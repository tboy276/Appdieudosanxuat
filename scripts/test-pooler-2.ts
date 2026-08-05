import { Client } from "pg";

async function testDirect() {
  const hosts = [
    "aws-0-ap-southeast-1.pooler.supabase.com",
    "aws-0-us-east-1.pooler.supabase.com",
    "aws-0-eu-central-1.pooler.supabase.com",
    "db.smjtxmnkgsascejjpfpu.supabase.co"
  ];

  for (const host of hosts) {
    console.log("Connecting to host:", host);
    const client = new Client({
      user: "postgres.smjtxmnkgsascejjpfpu",
      password: "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs",
      host,
      port: 6543,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });

    try {
      await client.connect();
      const res = await client.query("SELECT version();");
      console.log("✅ CONNECTED SUCCESS! Version:", res.rows[0].version);
      await client.end();
      return host;
    } catch (e: any) {
      console.error("❌ Error connecting to", host, ":", e.message);
    }
  }
}

testDirect();
