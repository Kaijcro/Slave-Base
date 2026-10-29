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
import { query, type HookCallback, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { report, client } from './report';
import { persona } from './personas';
import { shopServer, SHOP_TOOLS } from './shop/tools';
import { SHOP_DIR } from './shop/design';
import { SCHEDULE } from './schedule';
import { townServer, HANDOFF_TOOL } from './handoff';
import { voiceServer, VOICE_TOOLS, voiceAgents } from './voice/tools';
import { salesServer, SALES_TOOLS } from './sales/tools';
import { googleReady } from './drive/google';
import { syncAll } from './drive/sync';
import { AGENTS } from '../src/world/agents';
import type { PlaceKey } from '../src/world/places';

const MAX_PARALLEL = Math.max(1, Number(process.env.MAX_PARALLEL ?? 2));
const MAX_TURNS = Math.max(5, Number(process.env.MAX_TURNS ?? 30));
const TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
const OUT = resolve('output');
const SESSIONS = resolve('.town-sessions.json');

interface Task { id: number; agent_id: string; prompt: string; status: string; fresh: boolean; from_agent?: string | null; parent_id?: number | null }

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
    case 'mcp__town__hand_off': return `Handing off to ${AGENTS.find((a) => a.id === i.to)?.name.split(' ')[0] ?? 'a teammate'}`;
    case 'mcp__voice__voice_create_demo': return `Building a demo receptionist for ${short(String(i.business_name ?? ''), 30)}`;
    case 'mcp__voice__voice_assign_demo_number': return 'Setting up a demo phone number';
    case 'mcp__voice__voice_list_calls': return 'Checking recent calls';
    case 'mcp__voice__voice_get_call': return 'Reading a call transcript';
    case 'mcp__voice__voice_propose_update': return 'Drafting a script change for your approval';
    case 'mcp__shop__shop_make_artwork': return `Painting artwork: ${short(String(i.name ?? ''), 40)}`;
    case 'mcp__shop__shop_make_background': return `Making a photo background: ${short(String(i.name ?? ''), 30)}`;
    case 'mcp__shop__shop_ai_mockup': return 'Photographing a design (AI mockup)';
    case 'mcp__shop__shop_remake_photos': return 'Re-making listing photos';
    case 'mcp__shop__shop_make_design': return `Designing: ${short(String(i.name ?? ''), 40)}`;
    case 'mcp__shop__shop_publish_digital': return `Publishing to Etsy: ${short(String(i.title ?? ''), 40)}`;
    case 'mcp__sales__prospects_search': return `Finding ${short(String(i.business_type ?? 'businesses'), 25)} in ${short(String(i.area ?? ''), 25)}`;
    case 'mcp__sales__outreach_create_campaign': return 'Drafting a cold email campaign';
    case 'mcp__sales__outreach_add_leads': return 'Adding prospects to a campaign';
    case 'mcp__sales__outreach_request_launch': return 'Asking you to approve a campaign';
    case 'mcp__sales__outreach_launch': return 'Launching your approved campaign';
    case 'mcp__sales__outreach_replies': return 'Reading email replies';
    case 'mcp__sales__client_report': return 'Making a client’s monthly report';
    case 'mcp__voice__voice_apply_update': return 'Applying your approved script change';
    default: return `Using ${tool.replace(/^mcp__\w+__/, '').replace(/_/g, ' ')}`;
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

/* ---------------- the owner's Google Drive connector ---------------- */
// Agents may use the owner's Google Drive connector (from their Claude account) to search, read, create and edit files.
// Sharing, deleting and changing permissions stay off. Turn it all off with AGENT_DRIVE_ACCESS=false.
const driveAccess = () => (process.env.AGENT_DRIVE_ACCESS ?? 'true').toLowerCase() !== 'false';
const driveGate: CanUseTool = async (toolName, input, opts) => {
  const isDrive = /google.?drive/i.test(toolName) || /google.?drive/i.test(opts.mcpServer?.name ?? '');
  if (isDrive && driveAccess()) {
    if (/share|trash|delete|permission/i.test(toolName)) return { behavior: 'deny', message: 'Sharing, deleting or changing permissions in Google Drive isn’t allowed. Tell the owner what you’d like done instead.' };
    return { behavior: 'allow', updatedInput: input };
  }
  return { behavior: 'deny', message: 'That tool isn’t available to town agents.' };
};

/* ---------------- run one prompt ---------------- */
async function run(t: Task) {
  const agent = AGENTS.find((a) => a.id === t.agent_id)!;
  const place: PlaceKey = agent.home ?? 'hall';
  const abort = new AbortController();
  running.set(t.id, { agent: agent.id, abort });
  const first = agent.name.split(' ')[0];
  log(`▶ ${first}${t.from_agent ? ` (from ${AGENTS.find((a) => a.id === t.from_agent)?.name.split(' ')[0] ?? t.from_agent})` : ''}: ${short(t.prompt.replace(/^.*handed you this task:\s*/s, '').replace(/\s+/g, ' '), 70)}`);
  await heartbeat();

  const dir = join(OUT, agent.id);
  mkdirSync(dir, { recursive: true });
  const title = t.from_agent ? t.prompt.replace(/^.*handed you this task:\s*/s, '') : t.prompt;
  await report(agent.id, 'started', place, short(title, 80)).catch((e) => log(`✖ ${e.message}`));

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

  // Any agent can hand work to a teammate.
  const handoffs = townServer({
    db, taskId: t.id, agentId: agent.id, cwd: dir,
    onHandoff: (to) => {
      const name = AGENTS.find((a) => a.id === to)?.name.split(' ')[0] ?? to;
      log(`   ${first} · handed off to ${name} (starts when ${first} finishes)`);
    },
  });

  // The AI receptionist business (Retell): only the agents listed in VOICE_AGENTS, and only once a key is set.
  const voice = !!process.env.RETELL_API_KEY?.trim() && voiceAgents().includes(agent.id);
  // Prospects, cold email, clients and reports for that business: the same agents, once any of its keys is set.
  const sales = voiceAgents().includes(agent.id) && ['RETELL_API_KEY', 'GOOGLE_PLACES_API_KEY', 'INSTANTLY_API_KEY'].some((k) => process.env[k]?.trim());

  const attempt = async (resume: string | undefined) => {
    let text = '', ok = false, why = '';
    for await (const msg of query({
      prompt: t.prompt,
      options: {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: persona(agent, place, { voice, sales }) },
        allowedTools: [...TOOLS, HANDOFF_TOOL, ...(shop ? SHOP_TOOLS : []), ...(voice ? VOICE_TOOLS : []), ...(sales ? SALES_TOOLS : [])],
        mcpServers: {
          town: handoffs,
          ...(shop ? { shop: shopServer() } : {}),
          ...(voice ? { voice: voiceServer({ taskPrompt: t.prompt, fromAgent: t.from_agent, agentId: agent.id, taskId: t.id }) } : {}),
          ...(sales ? { sales: salesServer({ db, taskPrompt: t.prompt, fromAgent: t.from_agent, agentId: agent.id }) } : {}),
        },
        ...(shop ? { additionalDirectories: [SHOP_DIR] } : {}),
        permissionMode: 'acceptEdits',
        maxTurns: shop || voice || sales ? Math.max(MAX_TURNS, 80) : MAX_TURNS, // research and design take more steps
        cwd: dir,
        resume,
        abortController: abort,
        hooks: { PreToolUse: [{ hooks: [onToolUse] }] },
        canUseTool: driveGate,
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
  if (status === 'done' && result) { try { saveResult(agent.name, title, t.prompt, result); } catch { /* not important */ } }
  void driveSync();

  // Walk the result over to Town Hall, like a real report.
  if (status === 'done' && place !== 'hall') {
    await sleep(1500);
    await report(agent.id, 'started', 'hall', short(`Filing: ${summary}`, 80)).catch(() => {});
    await sleep(8000);
    if (![...running.values()].some((r) => r.agent === agent.id)) await report(agent.id, 'finished', 'hall', 'Report filed at Town Hall').catch(() => {});
  }
}

/* ---------------- Google Drive (workers/drive/) ---------------- */
let syncing = false, syncAgain = false, lastDriveError = '';
async function driveSync() {
  if (!googleReady()) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  try {
    do {
      syncAgain = false;
      const r = await syncAll({ log });
      if (r.docs) log(`   ☁ Google Drive: ${r.docs} file${r.docs === 1 ? '' : 's'} updated`);
      lastDriveError = '';
    } while (syncAgain);
  } catch (e) {
    const m = (e as Error).message;
    if (m !== lastDriveError) log(`✖ Google Drive: ${m}`);
    lastDriveError = m;
  } finally { syncing = false; }
}

/** Every finished result is also saved as a file, so it shows up in Drive under Results. */
function saveResult(agentName: string, title: string, prompt: string, result: string) {
  const dir = join(OUT, 'results', agentName.split(' ')[0]);
  mkdirSync(dir, { recursive: true });
  const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  const name = `${stamp} ${title.replace(/^.*handed you this task:\s*/s, '').replace(/[\\/:*?"<>|#\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)}.md`;
  writeFileSync(join(dir, name), `# ${title.split('\n')[0].slice(0, 120)}\n\n**${agentName}** · ${d.toLocaleString()}\n\n${result}\n\n---\n\n**Your prompt**\n\n${prompt}\n`);
}

/* ---------------- routines (workers/schedule.ts) ---------------- */
const SCHEDULE_FILE = resolve('.town-schedule.json');
let lastRuns: Record<string, string> = {};
try { if (existsSync(SCHEDULE_FILE)) lastRuns = JSON.parse(readFileSync(SCHEDULE_FILE, 'utf8')); } catch { lastRuns = {}; }

async function runRoutines() {
  const now = new Date(), today = now.toDateString();
  for (const r of SCHEDULE) {
    const due = r.monthDays ? r.monthDays.includes(now.getDate()) : (r.days ?? []).includes(now.getDay());
    if (!due || now.getHours() < r.hour || lastRuns[r.id] === today) continue;
    if (r.needs && !r.needs.every((k) => process.env[k]?.trim())) continue; // that business isn't set up yet
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
  const { data: queued, error } = await db.from('agent_tasks').select('id, agent_id, prompt, status, fresh, from_agent, parent_id').eq('status', 'queued').order('id').limit(50);
  if (error) { log(`✖ Couldn't read prompts: ${error.message}. Did you run supabase/prompts.sql?`); return; }
  queuedCount = queued.length;
  for (const t of queued as Task[]) {
    if (running.size >= MAX_PARALLEL) break;
    if ([...running.values()].some((r) => r.agent === t.agent_id)) continue; // one prompt at a time per agent
    if (t.parent_id && running.has(t.parent_id)) continue; // a hand-off waits until the sender is done
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
if (googleReady()) { console.log('   ☁ Copying work to Google Drive after every task.\n'); void driveSync(); setInterval(() => void driveSync(), 15 * 60_000); }
for (;;) {
  try { await runRoutines(); await poll(); } catch (e) { log(`✖ ${(e as Error).message}`); }
  await sleep(3000);
}
