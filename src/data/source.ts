import type { AgentDef } from '../world/agents';
import { SimSource } from './sim';
import { SupabaseSource } from './supabase';
import { supabaseConfig } from './client';
import type { AgentSource } from './types';

/**
 * Live mode turns on when both Supabase variables are set in .env.
 * Add ?demo to the URL to force the demo even when Supabase is configured.
 */
export function pickSource(defs: AgentDef[]): AgentSource {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  if (supabaseConfig() && !forceDemo) return new SupabaseSource();
  return new SimSource(defs);
}
