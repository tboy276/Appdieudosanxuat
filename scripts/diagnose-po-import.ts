import fs from "fs";
import path from "path";

// Load .env.local
const envPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}

import { supabaseAdmin } from "../lib/supabase";

async function diagnose() {
  console.log("=== DIAGNOSING DATABASE STATE ===");

  const { count: poCount, error: poErr } = await supabaseAdmin
    .from("purchase_orders")
    .select("*", { count: "exact", head: true });

  const { count: lineCount, error: lineErr } = await supabaseAdmin
    .from("po_lines")
    .select("*", { count: "exact", head: true });

  const { count: prodCount, error: prodErr } = await supabaseAdmin
    .from("products")
    .select("*", { count: "exact", head: true });

  const { count: custCount, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("*", { count: "exact", head: true });

  const { count: pcCount, error: pcErr } = await supabaseAdmin
    .from("product_customers")
    .select("*", { count: "exact", head: true });

  console.log("Total purchase_orders count:", poCount, poErr ? `Error: ${poErr.message}` : "");
  console.log("Total po_lines count:", lineCount, lineErr ? `Error: ${lineErr.message}` : "");
  console.log("Total products count:", prodCount, prodErr ? `Error: ${prodErr.message}` : "");
  console.log("Total customers count:", custCount, custErr ? `Error: ${custErr.message}` : "");
  console.log("Total product_customers count:", pcCount, pcErr ? `Error: ${pcErr.message}` : "");

  // Fetch recent POs
  const { data: pos, error: listErr } = await supabaseAdmin
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      customer_id,
      created_at,
      customers ( id, name ),
      po_lines ( id, product_id, order_qty, products ( part_no, name_vi ) )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (listErr) {
    console.error("Error listing pos:", listErr);
    return;
  }

  console.log(`\n=== RECENT ${pos?.length} PURCHASE ORDERS IN DATABASE ===`);
  (pos || []).forEach((po: any, idx: number) => {
    const lines = po.po_lines || [];
    const custName = po.customers?.name || "Unknown";
    const lineSkus = lines.map((l: any) => `${l.products?.part_no} (qty: ${l.order_qty})`).join(", ");
    console.log(`[${idx + 1}] PO: ${po.po_number} | Cust: ${custName} | Lines count: ${lines.length} | Lines: [${lineSkus}] | Created: ${po.created_at}`);
  });
}

diagnose().catch(console.error);
