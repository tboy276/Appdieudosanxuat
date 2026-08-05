import { supabaseAdmin } from "../lib/supabase";

async function testFlatListPOs() {
  console.log("=== TESTING FLATTENED LIST POS ===");

  const { data, error } = await supabaseAdmin
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      order_date,
      requested_date,
      status,
      created_at,
      updated_at,
      customers (
        id,
        name
      ),
      po_lines (
        id,
        product_id,
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
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error:", error);
    return;
  }

  const flattenedPOs: any[] = [];

  for (const row of data || []) {
    const customerName = (row.customers as any)?.name || "";
    const lines = Array.isArray(row.po_lines) ? row.po_lines : [];

    if (lines.length === 0) {
      // PO with no lines
      flattenedPOs.push({
        poId: row.id,
        poLineId: row.id,
        poNumber: row.po_number,
        customerName,
        sku: "",
        productNameVi: "",
        qty: 0,
        requestedDate: row.requested_date ? String(row.requested_date).split("T")[0] : "",
        status: row.status,
        shippedQty: 0,
        createdAt: row.created_at,
        createdBy: "admin",
      });
    } else {
      for (const line of lines) {
        let prodObj = line.product_customers?.products;
        if (Array.isArray(prodObj)) prodObj = prodObj[0];

        const sku = prodObj?.part_no || "";
        const productNameVi = prodObj?.name_vi || sku;
        const qty = Number(line.order_qty || 0);

        flattenedPOs.push({
          poId: row.id,
          poLineId: line.id,
          poNumber: row.po_number,
          customerName,
          sku,
          productNameVi,
          qty,
          requestedDate: row.requested_date ? String(row.requested_date).split("T")[0] : "",
          status: row.status,
          shippedQty: 0,
          createdAt: row.created_at,
          createdBy: "admin",
          productId: prodObj?.id || line.product_id,
        });
      }
    }
  }

  console.log("Total purchase_orders rows in DB:", data?.length);
  console.log("Total flattened PO items for table:", flattenedPOs.length);
  console.log("Unique SKUs count:", new Set(flattenedPOs.map((p) => p.sku)).size);
}

testFlatListPOs().catch(console.error);
