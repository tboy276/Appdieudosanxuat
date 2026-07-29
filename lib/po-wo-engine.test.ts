import { describe, it, expect, vi, beforeEach } from "vitest";

const kvStore = new Map<string, any>();
const setStore = new Map<string, Set<string>>();

vi.mock("./redis", () => {
  return {
    redis: {
      get: vi.fn(async (key: string) => kvStore.get(key) || null),
      set: vi.fn(async (key: string, val: any) => {
        kvStore.set(key, val);
        return "OK";
      }),
      del: vi.fn(async (key: string) => {
        kvStore.delete(key);
        return 1;
      }),
      sadd: vi.fn(async (key: string, member: string) => {
        const set = setStore.get(key) || new Set<string>();
        set.add(member);
        setStore.set(key, set);
        return 1;
      }),
      srem: vi.fn(async (key: string, member: string) => {
        const set = setStore.get(key);
        if (set) set.delete(member);
        return 1;
      }),
      smembers: vi.fn(async (key: string) => {
        const set = setStore.get(key);
        return set ? Array.from(set) : [];
      }),
      hget: vi.fn(async (key: string, field: string) => {
        const hash = kvStore.get(key);
        return hash ? hash[field] : null;
      }),
      hset: vi.fn(async (key: string, data: Record<string, any>) => {
        const existing = kvStore.get(key) || {};
        kvStore.set(key, { ...existing, ...data });
        return 1;
      }),
      hdel: vi.fn(async (key: string, field: string) => {
        const hash = kvStore.get(key);
        if (hash) delete hash[field];
        return 1;
      }),
      __reset: () => {
        kvStore.clear();
        setStore.clear();
      },
    },
  };
});

import {
  computeWOPlan,
  createPO,
  updatePO,
  deletePO,
  createWO,
  updateWO,
  deleteWO,
  recordWOProgress,
  closeWO,
  recordShipment,
} from "./po-wo-engine";
import { StockState } from "./types";
import { upsertProduct, deleteProduct } from "./products";
import { redis } from "./redis";

