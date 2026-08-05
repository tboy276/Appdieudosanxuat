import { supabaseAdmin } from "../lib/supabase";

async function inspectSchema() {
  console.log("=== CHECKING PO_LINES JOIN CAPABILITIES ===");

  // Test 1: Join po_lines with product_customers -> products
  const { data: test1, error: err1 } = await supabaseAdmin
    .from("po_lines")
    .select(`
      id,
      po_id,
      order_qty,
      product_customers (
        customer_id,
        products (
          id,
          part_no,
          name_vi
        )
      ),
      purchase_orders (
        id,
        po_number,
        requested_date,
        status,
        customers ( id, name )
      )
    `)
    .limit(5);

  console.log("Test 1 (via product_customers):", err1 ? `ERR: ${err1.message}` : `SUCCESS: ${test1?.length} rows`);
  if (test1 && test1.length > 0) {
    console.log("Sample row 1:", JSON.stringify(test1[0], null, 2));
  }

  // Test 2: direct select from purchase_orders joining po_lines
  const { data: test2, error: err2 } = await supabaseAdmin
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      requested_date,
      status,
      customers ( id, name ),
      po_lines (
        id,
        product_id,
        customer_id,
        order_qty,
        product_customers (
          products (
            id,
            part_no,
            name_vi
          )
        )
      )
    `)
    .limit(5);

  console.log("\nTest 2 (purchase_orders join po_lines):", err2 ? `ERR: ${err2.message}` : `SUCCESS: ${test2?.length} rows`);
  if (test2 && test2.length > 0) {
    console.log("Sample PO with lines:", JSON.stringify(test2[0], null, 2));
  }
}

inspectSchema().catch(console.error);
