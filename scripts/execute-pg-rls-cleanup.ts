import { Client } from "pg";

async function executeRlsCleanup() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  // Connection options to try
  const attempts = [
    { host: "aws-0-ap-southeast-1.pooler.supabase.com", port: 6543, user: `postgres.${ref}` },
    { host: "aws-0-ap-southeast-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}` },
    { host: "aws-0-ap-southeast-1.pooler.supabase.com", port: 6543, user: "postgres" },
    { host: "aws-0-ap-southeast-1.pooler.supabase.com", port: 5432, user: "postgres" },
    { host: "52.74.252.201", port: 6543, user: `postgres.${ref}` },
    { host: "52.74.252.201", port: 5432, user: `postgres.${ref}` },
  ];

  let client: Client | null = null;
  for (const a of attempts) {
    console.log(`Connecting: host=${a.host}, port=${a.port}, user=${a.user}`);
    const c = new Client({
      host: a.host,
      port: a.port,
      user: a.user,
      password: pass,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 4000,
    });
    try {
      await c.connect();
      client = c;
      console.log("🎉 CONNECTED TO SUPABASE POSTGRESQL!\n");
      break;
    } catch (e: any) {
      console.log("Connection failed:", e.message);
      try { await c.end(); } catch {}
    }
  }

  if (!client) {
    console.error("Could not connect via pg pooler.");
    return;
  }

  // 1. SELECT * FROM pg_policies WHERE tablename = 'inventory_transactions' BEFORE CLEANUP
  console.log("==========================================================================");
  console.log("1. PG_POLICIES DÀNH CHO BẢNG inventory_transactions (TRƯỚC KHI DỌN DẸP)");
  console.log("==========================================================================");
  const invBefore = await client.query(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
  );
  console.table(invBefore.rows);

  console.log("\n==========================================================================");
  console.log("2. TẤT CẢ PG_POLICIES TRONG SCHEMA PUBLIC (TRƯỚC KHI DỌN DẸP)");
  console.log("==========================================================================");
  const allBefore = await client.query(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
  );
  console.table(allBefore.rows);

  // 3. DROP ALL EXISTING POLICIES AND ENFORCE DENY ALL (false) ON ALL PUBLIC TABLES
  console.log("\n==========================================================================");
  console.log("3. THỰC HIỆN DROP TOÀN BỘ POLICY CŨ VÀ KHỞI TẠO 100% DENY POLICY (false)");
  console.log("==========================================================================");
  const tablesRes = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
  );
  const tables: string[] = tablesRes.rows.map((r) => r.table_name);
  console.log("Danh sách các bảng trong public schema:", tables);

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
  console.log("✅ Đã kích hoạt RLS và gán duy nhất 1 policy deny (false) cho tất cả các bảng!");

  // 4. SELECT * FROM pg_policies WHERE tablename = 'inventory_transactions' AFTER CLEANUP
  console.log("\n==========================================================================");
  console.log("4. PG_POLICIES DÀNH CHO BẢNG inventory_transactions (SAU KHI DỌN DẸP)");
  console.log("==========================================================================");
  const invAfter = await client.query(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'inventory_transactions';"
  );
  console.table(invAfter.rows);

  console.log("\n==========================================================================");
  console.log("5. TẤT CẢ PG_POLICIES TRONG SCHEMA PUBLIC (SAU KHI DỌN DẸP)");
  console.log("==========================================================================");
  const allAfter = await client.query(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
  );
  console.table(allAfter.rows);

  await client.end();
}

executeRlsCleanup().catch(console.error);
