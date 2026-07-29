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
  computeEquivalentFinishedQty,
  listPOs,
  listWOs,
  getWO,
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

  describe("computeEquivalentFinishedQty - Equivalent Finished Goods Calculation", () => {
    const customScrapRates = {
      D1: 0.10,
      CK1: 0.02,
      MNL: 0.03,
      LR: 0.00,
    };
    const routing = ["D1", "CK1", "MNL", "LR"];

    it("Case 1: 4-step routing with phoi at first step (D1) should reduce equivalentQty according to accumulated scrap rates", () => {
      const stockByCode: Record<string, StockState> = {
        D1: { tonPhoi: 1000, tonThanhPham: 0 },
      };

      const eqQty = computeEquivalentFinishedQty("SKU-EQ-01", routing, stockByCode, customScrapRates);

      // Yield factor: 0.90 * 0.98 * 0.97 * 1.00 = 0.85554
      // 1000 * 0.85554 = 855.54
      expect(eqQty).toBeCloseTo(855.54, 2);
    });

    it("Case 2: tonThanhPham at middle step (CK1) should NOT deduct scrap rate of CK1 (already completed step CK1)", () => {
      const stockByCode: Record<string, StockState> = {
        CK1: { tonPhoi: 0, tonThanhPham: 1000 },
      };

      const eqQty = computeEquivalentFinishedQty("SKU-EQ-02", routing, stockByCode, customScrapRates);

      // Yield factor for tonThanhPham at CK1: (1 - 0.03) * (1 - 0.00) = 0.97
      // 1000 * 0.97 = 970 (CK1's 2% scrap is NOT deducted)
      expect(eqQty).toBeCloseTo(970, 2);
    });

    it("Case 3: Exact Excel verification for 1000 pcs phoi at D1 yields ~855.54 equivalent finished goods instead of raw 1000", () => {
      const stockByCode: Record<string, StockState> = {
        D1: { tonPhoi: 1000, tonThanhPham: 0 },
        CK1: { tonPhoi: 0, tonThanhPham: 0 },
        MNL: { tonPhoi: 0, tonThanhPham: 0 },
        LR: { tonPhoi: 0, tonThanhPham: 0 },
      };

      const eqQty = computeEquivalentFinishedQty("SKU-EXCEL-01", routing, stockByCode, customScrapRates);

      expect(eqQty).toBeCloseTo(855.54, 2);
      expect(eqQty).not.toBe(1000);
    });

    it("Case 4: 2-step routing (D1 -> LR) off-by-one test: 1000 phoi at D1 yields 900 equivalent (D1 scrap 10%)", () => {
      const routing2 = ["D1", "LR"];
      const stockByCode: Record<string, StockState> = {
        D1: { tonPhoi: 1000, tonThanhPham: 500 },
        LR: { tonPhoi: 0, tonThanhPham: 200 },
      };

      const eqQty = computeEquivalentFinishedQty("SKU-2STEP", routing2, stockByCode, customScrapRates);

      // tonPhoi D1: 1000 * (1 - 0.10) * (1 - 0) = 900
      // tonThanhPham D1: 500 * (1 - 0) = 500
      // tonThanhPham LR: 200 * 1 = 200
      // Total = 900 + 500 + 200 = 1600
      expect(eqQty).toBe(1600);
    });

    it("Case 5: 5-step routing (CUAPHOI -> D1 -> CK1 -> MNL -> LR) off-by-one test across long chain", () => {
      const routing5 = ["CUAPHOI", "D1", "CK1", "MNL", "LR"];
      const scrap5 = {
        CUAPHOI: 0.01,
        D1: 0.10,
        CK1: 0.02,
        MNL: 0.03,
        LR: 0.00,
      };

      const stockByCode: Record<string, StockState> = {
        CUAPHOI: { tonPhoi: 1000, tonThanhPham: 0 },
        CK1: { tonPhoi: 500, tonThanhPham: 0 },
      };

      const eqQty = computeEquivalentFinishedQty("SKU-5STEP", routing5, stockByCode, scrap5);

      // CUAPHOI phoi: 1000 * 0.99 * 0.90 * 0.98 * 0.97 * 1.00 = 846.9846
      // CK1 phoi: 500 * 0.98 * 0.97 * 1.00 = 475.3
      // Total = 846.9846 + 475.3 = 1322.2846
      expect(eqQty).toBeCloseTo(1322.2846, 2);
    });
  });

  it("Case 8: Parallel listPOs() and listWOs() with 5 records preserves exact input order and filters out deleted nulls", async () => {
    await upsertProduct({
      sku: "SKU-BATCH",
      nameVi: "SP Batch Test",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const createdPOIds: string[] = [];
    const createdWOIds: string[] = [];

    // Create 5 POs and 5 WOs
    for (let i = 1; i <= 5; i++) {
      const po = await createPO({
        poId: `PO-BATCH-0${i}`,
        poNumber: `PO-BATCH-0${i}`,
        customerName: `Khách Hàng ${i}`,
        sku: "SKU-BATCH",
        productNameVi: "SP Batch Test",
        qty: 100 * i,
        requestedDate: "2026-09-01",
      });
      createdPOIds.push(po.poId);

      const wo = await createWO(po.poId, "admin");
      createdWOIds.push(wo.woId);
    }

    // Call listPOs() and listWOs()
    const allPOs = await listPOs();
    const allWOs = await listWOs();

    expect(allPOs).toHaveLength(5);
    expect(allWOs).toHaveLength(5);

    // Verify exact order preservation
    expect(allPOs.map((p) => p.poId)).toEqual(createdPOIds);
    expect(allWOs.map((w) => w.woId)).toEqual(createdWOIds);

    // Test filtering out deleted null records (simulate orphaned ID in Redis set)
    (redis as any).sadd("pos", "PO-DELETED-ORPHAN");
    (redis as any).sadd("wos", "WO-DELETED-ORPHAN");

    const allPOsWithOrphan = await listPOs();
    const allWOsWithOrphan = await listWOs();

    expect(allPOsWithOrphan).toHaveLength(5);
    expect(allWOsWithOrphan).toHaveLength(5);
    expect(allPOsWithOrphan.find((p) => p.poId === "PO-DELETED-ORPHAN")).toBeUndefined();
    expect(allWOsWithOrphan.find((w) => w.woId === "WO-DELETED-ORPHAN")).toBeUndefined();
  });

  it("Case 9: Increasing WO targetQty recalculates plannedQty and automatically reverts DONE status to PENDING if actualQty < newPlannedQty", async () => {
    await upsertProduct({
      sku: "SKU-UPDATE-INC",
      nameVi: "SP Test Increase Target",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poId: "PO-INC-01",
      poNumber: "PO-INC-01",
      customerName: "Khách Tăng Qty",
      sku: "SKU-UPDATE-INC",
      productNameVi: "SP Test Increase Target",
      qty: 100,
      requestedDate: "2026-09-15",
    });

    const wo = await createWO(po.poId, "admin");

    // Complete D1 step with 115 pcs (plannedQty is 112 for targetQty 100)
    await recordWOProgress(wo.woId, "D1", 115, "worker1");
    let woState = await getWO(wo.woId);
    let d1Step = woState?.steps.find((s) => s.code === "D1");
    expect(d1Step?.status).toBe("DONE");
    expect(d1Step?.plannedQty).toBe(112);

    // Increase targetQty to 200 -> D1 new plannedQty = ceil(200 / 0.9) = 223
    const updatedWO = await updateWO(wo.woId, { targetQty: 200 });
    d1Step = updatedWO.steps.find((s) => s.code === "D1");

    expect(d1Step?.plannedQty).toBe(223);
    // Since actualQty (115) < newPlannedQty (223), status MUST automatically revert to PENDING
    expect(d1Step?.status).toBe("PENDING");
  });

  it("Case 10: Decreasing WO targetQty recalculates plannedQty, retains DONE status if actualQty >= newPlannedQty, and preserves actualQty without error", async () => {
    await upsertProduct({
      sku: "SKU-UPDATE-DEC",
      nameVi: "SP Test Decrease Target",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poId: "PO-DEC-01",
      poNumber: "PO-DEC-01",
      customerName: "Khách Giảm Qty",
      sku: "SKU-UPDATE-DEC",
      productNameVi: "SP Test Decrease Target",
      qty: 200,
      requestedDate: "2026-09-15",
    });

    const wo = await createWO(po.poId, "admin");

    // Complete D1 step with 225 pcs
    await recordWOProgress(wo.woId, "D1", 225, "worker1");
    let d1Step = (await getWO(wo.woId))?.steps.find((s) => s.code === "D1");
    expect(d1Step?.status).toBe("DONE");

    // Decrease targetQty to 100 -> D1 new plannedQty = ceil(100 / 0.9) = 112
    // actualQty (225) >= newPlannedQty (112) -> retains DONE status and preserves 225 actualQty
    const updatedWO = await updateWO(wo.woId, { targetQty: 100 });
    d1Step = updatedWO.steps.find((s) => s.code === "D1");

    expect(d1Step?.plannedQty).toBe(112);
    expect(d1Step?.actualQty).toBe(225);
    expect(d1Step?.status).toBe("DONE");
  });

  it("Case 11: Real console.time benchmark measuring listPOs() and listWOs() execution speed with 25 records", async () => {
    await upsertProduct({
      sku: "SKU-BENCH",
      nameVi: "SP Bench Test",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    // Seed 25 POs and 25 WOs
    for (let i = 1; i <= 25; i++) {
      const po = await createPO({
        poId: `PO-BENCH-${i}`,
        poNumber: `PO-BENCH-${i}`,
        customerName: `Khách Bench ${i}`,
        sku: "SKU-BENCH",
        productNameVi: "SP Bench Test",
        qty: 100,
        requestedDate: "2026-09-01",
      });
      await createWO(po.poId, "admin");
    }

    console.time("⏱️ listPOs() [25 records]");
    const pos = await listPOs();
    console.timeEnd("⏱️ listPOs() [25 records]");

    console.time("⏱️ listWOs() [25 records]");
    const wos = await listWOs();
    console.timeEnd("⏱️ listWOs() [25 records]");

    expect(pos.length).toBeGreaterThanOrEqual(25);
    expect(wos.length).toBeGreaterThanOrEqual(25);
  });

  it("Case 12: Increasing WO targetQty on a READY_TO_SHIP WO automatically downgrades overall status back to IN_PROGRESS", async () => {
    await upsertProduct({
      sku: "SKU-SYNC-STATUS",
      nameVi: "SP Test Sync Status",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poId: "PO-SYNC-01",
      poNumber: "PO-SYNC-01",
      customerName: "Khách Ready To Ship",
      sku: "SKU-SYNC-STATUS",
      productNameVi: "SP Test Sync Status",
      qty: 100,
      requestedDate: "2026-09-20",
    });

    const wo = await createWO(po.poId, "admin");

    // Complete all steps and close WO to status READY_TO_SHIP
    await recordWOProgress(wo.woId, "D1", 120, "worker1");
    await recordWOProgress(wo.woId, "LR", 100, "worker2");
    const closedWO = await closeWO(wo.woId, "admin");
    expect(closedWO.status).toBe("READY_TO_SHIP");

    // Now increase targetQty to 200 -> LR plannedQty becomes 200, but LR actualQty is only 100
    const updatedWO = await updateWO(wo.woId, { targetQty: 200 });

    // Verify overall status is automatically downgraded to IN_PROGRESS
    expect(updatedWO.status).toBe("IN_PROGRESS");
    const lastStep = updatedWO.steps.find((s) => s.code === "LR");
    expect(lastStep?.status).toBe("PENDING");
  });

  it("Case 13: Updating WO targetQty below shippedQty must be rejected with explicit error", async () => {
    await upsertProduct({
      sku: "SKU-REJECT-QTY",
      nameVi: "SP Test Reject Qty",
      routing: ["D1", "LR"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poId: "PO-REJECT-01",
      poNumber: "PO-REJECT-01",
      customerName: "Khách Xuất Hàng Rồi",
      sku: "SKU-REJECT-QTY",
      productNameVi: "SP Test Reject Qty",
      qty: 100,
      requestedDate: "2026-09-25",
    });

    const wo = await createWO(po.poId, "admin");

    await recordWOProgress(wo.woId, "D1", 115, "worker1");
    await recordWOProgress(wo.woId, "LR", 100, "worker2");
    await closeWO(wo.woId, "admin");

    // Record 60 pcs shipped
    await recordShipment([wo.woId], { [wo.woId]: 60 }, "dispatcher1");

    // Try to update targetQty to 50 (below shippedQty of 60) -> MUST REJECT
    await expect(updateWO(wo.woId, { targetQty: 50 })).rejects.toThrow(
      "Không thể giảm targetQty (50 pcs) xuống dưới số lượng đã xuất hàng (60 pcs)."
    );
  });
});
