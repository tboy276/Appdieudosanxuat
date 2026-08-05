import { describe, it, expect, beforeAll } from "vitest";
import { signToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { GET as getPOs, POST as createPORoute, PUT as updatePORoute, DELETE as deletePORoute } from "@/app/api/po/route";
import { GET as exportPOsRoute } from "@/app/api/po/export/route";
import { listPOs, getPO, createPO, updatePO, deletePO, bulkDeletePOs, evaluatePODeliveryStatus } from "@/lib/po-postgres";
import { upsertProduct } from "@/lib/products";
import { supabaseAdmin } from "@/lib/supabase";
import { seedWorkshops } from "@/scripts/seed-workshops-supabase";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";

process.env.SEED_ADMIN_PASSWORD = "TestAdminPass@2026";
process.env.JWT_SECRET = "test-secret-key-1234567890";

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

describe("PO Module Migration (Supabase PostgreSQL)", () => {
  const token = signToken({ id: "admin_1", username: "admin", role: "ADMIN" });
  const testCustomer = "Khách Hàng PO Postgres Test";
  const testSku = "SKU-PO-TEST-001";

  beforeAll(async () => {
    await seedWorkshops();

    // Clean up any old test records
    const { data: oldProds } = await supabaseAdmin.from("products").select("id").eq("part_no", testSku);
    if (oldProds && oldProds.length > 0) {
      const pId = oldProds[0].id;
      const { data: lines } = await supabaseAdmin.from("po_lines").select("po_id").eq("product_id", pId);
      const poIds = (lines || []).map((l) => l.po_id);
      if (poIds.length > 0) {
        await supabaseAdmin.from("work_orders").delete().in("po_line_id", (lines || []).map((l) => l.id));
        await supabaseAdmin.from("purchase_orders").delete().in("id", poIds);
      }
      await supabaseAdmin.from("product_customers").delete().eq("product_id", pId);
      await supabaseAdmin.from("product_routings").delete().eq("product_id", pId);
      await supabaseAdmin.from("products").delete().eq("id", pId);
    }

    // Ensure test product exists on Supabase
    await upsertProduct({
      sku: testSku,
      nameVi: "Sản Phẩm Test PO Postgres",
      customerNames: [testCustomer],
      routing: ["D1", "CK1", "KTP"],
      unit: "Cái",
    });
  }, 35000);

  it("should evaluate PO delivery status correctly", () => {
    expect(evaluatePODeliveryStatus("2026-08-04", "COMPLETED")).toBe("Đã hoàn thành");
    expect(evaluatePODeliveryStatus("2026-08-04", "CANCELLED")).toBe("Đã hủy");

    const todayStr = new Date().toISOString().split("T")[0];
    expect(evaluatePODeliveryStatus(todayStr, "NEW")).toBe("Hôm nay hết hạn");

    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    expect(evaluatePODeliveryStatus(futureDate, "NEW")).toBe("Còn 5 ngày");

    const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    expect(evaluatePODeliveryStatus(pastDate, "NEW")).toBe("Đã quá hạn 3 ngày");
  });

  it("should create, update, fetch and delete PO directly in Supabase PostgreSQL", async () => {
    const poNumber = `PO-TEST-PG-${Date.now()}`;
    const reqDate = "2026-10-15";

    // 1. Create PO via API Route / Supabase function
    const createdPO = await createPO({
      poNumber,
      customerName: testCustomer,
      sku: testSku,
      productNameVi: "Sản Phẩm Test PO Postgres",
      qty: 150,
      requestedDate: reqDate,
    });

    expect(createdPO).toBeDefined();
    expect(createdPO.poNumber).toBe(poNumber);
    expect(createdPO.qty).toBe(150);
    expect(createdPO.customerName).toBe(testCustomer);
    expect(createdPO.status).toBe("NEW");

    // 2. Fetch single PO via getPO
    const fetched = await getPO(createdPO.poId);
    expect(fetched).not.toBeNull();
    expect(fetched?.poNumber).toBe(poNumber);

    // 3. Update PO requestedDate and status
    const updated = await updatePO(createdPO.poId, {
      requestedDate: "2026-11-20",
      status: "IN_PRODUCTION",
      qty: 200,
    });

    expect(updated.requestedDate).toBe("2026-11-20");
    expect(updated.status).toBe("IN_PRODUCTION");
    expect(updated.qty).toBe(200);

    // 4. Delete PO (no active WOs referencing it)
    await deletePO(createdPO.poId);
    const afterDelete = await getPO(createdPO.poId);
    expect(afterDelete).toBeNull();
  }, 20000);

  it("should block deleting PO when a Work Order (WO) references it with clean Vietnamese error message", async () => {
    const poNumber = `PO-RESTRICT-PG-${Date.now()}`;
    const po = await createPO({
      poNumber,
      customerName: testCustomer,
      sku: testSku,
      productNameVi: "Sản Phẩm Test PO Postgres",
      qty: 100,
      requestedDate: "2026-12-01",
    });

    // Insert a dummy Work Order in Supabase referencing this PO line
    const { data: lines } = await supabaseAdmin.from("po_lines").select("id, product_id").eq("po_id", po.poId);
    expect(lines).toBeDefined();
    expect(lines!.length).toBeGreaterThan(0);

    const poLineId = lines![0].id;
    const productId = lines![0].product_id;

    // Get a workshop ID
    const { data: wsData } = await supabaseAdmin.from("workshops").select("id").limit(1).single();
    expect(wsData).toBeDefined();

    const dummyWoId = `WO-DUMMY-${Date.now()}`;
    const { error: woInsertErr } = await supabaseAdmin.from("work_orders").insert({
      wo_number: dummyWoId,
      po_line_id: poLineId,
      product_id: productId,
      workshop_id: wsData!.id,
      step_order: 1,
      planned_qty: 100,
      completed_qty: 0,
      lead_time_days: 1,
      deadline: "2026-12-01",
      status: "PENDING",
    });

    expect(woInsertErr).toBeNull();

    // Try deleting PO -> Should fail with clean Vietnamese FK RESTRICT error message!
    await expect(deletePO(po.poId)).rejects.toThrow("do đã có Lệnh sản xuất (WO) liên quan");

    // Clean up dummy WO and PO
    await supabaseAdmin.from("work_orders").delete().eq("wo_number", dummyWoId);
    await deletePO(po.poId);
  }, 20000);

  it("should export PO list to Excel buffer with delivery evaluation column via GET /api/po/export", async () => {
    const poNumber = `PO-EXPORT-${Date.now()}`;
    const po = await createPO({
      poNumber,
      customerName: testCustomer,
      sku: testSku,
      productNameVi: "Sản Phẩm Test PO Postgres",
      qty: 75,
      requestedDate: "2026-12-31",
    });

    const req = createMockRequest("http://localhost:3000/api/po/export", "GET", undefined, token);
    const res = await exportPOsRoute(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");

    const arrayBuffer = await res.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonRows: any[] = XLSX.utils.sheet_to_json(sheet);

    expect(jsonRows.length).toBeGreaterThan(0);
    const exportRow = jsonRows.find((r) => r["Mã PO"] === poNumber);
    expect(exportRow).toBeDefined();
    expect(exportRow["Part No (SKU)"]).toBe(testSku);
    expect(exportRow["Đánh Giá Hạn Giao"]).toBeDefined();

    // Clean up
    await deletePO(po.poId);
  }, 20000);
});
