import { Client } from "pg";
import fs from "fs";
import path from "path";

async function applyV5Schema() {
  const connectionStrings = [
    process.env.DATABASE_URL,
    "postgres://postgres.smjtxmnkgsascejjpfpu:Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    "postgres://postgres.smjtxmnkgsascejjpfpu:Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    "postgres://postgres:Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs@db.smjtxmnkgsascejjpfpu.supabase.co:5432/postgres",
  ].filter(Boolean) as string[];

  const sqlFile = path.resolve(__dirname, "schema-v5-shipments-rls.sql");
  const sqlContent = fs.readFileSync(sqlFile, "utf8");

  console.log("🚀 Executing Schema V5 Migration SQL script on Supabase PostgreSQL...");

  let connected = false;
  for (const connStr of connectionStrings) {
    console.log(`Connecting to: ${connStr.replace(/:[^:@]+@/, ":****@")}`);
    const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      await client.query(sqlContent);
      console.log("✅ Schema V5 (shipments, shipment_items, create_shipment & 12 RLS policies) applied successfully!");
      await client.end();
      connected = true;
      break;
    } catch (err: any) {
      console.error("❌ Connection/execution failed:", err.message);
      try { await client.end(); } catch {}
    }
  }

  if (!connected) {
    throw new Error("Could not connect to any PostgreSQL connection string.");
  }
}

applyV5Schema().catch((err) => {
  console.error("Fatal migration error:", err);
  process.exit(1);
});
