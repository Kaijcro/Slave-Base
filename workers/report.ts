import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isPlace, type PlaceKey } from '../src/world/places';
import { EVENT_KINDS, type EventKind } from '../src/data/types';

/**
 * The one function every agent calls to show up in town.
 * Runs on your computer or a server, never in the browser, because it uses the secret key.
 */
let sb: SupabaseClient | null = null;

function client() {
  if (sb) return sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Copy .env.example to .env and fill them in.');
  }
  sb = createClient(url, key, { auth: { persistSession: false } });
  return sb;
}

export async function report(agentId: string, kind: EventKind, place: PlaceKey, text = '') {
  if (!EVENT_KINDS.includes(kind)) throw new Error(`kind must be one of: ${EVENT_KINDS.join(', ')}`);
  if (!isPlace(place)) throw new Error(`Unknown place "${place}"`);
  const { error } = await client().from('agent_events').insert({ agent_id: agentId, kind, place, text: text.slice(0, 280) });
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
}
