import { listPOs, getPO, ensureCustomerByName, enrichPOWithShippedQty } from "../lib/po-postgres";
import { upsertProduct } from "../lib/products";
import { declareOpeningStock } from "../lib/inventory-postgres";
import { getShippableItems, createShipment } from "../lib/shipment";
import { supabaseAdmin } from "../lib/supabase";

async function verifyGroup4() {
  console.log("==========================================================");
  console.log("TEST KIỂM CHỨNG NHÓM 4: getShippableItems + createShipment + po-pipeline");
  console.log("==========================================================");

  const custName = "KH Test Group 4 Shipment";
  const sku1 = `SKU-G4-A-${Date.now()}`;
  const sku2 = `SKU-G4-B-${Date.now()}`;
  const testPoNumber = `PO-GRP4-MULTI-${Date.now()}`;

  // 1. Tạo 2 SKU
  await upsertProduct({
    sku: sku1,
    nameVi: "Sản phẩm G4 Mẫu A",
    customerNames: [custName],
    routing: ["D1", "KTP"],
    unit: "Cái",
  });

  await upsertProduct({
    sku: sku2,
    nameVi: "Sản phẩm G4 Mẫu B",
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
  const { data: poHeader } = await supabaseAdmin
    .from("purchase_orders")
    .insert({
      po_number: testPoNumber,
      customer_id: custId,
      requested_date: "2026-09-20",
      status: "NEW",
    })
    .select("id")
    .single();

  const poHeaderId = poHeader!.id;

  // Insert 2 lines: line 1 = 50, line 2 = 100
  const { data: insertedLines } = await supabaseAdmin
    .from("po_lines")
    .insert([
      { po_id: poHeaderId, customer_id: custId, product_id: prod1Id, order_qty: 50 },
      { po_id: poHeaderId, customer_id: custId, product_id: prod2Id, order_qty: 100 },
    ])
    .select("id, product_id, order_qty");

  const [line1, line2] = insertedLines!;
  console.log(`1. Đã tạo PO đa dòng ${testPoNumber}:`);
  console.log(`   - Line 1: SKU ${sku1}, SL = 50 (LineID: ${line1.id})`);
  console.log(`   - Line 2: SKU ${sku2}, SL = 100 (LineID: ${line2.id})`);

  // 2. Thêm tồn kho KTP cho cả 2 SKU bằng declareOpeningStock
  await declareOpeningStock("KTP", sku1, { tonPhoi: 0, tonThanhPham: 50 }, "admin");
  await declareOpeningStock("KTP", sku2, { tonPhoi: 0, tonThanhPham: 100 }, "admin");

  console.log("\n2. Đã bổ sung tồn kho KTP hợp lệ: SKU 1 = 50 Cái, SKU 2 = 100 Cái.");

  // 3. Kiểm tra getShippableItems()
  const shippable = await getShippableItems({ customerId: custId });
  console.log(`3. getShippableItems trả về: ${shippable.length} dòng.`);

  const shippableLine1 = shippable.find((s) => s.poLineId === line1.id);
  const shippableLine2 = shippable.find((s) => s.poLineId === line2.id);

  if (!shippableLine1 || !shippableLine2) {
    throw new Error(`THẤT BẠI: getShippableItems không tách đủ 2 dòng riêng biệt cho PO đa dòng! Tìm thấy: ${JSON.stringify(shippable)}`);
  }
  console.log(`   - Dòng 1 có thể xuất: ${shippableLine1.maxShippableQty}/${shippableLine1.orderQty}`);
  console.log(`   - Dòng 2 có thể xuất: ${shippableLine2.maxShippableQty}/${shippableLine2.orderQty}`);
  console.log("✅ ĐẠT: getShippableItems tách độc lập từng dòng của PO đa dòng!");

  // 4. Tạo phiếu xuất hàng CHỈ XUẤT CHO DÒNG 1 (SL = 30)
  console.log("\n4. Tiến hành xuất hàng 30 cái cho Dòng 1...");
  const shipRes = await createShipment(
    custId,
    [{ poLineId: line1.id, productId: prod1Id, shippedQty: 30 }],
    "admin",
    "Xuất test dòng 1"
  );
  console.log(`   - Tạo phiếu xuất thành công: ${shipRes.shipmentNumber}`);

  // 5. Kiểm tra enrichPOWithShippedQty
  const posAfterShip = await listPOs();
  const poLine1After = posAfterShip.find((p) => p.poLineId === line1.id);
  const poLine2After = posAfterShip.find((p) => p.poLineId === line2.id);

  console.log(`   - Dòng 1 đã xuất: ${poLine1After?.shippedQty} (Kỳ vọng: 30)`);
  console.log(`   - Dòng 2 đã xuất: ${poLine2After?.shippedQty} (Kỳ vọng: 0)`);

  if (poLine1After?.shippedQty !== 30) {
    throw new Error(`THẤT BẠI: Dòng 1 chưa ghi nhận đúng 30 cái đã xuất! Thực tế: ${poLine1After?.shippedQty}`);
  }
  if (poLine2After?.shippedQty !== 0) {
    throw new Error(`THẤT BẠI: Dòng 2 bị ghi đè số lượng đã xuất! Thực tế: ${poLine2After?.shippedQty}`);
  }
  console.log("✅ ĐẠT: Xuất hàng dòng 1 chỉ cộng shippedQty cho dòng 1, dòng 2 giữ nguyên 0!");

  // Cleanup test data
  await supabaseAdmin.from("shipment_items").delete().in("po_line_id", [line1.id, line2.id]);
  await supabaseAdmin.from("shipments").delete().eq("id", shipRes.shipmentId);
  await supabaseAdmin.from("opening_stocks").delete().in("product_id", [prod1Id, prod2Id]);
  await supabaseAdmin.from("inventory_transactions").delete().in("product_id", [prod1Id, prod2Id]);
  await supabaseAdmin.from("po_lines").delete().eq("po_id", poHeaderId);
  await supabaseAdmin.from("purchase_orders").delete().eq("id", poHeaderId);
  await supabaseAdmin.from("product_routings").delete().in("product_id", [prod1Id, prod2Id]);
  await supabaseAdmin.from("product_customers").delete().in("product_id", [prod1Id, prod2Id]);
  await supabaseAdmin.from("products").delete().in("id", [prod1Id, prod2Id]);
  await supabaseAdmin.from("customers").delete().eq("id", custId);

  console.log("\n==========================================================");
  console.log(">>> HOÀN TẤT VÀ VƯỢT QUA TOÀN BỘ BÀI TEST NHÓM 4 <<<");
  console.log("==========================================================");
}

verifyGroup4().catch((err) => {
  console.error("LỖI TEST NHÓM 4:", err);
  process.exit(1);
});
