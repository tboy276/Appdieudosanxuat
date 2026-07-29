import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { WorkCenter, User } from "../types";

// Load .env.local manually if running via CLI / tsx
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, "utf-8");
  for (const line of envConfig.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...values] = trimmed.split("=");
      if (key && values.length > 0) {
        process.env[key.trim()] = values.join("=").trim();
      }
    }
  }
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

const WORK_CENTERS: WorkCenter[] = [
  { code: "CUAPHOI", name: "Tổ cưa phôi PSX", scrapRate: 0.01, isFirstStep: true },
  { code: "D1", name: "Xưởng Đúc 1", scrapRate: 0.10, isFirstStep: true },
  { code: "D2", name: "Xưởng Đúc 2", scrapRate: 0.10, isFirstStep: true },
  { code: "R1", name: "Xưởng Rèn 1", scrapRate: 0.05, isFirstStep: true },
  { code: "R2", name: "Xưởng Rèn 2", scrapRate: 0.05, isFirstStep: true },
  { code: "CK1", name: "Xưởng Cơ Khí 1", scrapRate: 0.02 },
  { code: "CK2", name: "Xưởng Cơ Khí 2", scrapRate: 0.02 },
  { code: "CK3", name: "Xưởng Cơ Khí 3", scrapRate: 0.02 },
  { code: "MNL", name: "Xưởng Mạ Nhiệt Luyện", scrapRate: 0.03 },
  { code: "LR", name: "Xưởng Lắp Ráp", scrapRate: 0.00, isFinalStep: true },
];

async function seed() {
  console.log("🌱 Starting MES-Lite Database Seed...");

  if (!process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL.includes("dummy")) {
    console.warn("⚠️ Warning: UPSTASH_REDIS_REST_URL is missing or using placeholder in .env.local.");
  }

  // 1. Seed Work Centers
  await redis.set("workcenters", WORK_CENTERS);
  console.log(`✅ Seeded ${WORK_CENTERS.length} work centers into key "workcenters".`);

  // 2. Seed Admin User
  const passwordHash = await bcrypt.hash("Admin@123", 10);
  const adminUser: User = {
    id: "usr_admin_001",
    username: "admin",
    passwordHash,
    role: "ADMIN",
    createdAt: new Date().toISOString(),
  };

  await redis.set("users", [adminUser]);
  console.log(`✅ Seeded 1 ADMIN user (username: admin) into key "users".`);

  console.log("🎉 Seeding completed successfully!");
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
