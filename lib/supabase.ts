import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-url.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key";

export const isSupabaseEnvConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fetchWithRetry = async (url: string | URL | Request, options?: RequestInit) => {
  let lastErr: any = null;
  // Omit signal from options so retries do not fail instantly if original signal aborted
  const { signal: _, ...cleanOpts } = options || {};

  for (let i = 0; i < 3; i++) {
    try {
      const res = await globalThis.fetch(url, cleanOpts);
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
};

/**
 * Public Supabase client for client-side queries (uses anon key)
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithRetry },
});

/**
 * Admin Supabase client for server-side API routes (uses service role key to bypass RLS)
 */
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    global: { fetch: fetchWithRetry },
  }
);
