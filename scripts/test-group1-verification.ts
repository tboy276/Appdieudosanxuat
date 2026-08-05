import { listPOs, getPO } from "../lib/po-postgres";

async function verifyGroup1() {
  console.log("==========================================================");
  console.log("TEST KIỂM CHỨNG NHÓM 1: mapDbRecordToPO + listPOs + getPO");
  console.log("==========================================================");

  const pos = await listPOs();
  console.log(`1. listPOs() trả về tổng cộng: ${pos.length} dòng PO items.`);

  if (pos.length !== 149) {
    throw new Error(`THẤT BẠI: Mong đợi 149 dòng nhưng nhận được ${pos.length} dòng!`);
  }
  console.log("✅ ĐẠT: listPOs() trả về ĐÚNG 149/149 dòng!");

  // Verify all 149 lines have distinct poLineId and valid fields
  const poLineIdsSet = new Set<string>();
  let validLineCount = 0;

  for (const p of pos) {
    if (!p.poId || !p.poLineId || !p.poNumber || !p.sku || p.qty <= 0) {
      throw new Error(`Dòng không hợp lệ: ${JSON.stringify(p)}`);
    }
    poLineIdsSet.add(p.poLineId);
    validLineCount++;
  }

  console.log(`2. Số lượng poLineId duy nhất: ${poLineIdsSet.size}/${pos.length}`);
  if (poLineIdsSet.size !== 149) {
    throw new Error(`THẤT BẠI: Có poLineId bị trùng lặp! Số lượng duy nhất: ${poLineIdsSet.size}`);
  }
  console.log("✅ ĐẠT: Toàn bộ 149 dòng đều có poLineId duy nhất và đầy đủ SKU, Qty, poNumber!");

  // Verify multi-line PO 50019763 (should have 20 items in pos)
  const po20Items = pos.filter((p) => p.poNumber === "50019763");
  console.log(`3. Số dòng của PO 50019763: ${po20Items.length} dòng.`);
  if (po20Items.length !== 20) {
    throw new Error(`THẤT BẠI: PO 50019763 mong đợi 20 dòng nhưng có ${po20Items.length} dòng!`);
  }
  console.log("✅ ĐẠT: PO đa dòng 50019763 hiển thị đủ 20 SKU riêng biệt!");

  // Test getPO by poLineId for first 3 lines of PO 50019763
  for (let i = 0; i < 3; i++) {
    const item = po20Items[i];
    const retrieved = await getPO(item.poLineId!);
    if (!retrieved || retrieved.sku !== item.sku || retrieved.qty !== item.qty) {
      throw new Error(`THẤT BẠI: getPO theo poLineId ${item.poLineId} trả về sai SKU (${retrieved?.sku} vs ${item.sku})`);
    }
    console.log(`   - getPO(poLineId: ${item.poLineId}) -> SKU: ${retrieved.sku}, Qty: ${retrieved.qty} (Khớp 100%)`);
  }
  console.log("✅ ĐẠT: getPO(poLineId) tra cứu chính xác từng dòng cụ thể!");

  console.log("\n==========================================================");
  console.log(">>> HOÀN TẤT VÀ VƯỢT QUA TOÀN BỘ BÀI TEST NHÓM 1 <<<");
  console.log("==========================================================");
}

verifyGroup1().catch((err) => {
  console.error("LỖI TEST NHÓM 1:", err);
  process.exit(1);
});
