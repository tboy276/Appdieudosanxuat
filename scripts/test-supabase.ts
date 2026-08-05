import fs from "fs";
import path from "path";

// Manually parse .env.local
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

async function testConnection() {
  console.log("Testing Supabase connection...");
  console.log("URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);

  const { data, count, error } = await supabaseAdmin
    .from("workshops")
    .select("*", { count: "exact" });

  if (error) {
    console.error("Supabase Connection Error:", error);
    process.exit(1);
  }

  console.log("Supabase Connection Successful!");
  console.log("Workshops count:", count);
  console.log("Workshops data:", data);
}

testConnection();
