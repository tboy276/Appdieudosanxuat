import fs from "fs";
import path from "path";

const envPath = path.resolve(".env.local");
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, "utf-8");
  for (const line of envConfig.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...values] = trimmed.split("=");
      if (key && values.length > 0) {
        process.env[key.trim()] = values.join("=").trim().replace(/"/g, "");
      }
    }
  }
}

const { resetSystemData } = await import("../lib/redis.ts");
const { Redis } = await import("@upstash/redis");

const upstash = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function main() {
  console.log("🚀 Running resetSystemData() on Upstash Redis Production Database:", process.env.UPSTASH_REDIS_REST_URL);
  await resetSystemData();
  console.log("✅ resetSystemData() completed successfully.\n");

  const keys = await upstash.keys("*");
  console.log(`==================================================`);
  console.log(`📊 TỔNG SỐ KEY CÒN LẠI TRÊN REDIS DATABASE: ${keys.length}`);
  console.log(`==================================================\n`);

  for (const k of keys) {
    const type = await upstash.type(k);
    let preview = "";
    if (type === "string") {
      const val = await upstash.get(k);
      preview = typeof val === "object" ? JSON.stringify(val).slice(0, 150) : String(val).slice(0, 150);
    } else if (type === "set") {
      const members = await upstash.smembers(k);
      preview = `[${members.join(", ")}]`;
    } else if (type === "hash") {
      const fields = await upstash.hgetall(k);
      preview = JSON.stringify(fields).slice(0, 150);
    }
    console.log(`🔑 Key: "${k}" | Type: ${type.toUpperCase()}`);
    console.log(`   Content: ${preview}\n`);
  }
}

main().catch(console.error);
