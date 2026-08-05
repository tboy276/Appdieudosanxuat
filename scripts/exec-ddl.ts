import { Client } from "pg";
import fs from "fs";
import path from "path";

async function execDdl() {
  const sqlFile = path.resolve(__dirname, "schema-v5-shipments-rls.sql");
  const sqlContent = fs.readFileSync(sqlFile, "utf8");

  // Try direct connection options
  const password = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";
  const projectRef = "smjtxmnkgsascejjpfpu";

  const hostsToTry = [
    `aws-0-ap-southeast-1.pooler.supabase.com`,
    `aws-0-us-east-1.pooler.supabase.com`,
    `aws-0-eu-central-1.pooler.supabase.com`,
  ];

  for (const host of hostsToTry) {
    const connString = `postgres://postgres.${projectRef}:${password}@${host}:6543/postgres`;
    console.log("Trying connection string to host:", host);
    const client = new Client({
      connectionString: connString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });

    try {
      await client.connect();
      console.log("Connected! Executing DDL...");
      await client.query(sqlContent);
      console.log("✅ DDL executed successfully on Supabase!");
      await client.end();
      return;
    } catch (e: any) {
      console.log("Connection failed:", e.message);
      try { await client.end(); } catch {}
    }
  }
}

execDdl();
