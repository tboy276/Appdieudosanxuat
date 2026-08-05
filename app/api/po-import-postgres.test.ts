import { describe, it, expect, beforeEach } from "vitest";

process.env.SEED_ADMIN_PASSWORD = "TestAdminPass@2026";
process.env.JWT_SECRET = "test-secret-key-1234567890";

import { POST as importPOHandler } from "./po/import/route";
import { upsertProduct, getProduct } from "@/lib/products";
import { listPOs, getPO } from "@/lib/po-wo-engine";
import { seedWorkshops } from "@/scripts/seed-workshops-supabase";
import { signToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

function createMockRequest(url: string, method: string, body?: any, token?: string) {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (token) {
    headers.set("Cookie", `${AUTH_COOKIE_NAME}=${token}`);
  }
  return new NextRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("PO Import Integration with Supabase PostgreSQL Products & POs", () => {
  beforeEach(async () => {
    // Seed baseline workshops in Supabase
    await seedWorkshops();
  });

  it("should validate existing product customers, create draft SKUs and save all valid POs directly into Supabase PostgreSQL", async () => {
    const token = signToken({ id: "admin_1", username: "admin", role: "ADMIN" });
    const ts = Date.now();

    const existingSku = `SKU-PO-EXISTING-${ts}`;
    const brandNewSku = `SKU-PO-NEW-DRAFT-${ts}`;
    const registeredCustomer = `Công Ty TNHH Thép Việt ${ts}`;
    const wrongCustomer = `Khách Hàng Không Khớp ${ts}`;
    const newCustomer = `Khách Hàng Mới Tinh ${ts}`;
    const poNum1 = `PO-IMP-${ts}-001`;
    const poNum2 = `PO-IMP-${ts}-002`;
    const poNum3 = `PO-IMP-${ts}-003`;

    // 1. Create an existing product in Supabase PostgreSQL
    await upsertProduct({
      sku: existingSku,
      nameVi: "Trục Thép Đã Tồn Tại",
      customerNames: [registeredCustomer],
      routing: ["D1", "CK1", "KTP"],
      unit: "Cái",
    });

    // 2. Prepare import payload with 3 rows:
    // Row 0: Existing SKU + Matching Customer -> Valid
    // Row 1: Existing SKU + Wrong Customer -> Conflict
    // Row 2: Brand New SKU + New Customer -> Creates Draft SKU in Supabase Postgres + Valid PO
    const importRows = [
      {
        poNumber: poNum1,
        sku: existingSku,
        customerName: registeredCustomer,
        qty: 100,
        requestedDate: "2026-09-15",
      },
      {
        poNumber: poNum2,
        sku: existingSku,
        customerName: wrongCustomer,
        qty: 200,
        requestedDate: "2026-09-15",
      },
      {
        poNumber: poNum3,
        sku: brandNewSku,
        productNameVi: "Bánh Răng Nháp Mới",
        customerName: newCustomer,
        qty: 350,
        requestedDate: "2026-09-20",
      },
    ];

    // 3. Call PO import endpoint with skipConflicts: true so valid rows are processed
    const req = createMockRequest("http://localhost:3000/api/po/import", "POST", {
      rows: importRows,
      skipConflicts: true,
    }, token);

    const res = await importPOHandler(req);
    const json = await res.json();
    if (res.status !== 200) {
      console.error("IMPORT ERROR RESPONSE:", json);
    }
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.count).toBe(2); // 2 valid POs created (Row 0 & Row 2)
    expect(json.conflictCount).toBe(1); // 1 conflict row (Row 1)
    expect(json.conflictRows[0].sku).toBe(existingSku);
    expect(json.conflictRows[0].requestedCustomer).toBe(wrongCustomer);

    // 4. Verify that brand new SKU was saved as a Draft SKU directly in Supabase PostgreSQL!
    const fetchedDraftProduct = await getProduct(brandNewSku);
    expect(fetchedDraftProduct).not.toBeNull();
    expect(fetchedDraftProduct?.sku).toBe(brandNewSku);
    expect(fetchedDraftProduct?.needsRouting).toBe(true);
    expect(fetchedDraftProduct?.customerNames).toContain(newCustomer);

    // 5. CRITICAL VERIFICATION: Direct SQL queries into purchase_orders & po_lines tables
    const { data: dbPoRows, error: dbPoErr } = await supabaseAdmin
      .from("purchase_orders")
      .select("id, po_number, customer_id, requested_date, status")
      .in("po_number", [poNum1, poNum3]);

    expect(dbPoErr).toBeNull();
    expect(dbPoRows).toBeDefined();
    expect(dbPoRows?.length).toBe(2);

    const po1Row = dbPoRows?.find((p) => p.po_number === poNum1);
    const po3Row = dbPoRows?.find((p) => p.po_number === poNum3);
    expect(po1Row).toBeDefined();
    expect(po3Row).toBeDefined();

    // Verify po_lines rows directly via SQL
    const { data: dbLineRows, error: dbLineErr } = await supabaseAdmin
      .from("po_lines")
      .select("id, po_id, product_id, order_qty")
      .in("po_id", [po1Row!.id, po3Row!.id]);

    expect(dbLineErr).toBeNull();
    expect(dbLineRows).toBeDefined();
    expect(dbLineRows?.length).toBe(2);

    const line1 = dbLineRows?.find((l) => l.po_id === po1Row!.id);
    const line3 = dbLineRows?.find((l) => l.po_id === po3Row!.id);
    expect(line1?.order_qty).toBe(100);
    expect(line3?.order_qty).toBe(350);

    // 6. Domain layer listPOs() verification
    const allPOs = await listPOs();
    const importedPo1 = allPOs.find((p) => p.poNumber === poNum1);
    const importedPo3 = allPOs.find((p) => p.poNumber === poNum3);

    expect(importedPo1).toBeDefined();
    expect(importedPo1?.sku).toBe(existingSku);
    expect(importedPo1?.customerName).toBe(registeredCustomer);
    expect(importedPo1?.qty).toBe(100);
    expect(importedPo1?.requestedDate).toBe("2026-09-15");

    expect(importedPo3).toBeDefined();
    expect(importedPo3?.sku).toBe(brandNewSku);
    expect(importedPo3?.customerName).toBe(newCustomer);
    expect(importedPo3?.qty).toBe(350);
    expect(importedPo3?.requestedDate).toBe("2026-09-20");
  }, 25000);
});
