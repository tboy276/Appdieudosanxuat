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

async function testAnonPost() {
  console.log("==========================================================================");
  console.log("1. THỬ NGHIỆM HTTP POST (INSERT) BẰNG ANON_KEY VÀO BẢNG 'purchase_orders'");
  console.log("==========================================================================");

  const res1 = await fetch(`${supabaseUrl}/rest/v1/purchase_orders`, {
    method: "POST",
    headers: {
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      po_number: "PO-RLS-TEST-" + Date.now(),
      status: "DRAFT"
    })
  });
  console.log(`[purchase_orders] HTTP Status Code: ${res1.status}`);
  console.log(`[purchase_orders] Raw Response Body:`, JSON.stringify(await res1.json(), null, 2));

  console.log("\n==========================================================================");
  console.log("2. THỬ NGHIỆM HTTP POST (INSERT) BẰNG ANON_KEY VÀO BẢNG 'work_orders'");
  console.log("==========================================================================");

  const res2 = await fetch(`${supabaseUrl}/rest/v1/work_orders`, {
    method: "POST",
    headers: {
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      wo_number: "WO-RLS-TEST-" + Date.now(),
      status: "PENDING"
    })
  });
  console.log(`[work_orders] HTTP Status Code: ${res2.status}`);
  console.log(`[work_orders] Raw Response Body:`, JSON.stringify(await res2.json(), null, 2));

  console.log("\n==========================================================================");
  console.log("3. THỬ NGHIỆM HTTP POST (INSERT) BẰNG ANON_KEY VÀO BẢNG 'shipments'");
  console.log("==========================================================================");

  const res3 = await fetch(`${supabaseUrl}/rest/v1/shipments`, {
    method: "POST",
    headers: {
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      note: "Test RLS Shipment Direct Insert"
    })
  });
  console.log(`[shipments] HTTP Status Code: ${res3.status}`);
  console.log(`[shipments] Raw Response Body:`, JSON.stringify(await res3.json(), null, 2));
}

testAnonPost().catch(console.error);
