import { supabaseAdmin } from "../lib/supabase";

async function testEndpoints() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtanR4bW5rZ3Nhc2NlampwZnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTc0MDE2NSwiZXhwIjoyMTAxMzE2MTY1fQ.Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://smjtxmnkgsascejjpfpu.supabase.co";

  console.log("Testing Supabase endpoints...");

  // Try 1: Query API
  try {
    const res = await fetch(`${projectUrl}/pg/v1/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: "SELECT version();" }),
    });
    console.log("pg/v1/query status:", res.status);
    const txt = await res.text();
    console.log("pg/v1/query body:", txt);
  } catch (e: any) {
    console.error("pg/v1/query error:", e.message);
  }

  // Try 2: Check existing RPC functions or query tables
  try {
    const { data, error } = await supabaseAdmin.from("inventory_transactions").select("id").limit(1);
    console.log("inventory_transactions query:", { data, error });
  } catch (e: any) {
    console.error("inventory_transactions query error:", e.message);
  }
}

testEndpoints();
