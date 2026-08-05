async function testSqlApi() {
  const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtanR4bW5rZ3Nhc2NlampwZnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTc0MDE2NSwiZXhwIjoyMTAxMzE2MTY1fQ.Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";
  const ref = "smjtxmnkgsascejjpfpu";

  console.log("Testing Supabase SQL Management APIs...");

  const urls = [
    `https://api.supabase.com/v1/projects/${ref}/db/query`,
    `https://${ref}.supabase.co/database/query`,
    `https://${ref}.supabase.co/sql`,
  ];

  for (const url of urls) {
    try {
      console.log("Testing URL:", url);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ query: "SELECT 1 as test;" }),
      });
      console.log("Status:", res.status);
      const txt = await res.text();
      console.log("Body:", txt.slice(0, 200));
    } catch (e: any) {
      console.error("Error:", e.message);
    }
  }
}

testSqlApi();
