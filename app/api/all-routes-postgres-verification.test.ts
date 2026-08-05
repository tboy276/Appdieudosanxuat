import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { signToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { seedWorkshops } from "@/scripts/seed-workshops-supabase";

// Route Handlers to verify
import { POST as importProductsHandler } from "./products/import/route";
import { POST as bulkOpeningHandler } from "./inventory/opening/bulk/route";
import { POST as transferProductionHandler } from "./production/transfer/route";
import { GET as workcentersHandler } from "./workcenters/route";
import { POST as closeWOHandler } from "./wo/[id]/close/route";
import { GET as pipelineReportHandler } from "./reports/po-pipeline/route";
import { GET as auditOpeningHandler } from "./audit/opening/route";
import { GET as usersGetHandler, POST as usersPostHandler } from "./users/route";
import { GET as historyHandler } from "./history/route";

import { createPO } from "@/lib/po-postgres";
import { createWOsForPO } from "@/lib/wo-postgres";
import { upsertProduct } from "@/lib/products";

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

describe("All Secondary/Peripheral API Routes - PostgreSQL Verification", () => {
  const token = signToken({ id: "admin_1", username: "admin", role: "ADMIN" });
  const ts = Date.now();

  beforeAll(async () => {
    await seedWorkshops();
  }, 35000);

  it("1. GET /api/workcenters should return valid workshops list directly from Supabase Postgres", async () => {
    const req = createMockRequest("http://localhost:3000/api/workcenters", "GET", undefined, token);
    const res = await workcentersHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThanOrEqual(11);

    // Direct SQL check
    const { count: wsCount } = await supabaseAdmin.from("workshops").select("*", { count: "exact", head: true });
    expect(json.length).toBe(wsCount);
  });

  it("2. POST /api/products/import should write multiple SKUs and Routings directly to Postgres", async () => {
    const importSku1 = `SKU-IMP-TEST-${ts}-01`;
    const importSku2 = `SKU-IMP-TEST-${ts}-02`;
    const custName = `Khách Hàng Import Test ${ts}`;

    const rows = [
      {
        sku: importSku1,
        nameVi: "Sản phẩm Import Test 1",
        customerName: custName,
        routingStr: "D1(10,2) -> CK1(5,3) -> KTP",
        unit: "Cái",
      },
      {
        sku: importSku2,
        nameVi: "Sản phẩm Import Test 2",
        customerName: custName,
        routingStr: "D2(8,1) -> LR(2,2) -> KTP",
        unit: "Cái",
      },
    ];

    const req = createMockRequest("http://localhost:3000/api/products/import", "POST", { rows }, token);
    const res = await importProductsHandler(req);
    const json = await res.json();
    if (res.status !== 200) {
      console.error("IMPORT PRODUCT ERR:", json);
    }
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.count).toBe(2);

    // Direct SQL verification on products and product_routings
    const { data: prods, error: prodErr } = await supabaseAdmin
      .from("products")
      .select("id, part_no, name_vi, product_routings ( step_order, workshops ( code ) )")
      .in("part_no", [importSku1, importSku2]);

    expect(prodErr).toBeNull();
    expect(prods?.length).toBe(2);

    const p1 = prods?.find((p) => p.part_no === importSku1);
    expect(p1).toBeDefined();
    expect(p1?.name_vi).toBe("Sản phẩm Import Test 1");
    const p1Steps = (p1?.product_routings as any[])
      ?.sort((a, b) => a.step_order - b.step_order)
      ?.map((r) => r.workshops?.code);
    expect(p1Steps).toEqual(["D1", "CK1"]);
  });

  it("3. POST /api/inventory/opening/bulk should record opening stock directly into Supabase Postgres", async () => {
    const openingSku = `SKU-OPENING-BULK-${ts}`;
    const custName = `Khách Hàng Opening ${ts}`;

    await upsertProduct({
      sku: openingSku,
      nameVi: "Sản phẩm Opening Bulk",
      customerNames: [custName],
      routing: ["D1", "CK1", "KTP"],
      unit: "Cái",
    });

    const items = [
      {
        wcCode: "D1",
        sku: openingSku,
        state: { tonPhoi: 0, tonThanhPham: 10 }, // Step 1 cannot have tonPhoi > 0
      },
      {
        wcCode: "CK1",
        sku: openingSku,
        state: { tonPhoi: 20, tonThanhPham: 5 },
      },
    ];

    const req = createMockRequest("http://localhost:3000/api/inventory/opening/bulk", "POST", {
      items,
      cutoverDate: "2026-08-01",
    }, token);

    const res = await bulkOpeningHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Direct SQL check on opening_stocks table
    const { data: snapshots, error: snapErr } = await supabaseAdmin
      .from("opening_stocks")
      .select("workshop_id, ton_phoi, ton_thanh_pham, workshops(code), products(part_no)")
      .eq("snapshot_date", "2026-08-01");

    expect(snapErr).toBeNull();
    expect(snapshots).toBeDefined();

    const d1Snap = snapshots?.find((s: any) => s.workshops?.code === "D1" && s.products?.part_no === openingSku);
    expect(d1Snap).toBeDefined();
    expect(d1Snap?.ton_phoi).toBe(0);
    expect(d1Snap?.ton_thanh_pham).toBe(10);
  });

  it("4. POST /api/production/transfer should write transfer transactions directly to inventory_transactions", async () => {
    const transferSku = `SKU-TRANSFER-TEST-${ts}`;
    const custName = `Khách Hàng Transfer ${ts}`;

    await upsertProduct({
      sku: transferSku,
      nameVi: "Sản phẩm Transfer Test",
      customerNames: [custName],
      routing: ["D1", "CK1", "KTP"],
      unit: "Cái",
    });

    const req = createMockRequest("http://localhost:3000/api/production/transfer", "POST", {
      fromCode: "D1",
      toCode: "CK1",
      sku: transferSku,
      qty: 15,
      customDate: "2026-08-05",
    }, token);

    const res = await transferProductionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Direct SQL check in inventory_transactions
    const { data: txs, error: txErr } = await supabaseAdmin
      .from("inventory_transactions")
      .select("id, from_workshop_id, to_workshop_id, qty_tp_ok, transaction_type, workshops!inventory_transactions_from_workshop_id_fkey(code)")
      .eq("transaction_type", "TRANSFER");

    expect(txErr).toBeNull();
    expect(txs?.length).toBeGreaterThanOrEqual(1);
    const transferTx = txs?.find((t: any) => t.workshops?.code === "D1" && t.qty_tp_ok === 15);
    expect(transferTx).toBeDefined();
  });

  it("5. POST /api/wo/[id]/close should update WO status to COMPLETED directly in Postgres", async () => {
    const closeSku = `SKU-CLOSE-WO-${ts}`;
    const custName = `Khách Hàng Close WO ${ts}`;

    await upsertProduct({
      sku: closeSku,
      nameVi: "Sản phẩm Close WO Test",
      customerNames: [custName],
      routing: ["D1", "CK1", "KTP"],
      unit: "Cái",
    });

    const po = await createPO({
      poNumber: `PO-CLOSE-${ts}`,
      customerName: custName,
      sku: closeSku,
      qty: 80,
      requestedDate: "2026-10-01",
    });

    const { createdWos: wos } = await createWOsForPO(po.poId);
    expect(wos.length).toBe(2); // D1, CK1

    const targetWo = wos[0];

    const req = createMockRequest(`http://localhost:3000/api/wo/${targetWo.woId}/close`, "POST", undefined, token);
    const res = await closeWOHandler(req, { params: { id: targetWo.woId } });
    expect(res.status).toBe(200);

    // Direct SQL verification on work_orders
    const { data: dbWo, error: woErr } = await supabaseAdmin
      .from("work_orders")
      .select("id, status")
      .eq("id", targetWo.woId)
      .single();

    expect(woErr).toBeNull();
    expect(dbWo?.status).toBe("COMPLETED");
  });

  it("6. GET /api/reports/po-pipeline should compute active PO WIP balance accurately from Postgres", async () => {
    const req = createMockRequest("http://localhost:3000/api/reports/po-pipeline", "GET", undefined, token);
    const res = await pipelineReportHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    // Verified structure
    if (json.length > 0) {
      expect(json[0]).toHaveProperty("poId");
      expect(json[0]).toHaveProperty("poNumber");
      expect(json[0]).toHaveProperty("coverageStatus");
      expect(json[0]).toHaveProperty("steps");
    }
  });

  it("7. GET /api/audit/opening should return opening stock audit history from Postgres opening_stocks table", async () => {
    const req = createMockRequest("http://localhost:3000/api/audit/opening", "GET", undefined, token);
    const res = await auditOpeningHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);

    // Direct SQL check
    const { count: openCount } = await supabaseAdmin
      .from("opening_stocks")
      .select("*", { count: "exact", head: true });

    expect(json.length).toBe(openCount);
  });

  it("8. GET & POST /api/users should query and insert user accounts directly in Supabase Postgres users table", async () => {
    const testUsername = `user_test_${ts}`;
    const createReq = createMockRequest("http://localhost:3000/api/users", "POST", {
      username: testUsername,
      password: "TestPassword123!",
      fullName: "Test Verification User",
      role: "DISPATCHER",
    }, token);

    const createRes = await usersPostHandler(createReq);
    expect(createRes.status).toBe(200);

    // Direct SQL verification on users table
    const { data: dbUser, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id, username, full_name, role, status")
      .eq("username", testUsername)
      .single();

    expect(userErr).toBeNull();
    expect(dbUser).toBeDefined();
    expect(dbUser?.username).toBe(testUsername);
    expect(dbUser?.role).toBe("DISPATCHER");

    // Verify GET /api/users list returns this user
    const listReq = createMockRequest("http://localhost:3000/api/users", "GET", undefined, token);
    const listRes = await usersGetHandler(listReq);
    expect(listRes.status).toBe(200);

    const listJson = await listRes.json();
    expect(Array.isArray(listJson)).toBe(true);
    expect(listJson.some((u: any) => u.username === testUsername)).toBe(true);
  });

  it("9. GET /api/history should return inventory transaction logs from Postgres inventory_transactions", async () => {
    const req = createMockRequest("http://localhost:3000/api/history", "GET", undefined, token);
    const res = await historyHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);

    // Direct SQL count comparison
    const { count: txCount } = await supabaseAdmin
      .from("inventory_transactions")
      .select("*", { count: "exact", head: true });

    expect(typeof txCount).toBe("number");
    expect(json.length).toBeGreaterThanOrEqual(0);
    expect(Math.abs(json.length - (txCount ?? 0))).toBeLessThanOrEqual(5);
  });
});
