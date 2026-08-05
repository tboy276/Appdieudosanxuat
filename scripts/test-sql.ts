import { supabaseAdmin } from "../lib/supabase";

async function main() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  console.log("Testing SQL execution with Supabase service key...");

  try {
    const res = await fetch(`${projectUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey || "",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: "SELECT version();" }),
    });

    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}

main();
