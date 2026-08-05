import fs from "fs";
import path from "path";

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

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

async function runTest() {
  console.log("Supabase URL:", supabaseUrl);

  const tablesToTest = [
    "purchase_orders",
    "products",
    "work_orders",
    "inventory_transactions",
    "shipments",
    "users",
    "customers",
    "opening_stocks",
    "po_lines",
    "shipment_items",
    "product_customers",
    "product_routings"
  ];

  console.log("\n=========================================================");
  console.log("1. THỬ NGHIỆM GỌI THỰC TẾ REST API QUA ANON_KEY (CURL EQUIVALENT)");
  console.log("=========================================================");

  for (const t of tablesToTest) {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(`${supabaseUrl}/rest/v1/${t}?select=*`, {
          method: "GET",
          headers: {
            "apikey": supabaseAnonKey,
            "Authorization": `Bearer ${supabaseAnonKey}`,
            "Content-Type": "application/json"
          }
        });
        if (res) break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (res) {
      const status = res.status;
      const body = await res.json().catch(() => null);
      console.log(`Bảng [${t}]: Status HTTP = ${status}`);
      console.log(`Response Body:`, JSON.stringify(body));
    } else {
      console.log(`Bảng [${t}]: Network error fetch failed after 3 retries`);
    }
    console.log("---------------------------------------------------------");
  }
}

runTest().catch(console.error);
