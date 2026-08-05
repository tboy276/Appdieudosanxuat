import { Client } from "pg";

async function runRlsCheck() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  const client = new Client({
    host: "aws-0-ap-southeast-1.pooler.supabase.com",
    port: 6543,
    user: "postgres",
    password: pass,
    database: "postgres",
    options: `project=${ref}`,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  await client.connect();
  console.log("==========================================================================");
  console.log("✅ CONNECTED TO SUPABASE POSTGRESQL DATABASE VIA PG CLIENT");
  console.log("==========================================================================\n");

  // 1. Query current pg_policies for inventory_transactions
  console.log("==========================================================================");
  console.log("1. KẾT QUẢ SELECT * FROM pg_policies WHERE tablename = 'inventory_transactions'");
  console.log("==========================================================================");
  const invRes = await client.query(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
  );
  console.table(invRes.rows);

  console.log("\n==========================================================================");
  console.log("2. KẾT QUẢ SELECT * FROM pg_policies WHERE schemaname = 'public'");
  console.log("==========================================================================");
  const allRes = await client.query(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
  );
  console.table(allRes.rows);

  // 3. Drop ALL policies on ALL tables in public schema
  console.log("\n==========================================================================");
  console.log("3. DROPPING ALL OLD POLICIES & ENFORCING DENY ALL (false) ON ALL TABLES");
  console.log("==========================================================================");

  // Get all tables in public schema
  const tablesRes = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
  );
  const tables: string[] = tablesRes.rows.map((r) => r.table_name);
  console.log("Danh sách các bảng trong schema public:", tables);

  // Drop all existing policies dynamically
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

  // Enable RLS and create single deny policy on every table
  for (const t of tables) {
    await client.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY;`);
    await client.query(`DROP POLICY IF EXISTS "deny_direct_access_${t}" ON public."${t}";`);
    await client.query(
      `CREATE POLICY "deny_direct_access_${t}" ON public."${t}" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);`
    );
  }
  console.log("\n✅ Đã kích hoạt RLS và thiết lập duy nhất 1 Policy deny_direct_access_* (false) cho TẤT CẢ các bảng!");

  // 4. Final verification query for inventory_transactions
  console.log("\n==========================================================================");
  console.log("4. KẾT QUẢ SAU CỦA inventory_transactions IN PG_POLICIES");
  console.log("==========================================================================");
  const finalInvRes = await client.query(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
  );
  console.table(finalInvRes.rows);

  console.log("\n==========================================================================");
  console.log("5. KẾT QUẢ SAU CỦA TẤT CẢ CÁC BẢNG TRONG SCHEMAMANAGER PUBLIC");
  console.log("==========================================================================");
  const finalAllRes = await client.query(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
  );
  console.table(finalAllRes.rows);

  await client.end();
}

runRlsCheck().catch(console.error);
