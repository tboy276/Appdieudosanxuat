import { Client } from "pg";

const regions = [
  "aws-0-ap-southeast-1",
  "aws-0-us-east-1",
  "aws-0-us-west-1",
  "aws-0-eu-central-1",
  "aws-0-ap-northeast-1",
  "aws-0-sa-east-1",
];

async function testPoolers() {
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";
  const ref = "smjtxmnkgsascejjpfpu";

  for (const reg of regions) {
    const host = `${reg}.pooler.supabase.com`;
    const connStr = `postgres://postgres.${ref}:${pass}@${host}:6543/postgres`;
    console.log("Testing:", host);
    const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      const res = await client.query("SELECT version();");
      console.log("✅ CONNECTED SUCCESS to", host, res.rows[0]);
      await client.end();
      return connStr;
    } catch (e: any) {
      console.log("❌ Failed:", e.message);
    }
  }
}

testPoolers();
