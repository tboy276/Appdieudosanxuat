import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, "utf8");
  for (const line of envConfig.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    }
  }
}

import { supabaseAdmin } from "../lib/supabase";

async function fixAndInspect() {
  console.log("=========================================================");
  console.log("1. ENFORCING RLS HARDENING AND DROPPING ALL OLD POLICIES");
  console.log("=========================================================");

  // Fetch all public tables dynamically from DB
  const { data: tablesData, error: tablesErr } = await supabaseAdmin
    .from("information_schema.tables" as any)
    .select("table_name")
    .eq("table_schema", "public");

  // We know our tables
  const allTables = [
    "products",
    "product_customers",
    "product_routings",
    "customers",
    "purchase_orders",
    "po_lines",
    "work_orders",
    "opening_stocks",
    "inventory_transactions",
    "shipments",
    "shipment_items",
    "users",
    "workshops"
  ];

  // SQL script to drop all policies and recreate deny_direct_access_*
  let sqlCommands = `
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.policyname, r.tablename);
    END LOOP;
END $$;
`;

  for (const t of allTables) {
    sqlCommands += `
ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_direct_access_${t}" ON public.${t};
CREATE POLICY "deny_direct_access_${t}" ON public.${t} FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
`;
  }

  // Execute SQL via RPC if function exec_sql exists, or we can use REST DDL or direct query
  console.log("Executing SQL RLS Hardening...");
  const { error: rpcErr } = await supabaseAdmin.rpc("exec_sql" as any, { query: sqlCommands }).catch((e) => ({ error: e }));

  if (rpcErr) {
    console.log("RPC exec_sql error (will use alternative):", rpcErr);
  }

  // Check pg_policies via RPC or fallback
}

fixAndInspect().catch(console.error);
