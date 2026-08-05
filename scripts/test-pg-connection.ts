import { Client } from "pg";

async function testSni() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  const hosts = [
    "aws-0-ap-southeast-1.pooler.supabase.com",
    "aws-1-ap-southeast-1.pooler.supabase.com",
    "aws-0-us-east-1.pooler.supabase.com",
  ];

  const servernames = [
    `db.${ref}.supabase.co`,
    `aws-0-ap-southeast-1.pooler.supabase.com`,
    `${ref}.supabase.co`,
  ];

  for (const host of hosts) {
    for (const servername of servernames) {
      for (const port of [5432, 6543]) {
        for (const user of [`postgres.${ref}`, "postgres"]) {
          const client = new Client({
            host,
            port,
            user,
            password: pass,
            database: "postgres",
            ssl: {
              rejectUnauthorized: false,
              servername,
            },
            connectionTimeoutMillis: 3000,
          });

          try {
            await client.connect();
            console.log(`🎉 SUCCESS! host=${host}, servername=${servername}, port=${port}, user=${user}`);
            const res = await client.query("SELECT version();");
            console.log("Version:", res.rows[0].version);

            const invRes = await client.query(
              "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
            );
            console.log("\nPolicies on inventory_transactions:");
            console.table(invRes.rows);

            const allRes = await client.query(
              "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
            );
            console.log("\nAll policies on public schema:");
            console.table(allRes.rows);

            await client.end();
            return;
          } catch (e: any) {
            // failed
          }
        }
      }
    }
  }
  console.log("All combinations failed.");
}

testSni().catch(console.error);
