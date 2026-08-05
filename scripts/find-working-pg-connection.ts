import { Client } from "pg";

async function findWorkingConnection() {
  const ref = "smjtxmnkgsascejjpfpu";
  const pass = "Sdhs28Nfa4eGcOynKIFj4hwq7cjzD4V9v1m1xPE4QUs";

  // IP addresses of aws-0-ap-southeast-1.pooler.supabase.com
  const poolerIps = ["52.74.252.201", "52.77.146.31", "54.255.219.82"];

  const tests: any[] = [];

  for (const ip of poolerIps) {
    tests.push({ host: ip, port: 6543, user: `postgres.${ref}`, options: undefined, ssl: { rejectUnauthorized: false, servername: `db.${ref}.supabase.co` } });
    tests.push({ host: ip, port: 5432, user: `postgres.${ref}`, options: undefined, ssl: { rejectUnauthorized: false, servername: `db.${ref}.supabase.co` } });
    tests.push({ host: ip, port: 6543, user: `postgres`, options: `project=${ref}`, ssl: { rejectUnauthorized: false, servername: `db.${ref}.supabase.co` } });
    tests.push({ host: ip, port: 5432, user: `postgres`, options: `project=${ref}`, ssl: { rejectUnauthorized: false, servername: `db.${ref}.supabase.co` } });
    tests.push({ host: ip, port: 6543, user: `postgres.${ref}`, options: undefined, ssl: { rejectUnauthorized: false } });
    tests.push({ host: ip, port: 5432, user: `postgres.${ref}`, options: undefined, ssl: { rejectUnauthorized: false } });
  }

  for (const t of tests) {
    console.log(`Connecting: host=${t.host}, port=${t.port}, user=${t.user}, servername=${t.ssl?.servername}`);
    const client = new Client({
      host: t.host,
      port: t.port,
      user: t.user,
      password: pass,
      database: "postgres",
      options: t.options,
      ssl: t.ssl,
      connectionTimeoutMillis: 3000,
    });

    try {
      await client.connect();
      console.log(`\n🎉 SUCCESSFUL DB CONNECTION! host=${t.host}, port=${t.port}, user=${t.user}`);
      const res = await client.query("SELECT version();");
      console.log("Version:", res.rows[0].version);
      await client.end();
      return { host: t.host, port: t.port, user: t.user, options: t.options, ssl: t.ssl };
    } catch (e: any) {
      console.log("Failed:", e.message);
      try { await client.end(); } catch {}
    }
  }
  console.log("All connection attempts failed.");
}

findWorkingConnection().catch(console.error);
