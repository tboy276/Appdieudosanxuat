import { supabaseAdmin } from "../lib/supabase";
import { getProduct } from "../lib/products";

async function checkRoutingProducts() {
  const { data: prs } = await supabaseAdmin
    .from("product_routings")
    .select("product_id, products(id, part_no, name_vi), workshops(code)")
    .limit(10);

  console.log("Routings in DB:", JSON.stringify(prs, null, 2));
}

checkRoutingProducts();
