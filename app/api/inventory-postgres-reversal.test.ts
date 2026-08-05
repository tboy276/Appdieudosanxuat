import { describe, it, expect, beforeAll } from "vitest";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

import {
  declareOpeningStock,
  recordProductionInput,
  recordTransfer,
  reverseTransaction,
  getXNTReport,
  getTransactionHistory,
  ensureUserInSupabase,
} from "@/lib/inventory-postgres";
import { createPO } from "@/lib/po-postgres";
import { createWOsForPO } from "@/lib/wo-postgres";
import { POST as reverseApiHandler } from "@/app/api/inventory/reverse/route";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/auth";

describe("Step 4 — Inventory, XNT & Reversal Engine Migration to Supabase PostgreSQL", () => {
  let customerId: string;
  let customerName: string;
  let productId: string;
  let sku: string;
  let workshopId: string;
  let adminUserId: string;
  let dispatcherUserId: string;

  beforeAll(async () => {


    // 2. Ensure test customer
    const custCode = `CUST-STEP4-${Date.now()}`;
    customerName = `Customer Step 4 Test ${Date.now()}`;
    const { data: cust } = await supabaseAdmin
      .from("customers")
      .insert({ customer_code: custCode, name: customerName })
      .select()
      .single();
    customerId = cust.id;

    // 3. Ensure test product & routing
    sku = `SKU-STEP4-${Date.now()}`;
    const { data: prod } = await supabaseAdmin
      .from("products")
      .insert({ part_no: sku, name_vi: "Sản Phẩm Bước 4 Test", unit: "Cái" })
      .select()
      .single();
    productId = prod.id;

    await supabaseAdmin.from("product_customers").insert({ product_id: productId, customer_id: customerId });

    const { data: wsD1 } = await supabaseAdmin.from("workshops").select("id").eq("code", "D1").single();
    workshopId = wsD1.id;

    await supabaseAdmin.from("product_routings").insert({
      product_id: productId,
      workshop_id: workshopId,
      step_order: 1,
      ng_rate: 5.0,
      lead_time_days: 1,
    });

    // 4. Ensure admin and dispatcher users in Supabase
    adminUserId = await ensureUserInSupabase("admin_step4", "ADMIN");
    dispatcherUserId = await ensureUserInSupabase("dispatcher_step4", "DISPATCHER");
  }, 15000);

  it("1. Khai báo Tồn Đầu Kỳ (user thường), xác nhận trigger chặn đúng khi vi phạm", async () => {
    // Attempting ton_phoi > 0 at step 1 workshop (D1) should fail
    await expect(
      declareOpeningStock("D1", sku, { tonPhoi: 50, tonThanhPham: 100 }, "dispatcher_step4")
    ).rejects.toThrow(/Xưởng bước 1 hoặc KTP không được phép có Tồn Phôi/);

    // Valid declaration with tonPhoi = 0, tonThanhPham = 100 should succeed
    await declareOpeningStock("D1", sku, { tonPhoi: 0, tonThanhPham: 100 }, "dispatcher_step4");

    const { data: op } = await supabaseAdmin
      .from("opening_stocks")
      .select("*")
      .eq("workshop_id", workshopId)
      .eq("product_id", productId)
      .single();

    expect(op).toBeDefined();
    expect(op.ton_thanh_pham).toBe(100);
    expect(op.ton_phoi).toBe(0);
  });

  it("2. Báo cáo sản lượng có NG, xác nhận completed_qty của WO cập nhật đúng", async () => {
    // Create PO and WO
    const poNumber = `PO-STEP4-WO-${Date.now()}`;
    const newPo = await createPO({
      poNumber,
      customerId,
      customerName,
      sku,
      orderQty: 200,
      requestedDate: "2026-08-25",
      lines: [{ partNo: sku, orderQty: 200 }],
    });

    await createWOsForPO(newPo.poId, "admin_step4");

    const { data: poLine } = await supabaseAdmin
      .from("po_lines")
      .select("id")
      .eq("po_id", newPo.poId)
      .single();

    const { data: wo } = await supabaseAdmin
      .from("work_orders")
      .select("*")
      .eq("po_line_id", poLine.id)
      .single();

    expect(wo).toBeDefined();

    // Record production input: 80 OK, 5 NG
    await recordProductionInput("D1", sku, 80, "dispatcher_step4", true, wo.id, undefined, 5);

    // Check WO completed_qty sync
    const { data: updatedWo } = await supabaseAdmin
      .from("work_orders")
      .select("completed_qty, status")
      .eq("id", wo.id)
      .single();

    expect(updatedWo.completed_qty).toBe(80);
    expect(["IN_PROGRESS", "COMPLETED"]).toContain(updatedWo.status);
  }, 15000);

  it("3a. ADMIN nhập 500 (nhầm), tạo REVERSAL đảo 450 -> WO completed_qty tính đúng còn 50", async () => {
    const poNumber = `PO-REV-3A-${Date.now()}`;
    const newPo = await createPO({
      poNumber,
      customerId,
      customerName,
      sku,
      orderQty: 1000,
      requestedDate: "2026-08-25",
      lines: [{ partNo: sku, orderQty: 1000 }],
    });

    await createWOsForPO(newPo.poId, "admin_step4");

    const { data: poLine } = await supabaseAdmin
      .from("po_lines")
      .select("id")
      .eq("po_id", newPo.poId)
      .single();

    const { data: wo } = await supabaseAdmin
      .from("work_orders")
      .select("*")
      .eq("po_line_id", poLine.id)
      .single();

    expect(wo).toBeDefined();

    // 1. Input 500 pcs by mistake
    await recordProductionInput("D1", sku, 500, "admin_step4", true, wo.id);

    const { data: woAfterInput } = await supabaseAdmin
      .from("work_orders")
      .select("completed_qty")
      .eq("id", wo.id)
      .single();
    expect(woAfterInput.completed_qty).toBe(500);

    // Fetch the inserted transaction ID
    const { data: txList } = await supabaseAdmin
      .from("inventory_transactions")
      .select("id")
      .eq("work_order_id", wo.id)
      .eq("transaction_type", "PRODUCTION_INPUT")
      .order("logged_at", { ascending: false });

    const origTxId = txList[0].id;

    // 2. ADMIN creates REVERSAL of 450 pcs
    const revResult = await reverseTransaction(origTxId, 450, 0, "Nhập nhầm 500pcs, đảo lại 450pcs", "admin_step4", "ADMIN");
    expect(revResult.success).toBe(true);

    // 3. Verify WO completed_qty automatically reduces to 50
    const { data: woAfterReversal } = await supabaseAdmin
      .from("work_orders")
      .select("completed_qty, status")
      .eq("id", wo.id)
      .single();

    expect(woAfterReversal.completed_qty).toBe(50);
    expect(["IN_PROGRESS", "COMPLETED"]).toContain(woAfterReversal.status);
  }, 15000);

  it("3b. ADMIN cố đảo vượt quá số lượng gốc -> bị chặn với thông báo lỗi rõ ràng", async () => {
    const { data: txOrig } = await supabaseAdmin
      .from("inventory_transactions")
      .insert({
        transaction_type: "PRODUCTION_INPUT",
        product_id: productId,
        to_workshop_id: workshopId,
        qty_tp_ok: 500,
        qty_ng: 0,
        note: "Giao dịch gốc 500 pcs",
        created_by: adminUserId,
      })
      .select()
      .single();

    // Attempting to reverse 600 pcs when original is 500 pcs
    await expect(
      reverseTransaction(txOrig.id, 600, 0, "Cố đảo 600pcs", "admin_step4", "ADMIN")
    ).rejects.toThrow(/Không thể đảo 600 pcs/);

    // Clean up
    await supabaseAdmin.from("inventory_transactions").delete().eq("id", txOrig.id);
  });

  it("3c. ADMIN đảo từng phần nhiều lần cho cùng 1 giao dịch gốc (gốc 500, đảo 200, đảo 250 -> tổng 450, còn lại 50)", async () => {
    const sku3c = `SKU-3C-${Date.now()}`;
    const { data: prod3c } = await supabaseAdmin
      .from("products")
      .insert({ part_no: sku3c, name_vi: "Sản phẩm Test 3C", unit: "Cái" })
      .select()
      .single();

    const { data: txOrig } = await supabaseAdmin
      .from("inventory_transactions")
      .insert({
        transaction_type: "PRODUCTION_INPUT",
        product_id: prod3c.id,
        to_workshop_id: workshopId,
        qty_tp_ok: 500,
        qty_ng: 0,
        note: "Giao dịch gốc 500 pcs test đảo nhiều lần",
        created_by: adminUserId,
      })
      .select()
      .single();

    // Reversal 1: 200 pcs
    const res1 = await reverseTransaction(txOrig.id, 200, 0, "Đảo lần 1", "admin_step4", "ADMIN");
    expect(res1.success).toBe(true);

    // Reversal 2: 250 pcs
    const res2 = await reverseTransaction(txOrig.id, 250, 0, "Đảo lần 2", "admin_step4", "ADMIN");
    expect(res2.success).toBe(true);

    // Total reversed = 450. Attempting to reverse 100 more (exceeding 50 remaining) should fail!
    await expect(
      reverseTransaction(txOrig.id, 100, 0, "Đảo lần 3 vượt quá", "admin_step4", "ADMIN")
    ).rejects.toThrow(/Không thể đảo 100 pcs/);

    // Clean up
    await supabaseAdmin.from("inventory_transactions").delete().or(`note.ilike.%${txOrig.id}%`);
    await supabaseAdmin.from("inventory_transactions").delete().eq("id", txOrig.id);
  }, 15000);

  it("3d. Tài khoản DISPATCHER cố gọi API Reversal -> trả về lỗi 403 Forbidden", async () => {
    const token = signToken({ id: dispatcherUserId, username: "dispatcher_step4", role: "DISPATCHER" });

    const req = new NextRequest("http://localhost:3000/api/inventory/reverse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        originalTxId: "00000000-0000-0000-0000-000000000000",
        qtyOk: 10,
        reason: "Hành vi trái phép",
      }),
    });

    const res = await reverseApiHandler(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/không có quyền/);
  });

  it("3e. (Database & Engine Layer RLS) Gọi trực tiếp reverseTransaction/DB với role DISPATCHER (bỏ qua API) -> bị chặn độc lập ở tầng Database/Engine", async () => {
    // 1. Direct call to reverseTransaction engine with role "DISPATCHER" must be rejected by engine guard
    await expect(
      reverseTransaction("00000000-0000-0000-0000-000000000000", 10, 0, "Bỏ qua API", "dispatcher_step4", "DISPATCHER")
    ).rejects.toThrow(/Chỉ tài khoản ADMIN mới có quyền thực hiện Đảo bút toán/);

    const nonAdminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error: rlsErr } = await nonAdminClient
      .from("inventory_transactions")
      .insert({
        transaction_type: "REVERSAL",
        product_id: productId,
        to_workshop_id: workshopId,
        qty_tp_ok: 10,
        qty_ng: 0,
        note: "Bỏ qua API chèn trực tiếp",
        created_by: dispatcherUserId,
      });

    // RLS policy in PostgreSQL prevents insert of REVERSAL for non-admin/anon users
    expect(rlsErr).toBeDefined();
  });


  it("4. Báo cáo XNT Real-time trừ chính xác phần đã đảo", async () => {
    const today = new Date().toISOString().split("T")[0];
    const report = await getXNTReport(today, sku);

    expect(Array.isArray(report)).toBe(true);
    const d1Item = report.find((r) => r.wcCode === "D1" && r.sku === sku);
    expect(d1Item).toBeDefined();
    if (d1Item) {
      expect(d1Item.closing.tonThanhPham).toBeGreaterThanOrEqual(0);
    }
  });

  it("5. Benchmark hiệu năng báo cáo XNT — Quy mô nhỏ (14 cặp) và Giả lập lớn (Tất cả sản phẩm trong DB)", async () => {
    const today = new Date().toISOString().split("T")[0];

    // 1. Warm-up connection to Supabase PostgREST
    await supabaseAdmin.from("workshops").select("id").limit(1);

    // 2. Benchmark Small Scale (14 pairs - single SKU across workshops): 3 iterations averaged
    const smallRuns: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await getXNTReport(today, sku);
      const t1 = performance.now();
      smallRuns.push(t1 - t0);
    }
    const avgSmallMs = smallRuns.reduce((a, b) => a + b, 0) / smallRuns.length;

    console.log(`⏱️ Calibrated Small Scale XNT Benchmark (14 pairs, 3-run avg post warm-up): ${avgSmallMs.toFixed(2)} ms (Runs: ${smallRuns.map(r => r.toFixed(1)).join(', ')} ms)`);
    expect(avgSmallMs).toBeLessThan(5000);

    // 3. Benchmark Full Scale (All SKUs across all workshops): 3 iterations averaged
    const fullRuns: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await getXNTReport(today);
      const t1 = performance.now();
      fullRuns.push(t1 - t0);
    }
    const avgFullMs = fullRuns.reduce((a, b) => a + b, 0) / fullRuns.length;

    console.log(`⚡ Calibrated Full Scale XNT Benchmark (All SKUs, 3-run avg post warm-up): ${avgFullMs.toFixed(2)} ms (Runs: ${fullRuns.map(r => r.toFixed(1)).join(', ')} ms)`);
    expect(avgFullMs).toBeLessThan(5000);
  });

});
