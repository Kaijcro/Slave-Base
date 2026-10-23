import type { AgentDef } from '../world/agents';
import { SimSource } from './sim';
import { SupabaseSource } from './supabase';
import type { AgentSource } from './types';

/**
 * Live mode turns on when both Supabase variables are set in .env.
 * Add ?demo to the URL to force the demo even when Supabase is configured.
 */
export function pickSource(defs: AgentDef[]): AgentSource {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const forceDemo = new URLSearchParams(location.search).has('demo');
  if (url && key && !forceDemo) return new SupabaseSource(url, key);
  return new SimSource(defs);
}
