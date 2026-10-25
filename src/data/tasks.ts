import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './client';
import type { AgentDef } from '../world/agents';
import type { AgentEvent } from './types';
import type { SimSource } from './sim';
import { BIZ, type PlaceKey } from '../world/places';
import { pick, ri } from '../art/pixel';

/**
 * Prompts you send to agents, and their results.
 *
 * Live: rows in the Supabase `agent_tasks` table. The website adds them (only when you're signed in
 * as a town owner); the town runner on your Mac picks them up, runs the agent, and writes the result back.
 * Demo: the same thing faked in the browser, so you can try it without any setup.
 */
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface AgentTask {
  id: number;
  agent_id: string;
  prompt: string;
  status: TaskStatus;
  fresh: boolean;
  summary: string | null;
  result: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}
export interface RunnerInfo { online: boolean; running: number; queued: number; lastSeen: Date | null }

export interface Tasks {
  readonly mode: 'demo' | 'live';
  /** Signed-in email, or null. */
  user: string | null;
  /** True once we know the signed-in user is a town owner (always true in demo). */
  owner: boolean;
  runner: RunnerInfo | null;
  forAgent(id: string): AgentTask[];
  send(agentId: string, prompt: string, fresh: boolean): Promise<void>;
  cancel(id: number): Promise<void>;
  signIn(email: string): Promise<void>;
  signOut(): Promise<void>;
  onChange(fn: () => void): void;
}

abstract class Base {
  protected rows = new Map<number, AgentTask>();
  private fns = new Set<() => void>();
  onChange(fn: () => void) { this.fns.add(fn); }
  protected changed() { this.fns.forEach((f) => f()); }
  forAgent(id: string) { return [...this.rows.values()].filter((t) => t.agent_id === id).sort((a, b) => b.id - a.id); }
}

/* ---------------- live (Supabase) ---------------- */
export class LiveTasks extends Base implements Tasks {
  readonly mode = 'live' as const;
  user: string | null = null;
  owner = false;
  runner: RunnerInfo | null = null;
  private sb: SupabaseClient = supabase();
  private chan: ReturnType<SupabaseClient['channel']> | null = null;

  constructor() {
    super();
    this.sb.auth.onAuthStateChange((_e, session) => {
      const email = session?.user?.email ?? null;
      if (email !== this.user) { this.user = email; void this.refresh(); }
    });
    void this.watchRunner();
    setInterval(() => this.tickRunner(), 15000);
  }

  private async refresh() {
    this.rows.clear();
    this.owner = false;
    this.chan?.unsubscribe(); this.chan = null;
    if (this.user) {
      const { data } = await this.sb.rpc('is_town_owner');
      this.owner = data === true;
      if (this.owner) {
        const { data: rows, error } = await this.sb.from('agent_tasks').select('*').order('id', { ascending: false }).limit(200);
        if (error) console.error('[tasks] Could not load agent_tasks. Did you run supabase/prompts.sql?', error);
        for (const r of (rows ?? []) as AgentTask[]) this.rows.set(r.id, r);
        this.chan = this.sb.channel('agent-tasks')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_tasks' }, (p) => {
            const r = (p.new ?? p.old) as AgentTask;
            if (p.eventType === 'DELETE') this.rows.delete(r.id); else this.rows.set(r.id, r);
            this.changed();
          })
          .subscribe();
      }
    }
    this.changed();
  }

  private lastRunner: { last_seen: string | null; running: number; queued: number } | null = null;
  private async watchRunner() {
    const { data } = await this.sb.from('runner_status').select('*').eq('id', 1).maybeSingle();
    if (data) this.lastRunner = data;
    this.tickRunner();
    this.sb.channel('runner-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_status' }, (p) => { this.lastRunner = p.new as never; this.tickRunner(); })
      .subscribe();
  }
  private tickRunner() {
    const r = this.lastRunner;
    const seen = r?.last_seen ? new Date(r.last_seen) : null;
    this.runner = { online: !!seen && Date.now() - seen.getTime() < 75_000, running: r?.running ?? 0, queued: r?.queued ?? 0, lastSeen: seen };
    this.changed();
  }

  async send(agentId: string, prompt: string, fresh: boolean) {
    const { error } = await this.sb.from('agent_tasks').insert({ agent_id: agentId, prompt, fresh });
    if (error) throw new Error(error.code === '42501' ? 'Your email isn’t on the town owner list (see supabase/prompts.sql).' : error.message);
  }
  async cancel(id: number) {
    const { error } = await this.sb.from('agent_tasks').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw new Error(error.message);
  }
  async signIn(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw new Error(error.message);
  }
  async signOut() { await this.sb.auth.signOut(); }
}

/* ---------------- demo ---------------- */
const DEMO_STEPS = ['Reading the brief', 'Searching the web', 'Comparing sources', 'Taking notes', 'Drafting the answer', 'Saving results'];

export class DemoTasks extends Base implements Tasks {
  readonly mode = 'demo' as const;
  user = 'demo';
  owner = true;
  runner: RunnerInfo = { online: true, running: 0, queued: 0, lastSeen: new Date() };
  private next = 1;
  private busy = new Set<string>();

  constructor(private defs: AgentDef[], private sim: SimSource, private emit: (e: AgentEvent) => void) { super(); }

  async send(agentId: string, prompt: string, fresh: boolean) {
    const t: AgentTask = { id: this.next++, agent_id: agentId, prompt, fresh, status: 'queued', summary: null, result: null, created_at: new Date().toISOString() };
    this.rows.set(t.id, t);
    this.changed();
    this.pump();
  }
  async cancel(id: number) {
    const t = this.rows.get(id);
    if (t && (t.status === 'queued' || t.status === 'running')) { t.status = 'cancelled'; t.summary = 'Cancelled'; this.changed(); }
  }
  async signIn() {}
  async signOut() {}

  private pump() {
    for (const t of [...this.rows.values()].sort((a, b) => a.id - b.id)) {
      if (t.status !== 'queued' || this.busy.has(t.agent_id) || this.busy.size >= 2) continue;
      void this.run(t);
    }
    this.runner.running = this.busy.size;
    this.runner.queued = [...this.rows.values()].filter((t) => t.status === 'queued').length;
  }

  private async run(t: AgentTask) {
    const id = t.agent_id;
    const def = this.defs.find((d) => d.id === id)!;
    const place: PlaceKey = def.home ?? pick(BIZ);
    this.busy.add(id);
    this.sim.hold(id);
    t.status = 'running'; t.started_at = new Date().toISOString(); this.changed();
    const title = t.prompt.length > 60 ? t.prompt.slice(0, 57) + '…' : t.prompt;
    this.emit({ agent_id: id, kind: 'started', place, text: title });
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(5000);
    for (const step of DEMO_STEPS.slice(0, ri(3, 6))) {
      if ((t.status as TaskStatus) === 'cancelled') break;
      this.emit({ agent_id: id, kind: 'progress', place, text: step });
      await wait(2200);
    }
    if ((t.status as TaskStatus) !== 'cancelled') {
      t.status = 'done';
      t.summary = `(Demo) Finished: ${title}`;
      t.result = `This is a demo answer from ${def.name}.\n\nIn live mode, the town runner on your Mac sends your prompt to Claude as ${def.name.split(' ')[0]} (${def.role}), and the real answer appears here.\n\nYour prompt was:\n“${t.prompt}”`;
      t.finished_at = new Date().toISOString();
      this.emit({ agent_id: id, kind: 'finished', place, text: t.summary });
    }
    this.changed();
    this.busy.delete(id);
    this.sim.release(id);
    this.pump();
    this.changed();
  }
}
