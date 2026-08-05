import { listPOs, getPO, ensureCustomerByName } from "../lib/po-postgres";
import { createWOsForPO, listWOs } from "../lib/wo-postgres";
import { upsertProduct } from "../lib/products";
import { supabaseAdmin } from "../lib/supabase";

async function verifyGroup3() {
  console.log("==========================================================");
  console.log("TEST KIỂM CHỨNG NHÓM 3: createWOsForPO đa dòng & không trùng wo_number");
  console.log("==========================================================");

  const custName = "KH Test Group 3 Multi-Line";
  const sku1 = `SKU-G3-A-${Date.now()}`;
  const sku2 = `SKU-G3-B-${Date.now()}`;
  const testPoNumber = `PO-GRP3-MULTI-${Date.now()}`;

  // 1. Tạo 2 SKU với quy trình Routing hoàn chỉnh:
  // SKU 1: D1 -> CK1 -> KTP (2 bước sản xuất)
  // SKU 2: D2 -> KTP (1 bước sản xuất)
  const p1 = await upsertProduct({
    sku: sku1,
    nameVi: "Sản phẩm G3 Mẫu A",
    customerNames: [custName],
    routing: ["D1", "CK1", "KTP"],
    unit: "Cái",
  });

  const p2 = await upsertProduct({
    sku: sku2,
    nameVi: "Sản phẩm G3 Mẫu B",
    customerNames: [custName],
    routing: ["D2", "KTP"],
    unit: "Cái",
  });

  const custId = await ensureCustomerByName(custName);

  const { data: prodRows } = await supabaseAdmin
    .from("products")
    .select("id, part_no")
    .in("part_no", [sku1, sku2]);

  const prod1Id = prodRows!.find((p) => p.part_no === sku1)!.id;
  const prod2Id = prodRows!.find((p) => p.part_no === sku2)!.id;

  // Create PO header
  const { data: poHeader, error: poErr } = await supabaseAdmin
    .from("purchase_orders")
    .insert({
      po_number: testPoNumber,
      customer_id: custId,
      requested_date: "2026-09-15",
      status: "NEW",
    })
    .select("id")
    .single();

  if (poErr || !poHeader) throw new Error(`Lỗi tạo PO: ${poErr?.message}`);
  const poHeaderId = poHeader.id;

  // Insert 2 lines: line 1 = 15, line 2 = 25
  const { data: insertedLines, error: linesErr } = await supabaseAdmin
    .from("po_lines")
    .insert([
      { po_id: poHeaderId, customer_id: custId, product_id: prod1Id, order_qty: 15 },
      { po_id: poHeaderId, customer_id: custId, product_id: prod2Id, order_qty: 25 },
    ])
    .select("id, product_id, order_qty");

  if (linesErr || !insertedLines) throw new Error(`Lỗi tạo lines: ${linesErr?.message}`);

  const [line1, line2] = insertedLines;
  console.log(`1. Đã tạo PO đa dòng ${testPoNumber} gồm 2 mặt hàng:`);
  console.log(`   - Line 1: SKU ${sku1} (Routing: D1, CK1), SL = 15 (LineID: ${line1.id})`);
  console.log(`   - Line 2: SKU ${sku2} (Routing: D2), SL = 25 (LineID: ${line2.id})`);

  // 2. Gọi createWOsForPO(poHeaderId, "admin") để tạo WO cho TOÀN BỘ PO
  console.log("\n2. Tạo Work Orders hàng loạt cho toàn bộ PO đa dòng...");
  const { createdWos, skippedCount } = await createWOsForPO(poHeaderId, "admin");
  console.log(`   - Tổng số WO tạo ra: ${createdWos.length} WOs.`);

  // Verify created WOs
  const woNumbers = createdWos.map((w: any) => w.woNumber);
  const distinctWoNumbers = new Set(woNumbers);
  console.log(`3. Danh sách mã WO:`, woNumbers);

  if (woNumbers.length !== distinctWoNumbers.size) {
    throw new Error(`THẤT BẠI: Có mã WO bị trùng lặp! ${woNumbers.join(", ")}`);
  }
  console.log("✅ ĐẠT: Toàn bộ mã WO đều duy nhất và không bị trùng lặp!");

  // Check that WOs exist for both line1 and line2
  const wosLine1 = createdWos.filter((w: any) => w.poLineId === line1.id);
  const wosLine2 = createdWos.filter((w: any) => w.poLineId === line2.id);

  console.log(`4. Phân bổ WO theo từng dòng SKU:`);
  console.log(`   - Line 1 (SKU ${sku1}): ${wosLine1.length} WOs (Mã: ${wosLine1.map((w: any) => w.woNumber).join(", ")})`);
  console.log(`   - Line 2 (SKU ${sku2}): ${wosLine2.length} WOs (Mã: ${wosLine2.map((w: any) => w.woNumber).join(", ")})`);

  if (wosLine1.length !== 2 || wosLine2.length !== 1) {
    throw new Error(`THẤT BẠI: Số lượng WO cho từng dòng không khớp routing! Line 1: ${wosLine1.length} (kỳ vọng 2), Line 2: ${wosLine2.length} (kỳ vọng 1)`);
  }
  console.log("✅ ĐẠT: Cả 2 SKU trong PO đa dòng đều được tạo đủ WO độc lập, đúng số bước routing!");

  // 5. Test createWOsForPO(poLineId) cho 1 dòng riêng lẻ
  console.log("\n5. Kiểm tra tạo WO cho 1 dòng PO Line cụ thể...");
  // Tạo 1 dòng PO mới
  const sku3 = `SKU-G3-C-${Date.now()}`;
  await upsertProduct({
    sku: sku3,
    nameVi: "Sản phẩm G3 Mẫu C",
    customerNames: [custName],
    routing: ["CK2", "KTP"],
    unit: "Cái",
  });
  const { data: p3Row } = await supabaseAdmin.from("products").select("id").eq("part_no", sku3).single();
  const { data: line3Row } = await supabaseAdmin
    .from("po_lines")
    .insert({ po_id: poHeaderId, customer_id: custId, product_id: p3Row!.id, order_qty: 40 })
    .select("id")
    .single();

  const { createdWos: line3Wos } = await createWOsForPO(line3Row!.id, "admin");
  console.log(`   - WO tạo riêng cho Line 3 (${sku3}): ${line3Wos.map((w: any) => w.woNumber).join(", ")}`);
  if (!line3Wos.some((w: any) => w.poLineId === line3Row!.id)) {
    throw new Error("THẤT BẠI: createWOsForPO(poLineId) không tạo WO cho đúng dòng!");
  }
  console.log("✅ ĐẠT: createWOsForPO(poLineId) tạo chính xác WO cho riêng dòng chỉ định!");

  // Cleanup test WOs, PO lines, PO header, products, customer
  await supabaseAdmin.from("work_orders").delete().in("po_line_id", [line1.id, line2.id, line3Row!.id]);
  await supabaseAdmin.from("po_lines").delete().eq("po_id", poHeaderId);
  await supabaseAdmin.from("purchase_orders").delete().eq("id", poHeaderId);
  await supabaseAdmin.from("product_routings").delete().in("product_id", [prod1Id, prod2Id, p3Row!.id]);
  await supabaseAdmin.from("product_customers").delete().in("product_id", [prod1Id, prod2Id, p3Row!.id]);
  await supabaseAdmin.from("products").delete().in("id", [prod1Id, prod2Id, p3Row!.id]);
  await supabaseAdmin.from("customers").delete().eq("id", custId);

  console.log("\n==========================================================");
  console.log(">>> HOÀN TẤT VÀ VƯỢT QUA TOÀN BỘ BÀI TEST NHÓM 3 <<<");
  console.log("==========================================================");
}

verifyGroup3().catch((err) => {
  console.error("LỖI TEST NHÓM 3:", err);
  process.exit(1);
});
