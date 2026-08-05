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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const admin = createClient(url, serviceKey);

async function testRpc() {
  console.log("Checking Supabase tables via supabaseAdmin with retry...");

  const tables = [
    "products", "product_customers", "product_routings", "customers",
    "purchase_orders", "po_lines", "work_orders", "opening_stocks",
    "inventory_transactions", "shipments", "shipment_items", "users", "workshops"
  ];

  for (const t of tables) {
    let res: any = null;
    for (let i = 0; i < 3; i++) {
      try {
        res = await admin.from(t).select("*").limit(1);
        if (!res.error) break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    console.log(`Table '${t}':`, { dataCount: res?.data?.length, error: res?.error?.message });
  }
}

testRpc().catch(console.error);
