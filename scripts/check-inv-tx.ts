import { supabaseAdmin } from "../lib/supabase";

async function checkColumns() {
  console.log("Checking inventory_transactions columns...");
  const { data, error } = await supabaseAdmin
    .from("inventory_transactions")
    .select("*")
    .limit(1);

  console.log("Query result:", { data, error });
}

checkColumns();
