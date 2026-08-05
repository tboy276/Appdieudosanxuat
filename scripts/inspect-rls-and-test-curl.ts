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
import { supabaseAdmin } from "../lib/supabase";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

async function inspectRlsAndTest() {
  console.log("=========================================================");
  console.log("Supabase URL:", supabaseUrl);
  console.log("1. THỬ NGHIỆM GỌI THỰC TẾ QUA REST API VỚI ANON_KEY (SIMULATING CURL)");
  console.log("=========================================================");

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

  for (const table of tablesToTest) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*`, {
      method: "GET",
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json"
      }
    });

    const status = res.status;
    const body = await res.json().catch(() => null);
    console.log(`Bảng [${table}]: Status HTTP = ${status}`);
    console.log(`Response Body:`, JSON.stringify(body));
    console.log("---------------------------------------------------------");
  }
}

inspectRlsAndTest().catch(console.error);
