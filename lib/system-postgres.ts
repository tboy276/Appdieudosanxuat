/**
 * Flush & Reset System Database in PostgreSQL
 * Clears all operational transactional data (POs, WOs, Inventory, Shipments, Products, Customers)
 * while PRESERVING master system accounts (users) and master workshop definitions (workshops).
 */
export async function resetSystemDataPostgres(): Promise<void> {
  console.log("🧹 Resetting system operational data in Supabase PostgreSQL...");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // Tables to clear and their corresponding filter column for deleting all rows
  const tablesToClear: { table: string; filter: string }[] = [
    { table: "shipment_items", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "shipments", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "inventory_transactions", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "opening_stocks", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "work_orders", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "po_lines", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "purchase_orders", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "product_routings", filter: "product_id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "product_customers", filter: "product_id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "products", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
    { table: "customers", filter: "id=neq.00000000-0000-0000-0000-000000000000" },
  ];

  for (const item of tablesToClear) {
    let success = false;
    let lastErr: any = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/${item.table}?${item.filter}`, {
          method: "DELETE",
          headers: {
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json"
          }
        });

        if (res.ok || res.status === 204 || res.status === 200) {
          success = true;
          break;
        } else {
          const body = await res.json().catch(() => null);
          lastErr = body?.message || `HTTP ${res.status}`;
        }
      } catch (err: any) {
        lastErr = err.message || err;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!success) {
      console.error(`❌ Failed to reset table '${item.table}':`, lastErr);
      throw new Error(`Lỗi reset bảng ${item.table}: ${lastErr}`);
    }
  }

  console.log("✅ Successfully reset system operational data in PostgreSQL (preserved users & workshops).");
}
