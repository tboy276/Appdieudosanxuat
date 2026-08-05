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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

async function testAnonAccess() {
  console.log("==========================================================================");
  console.log("KIỂM TRUY THỰC TẾ QUA REST API BẰNG ANON_KEY (CURL EQUIVALENT)");
  console.log("==========================================================================\n");

  const tables = [
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
    "product_routings",
    "workshops"
  ];

  for (const t of tables) {
    let res: Response | null = null;
    for (let i = 0; i < 3; i++) {
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
      console.log(`Bảng [${t.padEnd(22)}]: Status HTTP = ${status} | Body: ${JSON.stringify(body)}`);
    } else {
      console.log(`Bảng [${t.padEnd(22)}]: Fetch failed`);
    }
  }
}

testAnonAccess().catch(console.error);
