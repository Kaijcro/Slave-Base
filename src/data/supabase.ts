import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AgentEvent, AgentSource, Emit } from './types';

/**
 * Live mode: reads agent status rows from Supabase and listens for new ones in real time.
 * The browser only ever reads. Agents write with the secret key from the server side (see workers/report.ts).
 */
export class SupabaseSource implements AgentSource {
  readonly mode = 'live' as const;
  status = 'Connecting…';
  private sb: SupabaseClient;

  constructor(url: string, publishableKey: string) {
    this.sb = createClient(url, publishableKey, { auth: { persistSession: false } });
  }

  async start(emit: Emit) {
    // 1. Catch up: replay today's recent history so everyone is where they should be.
    const { data, error } = await this.sb
      .from('agent_events')
      .select('agent_id, kind, place, text, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      this.status = 'Can’t read events';
      console.error('[supabase] Could not load agent_events. Did you run supabase/schema.sql?', error);
    } else {
      for (const row of [...(data as AgentEvent[])].reverse()) emit(row, { instant: true });
    }

    // 2. Stay live: every new row moves someone in town.
    this.sb
      .channel('agent-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_events' }, (payload) => {
        emit(payload.new as AgentEvent);
      })
      .subscribe((s) => {
        this.status = s === 'SUBSCRIBED' ? 'Live' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'Reconnecting…' : this.status;
      });
  }
}
