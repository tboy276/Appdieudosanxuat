import { Client } from "pg";

async function scanRegions() {
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
    "eu-west-3",
    "sa-east-1"
  ];

  for (const r of regions) {
    const host = `aws-0-${r}.pooler.supabase.com`;
    for (const port of [5432, 6543]) {
      const client = new Client({
        host,
        port,
        user: `postgres.${ref}`,
        password: pass,
        database: "postgres",
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 2500,
      });

      try {
        await client.connect();
        console.log(`\n🎉 FOUND WORKING POOLER! host=${host}, port=${port}`);

        const invRes = await client.query(
          "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
        );
        console.log("\n--- Policies on inventory_transactions ---");
        console.table(invRes.rows);

        const allRes = await client.query(
          "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
        );
        console.log("\n--- All policies on public schema ---");
        console.table(allRes.rows);

        // Execute dynamic cleanup & enforce deny (false) on all 12+ tables
        console.log("\n--- Enforcing Deny All (false) policies ---");
        const tablesRes = await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
        );
        const tables: string[] = tablesRes.rows.map((row) => row.table_name);
        console.log("Public tables:", tables);

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

        console.log("\n--- Final pg_policies verification on inventory_transactions ---");
        const finalInvRes = await client.query(
          "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
        );
        console.table(finalInvRes.rows);

        console.log("\n--- Final pg_policies verification on all public tables ---");
        const finalAllRes = await client.query(
          "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
        );
        console.table(finalAllRes.rows);

        await client.end();
        return;
      } catch (e: any) {
        // next
      }
    }
  }
  console.log("All regions scanned.");
}

scanRegions().catch(console.error);
