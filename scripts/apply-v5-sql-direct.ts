import { Client } from "pg";
import fs from "fs";
import path from "path";

async function applySqlDirect() {
  const sqlFile = path.resolve(__dirname, "schema-v5-shipments-rls.sql");
  const sqlContent = fs.readFileSync(sqlFile, "utf8");

  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  // Connection configurations to try
  const configs = [
    { host: `aws-0-ap-southeast-1.pooler.supabase.com`, port: 5432, user: `postgres.${ref}`, db: "postgres" },
    { host: `aws-0-ap-southeast-1.pooler.supabase.com`, port: 6543, user: `postgres.${ref}`, db: "postgres" },
    { host: `aws-0-ap-southeast-1.pooler.supabase.com`, port: 5432, user: `postgres`, db: "postgres" },
    { host: `aws-0-ap-southeast-1.pooler.supabase.com`, port: 6543, user: `postgres`, db: "postgres" },
  ];

  for (const cfg of configs) {
    console.log(`Connecting: host=${cfg.host}, port=${cfg.port}, user=${cfg.user}`);
    const client = new Client({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: pass,
      database: cfg.db,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });

    try {
      await client.connect();
      console.log("✅ CONNECTED! Executing schema-v5 SQL script...");
      await client.query(sqlContent);
      console.log("🎉 SUCCESS! Schema V5 & 12 RLS policies applied to Supabase PostgreSQL!");
      await client.end();
      return;
    } catch (e: any) {
      console.error("❌ Failed:", e.message);
      try { await client.end(); } catch {}
    }
  }
}

applySqlDirect();
