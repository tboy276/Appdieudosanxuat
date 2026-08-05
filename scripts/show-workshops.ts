import { supabaseAdmin } from "../lib/supabase";

async function showWorkshops() {
  const { data } = await supabaseAdmin.from("workshops").select("code, name");
  console.log("Workshops:", data);
}

showWorkshops();
