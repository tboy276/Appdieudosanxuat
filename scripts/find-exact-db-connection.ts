import { Client } from "pg";

async function findDb() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  const regions = [
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-northeast-1",
    "ap-northeast-2",
    "ap-south-1",
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "eu-central-1",
    "eu-west-1",
    "eu-west-2",
    "sa-east-1"
  ];

  for (const r of regions) {
    const hosts = [`aws-0-${r}.pooler.supabase.com`, `aws-1-${r}.pooler.supabase.com`];
    for (const host of hosts) {
      for (const port of [5432, 6543]) {
        for (const user of [`postgres.${ref}`, `postgres`]) {
          const client = new Client({
            host,
            port,
            user,
            password: pass,
            database: "postgres",
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 1500,
          });

          try {
            await client.connect();
            console.log(`\n🎉 SUCCESSFUL DB CONNECTION! host=${host}, user=${user}, port=${port}`);

            // 1. SELECT current pg_policies for inventory_transactions
            console.log("\n==========================================================================");
            console.log("1. PG_POLICIES FOR inventory_transactions BEFORE CLEANUP:");
            console.log("==========================================================================");
            const invBefore = await client.query(
              "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
            );
            console.table(invBefore.rows);

            console.log("\n==========================================================================");
            console.log("2. ALL PG_POLICIES IN PUBLIC SCHEMA BEFORE CLEANUP:");
            console.log("==========================================================================");
            const allBefore = await client.query(
              "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
            );
            console.table(allBefore.rows);

            // 3. Drop ALL policies on ALL tables in public schema
            console.log("\n==========================================================================");
            console.log("3. DROPPING ALL OLD POLICIES & CREATING DENY ALL (false) POLICIES ON ALL TABLES");
            console.log("==========================================================================");
            const tablesRes = await client.query(
              "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
            );
            const tables: string[] = tablesRes.rows.map((row) => row.table_name);
            console.log("Public tables found:", tables);

            await client.query(`
              DO $$ 
              DECLARE 
                  r RECORD;
              BEGIN
                  FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
                      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.policyname, r.tablename);
                  END LOOP;
              END $$;
            `);

            for (const t of tables) {
              await client.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY;`);
              await client.query(`DROP POLICY IF EXISTS "deny_direct_access_${t}" ON public."${t}";`);
              await client.query(
                `CREATE POLICY "deny_direct_access_${t}" ON public."${t}" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);`
              );
            }

            console.log("\n✅ Successfully enabled RLS and created deny_direct_access_* (false) policies for ALL tables!");

            // 4. Verification after
            console.log("\n==========================================================================");
            console.log("4. PG_POLICIES FOR inventory_transactions AFTER CLEANUP:");
            console.log("==========================================================================");
            const invAfter = await client.query(
              "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
            );
            console.table(invAfter.rows);

            console.log("\n==========================================================================");
            console.log("5. ALL PG_POLICIES IN PUBLIC SCHEMA AFTER CLEANUP:");
            console.log("==========================================================================");
            const allAfter = await client.query(
              "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
            );
            console.table(allAfter.rows);

            await client.end();
            return;
          } catch (e) {
            try { await client.end(); } catch {}
          }
        }
      }
    }
  }
  console.log("All regions scanned.");
}

findDb().catch(console.error);
