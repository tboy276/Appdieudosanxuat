import { describe, it, expect, beforeAll } from "vitest";
import { supabaseAdmin } from "./supabase";
import { declareOpeningStock, getTodayDateString } from "./inventory";

describe("lib/inventory.ts - Opening Inventory & Stock State (Dual-State Model)", () => {
  let workshopId: string;
  let productId101: string;
  let productIdPrefill: string;

  beforeAll(async () => {
    // Ensure D1 workshop exists (seed if needed)
    const { data: ws } = await supabaseAdmin.from("workshops").select("id").eq("code", "D1").maybeSingle();
    workshopId = ws?.id;

    // Seed test products
    const { data: p1 } = await supabaseAdmin
      .from("products")
      .upsert({ part_no: "SKU-101", name_vi: "Test SKU-101", unit: "Cái" }, { onConflict: "part_no" })
      .select("id")
      .single();
    productId101 = p1?.id;

    const { data: p2 } = await supabaseAdmin
      .from("products")
      .upsert({ part_no: "SKU-PREFILL-TEST", name_vi: "Test SKU-PREFILL-TEST", unit: "Cái" }, { onConflict: "part_no" })
      .select("id")
      .single();
    productIdPrefill = p2?.id;

    // Ensure CK1 workshop exists
    const { data: wsCK1 } = await supabaseAdmin.from("workshops").select("id").eq("code", "CK1").maybeSingle();
    if (!wsCK1) {
      await supabaseAdmin.from("workshops").insert({ code: "CK1", name: "Xưởng Cơ Khí 1", is_ktp: false });
    }
  }, 15000);

  it("should return default zero stock when stock state key does not exist", async () => {
    const state = { tonPhoi: 0, tonThanhPham: 0 };
    expect(state.tonPhoi).toBe(0);
    expect(state.tonThanhPham).toBe(0);
  });

  it("should write opening stock to PostgreSQL on declareOpeningStock", async () => {
    const today = getTodayDateString();

    // D1 is step_order=1, so tonPhoi must be 0
    await declareOpeningStock("D1", "SKU-101", { tonPhoi: 0, tonThanhPham: 500 }, "admin", today);

    const { data: op } = await supabaseAdmin
      .from("opening_stocks")
      .select("ton_phoi, ton_thanh_pham, snapshot_date")
      .eq("product_id", productId101)
      .eq("workshop_id", workshopId)
      .eq("snapshot_date", today)
      .maybeSingle();

    expect(op).toBeDefined();
    expect(op!.ton_thanh_pham).toBe(500);
    expect(op!.ton_phoi).toBe(0);
    expect(op!.snapshot_date).toBe(today);
  }, 10000);

  it("should fetch latest opening stock snapshots per workcenter from PostgreSQL", async () => {
    const sku = "SKU-PREFILL-TEST";

    // Declare for D1 on 2026-07-25
    await declareOpeningStock("D1", sku, { tonPhoi: 0, tonThanhPham: 100 }, "admin", "2026-07-25");
    // Declare newer for D1 and CK1 on 2026-07-31
    await declareOpeningStock("D1", sku, { tonPhoi: 0, tonThanhPham: 120 }, "admin", "2026-07-31");
    await declareOpeningStock("CK1", sku, { tonPhoi: 80, tonThanhPham: 45 }, "admin", "2026-07-31");

    // Check D1 opening at 2026-07-31
    const { data: wsD1 } = await supabaseAdmin.from("workshops").select("id").eq("code", "D1").single();
    const { data: d1Op } = await supabaseAdmin
      .from("opening_stocks")
      .select("ton_phoi, ton_thanh_pham, snapshot_date")
      .eq("product_id", productIdPrefill)
      .eq("workshop_id", wsD1.id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    expect(d1Op).toBeDefined();
    expect(d1Op!.snapshot_date).toBe("2026-07-31");
    expect(d1Op!.ton_thanh_pham).toBe(120);

    // Check CK1 opening at 2026-07-31
    const { data: wsCK1 } = await supabaseAdmin.from("workshops").select("id").eq("code", "CK1").single();
    const { data: ck1Op } = await supabaseAdmin
      .from("opening_stocks")
      .select("ton_phoi, ton_thanh_pham, snapshot_date")
      .eq("product_id", productIdPrefill)
      .eq("workshop_id", wsCK1.id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    expect(ck1Op).toBeDefined();
    expect(ck1Op!.snapshot_date).toBe("2026-07-31");
    expect(ck1Op!.ton_phoi).toBe(80);
    expect(ck1Op!.ton_thanh_pham).toBe(45);
  }, 15000);
});
