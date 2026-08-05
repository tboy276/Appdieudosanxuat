import { supabaseAdmin } from "../lib/supabase";

async function inspectLines() {
  console.log("=== INSPECTING PURCHASE ORDERS & PO LINES RELATIONSHIP ===");

  const { data: pos, error: poErr } = await supabaseAdmin
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      customer_id,
      created_at,
      customers ( id, name )
    `)
    .order("po_number", { ascending: true });

  const { data: lines, error: lineErr } = await supabaseAdmin
    .from("po_lines")
    .select(`
      id,
      po_id,
      product_id,
      order_qty,
      customer_id
    `);

  console.log("Total PO headers:", pos?.length);
  console.log("Total PO lines:", lines?.length);

  const linesPerPo = new Map<string, any[]>();
  (lines || []).forEach((l) => {
    const list = linesPerPo.get(l.po_id) || [];
    list.push(l);
    linesPerPo.set(l.po_id, list);
  });

  console.log(`\nPO Header count: ${pos?.length}`);
  let multiLinePoCount = 0;
  let singleLinePoCount = 0;

  (pos || []).forEach((p, idx) => {
    const pLines = linesPerPo.get(p.id) || [];
    if (pLines.length > 1) {
      multiLinePoCount++;
      console.log(`[MULTI-LINE PO] ${p.po_number} (ID: ${p.id}) has ${pLines.length} lines!`);
    } else {
      singleLinePoCount++;
    }
  });

  console.log(`\nSummary:`);
  console.log(`- PO Headers with 1 line: ${singleLinePoCount}`);
  console.log(`- PO Headers with >1 lines: ${multiLinePoCount}`);
  console.log(`- Total PO Lines across all 65 headers: ${(lines || []).length}`);
}

inspectLines().catch(console.error);
