import { supabaseAdmin } from "../lib/supabase";

async function checkRpc() {
  console.log("Checking if create_shipment function exists...");
  const { data, error } = await supabaseAdmin.rpc("create_shipment", {
    p_customer_id: "00000000-0000-0000-0000-000000000000",
    p_actor_id: "00000000-0000-0000-0000-000000000000",
    p_note: "test",
    p_items: [],
  });

  console.log("create_shipment call result:", { data, error });
}

checkRpc();
