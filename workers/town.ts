/**
 * The town runner: keeps your agents working while it's open.
 *
 *   npm run town
 *
 * It watches for prompts you send from the website (the agent_tasks table), runs each one as a
 * real Claude agent, walks that townsperson to work, posts their steps to town, and writes the
 * answer back so it shows up in the agent monitor. Several agents can work at the same time.
 *
 * Who pays for the AI: with no ANTHROPIC_API_KEY in .env it uses your Claude subscription
 * (sign in once by running `claude`). Usage counts toward your plan's limits, shared with the Claude app.
 *
 * Settings in .env:
 *   MAX_PARALLEL=2   how many agents may work at once (2 is a good fit for a Pro plan)
 *   MAX_TURNS=30     how many steps one prompt may take before it stops
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { query, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { report, client } from './report';
import { persona } from './personas';
import { shopServer, SHOP_TOOLS } from './shop/tools';
import { SHOP_DIR } from './shop/design';
import { SCHEDULE } from './schedule';
import { AGENTS } from '../src/world/agents';
import type { PlaceKey } from '../src/world/places';

const MAX_PARALLEL = Math.max(1, Number(process.env.MAX_PARALLEL ?? 2));
const MAX_TURNS = Math.max(5, Number(process.env.MAX_TURNS ?? 30));
const TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
const OUT = resolve('output');
const SESSIONS = resolve('.town-sessions.json');

interface Task { id: number; agent_id: string; prompt: string; status: string; fresh: boolean }

// A blank or placeholder key means "use my Claude subscription". Remove it so it can't override the login.
const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
const usingApiKey = apiKey.startsWith('sk-ant-') && apiKey.length > 20;
if (!usingApiKey) delete process.env.ANTHROPIC_API_KEY;

const db = client();
const running = new Map<number, { agent: string; abort: AbortController }>();
let queuedCount = 0;

/* ---------------- memory: each agent continues their own conversation ---------------- */
let sessions: Record<string, string> = {};
try { if (existsSync(SESSIONS)) sessions = JSON.parse(readFileSync(SESSIONS, 'utf8')); } catch { sessions = {}; }
const saveSessions = () => writeFileSync(SESSIONS, JSON.stringify(sessions, null, 2));

/* ---------------- helpers ---------------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const stamp = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const log = (msg: string) => console.log(`${stamp()}  ${msg}`);

function describe(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (tool) {
    case 'WebSearch': return `Searching: ${short(String(i.query ?? ''), 40)}`;
    case 'WebFetch': {
      try { return `Reading ${new URL(String(i.url)).hostname.replace(/^www\./, '')}`; } catch { return 'Reading a web page'; }
    }
    case 'Write': case 'Edit': return `Saving ${String(i.file_path ?? 'notes').split('/').pop()}`;
    case 'Read': return `Reading ${String(i.file_path ?? 'a file').split('/').pop()}`;
    case 'Glob': case 'Grep': return 'Looking through saved files';
    default: return `Using ${tool}`;
  }
}

async function update(id: number, fields: Record<string, unknown>) {
  const { error } = await db.from('agent_tasks').update(fields).eq('id', id);
  if (error) log(`✖ Couldn't update task ${id}: ${error.message}`);
}

async function heartbeat(stopping = false) {
  const { error } = await db.from('runner_status').upsert({
    id: 1, last_seen: stopping ? null : new Date().toISOString(), running: stopping ? 0 : running.size, queued: queuedCount, max_parallel: MAX_PARALLEL,
  });
  if (error) log(`✖ Heartbeat failed: ${error.message}. Did you run supabase/prompts.sql?`);
}

/* ---------------- run one prompt ---------------- */
async function run(t: Task) {
  const agent = AGENTS.find((a) => a.id === t.agent_id)!;
  const place: PlaceKey = agent.home ?? 'hall';
  const abort = new AbortController();
  running.set(t.id, { agent: agent.id, abort });
  const first = agent.name.split(' ')[0];
  log(`▶ ${first}: ${short(t.prompt, 70)}`);
  await heartbeat();

  const dir = join(OUT, agent.id);
  mkdirSync(dir, { recursive: true });
  await report(agent.id, 'started', place, short(t.prompt, 80)).catch((e) => log(`✖ ${e.message}`));

  const onToolUse: HookCallback = async (input) => {
    if (input.hook_event_name === 'PreToolUse') {
      const step = describe(input.tool_name, input.tool_input);
      log(`   ${first} · ${step}`);
      await report(agent.id, 'progress', place, step).catch(() => {});
    }
    return {};
  };

  // AI Enterprizes runs the Etsy shop, so its agents get the shop tools.
  const shop = place === 'ai';
  if (shop) mkdirSync(join(SHOP_DIR, 'research'), { recursive: true });

  const attempt = async (resume: string | undefined) => {
    let text = '', ok = false, why = '';
    for await (const msg of query({
      prompt: t.prompt,
      options: {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: persona(agent, place) },
        allowedTools: shop ? [...TOOLS, ...SHOP_TOOLS] : TOOLS,
        ...(shop ? { mcpServers: { shop: shopServer() }, additionalDirectories: [SHOP_DIR] } : {}),
        permissionMode: 'acceptEdits',
        maxTurns: shop ? Math.max(MAX_TURNS, 80) : MAX_TURNS, // research and design take more steps
        cwd: dir,
        resume,
        abortController: abort,
        hooks: { PreToolUse: [{ hooks: [onToolUse] }] },
      },
    })) {
      if (msg.type === 'system' && msg.subtype === 'init') { sessions[agent.id] = msg.session_id; saveSessions(); }
      if (msg.type === 'result') {
        if (msg.subtype === 'success') { ok = true; text = msg.result; }
        else why = msg.subtype === 'error_max_turns' ? `Stopped after ${MAX_TURNS} steps` : 'Stopped early';
      }
    }
    return { ok, text, why };
  };

  let status = 'failed', summary = '', result = '';
  try {
    const resume = !t.fresh ? sessions[agent.id] : undefined;
    let out;
    try { out = await attempt(resume); }
    catch (e) {
      if (!resume || abort.signal.aborted) throw e;
      log(`   ${first} · couldn't continue the last conversation, starting a new one`);
      out = await attempt(undefined);
    }
    if (out.ok) {
      const m = out.text.match(/SUMMARY:\s*(.+)\s*$/im);
      summary = short((m ? m[1] : out.text.split('\n').filter(Boolean).pop() ?? 'Done').trim(), 200);
      result = out.text.replace(/\n?SUMMARY:.*$/im, '').trim();
      status = 'done';
    } else summary = out.why;
  } catch (e) {
    if (abort.signal.aborted) { status = 'cancelled'; summary = 'Cancelled'; }
    else {
      summary = 'Ran into an error';
      result = String((e as Error).message ?? e);
      log(`✖ ${first}: ${result}`);
      if (!usingApiKey && /log ?in|auth|credential|token|401/i.test(result)) {
        log('  Sign in again: run `claude`, type /login, then /exit. Or add CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` to .env.');
      }
    }
  }

  await update(t.id, { status, summary, result: result.slice(0, 20000) || null, finished_at: new Date().toISOString() });
  await report(agent.id, 'finished', place, summary).catch(() => {});
  log(`${status === 'done' ? '✔' : '✖'} ${first}: ${summary}`);
  running.delete(t.id);
  await heartbeat();

  // Walk the result over to Town Hall, like a real report.
  if (status === 'done' && place !== 'hall') {
    await sleep(1500);
    await report(agent.id, 'started', 'hall', short(`Filing: ${summary}`, 80)).catch(() => {});
    await sleep(8000);
    if (![...running.values()].some((r) => r.agent === agent.id)) await report(agent.id, 'finished', 'hall', 'Report filed at Town Hall').catch(() => {});
  }
}

