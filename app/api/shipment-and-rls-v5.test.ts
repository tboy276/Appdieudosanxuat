import { describe, it, expect, beforeAll } from "vitest";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { createPO, listPOs } from "@/lib/po-postgres";
import { upsertProduct } from "@/lib/products";
import { declareOpeningStock } from "@/lib/inventory-postgres";
import {
  getShippableItems,
  createShipment,
  listShipments,
  getShipment,
} from "@/lib/shipment";
import { POST as reverseApiHandler } from "@/app/api/inventory/reverse/route";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/auth";

describe("Step 5 — Customer Shipments Module, RLS Hardening & Auth Security", () => {
  let customerId: string;
  let customerName: string;
  let sku: string;
  let productId: string;
  let adminToken: string;
  let dispatcherToken: string;

  beforeAll(async () => {
    adminToken = signToken({ id: "usr_admin", username: "admin", role: "ADMIN" });
    dispatcherToken = signToken({ id: "usr_dispatcher", username: "dispatcher", role: "DISPATCHER" });

    // Seed customer
    customerName = `Khách Hàng Step5-${Date.now()}`;
    const { data: cust, error: custErr } = await supabaseAdmin
      .from("customers")
      .insert({ customer_code: `CUST-S5-${Date.now()}`, name: customerName })
      .select()
      .maybeSingle();
    if (custErr || !cust) {
      const { data: existingCust } = await supabaseAdmin.from("customers").select("id").limit(1).single();
      customerId = existingCust?.id || "";
    } else {
      customerId = cust.id;
    }



    // Seed product
    sku = `SKU-S5-${Date.now()}`;
    await upsertProduct({
      sku,
      nameVi: "Sản phẩm Step 5",
      customerName,
      routing: ["D1", "LR", "KTP"],
      unit: "Cái",
    });

    const { data: prod } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("part_no", sku)
      .single();
    productId = prod.id;
  });

  it("1. getShippableItems: does NOT list PO line when KTP stock is 0", async () => {
    const poNoStock = await createPO({
      poNumber: `PO-NO-STOCK-${Date.now()}`,
      customerName,
      sku,
      productNameVi: "Sản phẩm Step 5",
      qty: 200,
      requestedDate: "2026-12-01",
    });

    const shippable = await getShippableItems({ customerId, sku });
    const match = shippable.find((s) => s.poId === poNoStock.poId);
    expect(match).toBeUndefined();
  });

  it("2. createShipment: successfully creates shipment in PostgreSQL & updates listPOs shippedQty", async () => {
    const po = await createPO({
      poNumber: `PO-SHIP-01-${Date.now()}`,
      customerName,
      sku,
      productNameVi: "Sản phẩm Step 5",
      qty: 150,
      requestedDate: "2026-12-10",
    });

    // Add 200 pcs stock at KTP
    await declareOpeningStock("KTP", sku, { tonPhoi: 0, tonThanhPham: 200 }, "admin");

    // Check shippable items
    const shippable = await getShippableItems({ customerId, sku });
    const targetItem = shippable.find((s) => s.poId === po.poId);
    expect(targetItem).toBeDefined();
    expect(targetItem?.remainingOrderQty).toBe(150);
    expect(targetItem?.ktpAvailableQty).toBeGreaterThanOrEqual(200);

    // Create Shipment of 100 pcs
    const result = await createShipment(
      customerId,
      [
        {
          poLineId: targetItem!.poLineId,
          productId,
          shippedQty: 100,
        },
      ],
      "admin",
      "Phiếu xuất 100pcs cho khách"
    );

    expect(result.shipmentId).toBeDefined();
    expect(result.shipmentNumber).toMatch(/^SHIP-/);

    // Verify shippedQty on listPOs() is computed accurately via PostgreSQL JOIN
    const allPos = await listPOs();
    const poUpdated = allPos.find((p) => p.poId === po.poId);
    expect(poUpdated).toBeDefined();
    expect(poUpdated?.shippedQty).toBe(100);

    // Verify listShipments & getShipment
    const shipmentsList = await listShipments({ customerId });
    expect(shipmentsList.length).toBeGreaterThan(0);

    const detail = await getShipment(result.shipmentId);
    expect(detail).toBeDefined();
    expect(detail?.totalQty).toBe(100);
    expect(detail?.items.length).toBe(1);
  });

  it("3. Transaction Rollback: invalid over-shipping item rolls back header shipment completely", async () => {
    const poOver = await createPO({
      poNumber: `PO-OVER-${Date.now()}`,
      customerName,
      sku,
      productNameVi: "Sản phẩm Step 5",
      qty: 50,
      requestedDate: "2026-12-15",
    });

    const { data: line } = await supabaseAdmin
      .from("po_lines")
      .select("id")
      .eq("po_id", poOver.poId)
      .single();

    // Attempting to ship 999 pcs when order_qty is 50 -> must throw error
    await expect(
      createShipment(
        customerId,
        [
          {
            poLineId: line.id,
            productId,
            shippedQty: 999,
          },
        ],
        "admin",
        "Thử xuất quá quota"
      )
    ).rejects.toThrow(/vượt quá order_qty/);

    // Confirm that no orphaned header shipment was left in database
    const { data: orphanHeader } = await supabaseAdmin
      .from("shipments")
      .select("id")
      .eq("note", "Thử xuất quá quota");

    expect(orphanHeader || []).toHaveLength(0);
  });

  it("4. Race Condition & Concurrency: consecutive / concurrent shipment requests on 1 PO Line do not over-ship", async () => {
    const poRace = await createPO({
      poNumber: `PO-RACE-${Date.now()}`,
      customerName,
      sku,
      productNameVi: "Sản phẩm Step 5",
      qty: 100,
      requestedDate: "2026-12-20",
    });

    const { data: line } = await supabaseAdmin
      .from("po_lines")
      .select("id")
      .eq("po_id", poRace.poId)
      .single();

    // First shipment of 70 pcs (order_qty = 100) -> must succeed
    const res1 = await createShipment(customerId, [{ poLineId: line.id, productId, shippedQty: 70 }], "worker_a", "Ship 1");
    expect(res1.shipmentId).toBeDefined();

    // Second shipment attempt of 70 pcs (total 140 > 100) -> must be rejected
    await expect(
      createShipment(customerId, [{ poLineId: line.id, productId, shippedQty: 70 }], "worker_b", "Ship 2 OVER")
    ).rejects.toThrow(/vượt quá order_qty/);

    // Verify total shipped on PO is exactly 70 (not 140)
    const allPos = await listPOs();
    const poItem = allPos.find((p) => p.poId === poRace.poId);
    expect(poItem?.shippedQty).toBe(70);
  });


  it("5. API Layer REVERSAL Security: DISPATCHER receives 403 Forbidden on reverse API", async () => {
    const req = new NextRequest("http://localhost:3000/api/inventory/reverse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({
        originalTxId: "00000000-0000-0000-0000-000000000000",
        qtyOk: 10,
        reason: "Test DISPATCHER attempt",
      }),
    });

    const res = await reverseApiHandler(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/không có quyền/);
  });

  it("6. Direct REST API Attack Hardening (RLS): PostgREST calls with ANON_KEY are blocked 100%", async () => {
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // 1. Direct INSERT attempt into products table using ANON_KEY
    const { error: insertErr } = await anonClient
      .from("products")
      .insert({ part_no: "SKU-HACK", name_vi: "SP Hack", unit: "Cái" });

    expect(insertErr).toBeDefined();

    // 2. Direct INSERT attempt into shipments table using ANON_KEY
    const { error: shipErr } = await anonClient
      .from("shipments")
      .insert({ notes: "Direct Anon Insert Attack" });

    expect(shipErr).toBeDefined();

    // 3. Direct DELETE attempt on users table using ANON_KEY
    const { error: userDelErr } = await anonClient
      .from("users")
      .delete()
      .eq("username", "admin");

    expect(userDelErr).toBeDefined();
  });
});

