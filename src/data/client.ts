import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * One Supabase connection for the whole website. It only ever uses the publishable key:
 * visitors can read the town, and when you sign in by email you can also send prompts
 * (the database checks that your email is in town_owners).
 */
let client: SupabaseClient | null = null;

export function supabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return url && key ? { url, key } : null;
}

export function supabase(): SupabaseClient {
  if (client) return client;
  const cfg = supabaseConfig();
  if (!cfg) throw new Error('Supabase is not configured');
  client = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
