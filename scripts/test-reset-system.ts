import fs from "fs";
import path from "path";

// Ensure .env.local environment variables are loaded 100% into process.env
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

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || serviceKey.includes("anon")) {
  throw new Error("❌ SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình đúng trong .env.local! Không được dùng ANON_KEY cho test/reset.");
}

import { resetSystemDataPostgres } from "../lib/system-postgres";

async function getCount(table: string): Promise<number> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id`, {
        headers: {
          "apikey": serviceKey!,
          "Authorization": `Bearer ${serviceKey!}`
        }
      });
      if (res.ok) {
        const body = await res.json();
        if (Array.isArray(body)) return body.length;
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return 0;
}

async function testReset() {
  console.log("=========================================================");
  console.log("TESTING SYSTEM RESET ON SUPABASE POSTGRESQL (SERVICE ROLE KEY)");
  console.log("=========================================================");

  // Count before
  const usersBefore = await getCount("users");
  const workshopsBefore = await getCount("workshops");

  console.log(`Bảng 'users' trước reset: ${usersBefore} tài khoản`);
  console.log(`Bảng 'workshops' trước reset: ${workshopsBefore} xưởng`);

  if (usersBefore === 0 || workshopsBefore === 0) {
    console.warn("⚠️ Cảnh báo: Bảng users hoặc workshops đang bằng 0 trước reset!");
  }

  // Run reset
  await resetSystemDataPostgres();

  // Count after
  const usersAfter = await getCount("users");
  const workshopsAfter = await getCount("workshops");
  const posAfter = await getCount("purchase_orders");
  const wosAfter = await getCount("work_orders");
  const shipmentsAfter = await getCount("shipments");
  const productsAfter = await getCount("products");

  console.log("\n--- KẾT QUẢ SAU RESET ---");
  console.log(`Bảng 'users' (Giữ lại): ${usersAfter} tài khoản (Kỳ vọng: ${usersBefore})`);
  console.log(`Bảng 'workshops' (Giữ lại): ${workshopsAfter} xưởng (Kỳ vọng: ${workshopsBefore})`);
  console.log(`Bảng 'purchase_orders' (Đã xóa): ${posAfter} (Kỳ vọng: 0)`);
  console.log(`Bảng 'work_orders' (Đã xóa): ${wosAfter} (Kỳ vọng: 0)`);
  console.log(`Bảng 'shipments' (Đã xóa): ${shipmentsAfter} (Kỳ vọng: 0)`);
  console.log(`Bảng 'products' (Đã xóa): ${productsAfter} (Kỳ vọng: 0)`);

  if (usersAfter > 0 && workshopsAfter > 0 && posAfter === 0 && wosAfter === 0 && shipmentsAfter === 0 && productsAfter === 0) {
    console.log("\n🎉 SYSTEM RESET TEST PASSED 100%!");
  } else {
    console.error("\n❌ SYSTEM RESET TEST FAILED!");
  }
}

testReset().catch(console.error);
