import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { POST as importPOHandler } from "../app/api/po/import/route";
import { seedWorkshops } from "./seed-workshops-supabase";
import { upsertProduct } from "../lib/products";
import { signToken, AUTH_COOKIE_NAME } from "../lib/auth";
import { supabaseAdmin } from "../lib/supabase";
import { listPOs } from "../lib/po-wo-engine";

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

async function run473Proof() {
  console.log("==========================================================");
  console.log("XÁC NHẬN BẰNG CHỨNG SQL THỰC TẾ: IMPORT 473 DÒNG PO VÀO POSTGRES");
  console.log("==========================================================");

  await seedWorkshops();
  const token = signToken({ id: "admin_1", username: "admin", role: "ADMIN" });
  const ts = Date.now();

  const existingCustName = `Khách Hàng Benchmark A ${ts}`;
  const newCustName = `Khách Hàng Benchmark B ${ts}`;

  console.log("1. Chuẩn bị 100 SKU đã đăng ký trên Supabase Postgres...");
  for (let i = 1; i <= 100; i++) {
    const sku = `SKU-PROOF-EXIST-${ts}-${String(i).padStart(3, "0")}`;
    await upsertProduct({
      sku,
      nameVi: `Sản phẩm Proof ${i}`,
      customerNames: [existingCustName],
      routing: ["D1", "CK1", "KTP"],
      unit: "Cái",
    });
  }
  console.log("-> Đã tạo xong 100 SKU đăng ký sẵn.");

  // 2. Build 473 PO rows (100 existing SKUs + 133 brand new draft SKUs = 233 unique SKUs)
  console.log("2. Khởi tạo danh sách 473 dòng PO (233 SKU khác nhau)...");
  const importRows: any[] = [];
  let poCounter = 1;

  // 100 existing SKUs (distributed across rows)
  for (let i = 1; i <= 100; i++) {
    const sku = `SKU-PROOF-EXIST-${ts}-${String(i).padStart(3, "0")}`;
    const repeatCount = i <= 40 ? 3 : 2; // 40*3 + 60*2 = 240 rows
    for (let r = 0; r < repeatCount; r++) {
      importRows.push({
        poNumber: `PO-PRF-${ts}-${String(poCounter++).padStart(4, "0")}`,
        sku,
        customerName: existingCustName,
        qty: 50 + (i % 50),
        requestedDate: "2026-10-15",
      });
    }
  }

  // 133 new draft SKUs (distributed across remaining 233 rows)
  for (let i = 1; i <= 133; i++) {
    const sku = `SKU-PROOF-DRAFT-${ts}-${String(i).padStart(3, "0")}`;
    const repeatCount = i <= 100 ? 2 : 1; // 100*2 + 33*1 = 233 rows (Total = 240 + 233 = 473 rows)
    for (let r = 0; r < repeatCount; r++) {
      if (importRows.length < 473) {
        importRows.push({
          poNumber: `PO-PRF-${ts}-${String(poCounter++).padStart(4, "0")}`,
          sku,
          productNameVi: `Sản phẩm Draft ${i}`,
          customerName: newCustName,
          qty: 100 + (i % 20),
          requestedDate: "2026-11-20",
        });
      }
    }
  }

  console.log(`-> Tổng số dòng PO chuẩn bị gửi: ${importRows.length} dòng.`);

  // 3. Direct SQL Count BEFORE Import
  const { count: poBefore } = await supabaseAdmin
    .from("purchase_orders")
    .select("*", { count: "exact", head: true });
  const { count: linesBefore } = await supabaseAdmin
    .from("po_lines")
    .select("*", { count: "exact", head: true });

  console.log("\n----------------------------------------------------------");
  console.log(`[SQL BEFORE IMPORT] purchase_orders: ${poBefore} | po_lines: ${linesBefore}`);
  console.log("----------------------------------------------------------");

  // 4. Invoke the REAL Next.js route handler
  console.log("3. Gọi trực tiếp API Handler POST /api/po/import...");
  const startTime = Date.now();
  const req = createMockRequest("http://localhost:3000/api/po/import", "POST", {
    rows: importRows,
    skipConflicts: true,
  }, token);

  const res = await importPOHandler(req);
  const json = await res.json();
  const duration = Date.now() - startTime;

  console.log(`-> Response status: ${res.status}`);
  console.log(`-> Response JSON count: ${json.count}`);
  console.log(`-> Thời gian xử lý: ${duration} ms (${(duration / 1000).toFixed(2)} giây)`);

  // 5. Direct SQL Count AFTER Import
  const { count: poAfter } = await supabaseAdmin
    .from("purchase_orders")
    .select("*", { count: "exact", head: true });
  const { count: linesAfter } = await supabaseAdmin
    .from("po_lines")
    .select("*", { count: "exact", head: true });

  const poAdded = (poAfter || 0) - (poBefore || 0);
  const linesAdded = (linesAfter || 0) - (linesBefore || 0);

  console.log("\n==========================================================");
  console.log("KẾT QUẢ TRUY VẤN SQL TRỰC TIẾP TỪ SUPABASE POSTGRESQL:");
  console.log("==========================================================");
  console.log(`- purchase_orders TRƯỚC: ${poBefore}  -->  SAU: ${poAfter}  (TĂNG THỰC TẾ: +${poAdded} bản ghi)`);
  console.log(`- po_lines        TRƯỚC: ${linesBefore} -->  SAU: ${linesAfter} (TĂNG THỰC TẾ: +${linesAdded} bản ghi)`);
  console.log("==========================================================");

  // 6. Fetch 5 sample POs directly with their po_lines and product links
  const { data: samplePOs } = await supabaseAdmin
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      requested_date,
      status,
      customers ( name ),
      po_lines (
        id,
        order_qty,
        products ( part_no, name_vi )
      )
    `)
    .ilike("po_number", `PO-PRF-${ts}-%`)
    .limit(5);

  console.log("\nBằng chứng 5 bản ghi PO thật vừa tạo trong Supabase PostgreSQL:");
  samplePOs?.forEach((p, idx) => {
    const cust = (p.customers as any)?.name;
    const line = (p.po_lines as any)?.[0];
    const sku = line?.products?.part_no;
    const prodName = line?.products?.name_vi;
    const qty = line?.order_qty;
    console.log(` [${idx + 1}] ID: ${p.id} | PO: ${p.po_number} | Khách: ${cust} | SKU: ${sku} (${prodName}) | SL: ${qty} | Ngày: ${p.requested_date}`);
  });
}

run473Proof();
