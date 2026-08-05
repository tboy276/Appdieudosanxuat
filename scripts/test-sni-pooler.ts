import { Client } from "pg";

async function inspectPgPolicies() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  const hosts = [
    "aws-0-ap-southeast-1.pooler.supabase.com",
    "aws-0-us-east-1.pooler.supabase.com",
    "aws-0-eu-central-1.pooler.supabase.com",
  ];

  for (const host of hosts) {
    console.log("Connecting host:", host);
    const client = new Client({
      host,
      port: 6543,
      user: "postgres",
      password: pass,
      database: "postgres",
      options: `project=${ref}`,
      ssl: {
        rejectUnauthorized: false,
      },
      connectionTimeoutMillis: 5000,
    });

    try {
      await client.connect();
      console.log("\n==========================================================================");
      console.log("🎉 CONNECTED TO SUPABASE POSTGRESQL!");
      console.log("==========================================================================");

      // 1. SELECT current pg_policies for inventory_transactions
      console.log("\n--- 1. PG_POLICIES FOR inventory_transactions BEFORE CLEANUP ---");
      const invBefore = await client.query(
        "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
      );
      console.table(invBefore.rows);

      // 2. SELECT current pg_policies for ALL tables in public schema
      console.log("\n--- 2. ALL PG_POLICIES IN PUBLIC SCHEMA BEFORE CLEANUP ---");
      const allBefore = await client.query(
        "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
      );
      console.table(allBefore.rows);

      // 3. Drop ALL policies on ALL tables in public schema
      console.log("\n--- 3. DROPPING ALL OLD POLICIES & CREATING DENY ALL (false) POLICIES ---");
      const tablesRes = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
      );
      const tables: string[] = tablesRes.rows.map((r) => r.table_name);
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
      console.log("\n--- 4. PG_POLICIES FOR inventory_transactions AFTER CLEANUP ---");
      const invAfter = await client.query(
        "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
      );
      console.table(invAfter.rows);

      console.log("\n--- 5. ALL PG_POLICIES IN PUBLIC SCHEMA AFTER CLEANUP ---");
      const allAfter = await client.query(
        "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
      );
      console.table(allAfter.rows);

      await client.end();
      return;
    } catch (e: any) {
      console.error("❌ Failed:", e.message);
      try { await client.end(); } catch {}
    }
  }
}

inspectPgPolicies().catch(console.error);
