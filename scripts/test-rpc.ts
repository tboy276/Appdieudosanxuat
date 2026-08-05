import { supabaseAdmin } from "../lib/supabase";

async function testRpc() {
  console.log("Testing RPC call to Supabase...");
  // Test update_po_customer which was created earlier
  const { data, error } = await supabaseAdmin.rpc("update_po_customer", {
    p_po_id: "00000000-0000-0000-0000-000000000000",
    p_new_customer_id: "00000000-0000-0000-0000-000000000000"
  });

  console.log("RPC update_po_customer result:", { data, error });
}

testRpc();
