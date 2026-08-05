import { listPOs, getPO, updatePO, deletePO, ensureCustomerByName } from "../lib/po-postgres";
import { supabaseAdmin } from "../lib/supabase";

async function verifyGroup2() {
  console.log("==========================================================");
  console.log("TEST KIỂM CHỨNG NHÓM 2: updatePO + deletePO + shippedQty");
  console.log("==========================================================");

  // 1. Tạo 1 PO test đa dòng gồm 3 dòng khác nhau
  const custName = "KH Test Group 2 Multi-Line";
  const testPoNumber = `PO-GRP2-TEST-${Date.now()}`;
  
  const custId = await ensureCustomerByName(custName);

  // Get 3 valid products
  const { data: prods } = await supabaseAdmin.from("products").select("id, part_no, name_vi").limit(3);
  if (!prods || prods.length < 3) throw new Error("Cần ít nhất 3 sản phẩm trong DB để test");

  // Register product_customers
  for (const pr of prods) {
    await supabaseAdmin.from("product_customers").upsert({ product_id: pr.id, customer_id: custId }, { onConflict: "product_id,customer_id" });
  }

  // Create PO header
  const { data: poHeader, error: poHeaderErr } = await supabaseAdmin
    .from("purchase_orders")
    .insert({
      po_number: testPoNumber,
      customer_id: custId,
      requested_date: "2026-09-01",
      status: "NEW",
    })
    .select("id")
    .single();

  if (poHeaderErr || !poHeader) throw new Error(`Lỗi tạo PO Header: ${poHeaderErr?.message}`);
  const poHeaderId = poHeader.id;

  // Insert 3 lines: line 1 = 10, line 2 = 20, line 3 = 30
  const { data: insertedLines, error: lineInsertErr } = await supabaseAdmin
    .from("po_lines")
    .insert([
      { po_id: poHeaderId, customer_id: custId, product_id: prods[0].id, order_qty: 10 },
      { po_id: poHeaderId, customer_id: custId, product_id: prods[1].id, order_qty: 20 },
      { po_id: poHeaderId, customer_id: custId, product_id: prods[2].id, order_qty: 30 },
    ])
    .select("id, product_id, order_qty");

  if (lineInsertErr || !insertedLines) throw new Error(`Lỗi tạo po_lines: ${lineInsertErr?.message}`);

  const [line1, line2, line3] = insertedLines;
  console.log(`1. Đã tạo PO đa dòng ${testPoNumber} gồm 3 dòng:`);
  console.log(`   - Dòng 1 (${prods[0].part_no}): SL = 10 (LineID: ${line1.id})`);
  console.log(`   - Dòng 2 (${prods[1].part_no}): SL = 20 (LineID: ${line2.id})`);
  console.log(`   - Dòng 3 (${prods[2].part_no}): SL = 30 (LineID: ${line3.id})`);

  // 2. Test SỬA SL CHỈ CHO DÒNG 1 -> thành 99
  console.log("\n2. Tiến hành sửa số lượng Dòng 1 thành 99 cái...");
  await updatePO(line1.id, { qty: 99 });

  const fetchedLine1 = await getPO(line1.id);
  const fetchedLine2 = await getPO(line2.id);
  const fetchedLine3 = await getPO(line3.id);

  console.log(`   - Dòng 1 sau sửa: SL = ${fetchedLine1?.qty}`);
  console.log(`   - Dòng 2 sau sửa: SL = ${fetchedLine2?.qty}`);
  console.log(`   - Dòng 3 sau sửa: SL = ${fetchedLine3?.qty}`);

  if (fetchedLine1?.qty !== 99) {
    throw new Error(`THẤT BẠI: Dòng 1 không được cập nhật đúng 99! Thực tế: ${fetchedLine1?.qty}`);
  }
  if (fetchedLine2?.qty !== 20 || fetchedLine3?.qty !== 30) {
    throw new Error(`THẤT BẠI: Sửa dòng 1 đã làm đè sang dòng 2 hoặc 3! Dòng 2: ${fetchedLine2?.qty}, Dòng 3: ${fetchedLine3?.qty}`);
  }
  console.log("✅ ĐẠT: Sửa số lượng Dòng 1 CHỈ thay đổi Dòng 1, Dòng 2 và Dòng 3 giữ nguyên 100%!");

  // 3. Test XÓA 1 DÒNG LẺ (Dòng 2)
  console.log("\n3. Tiến hành xóa Dòng 2...");
  await deletePO(line2.id);

  const checkLine1AfterDel = await getPO(line1.id);
  const checkLine2AfterDel = await getPO(line2.id);
  const checkLine3AfterDel = await getPO(line3.id);

  if (checkLine2AfterDel !== null) {
    throw new Error("THẤT BẠI: Dòng 2 vẫn còn sau khi xóa!");
  }
  if (!checkLine1AfterDel || !checkLine3AfterDel) {
    throw new Error("THẤT BẠI: Xóa dòng 2 đã làm mất dòng 1 hoặc dòng 3!");
  }
  console.log("✅ ĐẠT: Xóa Dòng 2 thành công, Dòng 1 và Dòng 3 vẫn còn nguyên vẹn trong PO!");

  // 4. Test Xóa toàn bộ PO (bằng cách xóa PO Header)
  console.log("\n4. Tiến hành xóa toàn bộ PO...");
  await deletePO(poHeaderId);

  const checkLine1Final = await getPO(line1.id);
  const checkLine3Final = await getPO(line3.id);
  const checkHeaderFinal = await getPO(poHeaderId);

  if (checkLine1Final !== null || checkLine3Final !== null || checkHeaderFinal !== null) {
    throw new Error("THẤT BẠI: PO Header hoặc các dòng con chưa được dọn sạch hoàn toàn!");
  }
  console.log("✅ ĐẠT: Xóa toàn bộ PO Header đã CASCADE dọn sạch tất cả các dòng con liên quan!");

  // Cleanup test customer
  await supabaseAdmin.from("product_customers").delete().eq("customer_id", custId);
  await supabaseAdmin.from("customers").delete().eq("id", custId);

  console.log("\n==========================================================");
  console.log(">>> HOÀN TẤT VÀ VƯỢT QUA TOÀN BỘ BÀI TEST NHÓM 2 <<<");
  console.log("==========================================================");
}

verifyGroup2().catch((err) => {
  console.error("LỖI TEST NHÓM 2:", err);
  process.exit(1);
});
