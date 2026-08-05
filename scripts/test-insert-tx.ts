import { supabaseAdmin } from "../lib/supabase";

async function testInsert() {
  console.log("Testing insert into inventory_transactions...");

  // 1. Fetch 1 product, 1 workshop, 1 user from DB
  const { data: prods } = await supabaseAdmin.from("products").select("id").limit(1);
  const { data: wss } = await supabaseAdmin.from("workshops").select("id").limit(1);
  const { data: users } = await supabaseAdmin.from("users").select("id").limit(1);

  if (!prods?.length || !wss?.length || !users?.length) {
    console.error("Missing baseline master data in Supabase!");
    return;
  }

  const pId = prods[0].id;
  const wsId = wss[0].id;
  const uId = users[0].id;

  // Insert original production input
  const { data: txOrig, error: err1 } = await supabaseAdmin
    .from("inventory_transactions")
    .insert({
      transaction_type: "PRODUCTION_INPUT",
      product_id: pId,
      to_workshop_id: wsId,
      qty_tp_ok: 100,
      qty_ng: 0,
      note: "Test original TX",
      created_by: uId,
    })
    .select()
    .single();

  console.log("Insert original TX:", { txOrig, err1 });

  if (txOrig) {
    // Insert reversal TX
    const { data: txRev, error: err2 } = await supabaseAdmin
      .from("inventory_transactions")
      .insert({
        transaction_type: "REVERSAL",
        product_id: pId,
        to_workshop_id: wsId,
        qty_tp_ok: 40,
        qty_ng: 0,
        note: "Test reversal TX",
        created_by: uId,
        reversed_transaction_id: txOrig.id,
      })
      .select()
      .single();

    console.log("Insert reversal TX:", { txRev, err2 });

    // Clean up test rows
    if (txRev) await supabaseAdmin.from("inventory_transactions").delete().eq("id", txRev.id);
    await supabaseAdmin.from("inventory_transactions").delete().eq("id", txOrig.id);
  }
}

testInsert();
