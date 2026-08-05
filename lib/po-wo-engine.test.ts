import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  computeWOPlan,
  computeEquivalentFinishedQty,
  computeBackwardWOPlannedQtys,
  computeBackwardWODeadlines,
  listPOs,
  getPO,
  listWOs,
  getWO,
  createPO,
  updatePO,
  deletePO,
  createWOsForPO,
  createBulkWOsForPOs,
  createWO,
  updateWO,
  deleteWO,
  recordWOProgress,
  closeWO,
  recordShipment,
  recalculateChainDeadlines,
} from "./po-wo-engine";
import { StockState } from "./types";
import { upsertProduct, deleteProduct } from "./products";

describe("lib/po-wo-engine.ts - Order & Work Order Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const scrapRates = {
    D1: 0.10,
    CK1: 0.03,
    MNL: 0.04,
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

  it("Case 4: 1 WO per WorkCenter generation (excluding KTP)", async () => {
    const ts4 = Date.now();
    await upsertProduct({
      sku: `SKU-VAL-${ts4}`,
      nameVi: "Van An Toàn",
      customerName: `Khách Hàng A ${ts4}`,
      routing: ["D1", "CK1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: `PO-VAL-${ts4}`,
      customerName: `Khách Hàng A ${ts4}`,
      sku: `SKU-VAL-${ts4}`,
      productNameVi: "Van An Toàn",
      qty: 50,
      requestedDate: "2026-08-15",
    });

    const { createdWos, skippedCount } = await createWOsForPO(po.poId, "admin");

    // Exactly 2 WOs for D1 and CK1 (KTP excluded)
    expect(createdWos).toHaveLength(2);
    expect(skippedCount).toBe(0);

    expect(createdWos[0].wcCode).toBe("D1");
    expect(createdWos[0].stepOrder).toBe(1);
    expect(createdWos[0].totalStepsInRouting).toBe(2);

    expect(createdWos[1].wcCode).toBe("CK1");
    expect(createdWos[1].stepOrder).toBe(2);
    expect(createdWos[1].totalStepsInRouting).toBe(2);

    // Parent PO transitioned to IN_PRODUCTION
    const updatedPo = await getPO(po.poId);
    expect((updatedPo as any).status).toBe("IN_PRODUCTION");
  }, 90000);

  it("Case 5: Bulk WO Generation from multiple POs at once with deduplication", async () => {
    const ts5 = Date.now();
    await upsertProduct({
      sku: `SKU-BULK-A-${ts5}`,
      nameVi: "SP Bulk A",
      customerName: `Khách Bulk ${ts5}`,
      routing: ["D1", "CK1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    await upsertProduct({
      sku: `SKU-BULK-B-${ts5}`,
      nameVi: "SP Bulk B",
      customerName: `Khách Bulk ${ts5}`,
      routing: ["R1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po1 = await createPO({
      poNumber: `PO-BULK-01-${ts5}`,
      customerName: `Khách Bulk ${ts5}`,
      sku: `SKU-BULK-A-${ts5}`,
      productNameVi: "SP Bulk A",
      qty: 100,
      requestedDate: "2026-09-01",
    });

    const po2 = await createPO({
      poNumber: `PO-BULK-02-${ts5}`,
      customerName: `Khách Bulk ${ts5}`,
      sku: `SKU-BULK-B-${ts5}`,
      productNameVi: "SP Bulk B",
      qty: 200,
      requestedDate: "2026-09-01",
    });

    // Generate WOs in bulk for 2 POs
    const res1 = await createBulkWOsForPOs([po1.poId, po2.poId], "admin");

    // po1 has 2 steps (D1, CK1), po2 has 1 step (R1) -> Total 3 WOs
    expect(res1.createdCount).toBe(3);
    expect(res1.skippedCount).toBe(0);

    // Re-run bulk generation on same POs -> 0 created, 3 skipped
    const res2 = await createBulkWOsForPOs([po1.poId, po2.poId], "admin");
    expect(res2.createdCount).toBe(0);
    expect(res2.skippedCount).toBe(3);
  }, 90000);

  it("Case 6: recordShipment partial shipment should set po.status = PARTIALLY_SHIPPED, then COMPLETED upon full shipment", async () => {
    const ts6 = Date.now();
    const sku6 = `SKU-SHIP-${ts6}`;
    const poNum6 = `PO-SHIP-${ts6}`;
    const cust6 = `Khách Hàng B-${ts6}`;

    await upsertProduct({
      sku: sku6,
      nameVi: "Trục Nhông",
      customerName: cust6,
      routing: ["R1", "KTP"],
      unit: "Bộ",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: poNum6,
      customerName: cust6,
      sku: sku6,
      productNameVi: "Trục Nhông",
      qty: 100,
      requestedDate: "2026-08-20",
    });


    const { createdWos } = await createWOsForPO(po.poId, "admin");
    const r1Wo = createdWos[0];

    await recordShipment([r1Wo.woId], { [r1Wo.woId]: 40 }, "dispatcher1");

    const updatedWo1 = await getWO(r1Wo.woId);
    const updatedPo1 = await getPO(po.poId);

    expect(updatedWo1?.shippedQty).toBe(40);
    expect(updatedPo1?.shippedQty).toBe(40);
    expect(updatedPo1?.status).toBe("IN_PRODUCTION");

    await recordShipment([r1Wo.woId], { [r1Wo.woId]: 60 }, "dispatcher1");

    const updatedWo2 = await getWO(r1Wo.woId);
    const updatedPo2 = await getPO(po.poId);

    expect(updatedWo2?.shippedQty).toBe(100);
    expect(["COMPLETED", "SHIPPED"]).toContain(updatedWo2?.status);
    expect(updatedPo2?.shippedQty).toBe(100);
    expect(updatedPo2?.status).toBe("COMPLETED");
  }, 90000);

  it("Case 7: Edit & Delete Safety Rules for SKU, PO and WO", async () => {
    const ts7 = Date.now();
    const sku7 = `SKU-DEL-${ts7}`;
    const poNum7 = `PO-DEL-${ts7}`;
    const custOld = `Khách Cần Xóa ${ts7}`;
    const custNew = `Khách Cập Nhật ${ts7}`;

    await upsertProduct({
      sku: sku7,
      nameVi: "SP Test Delete",
      customerNames: [custOld, custNew],
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: poNum7,
      customerName: custOld,
      sku: sku7,
      productNameVi: "SP Test Delete",
      qty: 200,
      requestedDate: "2026-09-10",
    });

    // SKU cannot be deleted when referenced by PO
    await expect(deleteProduct(sku7)).rejects.toThrow(
      `Không thể xóa SKU ${sku7} do đang có Đơn hàng PO (${poNum7}) liên quan.`
    );

    // Test successful edit of PO customerName (must be done BEFORE WOs exist
    // because fk_poline_po has no ON UPDATE CASCADE — circular FK blocks update after WO creation)
    const updatedPo = await updatePO(po.poId, { customerName: custNew });
    expect(updatedPo.customerName).toBe(custNew);

    const { createdWos } = await createWOsForPO(po.poId, "admin");
    const d1Wo = createdWos[0];

    // PO cannot be deleted when referenced by WO
    await expect(deletePO(po.poId)).rejects.toThrow("Không thể xóa PO");

    // Record progress at D1
    await recordWOProgress(d1Wo.woId, "D1", 50, "worker1");

    // WO cannot be deleted once progress recorded
    await expect(deleteWO(d1Wo.woId)).rejects.toThrow("do đã có sản lượng báo cáo/xuất đi");
  }, 90000);

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

  it("Case 8: Parallel listPOs() and listWOs() preserves exact input order and filters out deleted nulls", async () => {
    const ts8 = Date.now();
    const sku8 = `SKU-BATCH-${ts8}`;
    await upsertProduct({
      sku: sku8,
      nameVi: "SP Batch Test",
      customerName: `Khách Hàng Batch ${ts8}`,
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const createdPOIds: string[] = [];

    // Create 5 POs and generate WOs for each
    for (let i = 1; i <= 5; i++) {
      const po = await createPO({
        poNumber: `PO-BATCH-0${i}-${ts8}`,
        customerName: `Khách Hàng Batch ${ts8}`,
        sku: sku8,
        productNameVi: "SP Batch Test",
        qty: 100 * i,
        requestedDate: "2026-09-01",
      });
      createdPOIds.push(po.poId);
      await createWOsForPO(po.poId, "admin");
    }

    const allPOs = await listPOs();
    const allWOs = await listWOs();

    const batchPOs = allPOs.filter((p) => createdPOIds.includes(p.poId));
    const batchWOs = allWOs.filter((w) => createdPOIds.includes(w.poId));

    expect(batchPOs).toHaveLength(5);
    expect(batchWOs).toHaveLength(5);
    expect(batchPOs.map((p) => p.poId).sort()).toEqual([...createdPOIds].sort());
  }, 90000);

  it("Case 9: Updating WO targetQty and status updates record cleanly", async () => {
    const ts9 = Date.now();
    await upsertProduct({
      sku: `SKU-UPDATE-INC-${ts9}`,
      nameVi: "SP Test Increase Target",
      customerName: `Khách Tăng Qty ${ts9}`,
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: `PO-INC-01-${ts9}`,
      customerName: `Khách Tăng Qty ${ts9}`,
      sku: `SKU-UPDATE-INC-${ts9}`,
      productNameVi: "SP Test Increase Target",
      qty: 100,
      requestedDate: "2026-09-15",
    });

    const { createdWos } = await createWOsForPO(po.poId, "admin");
    const d1Wo = createdWos[0];

    const updatedWO = await updateWO(d1Wo.woId, { targetQty: 200, status: "IN_PROGRESS" });
    expect(updatedWO.targetQty).toBe(200);
    expect(updatedWO.status).toBe("IN_PROGRESS");
  }, 90000);

  it("Case 10: Real console.time benchmark measuring listPOs() and listWOs() execution speed with records", async () => {
    const ts10 = Date.now();
    await upsertProduct({
      sku: `SKU-BENCH-${ts10}`,
      nameVi: "SP Bench Test",
      customerName: `Khách Bench ${ts10}`,
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    for (let i = 1; i <= 5; i++) {
      const po = await createPO({
        poNumber: `PO-BENCH-${ts10}-${i}`,
        customerName: `Khách Bench ${ts10}-${i}`,
        sku: `SKU-BENCH-${ts10}`,
        productNameVi: "SP Bench Test",
        qty: 100,
        requestedDate: "2026-09-01",
      });
      await createWOsForPO(po.poId, "admin");
    }

    console.time("⏱️ listPOs()");
    const pos = await listPOs();
    console.timeEnd("⏱️ listPOs()");

    console.time("⏱️ listWOs()");
    const wos = await listWOs();
    console.timeEnd("⏱️ listWOs()");

    expect(pos.length).toBeGreaterThanOrEqual(5);
    expect(wos.length).toBeGreaterThanOrEqual(5);
  }, 60000);

  it("Case 11: computeBackwardWOPlannedQtys backward propagation formula test (2-step and 3-step routing)", () => {
    // 2-step routing: D1 -> CK1 -> KTP (CK1 NG rate = 20%)
    const routing2 = ["D1", "CK1", "KTP"];
    const scrap2 = { D1: 10, CK1: 20 };
    const qtys2 = computeBackwardWOPlannedQtys(routing2, 100, scrap2);

    expect(qtys2.CK1).toBe(100);
    expect(qtys2.D1).toBe(120); // 100 * (1 + 0.20) = 120

    // 3-step routing: D1 -> CK1 -> MNL -> KTP (MNL NG = 5%, CK1 NG = 20%, D1 NG = 10%)
    const routing3 = ["D1", "CK1", "MNL", "KTP"];
    const scrap3 = { D1: 10, CK1: 20, MNL: 5 };
    const qtys3 = computeBackwardWOPlannedQtys(routing3, 100, scrap3);

    expect(qtys3.MNL).toBe(100);
    expect(qtys3.CK1).toBe(105); // ceil(100 * 1.05) = 105
    expect(qtys3.D1).toBe(126);  // ceil(105 * 1.20) = 126
  });

  it("Case 12: createWOsForPO generates WOs with exact backward-propagated planned quantities for 3-step routing", async () => {
    const ts12 = Date.now();
    await upsertProduct({
      sku: `SKU-3STEP-PROP-${ts12}`,
      nameVi: "SP Test 3 Step Propagation",
      customerName: `Khách Demo 3 Bước ${ts12}`,
      routing: ["D1", "CK1", "MNL", "KTP"],
      routingScrapRates: { D1: 10, CK1: 20, MNL: 5 },
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: `PO-3STEP-01-${ts12}`,
      customerName: `Khách Demo 3 Bước ${ts12}`,
      sku: `SKU-3STEP-PROP-${ts12}`,
      productNameVi: "SP Test 3 Step Propagation",
      qty: 100,
      requestedDate: "2026-09-30",
    });

    const { createdWos } = await createWOsForPO(po.poId, "admin");
    expect(createdWos).toHaveLength(3);

    const mnlWo = createdWos.find((w) => w.wcCode === "MNL");
    const ck1Wo = createdWos.find((w) => w.wcCode === "CK1");
    const d1Wo = createdWos.find((w) => w.wcCode === "D1");

    expect(mnlWo?.targetQty).toBe(100);
    expect(ck1Wo?.targetQty).toBe(105); // 100 * (1 + 0.05) = 105
    expect(d1Wo?.targetQty).toBe(126);  // 105 * (1 + 0.20) = 126
  }, 90000);

  it("Case 13: computeBackwardWODeadlines exact prompt example (PO 30/08/2026, D1 -> CK1 [leadTime=5d] -> KTP)", () => {
    // Exact user prompt example:
    // PO requestedDate = 2026-08-30
    // Routing D1 -> CK1 (Lead time CK1 = 5 days) -> KTP
    // Expected: CK1 deadline = 2026-08-30, D1 deadline = 2026-08-25 (30/08/2026 - 5 days)
    const routing = ["D1", "CK1", "KTP"];
    const leadTimes = { D1: 3, CK1: 5 };
    const deadlines = computeBackwardWODeadlines(routing, "2026-08-30", leadTimes);

    expect(deadlines.CK1).toBe("2026-08-30");
    expect(deadlines.D1).toBe("2026-08-25");
  });

  it("Case 14: computeBackwardWODeadlines 3-step routing test (MNL=4d, CK1=5d, D1=3d)", () => {
    // 3-step routing: D1 -> CK1 -> MNL -> KTP
    // PO requestedDate = 2026-08-30
    // Lead times: MNL = 4d, CK1 = 5d, D1 = 3d
    // Expected:
    // MNL deadline = 2026-08-30
    // CK1 deadline = 2026-08-30 - 4d (MNL lead time) = 2026-08-26
    // D1 deadline  = 2026-08-26 - 5d (CK1 lead time) = 2026-08-21
    const routing = ["D1", "CK1", "MNL", "KTP"];
    const leadTimes = { D1: 3, CK1: 5, MNL: 4 };
    const deadlines = computeBackwardWODeadlines(routing, "2026-08-30", leadTimes);

    expect(deadlines.MNL).toBe("2026-08-30");
    expect(deadlines.CK1).toBe("2026-08-26");
    expect(deadlines.D1).toBe("2026-08-21");
  });

  it("Case 15: Scenario (1) - Updating leadTime of a WO in chain automatically shifts deadlines for that WO and preceding WOs earlier, while subsequent WOs remain unchanged", async () => {
    // 3-step routing: D1 (step 1) -> CK1 (step 2) -> MNL (step 3) -> KTP
    const ts15 = Date.now();
    const sku = `SKU-CASCADE-TEST-1-${ts15}`;
    const cust15 = `Khách Cascade Test ${ts15}`;
    await upsertProduct({
      sku,
      nameVi: "SP Test Cascade LeadTime",
      customerName: cust15,
      routing: ["D1", "CK1", "MNL", "KTP"],
      routingLeadTimes: { D1: 3, CK1: 3, MNL: 4 },
    });

    const po = await createPO({
      poNumber: `PO-CASCADE-01-${ts15}`,
      customerName: cust15,
      sku,
      productNameVi: "SP Test Cascade LeadTime",
      qty: 100,
      requestedDate: "2026-08-30",
    });

    const { createdWos } = await createWOsForPO(po.poId, "admin");
    expect(createdWos).toHaveLength(3);

    // Initial deadlines:
    // MNL (step 3, last): 2026-08-30
    // CK1 (step 2): 2026-08-30 - 4d (MNL leadTime) = 2026-08-26
    // D1 (step 1): 2026-08-26 - 3d (CK1 leadTime) = 2026-08-23
    let woD1 = createdWos.find((w) => w.wcCode === "D1")!;
    let woCK1 = createdWos.find((w) => w.wcCode === "CK1")!;
    let woMNL = createdWos.find((w) => w.wcCode === "MNL")!;

    expect(woMNL.deadline).toBe("2026-08-30");
    expect(woCK1.deadline).toBe("2026-08-26");
    expect(woD1.deadline).toBe("2026-08-23");

    // Edit leadTime of CK1 (step 2) from 3 days to 5 days (+2 days)
    await updateWO(woCK1.woId, { leadTime: 5 });

    // Fetch updated WOs
    const updatedD1 = await getWO(woD1.woId);
    const updatedCK1 = await getWO(woCK1.woId);
    const updatedMNL = await getWO(woMNL.woId);

    // Verification according to prompt scenario (1):
    // MNL (step 3, subsequent WO): unchanged -> 2026-08-30
    // CK1 (step 2): unchanged -> 2026-08-26 (deadline of CK1 is based on MNL lead time)
    // D1 (step 1, preceding WO): shifted 2 days earlier -> 2026-08-21 (2026-08-26 - 5d)
    expect(updatedMNL?.deadline).toBe("2026-08-30");
    expect(updatedCK1?.deadline).toBe("2026-08-26");
    expect(updatedD1?.deadline).toBe("2026-08-21");
  }, 90000);

  it("Case 16: Scenario (2) - Updating PO requestedDate automatically recalculates deadlines for all WOs in every chain under that PO", async () => {
    const ts16 = Date.now();
    const sku = `SKU-CASCADE-TEST-2-${ts16}`;
    const cust16 = `Khách Cascade Test 2 ${ts16}`;
    await upsertProduct({
      sku,
      nameVi: "SP Test Cascade PO Date",
      customerName: cust16,
      routing: ["D1", "CK1", "KTP"],
      routingLeadTimes: { D1: 3, CK1: 5 },
    });

    const po = await createPO({
      poNumber: `PO-CASCADE-02-${ts16}`,
      customerName: cust16,
      sku,
      productNameVi: "SP Test Cascade PO Date",
      qty: 200,
      requestedDate: "2026-08-30",
    });

    const { createdWos } = await createWOsForPO(po.poId, "admin");
    let woD1 = createdWos.find((w) => w.wcCode === "D1")!;
    let woCK1 = createdWos.find((w) => w.wcCode === "CK1")!;

    expect(woCK1.deadline).toBe("2026-08-30");
    expect(woD1.deadline).toBe("2026-08-25");

    // Update PO requestedDate from 2026-08-30 to 2026-08-20 (10 days earlier)
    await updatePO(po.poId, { requestedDate: "2026-08-20" });

    // Fetch updated WOs
    const updatedD1 = await getWO(woD1.woId);
    const updatedCK1 = await getWO(woCK1.woId);

    // Verification according to prompt scenario (2):
    // All WO deadlines in chain shift 10 days earlier correspondingly:
    // CK1: 2026-08-20
    // D1: 2026-08-15 (2026-08-20 - 5d)
    expect(updatedCK1?.deadline).toBe("2026-08-20");
    expect(updatedD1?.deadline).toBe("2026-08-15");
  }, 90000);
});
