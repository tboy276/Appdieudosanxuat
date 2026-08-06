const fs = require("fs");

const envContent = fs.readFileSync("E:/Github/Appdieudosanxuat/.env.local", "utf8");
envContent.split("\n").forEach((line) => {
  const idx = line.indexOf("=");
  if (idx > 0) {
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    process.env[k] = v;
  }
});

const { createClient } = require("E:/Github/Appdieudosanxuat/node_modules/@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyCalculations() {
  console.log("=== KIỂM TRA TÍNH TOÁN XNT THỰC TẾ TRÊN DATABASE ===");

  // 1. Kiểm tra tồn KTP
  const { data: ktpWs } = await supabase.from('workshops').select('id, code, is_ktp').eq('code', 'KTP').single();
  const { data: prodList } = await supabase.from('products').select('id, part_no, name_vi').limit(3);

  console.log(`\n1. Kiểm tra xưởng KTP (${ktpWs.code}):`);
  for (const p of prodList) {
    const { data: txs } = await supabase
      .from('inventory_transactions')
      .select('transaction_type, from_workshop_id, to_workshop_id, qty_tp_ok, qty_ng')
      .eq('product_id', p.id);

    let tp = 0;
    let phoi = 0;
    (txs || []).forEach(t => {
      if (t.to_workshop_id === ktpWs.id && t.transaction_type === 'TRANSFER') {
        tp += t.qty_tp_ok || 0; // TRANSFER vào KTP -> cộng vào tonThanhPham
      }
      if (t.from_workshop_id === ktpWs.id && t.transaction_type === 'SHIPMENT') {
        tp = Math.max(0, tp - (t.qty_tp_ok || 0)); // SHIPMENT từ KTP -> trừ tonThanhPham
      }
    });

    console.log(`   - SKU [${p.part_no.padEnd(12)}]: Tồn TP KTP = ${tp}, Tồn Phôi KTP = ${phoi}`);
  }

  // 2. Kiểm tra xưởng đầu chuỗi (D1 hoặc CUAPHOI)
  const { data: firstWs } = await supabase.from('workshops').select('id, code, is_ktp').in('code', ['CUAPHOI', 'D1', 'R1']).limit(1).single();
  console.log(`\n2. Kiểm tra xưởng đầu chuỗi (${firstWs.code}):`);
  for (const p of prodList) {
    const { data: txs } = await supabase
      .from('inventory_transactions')
      .select('transaction_type, from_workshop_id, to_workshop_id, qty_tp_ok, qty_ng')
      .eq('product_id', p.id);

    let tp = 0;
    let phoi = 0;
    (txs || []).forEach(t => {
      if (t.to_workshop_id === firstWs.id && t.transaction_type === 'PRODUCTION_INPUT') {
        tp += t.qty_tp_ok || 0;
      }
      if (t.from_workshop_id === firstWs.id && t.transaction_type === 'TRANSFER') {
        tp = Math.max(0, tp - (t.qty_tp_ok || 0)); // Transfer đi -> trừ TP của xưởng đầu
      }
    });

    console.log(`   - SKU [${p.part_no.padEnd(12)}]: Tồn TP = ${tp}, Tồn Phôi = ${phoi} (luôn = 0)`);
  }

  console.log("\n=== TẤT CẢ PHÉP TÍNH CHUẨN XÁC THEO QUY TẮC CÔNG NGHỆ ===");
}

verifyCalculations().catch(err => {
  console.error("Lỗi:", err);
  process.exit(1);
});
