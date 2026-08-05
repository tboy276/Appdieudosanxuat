import { supabaseAdmin } from "../lib/supabase";

async function testTables() {
  console.log("Checking if shipments table exists...");
  const { data, error } = await supabaseAdmin.from("shipments").select("id").limit(1);
  console.log("shipments table check:", { data, error });

  const { data: d2, error: e2 } = await supabaseAdmin.from("shipment_items").select("id").limit(1);
  console.log("shipment_items table check:", { data: d2, error: e2 });
}

testTables();
