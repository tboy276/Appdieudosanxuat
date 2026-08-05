import fs from "fs";
import path from "path";

// Ensure .env.local environment variables are loaded into process.env
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, "utf8");
  for (const line of envConfig.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    }
  }
}

import { supabaseAdmin } from "../lib/supabase";

async function verifyCounts() {
  const { count: poCount, error: poErr } = await supabaseAdmin
    .from("purchase_orders")
    .select("*", { count: "exact", head: true });

  const { count: lineCount, error: lineErr } = await supabaseAdmin
    .from("po_lines")
    .select("*", { count: "exact", head: true });

  const { count: prodCount, error: prodErr } = await supabaseAdmin
    .from("products")
    .select("*", { count: "exact", head: true });

  console.log("==========================================");
  console.log("SQL DIRECT COUNT FROM SUPABASE POSTGRESQL:");
  console.log("==========================================");
  console.log(`- purchase_orders COUNT: ${poCount} (Error: ${poErr?.message || "none"})`);
  console.log(`- po_lines COUNT:        ${lineCount} (Error: ${lineErr?.message || "none"})`);
  console.log(`- products COUNT:        ${prodCount} (Error: ${prodErr?.message || "none"})`);

  const { data: latestPOs } = await supabaseAdmin
    .from("purchase_orders")
    .select("id, po_number, customer_id, requested_date, status, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  console.log("\nLatest 10 PO records in purchase_orders:");
  console.table(latestPOs);
}

verifyCounts();
