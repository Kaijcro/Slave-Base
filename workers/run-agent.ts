/**
 * Run a real Claude agent and watch its townsperson do the work.
 *
 *   npm run agent -- lots          (Hank scans vacant lots)
 *   npm run agent -- captions      (June writes Instagram captions)
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env.
 *
 * Who pays for the AI:
 *   - No ANTHROPIC_API_KEY in .env -> uses your Claude subscription (log in once by running `claude`).
 *     Usage counts toward your plan's limits, shared with the Claude app.
 *   - ANTHROPIC_API_KEY set        -> billed to that API key instead.
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { query, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { report } from './report';
import { JOBS } from './jobs';

const jobName = process.argv[2];
const job = jobName ? JOBS[jobName] : undefined;
if (!job) {
  console.log(`Usage: npm run agent -- <job>\nJobs: ${Object.keys(JOBS).join(', ')}`);
  process.exit(1);
}
// A blank or placeholder key means "use my Claude subscription". Remove it so it can't override the login.
const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
const usingApiKey = apiKey.startsWith('sk-ant-') && apiKey.length > 20;
if (!usingApiKey) delete process.env.ANTHROPIC_API_KEY;
console.log(usingApiKey ? 'Paying with: your API key' : 'Paying with: your Claude subscription (plan limits)');
mkdirSync('output', { recursive: true });

/** Turns a tool call into a short, human sentence for the speech bubble. */
function describe(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (tool) {
    case 'WebSearch': return `Searching: ${String(i.query ?? '').slice(0, 40)}`;
    case 'WebFetch': {
      try { return `Reading ${new URL(String(i.url)).hostname.replace(/^www\./, '')}`; } catch { return 'Reading a web page'; }
    }
    case 'Write': return `Saving ${String(i.file_path ?? 'results').split('/').pop()}`;
    case 'Read': return `Reading ${String(i.file_path ?? 'a file').split('/').pop()}`;
    default: return `Using ${tool}`;
  }
}

// This hook fires before every tool the agent uses, and posts it to town as a "progress" event.
const onToolUse: HookCallback = async (input) => {
  if (input.hook_event_name === 'PreToolUse') {
    await report(job.agent, 'progress', job.place, describe(input.tool_name, input.tool_input)).catch((e) => console.warn(e.message));
  }
  return {};
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`▶ ${job.agent} → ${job.place}: ${job.title}`);
try {
  await report(job.agent, 'started', job.place, job.title);
} catch (e) {
  console.error('✖ ' + (e as Error).message);
  process.exit(1);
}

let summary = '';
let failed = false;
try {
  for await (const msg of query({
    prompt: job.prompt,
    options: {
      allowedTools: job.tools,
      permissionMode: 'acceptEdits',
      maxTurns: 40,
      maxBudgetUsd: Number(process.env.MAX_USD_PER_RUN ?? 1),
      cwd: process.cwd(),
      hooks: { PreToolUse: [{ hooks: [onToolUse] }] },
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        const m = msg.result.match(/SUMMARY:\s*(.+)/i);
        summary = (m ? m[1] : msg.result.split('\n').filter(Boolean).pop() ?? 'Done').trim();
        console.log(msg.result);
        console.log(`Cost: $${msg.total_cost_usd.toFixed(3)}`);
      } else {
        failed = true;
        summary = `Stopped early (${msg.subtype.replace(/_/g, ' ')})`;
      }
    }
  }
} catch (e) {
  failed = true;
  summary = 'Ran into an error';
  console.error(e);
  if (!usingApiKey) {
    console.error('\nIf this mentions logging in or an expired session:\n  1. Run `claude`, type /login, sign in with your Claude account, then /exit.\n  2. Still failing? Run `claude setup-token` and add the token to .env as CLAUDE_CODE_OAUTH_TOKEN=...');
  }
}

await report(job.agent, 'finished', job.place, summary);

// Walk the result over to Town Hall, like a real report.
if (!failed) {
  await sleep(1500);
  await report(job.agent, 'started', 'hall', `Filing: ${summary}`);
  await sleep(9000);
  await report(job.agent, 'finished', 'hall', 'Report filed at Town Hall');
}
console.log(failed ? `✖ ${summary}` : `✔ ${summary}`);
