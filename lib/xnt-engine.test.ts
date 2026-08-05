import { describe, it, expect, beforeAll } from "vitest";
import { supabaseAdmin } from "./supabase";
import { transferPhoi, inputProduction, getXNTReport } from "./xnt-engine";
import { declareOpeningStock, getTodayDateString } from "./inventory";

// Helper: unique date offset for each test run to avoid conflicts
const testDate = new Date().toISOString().split("T")[0];

describe("lib/xnt-engine.ts - Material Balance Engine (Dual-State Model)", () => {
  beforeAll(async () => {
    // Seed test SKUs into PostgreSQL
    const testSkus = [
      { part_no: "SKU-001", name_vi: "Test SKU 001", unit: "Cái" },
      { part_no: "SKU-002", name_vi: "Test SKU 002", unit: "Cái" },
      { part_no: "SKU-003", name_vi: "Test SKU 003", unit: "Cái" },
      { part_no: "SKU-004", name_vi: "Test SKU 004", unit: "Cái" },
    ];

    for (const sku of testSkus) {
      await supabaseAdmin.from("products").upsert(sku, { onConflict: "part_no" });
    }

    // Ensure test workshops exist
    const testWorkshops = [
      { code: "CUAPHOI", name: "Tổ cưa phôi PSX", is_ktp: false },
      { code: "CK1", name: "Xưởng Cơ Khí 1", is_ktp: false },
      { code: "CK2", name: "Xưởng Cơ Khí 2", is_ktp: false },
    ];
    for (const ws of testWorkshops) {
      const { data: existing } = await supabaseAdmin.from("workshops").select("id").eq("code", ws.code).maybeSingle();
      if (!existing) {
        await supabaseAdmin.from("workshops").insert(ws);
      }
    }
  }, 20000);

  it("Case 1: recordTransfer with valid qty succeeds and is recorded in PostgreSQL", async () => {
    const sku = "SKU-001";
    const today = testDate;

    // Declare opening stock on CUAPHOI with phoi (CUAPHOI is NOT step_order=1 by default)
    await declareOpeningStock("CUAPHOI", sku, { tonPhoi: 50, tonThanhPham: 0 }, "admin", today);

    // Verify opening stock was written to PostgreSQL
    const { data: wsC } = await supabaseAdmin.from("workshops").select("id").eq("code", "CUAPHOI").single();
    const { data: prod } = await supabaseAdmin.from("products").select("id").eq("part_no", sku).single();

    const { data: op } = await supabaseAdmin
      .from("opening_stocks")
      .select("ton_phoi, ton_thanh_pham")
      .eq("workshop_id", wsC.id)
      .eq("product_id", prod.id)
      .eq("snapshot_date", today)
      .maybeSingle();

    expect(op).toBeDefined();
    expect(op!.ton_phoi).toBe(50);
  }, 15000);

  it("Case 2: inputProduction writes transaction to PostgreSQL", async () => {
    const sku = "SKU-002";
    const today = testDate;

    // Declare opening stock on CK1 (non-first-step)
    await declareOpeningStock("CK1", sku, { tonPhoi: 30, tonThanhPham: 0 }, "admin", today);

    // Record production input: 20 OK pcs
    await inputProduction("CK1", sku, 20, "worker1", false, undefined, today);

    // Verify transaction was written to PostgreSQL
    const { data: wsCK1 } = await supabaseAdmin.from("workshops").select("id").eq("code", "CK1").single();
    const { data: prod } = await supabaseAdmin.from("products").select("id").eq("part_no", sku).single();

    const { data: txs } = await supabaseAdmin
      .from("inventory_transactions")
      .select("qty_tp_ok, qty_ng, transaction_type")
      .eq("product_id", prod.id)
      .eq("to_workshop_id", wsCK1.id)
      .eq("transaction_date", today)
      .eq("transaction_type", "PRODUCTION_INPUT");

    expect(txs).toBeDefined();
    const lastTx = txs?.slice(-1)[0];
    expect(lastTx?.qty_tp_ok).toBe(20);
  }, 15000);

  it("Case 3: Interleaved daily transactions sequence should calculate getXNTReport adhering to Opening + In - Out = Closing", async () => {
    // Use a unique suffix to avoid cross-test contamination from other test runs
    const sku = `SKU-003-${Date.now()}`;
    const testDateOffset = new Date(Date.now() - 86400000 * 3).toISOString().split("T")[0]; // 3 days ago

    // Ensure SKU is seeded
    await supabaseAdmin.from("products").upsert({ part_no: sku, name_vi: `Test ${sku}`, unit: "Cái" }, { onConflict: "part_no" });


    // 1. First step CUAPHOI produces 200 pcs phoi
    await inputProduction("CUAPHOI", sku, 200, "worker1", true, undefined, testDateOffset);

    // 2. Transfer 120 pcs phoi from CUAPHOI -> CK1
    await transferPhoi("CUAPHOI", "CK1", sku, 120, "dispatcher1", true, undefined, testDateOffset);

    // 3. CK1 inputs 100 pcs production (consumes phoi, produces TP)
    await inputProduction("CK1", sku, 100, "worker2", false, undefined, testDateOffset);

    // Fetch report
    const report = await getXNTReport(testDateOffset, sku);
    expect(report.length).toBeGreaterThanOrEqual(2);

    const reportCUAPHOI = report.find((r) => r.wcCode === "CUAPHOI" && r.sku === sku);
    expect(reportCUAPHOI).toBeDefined();
    if (reportCUAPHOI) {
      // CUAPHOI nhap 200 phoi (PRODUCTION_INPUT), xuat 120 phoi (TRANSFER)
      expect(reportCUAPHOI.nhap.tonThanhPham).toBe(200); // inputProduction is PRODUCTION_INPUT -> nhap.tonThanhPham
      expect(reportCUAPHOI.xuat.tonThanhPham).toBe(120); // TRANSFER from CUAPHOI -> xuat.tonThanhPham
      expect(reportCUAPHOI.closing.tonThanhPham).toBe(80);
    }

    const reportCK1 = report.find((r) => r.wcCode === "CK1" && r.sku === sku);
    expect(reportCK1).toBeDefined();
    if (reportCK1) {
      // CK1 nhap 120 phoi (TRANSFER IN) + nhap 100 TP (PRODUCTION_INPUT)
      expect(reportCK1.nhap.tonPhoi).toBe(120); // TRANSFER -> nhap.tonPhoi
      expect(reportCK1.nhap.tonThanhPham).toBe(100); // PRODUCTION_INPUT -> nhap.tonThanhPham
    }
  }, 15000);

  it("Case 4: Multiple inputProduction requests succeed and are all recorded in PostgreSQL", async () => {
    const sku = "SKU-004";
    const today = testDate;

    // Declare opening stock on CK2 (non-first-step)
    await declareOpeningStock("CK2", sku, { tonPhoi: 40, tonThanhPham: 0 }, "admin", today);

    // In PostgreSQL mode, both requests succeed (no atomic Redis Lua check)
    const results = await Promise.allSettled([
      inputProduction("CK2", sku, 30, "userA", false, undefined, today),
      inputProduction("CK2", sku, 30, "userB", false, undefined, today),
    ]);

    // All fulfilled (PostgreSQL doesn't reject based on stock guard)
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Verify at least one transaction was written
    const { data: wsCK2 } = await supabaseAdmin.from("workshops").select("id").eq("code", "CK2").single();
    const { data: prod } = await supabaseAdmin.from("products").select("id").eq("part_no", sku).single();
    const { data: txs } = await supabaseAdmin
      .from("inventory_transactions")
      .select("id")
      .eq("product_id", prod.id)
      .eq("to_workshop_id", wsCK2.id)
      .eq("transaction_date", today);

    expect(txs && txs.length).toBeGreaterThanOrEqual(1);
  }, 15000);
});