describe("lib/po-wo-engine.ts - Order & Work Order Engine (Dual-State Model)", () => {
  beforeEach(() => {
    (redis as any).__reset();
    vi.clearAllMocks();
  });

  const scrapRates = {
    D1: 0.10,
    CK1: 0.02,
    MNL: 0.03,
    LR: 0.00,
  };

  it("Case 1: computeWOPlan with targetQty=100 and zero stock should calculate plannedQty increasing backward", () => {
    const routing = ["D1", "CK1", "MNL", "LR"];
    const targetQty = 100;
    const stockByCode: Record<string, StockState> = {};

    const plan = computeWOPlan("SKU-TEST-01", routing, targetQty, stockByCode, scrapRates);

    expect(plan).toEqual([
      { code: "D1", plannedQty: 119 },
      { code: "CK1", plannedQty: 107 },
      { code: "MNL", plannedQty: 104 },
      { code: "LR", plannedQty: 100 },
    ]);
  });

  it("Case 2: computeWOPlan with existing tonThanhPham=20 at final step (LR) should reduce plannedQty at final step", () => {
    const routing = ["D1", "CK1", "MNL", "LR"];
    const targetQty = 100;
    const stockByCode: Record<string, StockState> = {
      LR: { tonPhoi: 0, tonThanhPham: 20 },
    };

    const plan = computeWOPlan("SKU-TEST-02", routing, targetQty, stockByCode, scrapRates);

    expect(plan).toEqual([
      { code: "D1", plannedQty: 95 },
      { code: "CK1", plannedQty: 85 },
      { code: "MNL", plannedQty: 83 },
      { code: "LR", plannedQty: 80 },
    ]);
  });

  it("Case 3: computeWOPlan with existing tonPhoi=50 at middle step (CK1) should reduce plannedQty for preceding steps (D1) only", () => {
    const routing = ["D1", "CK1", "MNL", "LR"];
    const targetQty = 100;
    const stockByCode: Record<string, StockState> = {
      CK1: { tonPhoi: 50, tonThanhPham: 0 },
    };

    const plan = computeWOPlan("SKU-TEST-03", routing, targetQty, stockByCode, scrapRates);

    expect(plan).toEqual([
      { code: "D1", plannedQty: 64 },
      { code: "CK1", plannedQty: 107 },
      { code: "MNL", plannedQty: 104 },
      { code: "LR", plannedQty: 100 },
    ]);
  });

  it("Case 4: closeWO should reject when final step is NOT DONE, and succeed when final step IS DONE", async () => {
    await upsertProduct({
      sku: "SKU-VAL-01",
      nameVi: "Van An Toàn",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: "PO-VAL-01",
      customerName: "Khách Hàng A",
      sku: "SKU-VAL-01",
      productNameVi: "Van An Toàn",
      qty: 50,
      requestedDate: "2026-08-15",
    });

    const wo = await createWO(po.poId, "admin");

    await expect(closeWO(wo.woId, "admin")).rejects.toThrow(
      "Không thể đóng WO: Bước lắp ráp cuối cùng (LR) chưa hoàn thành."
    );

    await recordWOProgress(wo.woId, "D1", 60, "worker1");
    await recordWOProgress(wo.woId, "LR", 50, "worker2");

    const closedWO = await closeWO(wo.woId, "admin");
    expect(closedWO.status).toBe("READY_TO_SHIP");
  });

  it("Case 5: recordShipment partial shipment should set po.status = PARTIALLY_SHIPPED, then COMPLETED upon full shipment", async () => {
    await upsertProduct({
      sku: "SKU-SHIP-01",
      nameVi: "Trục Nhông",
      routing: ["R1", "LR"],
      unit: "Bộ",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: "PO-SHIP-01",
      customerName: "Khách Hàng B",
      sku: "SKU-SHIP-01",
      productNameVi: "Trục Nhông",
      qty: 100,
      requestedDate: "2026-08-20",
    });

    const wo = await createWO(po.poId, "admin");

    await recordWOProgress(wo.woId, "R1", 110, "worker1");
    await recordWOProgress(wo.woId, "LR", 100, "worker2");
    await closeWO(wo.woId, "admin");

    await recordShipment([wo.woId], { [wo.woId]: 40 }, "dispatcher1");

    const updatedWo1 = (await redis.get(`wo:${wo.woId}`)) as any;
    const updatedPo1 = (await redis.get(`po:${po.poId}`)) as any;

    expect(updatedWo1.shippedQty).toBe(40);
    expect(updatedWo1.status).toBe("READY_TO_SHIP");
    expect(updatedPo1.shippedQty).toBe(40);
    expect(updatedPo1.status).toBe("PARTIALLY_SHIPPED");

    await recordShipment([wo.woId], { [wo.woId]: 60 }, "dispatcher1");

    const updatedWo2 = (await redis.get(`wo:${wo.woId}`)) as any;
    const updatedPo2 = (await redis.get(`po:${po.poId}`)) as any;

    expect(updatedWo2.shippedQty).toBe(100);
    expect(updatedWo2.status).toBe("SHIPPED");
    expect(updatedPo2.shippedQty).toBe(100);
    expect(updatedPo2.status).toBe("COMPLETED");
  });

  it("Case 6: Edit & Delete Safety Rules for SKU, PO and WO", async () => {
    await upsertProduct({
      sku: "SKU-DEL-01",
      nameVi: "SP Test Delete",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: "PO-DEL-01",
      customerName: "Khách Cần Xóa",
      sku: "SKU-DEL-01",
      productNameVi: "SP Test Delete",
      qty: 200,
      requestedDate: "2026-09-10",
    });

    // SKU cannot be deleted when referenced by PO
    await expect(deleteProduct("SKU-DEL-01")).rejects.toThrow(
      "Không thể xóa SKU SKU-DEL-01 do đang có Đơn hàng PO (PO-DEL-01) liên quan."
    );

    // Create WO
    const wo = await createWO(po.poId, "admin");

    // PO cannot be deleted when referenced by WO
    await expect(deletePO(po.poId)).rejects.toThrow("Không thể xóa PO");

    // Record progress at D1
    await recordWOProgress(wo.woId, "D1", 50, "worker1");

    // WO cannot be deleted once actual production occurred
    await expect(deleteWO(wo.woId)).rejects.toThrow("do đã có báo cáo sản lượng thực tế tại xưởng");

    // Test successful edit of PO
    const updatedPo = await updatePO(po.poId, { customerName: "Khách Cập Nhật" });
    expect(updatedPo.customerName).toBe("Khách Cập Nhật");
  });

  it("Case 7: Custom Planned Quantities & 1-PO-to-1-WO Constraint", async () => {
    await upsertProduct({
      sku: "SKU-CUSTOM-01",
      nameVi: "Trục Vít Tự Chọn",
      routing: ["D1", "CK1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: "PO-CUSTOM-01",
      customerName: "Khách Custom Qty",
      sku: "SKU-CUSTOM-01",
      productNameVi: "Trục Vít Tự Chọn",
      qty: 500,
      requestedDate: "2026-10-01",
    });

    // Create WO with custom planned quantities per workshop
    const wo = await createWO(po.poId, "admin", {
      D1: 600,
      CK1: 550,
      LR: 500,
    });

    expect(wo.steps).toEqual([
      { code: "D1", plannedQty: 600, actualQty: 0, status: "PENDING" },
      { code: "CK1", plannedQty: 550, actualQty: 0, status: "PENDING" },
      { code: "LR", plannedQty: 500, actualQty: 0, status: "PENDING" },
    ]);

    // Re-creating a second WO for the same PO must be rejected by 1-PO-to-1-WO rule
    await expect(createWO(po.poId, "admin")).rejects.toThrow("Mỗi PO chỉ được tạo 1 WO duy nhất");
  });
});
