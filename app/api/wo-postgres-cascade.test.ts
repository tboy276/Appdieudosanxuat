import { describe, it, expect } from "vitest";
import { supabaseAdmin } from "../../lib/supabase";
import { upsertProduct } from "../../lib/products";
import { createPO, updatePO, listPOs, getPO } from "../../lib/po-postgres";
import {
  listWOs,
  getWO,
  createWOsForPO,
  updateWO,
  recordWOProgress,
  recordShipment,
} from "../../lib/wo-postgres";

describe("Bước 3.4 — Work Orders Migration to Supabase PostgreSQL & Cascade Triggers Verification", () => {
  it("Item 1: 3-Step Routing Backward Propagation planned_qty calculation formula", async () => {
    const ts = Date.now();
    const sku = `SKU-ROUTING3-${ts}`;
    const poNum = `PO-ROUTING3-${ts}`;
    const customerName = `Khách Hàng Cascade 1 ${ts}`;

    // 1. Create Product with 3-step routing + distinct NG rates per step
    // Step 1: D1 (NG=10%), Step 2: CK1 (NG=20%), Step 3: MNL (NG=5%), Step 4: KTP (implicit)
    await upsertProduct({
      sku,
      nameVi: "SP Test 3 Bước Routing",
      customerName,
      routing: ["D1", "CK1", "MNL", "KTP"],
      routingScrapRates: { D1: 10, CK1: 20, MNL: 5 },
      routingLeadTimes: { D1: 2, CK1: 3, MNL: 1 },
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    // 2. Create PO with qty = 100
    const po = await createPO({
      poNumber: poNum,
      customerName,
      sku,
      productNameVi: "SP Test 3 Bước Routing",
      qty: 100,
      requestedDate: "2026-10-15",
    });

    // 3. Generate WOs for PO
    const { createdWos } = await createWOsForPO(po.poId, "admin");
    expect(createdWos).toHaveLength(3);

    const d1Wo = createdWos.find((w) => w.wcCode === "D1")!;
    const ck1Wo = createdWos.find((w) => w.wcCode === "CK1")!;
    const mnlWo = createdWos.find((w) => w.wcCode === "MNL")!;

    // Verification formula:
    // Step 3 (MNL): planned_qty = 100 (output demand for KTP)
    // Step 2 (CK1): planned_qty = ceil(100 * (1 + 0.05)) = 105 (supplies MNL)
    // Step 1 (D1): planned_qty = ceil(105 * (1 + 0.20)) = 126 (supplies CK1)
    expect(mnlWo.targetQty).toBe(100);
    expect(ck1Wo.targetQty).toBe(105);
    expect(d1Wo.targetQty).toBe(126);
  }, 30000);

  it("Item 2: Database Trigger fn_recalculate_wo_deadlines_for_po automatically updates all WO deadlines when PO requested_date changes", async () => {
    const ts = Date.now();
    const sku = `SKU-DEADLINE-PO-${ts}`;
    const poNum = `PO-DEADLINE-PO-${ts}`;
    const customerName = `Khách Hàng Cascade 2 ${ts}`;

    await upsertProduct({
      sku,
      nameVi: "SP Test Cascade PO Date",
      customerName,
      routing: ["D1", "CK1", "MNL", "KTP"],
      routingLeadTimes: { D1: 2, CK1: 3, MNL: 1 },
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: poNum,
      customerName,
      sku,
      productNameVi: "SP Test Cascade PO Date",
      qty: 100,
      requestedDate: "2026-10-15",
    });

    await createWOsForPO(po.poId, "admin");

    // Update requested_date on PO header in PostgreSQL
    const newDate = "2026-11-20";
    await updatePO(po.poId, { requestedDate: newDate });

    // Fetch WOs back to check trigger effect
    const updatedWos = await listWOs({ poId: po.poId });
    const d1Wo = updatedWos.find((w) => w.wcCode === "D1")!;
    const ck1Wo = updatedWos.find((w) => w.wcCode === "CK1")!;
    const mnlWo = updatedWos.find((w) => w.wcCode === "MNL")!;

    // Formula verification (backward propagation from 2026-11-20):
    // MNL (leadTime=1): deadline = 2026-11-20
    // CK1 (leadTime=3): deadline = 2026-11-20 minus 1 day = 2026-11-19
    // D1  (leadTime=2): deadline = 2026-11-19 minus 3 days = 2026-11-16
    expect(mnlWo.deadline).toBe("2026-11-20");
    expect(ck1Wo.deadline).toBe("2026-11-19");
    expect(d1Wo.deadline).toBe("2026-11-16");
  }, 30000);

  it("Item 3: Database Trigger fn_recalculate_wo_deadlines_on_wo_lead_time_change shifts preceding WO deadlines earlier while subsequent WOs remain unchanged", async () => {
    const ts = Date.now();
    const sku = `SKU-LEADTIME-${ts}`;
    const poNum = `PO-LEADTIME-${ts}`;
    const customerName = `Khách Hàng Cascade 3 ${ts}`;

    await upsertProduct({
      sku,
      nameVi: "SP Test Lead Time Shift",
      customerName,
      routing: ["D1", "CK1", "MNL", "KTP"],
      routingLeadTimes: { D1: 2, CK1: 1, MNL: 1 },
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: poNum,
      customerName,
      sku,
      productNameVi: "SP Test Lead Time Shift",
      qty: 100,
      requestedDate: "2026-10-10",
    });

    await createWOsForPO(po.poId, "admin");

    const initialWos = await listWOs({ poId: po.poId });
    const ck1Wo = initialWos.find((w) => w.wcCode === "CK1")!;

    // Update lead_time_days of middle WO (CK1) from 1 day to 5 days
    await updateWO(ck1Wo.woId, { leadTime: 5 });

    const updatedWos = await listWOs({ poId: po.poId });
    const d1Wo = updatedWos.find((w) => w.wcCode === "D1")!;
    const mnlWo = updatedWos.find((w) => w.wcCode === "MNL")!;

    // Subsequent WO (MNL) deadline MUST remain unchanged (2026-10-10)
    expect(mnlWo.deadline).toBe("2026-10-10");

    // Preceding WO (D1) deadline MUST shift earlier by +4 extra lead days (2026-10-10 - 1 - 5 = 2026-10-04)
    expect(d1Wo.deadline).toBe("2026-10-04");
  }, 30000);

  it("Item 4: PO Line order_qty cascade & IN_PROGRESS protection trigger (trg_guard_poline_order_qty & trg_recalculate_planned_qty_on_poline)", async () => {
    const ts = Date.now();
    const sku = `SKU-GUARD-${ts}`;
    const poNum = `PO-GUARD-${ts}`;
    const customerName = `Khách Hàng Cascade 4 ${ts}`;

    await upsertProduct({
      sku,
      nameVi: "SP Test Guard Order Qty",
      customerName,
      routing: ["D1", "KTP"],
      routingScrapRates: { D1: 10 },
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: poNum,
      customerName,
      sku,
      productNameVi: "SP Test Guard Order Qty",
      qty: 100,
      requestedDate: "2026-10-20",
    });

    await createWOsForPO(po.poId, "admin");

    // 1. When WO is PENDING (OPEN), update order_qty to 200 -> planned_qty cascades
    await updatePO(po.poId, { qty: 200 });

    let wos = await listWOs({ poId: po.poId });
    let d1Wo = wos.find((w) => w.wcCode === "D1")!;
    expect(d1Wo.targetQty).toBe(200);

    // 2. Set WO to IN_PROGRESS
    await updateWO(d1Wo.woId, { status: "IN_PROGRESS" });

    // 3. Attempting to update PO qty / PO line order_qty MUST be blocked by DB trigger
    await expect(
      updatePO(po.poId, { qty: 300 })
    ).rejects.toThrow(/Không thể sửa order_qty/i);
  }, 30000);

  it("Item 5: Verify listPOs() displays accurate shippedQty using real PostgreSQL SQL JOIN", async () => {
    const ts = Date.now();
    const sku = `SKU-JOIN-PO-${ts}`;
    const poNum = `PO-JOIN-PO-${ts}`;
    const customerName = `Khách Hàng Join ${ts}`;

    await upsertProduct({
      sku,
      nameVi: "SP Test SQL JOIN shippedQty",
      customerName,
      routing: ["D1", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: poNum,
      customerName,
      sku,
      productNameVi: "SP Test SQL JOIN shippedQty",
      qty: 100,
      requestedDate: "2026-10-25",
    });

    const { createdWos } = await createWOsForPO(po.poId, "admin");
    const d1Wo = createdWos[0];

    // Record shipment of 50 pcs
    await recordShipment([d1Wo.woId], { [d1Wo.woId]: 50 }, "dispatcher1");

    // Query listPOs via real SQL JOIN
    const poList = await listPOs();
    const matchedPo = poList.find((p) => p.poId === po.poId);

    expect(matchedPo).toBeDefined();
    expect(matchedPo?.shippedQty).toBe(50);
    expect(matchedPo?.status).toBe("IN_PRODUCTION");
  }, 30000);

  it("Item 6: Distinction between WO internal production completed_qty and true Customer Shipment shippedQty. All 3 WO steps completed_qty > 0 but shippedQty = 0 before recordShipment", async () => {
    const ts = Date.now();
    const customerName = `Khách Hàng XNT ${ts}`;
    const sku = `SKU-XNT-DIST-${ts}`;
    const poNum = `PO-XNT-DIST-${ts}`;

    await upsertProduct({
      sku,
      nameVi: "SP Test Phân Biệt Sản Xuất & Xuất Hàng",
      customerName,
      routing: ["D1", "CK1", "MNL", "KTP"],
      unit: "Cái",
      createdAt: "",
      updatedAt: "",
    });

    const po = await createPO({
      poNumber: poNum,
      customerName,
      sku,
      productNameVi: "SP Test Phân Biệt Sản Xuất & Xuất Hàng",
      qty: 100,
      requestedDate: "2026-10-30",
    });

    const { createdWos } = await createWOsForPO(po.poId, "admin");
    expect(createdWos).toHaveLength(3);

    const d1Wo = createdWos.find((w) => w.wcCode === "D1")!;
    const ck1Wo = createdWos.find((w) => w.wcCode === "CK1")!;
    const mnlWo = createdWos.find((w) => w.wcCode === "MNL")!;

    // Report internal production progress for all 3 steps (completed_qty > 0 for D1, CK1, MNL)
    await recordWOProgress(d1Wo.woId, "D1", 100, "worker1");
    await recordWOProgress(ck1Wo.woId, "CK1", 100, "worker2");
    await recordWOProgress(mnlWo.woId, "MNL", 100, "worker3");

    // Verify PO shippedQty MUST BE 0 (no customer shipment recorded yet)
    let poList = await listPOs();
    let matchedPo = poList.find((p) => p.poId === po.poId);
    expect(matchedPo).toBeDefined();
    expect(matchedPo?.shippedQty).toBe(0);

    // Call recordShipment for 60 pcs
    await recordShipment([mnlWo.woId], { [mnlWo.woId]: 60 }, "dispatcher1");

    // Verify PO shippedQty is now 60 (true customer shipment)
    poList = await listPOs();
    matchedPo = poList.find((p) => p.poId === po.poId);
    expect(matchedPo?.shippedQty).toBe(60);
  }, 30000);
});
