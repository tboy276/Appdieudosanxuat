import { Client } from "pg";
import fs from "fs";
import path from "path";

const allRegions = [
  "aws-0-ap-southeast-1",
  "aws-0-ap-southeast-2",
  "aws-0-ap-northeast-1",
  "aws-0-ap-northeast-2",
  "aws-0-ap-south-1",
  "aws-0-us-east-1",
  "aws-0-us-west-1",
  "aws-0-us-west-2",
  "aws-0-eu-central-1",
  "aws-0-eu-west-1",
  "aws-0-eu-west-2",
  "aws-0-eu-west-3",
  "aws-0-sa-east-1",
  "aws-0-ca-central-1",
];

async function scanAllRegions() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";
  const sqlFile = path.resolve(__dirname, "schema-v5-shipments-rls.sql");
  const sqlContent = fs.readFileSync(sqlFile, "utf8");

  for (const reg of allRegions) {
    const host = `${reg}.pooler.supabase.com`;
    const user = `postgres.${ref}`;
    const client = new Client({
      host,
      port: 6543,
      user,
      password: pass,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 2500,
    });

    try {
      await client.connect();
      console.log("🎉🎉🎉 FOUND REGION & CONNECTED SUCCESS! Host:", host);
      await client.query(sqlContent);
      console.log("✅ Schema V5 & 12 RLS Policies APPLIED SUCCESSFULLY TO SUPABASE!");
      await client.end();
      return;
    } catch (e: any) {
      if (!e.message.includes("not found")) {
        console.log(`Host ${host} response:`, e.message);
      }
      try { await client.end(); } catch {}
    }
  }
  console.log("Scan complete.");
}

scanAllRegions();
