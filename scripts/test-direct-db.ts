import { Client } from "pg";

async function testDirectConn() {
  const client = new Client({
    user: "postgres",
    password: "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs",
    host: "db.smjtxmnkgsascejjpfpu.supabase.co",
    port: 5432,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const res = await client.query("SELECT version();");
    console.log("✅ SUCCESS CONNECTED DIRECT HOST:", res.rows[0].version);
    await client.end();
  } catch (e: any) {
    console.error("❌ Direct host error:", e.message);
  }
}

testDirectConn();
