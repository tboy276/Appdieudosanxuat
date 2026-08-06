import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { supabaseAdmin } from "./supabase";
import { recordProductionInput, recordTransfer, getXNTReport } from "./inventory-postgres";
import { createPO } from "./po-postgres";
import { getTodayVN } from "./date-utils";

describe("lib/inventory-auto-allocation.test.ts - Auto-allocation & Decoupled Transfer Engine", () => {
  const testSuffix = Date.now().toString().slice(-6);
  const testSku = `SKU-AUTO-${testSuffix}`;
  let productId: string;
  let wsD1Id: string;
  let wsCK1Id: string;
  let wo1Id: string;
  let wo2Id: string;
  let wo3Id: string;
  const poIds: string[] = [];

  beforeAll(async () => {
    // 1. Ensure workshops D1 & CK1 exist
    const { data: wsD1 } = await supabaseAdmin.from("workshops").select("id").eq("code", "D1").single();
    wsD1Id = wsD1!.id;

    const { data: wsCK1 } = await supabaseAdmin.from("workshops").select("id").eq("code", "CK1").single();
    wsCK1Id = wsCK1!.id;

    // 2. Create 3 POs for the same SKU (each will have its own D1 WO)
    const savedPo1 = await createPO({
      poNumber: `PO-AUTO-1-${testSuffix}`,
      customerName: `Customer A ${testSuffix}`,
      sku: testSku,
      productNameVi: `Test Product Auto Alloc ${testSuffix}`,
      qty: 100,
      requestedDate: "2026-08-10",
      status: "IN_PRODUCTION",
    });
    poIds.push(savedPo1.poId);

    const savedPo2 = await createPO({
      poNumber: `PO-AUTO-2-${testSuffix}`,
      customerName: `Customer B ${testSuffix}`,
      sku: testSku,
      productNameVi: `Test Product Auto Alloc ${testSuffix}`,
      qty: 80,
      requestedDate: "2026-08-08",
      status: "IN_PRODUCTION",
    });
    poIds.push(savedPo2.poId);

    const savedPo3 = await createPO({
      poNumber: `PO-AUTO-3-${testSuffix}`,
      customerName: `Customer C ${testSuffix}`,
      sku: testSku,
      productNameVi: `Test Product Auto Alloc ${testSuffix}`,
      qty: 50,
      requestedDate: "2026-08-20",
      status: "IN_PRODUCTION",
    });
    poIds.push(savedPo3.poId);

    const { data: prod } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("part_no", testSku)
      .single();

    productId = prod!.id;

    const { data: line1 } = await supabaseAdmin.from("po_lines").select("id").eq("po_id", savedPo1.poId).single();
    const { data: line2 } = await supabaseAdmin.from("po_lines").select("id").eq("po_id", savedPo2.poId).single();
    const { data: line3 } = await supabaseAdmin.from("po_lines").select("id").eq("po_id", savedPo3.poId).single();

    // Setup routing D1 (step 1) -> CK1 (step 2)
    await supabaseAdmin.from("product_routings").insert([
      { product_id: productId, workshop_id: wsD1Id, step_order: 1 },
      { product_id: productId, workshop_id: wsCK1Id, step_order: 2 },
    ]);

    // 3. Create 3 WOs for D1 with different deadlines
    // WO 1: deadline 2026-08-10, planned 100
    const { data: w1, error: e1 } = await supabaseAdmin
      .from("work_orders")
      .insert({
        po_line_id: line1!.id,
        product_id: productId,
        workshop_id: wsD1Id,
        wo_number: `WO-TEST-1-${testSuffix}`,
        planned_qty: 100,
        completed_qty: 0,
        deadline: "2026-08-10",
        status: "IN_PROGRESS",
        step_order: 1,
        lead_time_days: 3,
      })
      .select("id")
      .single();
    if (e1) throw e1;
    wo1Id = w1!.id;

    // WO 2: deadline 2026-08-08 (earlier!), planned 80
    const { data: w2, error: e2 } = await supabaseAdmin
      .from("work_orders")
      .insert({
        po_line_id: line2!.id,
        product_id: productId,
        workshop_id: wsD1Id,
        wo_number: `WO-TEST-2-${testSuffix}`,
        planned_qty: 80,
        completed_qty: 0,
        deadline: "2026-08-08",
        status: "IN_PROGRESS",
        step_order: 1,
        lead_time_days: 2,
      })
      .select("id")
      .single();
    if (e2) throw e2;
    wo2Id = w2!.id;

    // WO 3: deadline 2026-08-20 (latest deadline), planned 50
    const { data: w3, error: e3 } = await supabaseAdmin
      .from("work_orders")
      .insert({
        po_line_id: line3!.id,
        product_id: productId,
        workshop_id: wsD1Id,
        wo_number: `WO-TEST-3-${testSuffix}`,
        planned_qty: 50,
        completed_qty: 0,
        deadline: "2026-08-20",
        status: "IN_PROGRESS",
        step_order: 1,
        lead_time_days: 1,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    wo3Id = w3!.id;
  }, 20000);

  afterAll(async () => {
    // Cleanup test transactions, WOs, routings, POs, product
    if (productId) {
      await supabaseAdmin.from("inventory_transactions").delete().eq("product_id", productId);
      await supabaseAdmin.from("work_orders").delete().eq("product_id", productId);
      await supabaseAdmin.from("po_lines").delete().eq("product_id", productId);
      if (poIds.length > 0) {
        await supabaseAdmin.from("purchase_orders").delete().in("id", poIds);
      }
      await supabaseAdmin.from("product_customers").delete().eq("product_id", productId);
      await supabaseAdmin.from("product_routings").delete().eq("product_id", productId);
      await supabaseAdmin.from("products").delete().eq("id", productId);
    }
  });

  it("should auto-allocate to earliest deadline first (WO 2 before WO 1)", async () => {
    // Report 50 pcs for D1 / testSku
    // Since WO2 has deadline 2026-08-08 (needed 80) and WO1 has 2026-08-10, all 50 pcs should go to WO2
    const result = await recordProductionInput("D1", testSku, 50, "test_admin", true);

    expect(result.totalQtyOk).toBe(50);
    expect(result.excessQty).toBe(0);
    expect(result.allocations.length).toBe(1);
    expect(result.allocations[0].woId).toBe(wo2Id);
    expect(result.allocations[0].allocatedQty).toBe(50);
    expect(result.allocations[0].isCompleted).toBe(false);

    // Verify in DB that WO 2 completed_qty is now 50
    const { data: wo2 } = await supabaseAdmin.from("work_orders").select("completed_qty").eq("id", wo2Id).single();
    expect(wo2?.completed_qty).toBe(50);
  });

  it("should cascade allocation across multiple WOs when quantity fills the first WO", async () => {
    // Currently WO2 has 50/80 (needs 30). WO1 has 0/100 (needs 100). WO3 has 0/50 (needs 50).
    // Now report 70 pcs:
    // - 30 pcs should complete WO2 (reaching 80/80)
    // - 40 pcs should go to WO1 (reaching 40/100)
    const result = await recordProductionInput("D1", testSku, 70, "test_admin", true);

    expect(result.totalQtyOk).toBe(70);
    expect(result.excessQty).toBe(0);
    expect(result.allocations.length).toBe(2);

    // First allocation completes WO2
    const allocWo2 = result.allocations.find((a) => a.woId === wo2Id);
    expect(allocWo2).toBeDefined();
    expect(allocWo2!.allocatedQty).toBe(30);
    expect(allocWo2!.isCompleted).toBe(true);

    // Second allocation goes to WO1
    const allocWo1 = result.allocations.find((a) => a.woId === wo1Id);
    expect(allocWo1).toBeDefined();
    expect(allocWo1!.allocatedQty).toBe(40);
    expect(allocWo1!.isCompleted).toBe(false);

    // Verify DB states
    const { data: wo2Db } = await supabaseAdmin.from("work_orders").select("completed_qty, status").eq("id", wo2Id).single();
    expect(wo2Db?.completed_qty).toBe(80);
    expect(wo2Db?.status).toBe("COMPLETED");

    const { data: wo1Db } = await supabaseAdmin.from("work_orders").select("completed_qty, status").eq("id", wo1Id).single();
    expect(wo1Db?.completed_qty).toBe(40);
    expect(wo1Db?.status).toBe("IN_PROGRESS");
  });

  it("should record excess production with woId = null without blocking when exceeding total open WOs", async () => {
    // Current remaining need:
    // - WO2: 0 (completed)
    // - WO1: 60 (has 40/100)
    // - WO3: 50 (has 0/50)
    // Total remaining need across all open WOs = 110 pcs.
    // Report 150 pcs (excess of 40 pcs):
    // - 60 pcs completes WO1 (100/100 -> READY_TO_SHIP)
    // - 50 pcs completes WO3 (50/50 -> READY_TO_SHIP)
    // - 40 pcs is recorded as excess with woId = NULL
    const result = await recordProductionInput("D1", testSku, 150, "test_admin", true);

    expect(result.totalQtyOk).toBe(150);
    expect(result.excessQty).toBe(40);
    expect(result.allocations.length).toBe(3);

    const allocWo1 = result.allocations.find((a) => a.woId === wo1Id);
    expect(allocWo1?.allocatedQty).toBe(60);
    expect(allocWo1?.isCompleted).toBe(true);

    const allocWo3 = result.allocations.find((a) => a.woId === wo3Id);
    expect(allocWo3?.allocatedQty).toBe(50);
    expect(allocWo3?.isCompleted).toBe(true);

    const excessAlloc = result.allocations.find((a) => a.woId === null);
    expect(excessAlloc?.allocatedQty).toBe(40);

    // Verify excess transaction exists in DB with work_order_id = null
    const { data: excessTx } = await supabaseAdmin
      .from("inventory_transactions")
      .select("work_order_id, qty_tp_ok, note")
      .eq("product_id", productId)
      .is("work_order_id", null)
      .eq("qty_tp_ok", 40)
      .maybeSingle();

    expect(excessTx).toBeDefined();
    expect(excessTx!.work_order_id).toBeNull();
  });

  it("should support manual override mode by explicitly specifying woId", async () => {
    // Manual override to WO1
    const result = await recordProductionInput("D1", testSku, 15, "test_admin", true, wo1Id);

    expect(result.totalQtyOk).toBe(15);
    expect(result.allocations.length).toBe(1);
    expect(result.allocations[0].woId).toBe(wo1Id);
    expect(result.allocations[0].allocatedQty).toBe(15);

    // Check DB completed_qty for WO1 (was 100, now 115)
    const { data: wo1Db } = await supabaseAdmin.from("work_orders").select("completed_qty").eq("id", wo1Id).single();
    expect(wo1Db?.completed_qty).toBe(115);
  });

  it("should record physical transfer decoupled from WO (woId = undefined)", async () => {
    // Transfer 200 pcs from D1 to CK1 without WO
    await expect(
      recordTransfer("D1", "CK1", testSku, 200, "test_admin", false)
    ).resolves.not.toThrow();

    // Verify transfer transaction in DB
    const { data: transferTx } = await supabaseAdmin
      .from("inventory_transactions")
      .select("work_order_id, qty_tp_ok, transaction_type")
      .eq("product_id", productId)
      .eq("transaction_type", "TRANSFER")
      .eq("qty_tp_ok", 200)
      .maybeSingle();

    expect(transferTx).toBeDefined();
    expect(transferTx!.work_order_id).toBeNull();
    expect(transferTx!.qty_tp_ok).toBe(200);
  });

  it("should include (Workshop, SKU) in getXNTReport even if 0 stock", async () => {
    const today = getTodayVN();
    const xntReport = await getXNTReport(today, testSku);

    // Both D1 and CK1 and KTP should exist in report for testSku
    const d1Item = xntReport.find((r) => r.wcCode === "D1" && r.sku === testSku);
    const ck1Item = xntReport.find((r) => r.wcCode === "CK1" && r.sku === testSku);
    const ktpItem = xntReport.find((r) => r.wcCode === "KTP" && r.sku === testSku);

    expect(d1Item).toBeDefined();
    expect(ck1Item).toBeDefined();
    expect(ktpItem).toBeDefined();

    // D1 should have produced 50 + 70 + 150 + 15 = 285 pcs TP Ok, and transferred out 200 pcs
    expect(d1Item!.nhap.tonThanhPham).toBe(285);
    expect(d1Item!.xuat.tonThanhPham).toBe(200);
    expect(d1Item!.closing.tonThanhPham).toBe(85);

    // CK1 should have received 200 pcs Phôi from transfer
    expect(ck1Item!.nhap.tonPhoi).toBe(200);
    expect(ck1Item!.closing.tonPhoi).toBe(200);
  });
});