/* ---------------- routines (workers/schedule.ts) ---------------- */
const SCHEDULE_FILE = resolve('.town-schedule.json');
let lastRuns: Record<string, string> = {};
try { if (existsSync(SCHEDULE_FILE)) lastRuns = JSON.parse(readFileSync(SCHEDULE_FILE, 'utf8')); } catch { lastRuns = {}; }

async function runRoutines() {
  const now = new Date(), today = now.toDateString();
  for (const r of SCHEDULE) {
    if (!r.days.includes(now.getDay()) || now.getHours() < r.hour || lastRuns[r.id] === today) continue;
    lastRuns[r.id] = today;
    writeFileSync(SCHEDULE_FILE, JSON.stringify(lastRuns, null, 2));
    const { error } = await db.from('agent_tasks').insert({ agent_id: r.agent, prompt: r.prompt, fresh: true });
    log(error ? `✖ Couldn't start routine ${r.id}: ${error.message}` : `⏰ Routine: ${r.id} queued for ${r.agent}`);
  }
}

/* ---------------- the loop ---------------- */
async function poll() {
  // Cancelled while running?
  if (running.size) {
    const { data } = await db.from('agent_tasks').select('id, status').in('id', [...running.keys()]);
    for (const r of data ?? []) if (r.status === 'cancelled') running.get(r.id)?.abort.abort();
  }
  const { data: queued, error } = await db.from('agent_tasks').select('id, agent_id, prompt, status, fresh').eq('status', 'queued').order('id').limit(50);
  if (error) { log(`✖ Couldn't read prompts: ${error.message}. Did you run supabase/prompts.sql?`); return; }
  queuedCount = queued.length;
  for (const t of queued as Task[]) {
    if (running.size >= MAX_PARALLEL) break;
    if ([...running.values()].some((r) => r.agent === t.agent_id)) continue; // one prompt at a time per agent
    if (!AGENTS.some((a) => a.id === t.agent_id)) { await update(t.id, { status: 'failed', summary: `No agent called "${t.agent_id}"` }); continue; }
    // Claim it, so two runners never take the same prompt.
    const { data: claimed } = await db.from('agent_tasks').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', t.id).eq('status', 'queued').select('id');
    if (claimed?.length) { queuedCount--; void run(t); }
  }
}

console.log(`\n🏘  Slave Base town runner`);
console.log(`   Paying with: ${usingApiKey ? 'your API key' : 'your Claude subscription (plan limits)'}`);
console.log(`   Up to ${MAX_PARALLEL} agents at once. Results are saved in output/<agent>/.`);
console.log(`   Leave this window open. Press Control + C to stop.\n`);

// Anything left "running" from last time didn't finish.
await db.from('agent_tasks').update({ status: 'failed', summary: 'The runner stopped before this finished', finished_at: new Date().toISOString() }).eq('status', 'running');
process.on('SIGINT', async () => {
  console.log('\nStopping…');
  const ids = [...running.keys()];
  for (const r of running.values()) r.abort.abort();
  if (ids.length) await db.from('agent_tasks').update({ status: 'failed', summary: 'The runner was stopped', finished_at: new Date().toISOString() }).in('id', ids);
  await heartbeat(true);
  process.exit(0);
});

await heartbeat();
setInterval(() => void heartbeat(), 20_000);
for (;;) {
  try { await runRoutines(); await poll(); } catch (e) { log(`✖ ${(e as Error).message}`); }
  await sleep(3000);
}
