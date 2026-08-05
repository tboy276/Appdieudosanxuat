import { Client } from "pg";

async function testConnection() {
  const connectionStrings = [
    "postgres://postgres.smjtxmnkgsascejjpfpu:Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    "postgres://postgres.smjtxmnkgsascejjpfpu:Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    "postgres://postgres:Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs@db.smjtxmnkgsascejjpfpu.supabase.co:5432/postgres",
  ];

  for (const connStr of connectionStrings) {
    console.log("Trying connection:", connStr);
    const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      const res = await client.query("SELECT version();");
      console.log("✅ CONNECTED SUCCESS! Version:", res.rows[0]);
      await client.end();
      return connStr;
    } catch (err: any) {
      console.error("❌ Connection failed:", err.message);
    }
  }
}

testConnection();
