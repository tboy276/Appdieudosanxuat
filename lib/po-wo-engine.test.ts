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
      sadd: vi.fn(async (key: string, member: string) => {
        const set = setStore.get(key) || new Set<string>();
        set.add(member);
        setStore.set(key, set);
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
      __reset: () => {
        kvStore.clear();
        setStore.clear();
      },
    },
  };
});

import { computeWOPlan, createPO, createWO, recordWOProgress, closeWO, recordShipment } from "./po-wo-engine";
import { StockState } from "./types";
import { upsertProduct } from "./products";
import { redis } from "./redis";

describe("lib/po-wo-engine.ts - Order & Work Order Engine", () => {
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

    // Hand-calculated expected values:
    // LR  (scrap 0.00): ceil(100 / 1.00) = 100
    // MNL (scrap 0.03): ceil(100 / 0.97) = 104
    // CK1 (scrap 0.02): ceil(104 / 0.98) = 107
    // D1  (scrap 0.10): ceil(107 / 0.90) = 119
    expect(plan).toEqual([
      { code: "D1", plannedQty: 119 },
      { code: "CK1", plannedQty: 107 },
      { code: "MNL", plannedQty: 104 },
      { code: "LR", plannedQty: 100 },
    ]);
  });

  it("Case 2: computeWOPlan with existing tonBanThanhPham=20 at final step (LR) should reduce plannedQty at final step", () => {
    const routing = ["D1", "CK1", "MNL", "LR"];
    const targetQty = 100;
    const stockByCode: Record<string, StockState> = {
      LR: { tonPhoi: 0, tonPhoiDauVao: 0, tonBanThanhPham: 20 },
    };

    const plan = computeWOPlan("SKU-TEST-02", routing, targetQty, stockByCode, scrapRates);

    // Hand-calculated expected values:
    // LR: requiredOut = max(0, 100 - 20) = 80. plannedQty = 80
    // MNL: ceil(80 / 0.97) = 83
    // CK1: ceil(83 / 0.98) = 85
    // D1: ceil(85 / 0.90) = 95
    expect(plan).toEqual([
      { code: "D1", plannedQty: 95 },
      { code: "CK1", plannedQty: 85 },
      { code: "MNL", plannedQty: 83 },
      { code: "LR", plannedQty: 80 },
    ]);
  });

  it("Case 3: computeWOPlan with existing tonPhoiDauVao=50 at middle step (CK1) should reduce plannedQty for preceding steps (D1) only", () => {
    const routing = ["D1", "CK1", "MNL", "LR"];
    const targetQty = 100;
    const stockByCode: Record<string, StockState> = {
      CK1: { tonPhoi: 0, tonPhoiDauVao: 50, tonBanThanhPham: 0 },
    };

    const plan = computeWOPlan("SKU-TEST-03", routing, targetQty, stockByCode, scrapRates);

    // Hand-calculated expected values:
    // LR: 100
    // MNL: 104
    // CK1: 107
    // D1: need = max(0, 107 - 50 - 0) = 57 -> ceil(57 / 0.90) = 64
    expect(plan).toEqual([
      { code: "D1", plannedQty: 64 },
      { code: "CK1", plannedQty: 107 },
      { code: "MNL", plannedQty: 104 },
      { code: "LR", plannedQty: 100 },
    ]);
  });

  it("Case 4: closeWO should reject when final step is NOT DONE, and succeed when final step IS DONE", async () => {
    // 1. Setup Product with routing
    await upsertProduct({
      sku: "SKU-VAL-01",
      nameVi: "Van An Toàn",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    // 2. Create PO & WO
    const po = await createPO({
      poNumber: "PO-VAL-01",
      customerName: "Khách Hàng A",
      sku: "SKU-VAL-01",
      productNameVi: "Van An Toàn",
      qty: 50,
      requestedDate: "2026-08-15",
    });

    const wo = await createWO(po.poId, "admin");

    // 3. Attempt closeWO when steps are still PENDING
    await expect(closeWO(wo.woId, "admin")).rejects.toThrow(
      "Không thể đóng WO: Bước lắp ráp cuối cùng (LR) chưa hoàn thành."
    );

    // 4. Progress step 1 (D1) and step 2 (LR)
    await recordWOProgress(wo.woId, "D1", 60, "worker1");
    await recordWOProgress(wo.woId, "LR", 50, "worker2");

    // 5. Attempt closeWO again -> should succeed
    const closedWO = await closeWO(wo.woId, "admin");
    expect(closedWO.status).toBe("READY_TO_SHIP");
  });

  it("Case 5: recordShipment partial shipment should set po.status = PARTIALLY_SHIPPED, then COMPLETED upon full shipment", async () => {
    // 1. Setup Product, PO, WO
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

    // Progress and close WO
    await recordWOProgress(wo.woId, "R1", 110, "worker1");
    await recordWOProgress(wo.woId, "LR", 100, "worker2");
    await closeWO(wo.woId, "admin");

    // 2. Partial Shipment (40 pcs)
    await recordShipment([wo.woId], { [wo.woId]: 40 }, "dispatcher1");

    const updatedWo1 = (await redis.get(`wo:${wo.woId}`)) as any;
    const updatedPo1 = (await redis.get(`po:${po.poId}`)) as any;

    expect(updatedWo1.shippedQty).toBe(40);
    expect(updatedWo1.status).toBe("READY_TO_SHIP");
    expect(updatedPo1.shippedQty).toBe(40);
    expect(updatedPo1.status).toBe("PARTIALLY_SHIPPED");

    // 3. Complete Remaining Shipment (60 pcs)
    await recordShipment([wo.woId], { [wo.woId]: 60 }, "dispatcher1");

    const updatedWo2 = (await redis.get(`wo:${wo.woId}`)) as any;
    const updatedPo2 = (await redis.get(`po:${po.poId}`)) as any;

    expect(updatedWo2.shippedQty).toBe(100);
    expect(updatedWo2.status).toBe("SHIPPED");
    expect(updatedPo2.shippedQty).toBe(100);
    expect(updatedPo2.status).toBe("COMPLETED");
  });
});
