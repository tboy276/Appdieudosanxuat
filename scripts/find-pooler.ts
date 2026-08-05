import { Client } from "pg";

async function findWorkingPooler() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  const poolerHosts = [
    "aws-0-ap-southeast-1.pooler.supabase.com",
    "aws-1-ap-southeast-1.pooler.supabase.com",
    "aws-0-ap-northeast-1.pooler.supabase.com",
    "aws-0-us-east-1.pooler.supabase.com",
    "aws-0-eu-central-1.pooler.supabase.com",
  ];

  const userFormats = [
    `postgres.${ref}`,
    `postgres`,
    `postgres[${ref}]`,
  ];

  for (const host of poolerHosts) {
    for (const user of userFormats) {
      for (const port of [5432, 6543]) {
        const client = new Client({
          user,
          password: pass,
          host,
          port,
          database: "postgres",
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 2000,
        });

        try {
          await client.connect();
          const res = await client.query("SELECT version();");
          console.log(`✅ SUCCESS! host=${host}, user=${user}, port=${port}. Version:`, res.rows[0].version);
          await client.end();
          return { host, user, port };
        } catch (e: any) {
          // ignore
        }
      }
    }
  }
  console.log("❌ All pooler combinations failed.");
}

findWorkingPooler();
