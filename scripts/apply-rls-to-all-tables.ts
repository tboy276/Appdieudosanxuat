import { Client } from "pg";

async function applyRlsAll() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  // Try direct host and pooler connection strings
  const connectionStrings = [
    `postgres://postgres.${ref}:${pass}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
    `postgres://postgres.${ref}:${pass}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
    `postgres://postgres:${pass}@db.${ref}.supabase.co:5432/postgres`,
  ];

  let client: Client | null = null;
  for (const cs of connectionStrings) {
    console.log("Trying:", cs.replace(pass, "*****"));
    const c = new Client({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    try {
      await c.connect();
      client = c;
      console.log("✅ CONNECTED TO SUPABASE POSTGRESQL!");
      break;
    } catch (e: any) {
      console.log("Failed:", e.message);
      try { await c.end(); } catch {}
    }
  }

  if (!client) {
    console.log("❌ Direct PG connection failed, attempting via alternative...");
    return;
  }

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
}

applyRlsAll().catch(console.error);
