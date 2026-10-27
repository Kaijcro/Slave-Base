import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { listVoices, createAgent, getAgent, getLlm, updateLlm, listNumbers, pointNumber, listCalls, getCall, rt } from './retell';

/**
 * The tools agents get for the AI receptionist business (Retell AI).
 *
 * Safety rules built in:
 * - Agents can't buy phone numbers or place calls. Demos use numbers you bought and nicknamed "Demo…".
 * - Script changes to a live agent are only proposals. One goes live only when YOU send a prompt
 *   containing "approve <proposal id>" (hand-offs and routines can't approve).
 * - Proposals live in .town-voice/ at the repo root, outside the agents' folders, so they can't be edited after you read them.
 */
export const VOICE_DIR = resolve('.town-voice');
const PROPOSALS = join(VOICE_DIR, 'proposals');
const DEMOS_FILE = join(VOICE_DIR, 'demos.json');

export const VOICE_TOOLS = [
  'voice_guide', 'voice_list_voices', 'voice_create_demo', 'voice_list_agents', 'voice_assign_demo_number',
  'voice_list_calls', 'voice_get_call', 'voice_propose_update', 'voice_apply_update',
].map((n) => `mcp__voice__${n}`);

/** Which agents get these tools (.env VOICE_AGENTS, comma-separated ids). */
export const voiceAgents = () => (process.env.VOICE_AGENTS ?? 'priya,kofi,dex').split(',').map((s) => s.trim()).filter(Boolean);

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: `Didn't work: ${msg}` }], isError: true });
const safe = <A,>(fn: (a: A) => Promise<ReturnType<typeof ok>>) => async (a: A) => { try { return await fn(a); } catch (e) { return fail((e as Error).message); } };

interface Demo { agent_id: string; llm_id: string; business: string; website?: string; created: string; number?: string; number_assigned?: string }
const readDemos = (): Demo[] => (existsSync(DEMOS_FILE) ? JSON.parse(readFileSync(DEMOS_FILE, 'utf8')) : []);
const saveDemos = (d: Demo[]) => { mkdirSync(VOICE_DIR, { recursive: true }); writeFileSync(DEMOS_FILE, JSON.stringify(d, null, 2)); };

/** The receptionist script every demo starts from. */
export function receptionistPrompt(o: { business: string; facts: string; website?: string; demo: boolean }) {
  return [
    `You are the friendly virtual receptionist for ${o.business}. You answer their phone calls.`,
    '',
    '## What you know about the business',
    o.facts.trim(),
    ...(o.website ? [`Website: ${o.website}`] : []),
    '',
    '## Your job on every call',
    '1. Find out why they are calling.',
    '2. Answer questions using ONLY the facts above. If you don’t know something (prices, availability, specifics not listed), say you’ll have someone call them back. Never make up prices, times or promises.',
    '3. For bookings, quotes, emergencies or anything you can’t answer: get their name, the best callback number, and a short description of what they need. Repeat the number back to confirm it.',
    '4. Tell them when to expect a call back (say "as soon as possible" unless the facts give business hours).',
    '5. Thank them and end the call politely.',
    '',
    '## Style',
    '- Warm, calm and brief. One or two short sentences at a time; this is a phone call, not an essay.',
    '- Ask one question at a time. Don’t read lists aloud.',
    '- If asked whether you are a real person or a robot, say honestly that you are a virtual assistant for the business.',
    '- If someone describes a life-threatening emergency, tell them to hang up and call 911.',
    ...(o.demo ? ['', '## This is a demo', `This line is a demo built for ${o.business} to show what an AI receptionist could sound like. If the caller asks, say so honestly. Don’t claim any booking is real.`] : []),
  ].join('\n');
}

const fmtTime = (ms?: number) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');

export function voiceServer(ctx: { taskPrompt: string; fromAgent: string | null | undefined; agentId: string }) {
  return createSdkMcpServer({
    name: 'voice',
    version: '1.0.0',
    tools: [
      tool('voice_guide', 'Read this first: how the receptionist business tools work and the rules.', {}, safe(async () => ok([
        'AI RECEPTIONIST TOOLS (Retell AI)',
        '',
        'Build a demo for a prospect:',
        '1. WebFetch the prospect’s website (home, services, contact, about). Collect: what they do, services, area served, hours, phone, booking or emergency policy. Never invent facts; leave out what you can’t find.',
        '2. voice_create_demo with business_name, website_url and business_facts (short plain lines). It makes the phone agent in Retell.',
        '3. voice_assign_demo_number with the agent_id: points one of the owner’s "Demo" numbers at it, so the prospect can call it.',
        '4. Report the number, the agent_id, and the facts you used, so the owner can check it before sending it to the prospect.',
        '',
        'Review calls: voice_list_calls (recent calls with summaries), then voice_get_call for the full transcript.',
        '',
        'Improve a script: voice_propose_update. It does NOT change anything; it saves a proposal and returns an id.',
        'Tell the owner the id and what changes. Only the owner can approve it, by sending a prompt with "approve <id>".',
        'When the owner’s prompt says "approve <id>", call voice_apply_update with that id.',
        '',
        'Rules: you can’t buy numbers, place outbound calls, or change a live script without the owner’s approval.',
        'Scripts must never claim to be a human, invent prices, or promise things the business didn’t state.',
      ].join('\n')))),

      tool('voice_list_voices', 'List Retell voices you can use for a demo (filter by gender or accent).',
        { gender: z.enum(['male', 'female']).optional(), accent: z.string().optional().describe('e.g. American, British'), limit: z.number().int().min(1).max(50).default(15) },
        safe(async (a) => {
          const v = (await listVoices())
            .filter((x) => !a.gender || x.gender?.toLowerCase() === a.gender)
            .filter((x) => !a.accent || (x.accent ?? '').toLowerCase().includes(a.accent.toLowerCase()))
            .slice(0, a.limit)
            .map((x) => ({ voice_id: x.voice_id, name: x.voice_name, provider: x.provider, gender: x.gender, accent: x.accent, sample: x.preview_audio_url }));
          return ok(v);
        })),

      tool('voice_create_demo',
        'Create a demo AI receptionist in Retell, named after a prospect’s business, from facts you collected from their website. Returns the agent_id.',
        {
          business_name: z.string().min(2).max(80),
          website_url: z.string().url().optional(),
          business_facts: z.string().min(40).max(4000).describe('Plain lines of facts from their site: services, area, hours, phone, booking/emergency policy. Only what the site says.'),
          greeting: z.string().max(200).optional().describe('First thing the receptionist says. Default: "Thanks for calling <business>, how can I help you today?"'),
          voice_id: z.string().optional().describe('From voice_list_voices. Default: RETELL_VOICE_ID or a standard female voice.'),
        },
        safe(async (a) => {
          const prompt = receptionistPrompt({ business: a.business_name, facts: a.business_facts, website: a.website_url, demo: true });
          const greeting = a.greeting || `Thanks for calling ${a.business_name}, how can I help you today?`;
          const made = await createAgent({ name: `DEMO – ${a.business_name}`, prompt, greeting, voice_id: a.voice_id });
          const demos = readDemos();
          demos.push({ ...made, business: a.business_name, website: a.website_url, created: new Date().toISOString() });
          saveDemos(demos);
          return ok({ ...made, name: `DEMO – ${a.business_name}`, greeting, next: 'Call voice_assign_demo_number with this agent_id so the prospect can call it.' });
        })),

      tool('voice_list_agents', 'List the phone agents in Retell (demos and client receptionists), with which numbers point at them.', {},
        safe(async () => {
          const [agents, nums] = await Promise.all([rt<any>('POST', '/v2/list-agents', {}).catch(() => rt<any>('GET', '/list-agents')), listNumbers()]);
          const list = (Array.isArray(agents) ? agents : (agents as any).agents ?? []) as any[];
          const seen = new Map<string, any>();
          for (const x of list) { const prev = seen.get(x.agent_id); if (!prev || (x.version ?? 0) > (prev.version ?? 0)) seen.set(x.agent_id, x); }
          return ok([...seen.values()].map((x) => ({
            agent_id: x.agent_id, name: x.agent_name, voice_id: x.voice_id, llm_id: x.response_engine?.llm_id,
            numbers: nums.filter((n) => (n.inbound_agents ?? []).some((i) => i.agent_id === x.agent_id) || n.inbound_agent_id === x.agent_id).map((n) => n.phone_number_pretty ?? n.phone_number),
          })));
        })),

      tool('voice_assign_demo_number',
        'Point one of the owner’s demo phone numbers (nickname starts with "Demo") at a demo agent. Reuses the number that was assigned longest ago.',
        { agent_id: z.string().min(5) },
        safe(async (a) => {
          await getAgent(a.agent_id); // fails clearly if the id is wrong
          const pool = (await listNumbers()).filter((n) => /^demo/i.test(n.nickname ?? ''));
          if (!pool.length) return fail('there are no demo numbers. The owner needs to buy a number in Retell and give it a nickname starting with "Demo" (e.g. "Demo 1"). Agents can’t buy numbers.');
          const demos = readDemos();
          const lastUse = (num: string) => Math.max(0, ...demos.filter((d) => d.number === num && d.number_assigned).map((d) => Date.parse(d.number_assigned!)));
          const already = pool.find((n) => (n.inbound_agents ?? []).some((i) => i.agent_id === a.agent_id) || n.inbound_agent_id === a.agent_id);
          const pick = already ?? pool.sort((x, y) => lastUse(x.phone_number) - lastUse(y.phone_number))[0];
          const replaced = (pick.inbound_agents ?? [])[0]?.agent_id ?? pick.inbound_agent_id ?? null;
          if (!already) await pointNumber(pick.phone_number, a.agent_id);
          const now = new Date().toISOString();
          const d = demos.find((x) => x.agent_id === a.agent_id);
          if (d) { d.number = pick.phone_number; d.number_assigned = now; } else demos.push({ agent_id: a.agent_id, llm_id: '', business: '(unknown)', created: now, number: pick.phone_number, number_assigned: now });
          saveDemos(demos);
          const prevName = replaced && replaced !== a.agent_id ? demos.find((x) => x.agent_id === replaced)?.business ?? replaced : null;
          return ok({ number: pick.phone_number_pretty ?? pick.phone_number, nickname: pick.nickname, agent_id: a.agent_id, ...(prevName ? { note: `This number used to answer as the demo for ${prevName}; it now answers as the new demo.` } : {}) });
        })),

      tool('voice_list_calls', 'Recent calls with their AI summary, sentiment and a short transcript preview. Optionally for one agent.',
        { agent_id: z.string().optional(), since_hours: z.number().min(1).max(24 * 60).default(24 * 7), limit: z.number().int().min(1).max(100).default(25) },
        safe(async (a) => {
          const cutoff = Date.now() - a.since_hours * 3600_000;
          const calls = (await listCalls({ agentId: a.agent_id, limit: a.limit })).filter((c) => !c.start_timestamp || c.start_timestamp >= cutoff);
          return ok(calls.map((c) => ({
            call_id: c.call_id, agent_id: c.agent_id, when: fmtTime(c.start_timestamp), minutes: c.duration_ms ? +(c.duration_ms / 60000).toFixed(1) : 0,
            from: c.from_number, status: c.call_status, ended: c.disconnection_reason,
            summary: c.call_analysis?.call_summary, sentiment: c.call_analysis?.user_sentiment, successful: c.call_analysis?.call_successful,
            preview: (c.transcript ?? '').slice(0, 300),
          })));
        })),

      tool('voice_get_call', 'One call in full: transcript, summary, recording link.', { call_id: z.string().min(5) },
        safe(async (a) => {
          const c = await getCall(a.call_id);
          return ok({
            call_id: c.call_id, agent_id: c.agent_id, when: fmtTime(c.start_timestamp), minutes: c.duration_ms ? +(c.duration_ms / 60000).toFixed(1) : 0,
            from: c.from_number, to: c.to_number, ended: c.disconnection_reason, analysis: c.call_analysis, recording: c.recording_url,
            transcript: (c.transcript ?? '').slice(0, 30000),
          });
        })),

      tool('voice_propose_update',
        'Propose a new script (prompt) or greeting for a phone agent. Changes nothing yet: it saves a proposal for the owner to approve. Give the full new prompt, not a diff.',
        {
          agent_id: z.string().min(5),
          new_prompt: z.string().min(40).max(20000).optional(),
          new_greeting: z.string().max(300).optional(),
          reason: z.string().min(10).max(1500).describe('Why: what calls showed, what this fixes'),
        },
        safe(async (a) => {
          if (!a.new_prompt && !a.new_greeting) return fail('give new_prompt, new_greeting, or both.');
          const ag = await getAgent(a.agent_id);
          const llmId = ag.response_engine?.llm_id;
          if (!llmId) return fail('this agent doesn’t use a Retell LLM script, so it can’t be updated here.');
          const cur = await getLlm(llmId);
          const id = randomBytes(3).toString('hex');
          mkdirSync(PROPOSALS, { recursive: true });
          const p = {
            id, agent_id: a.agent_id, agent_name: ag.agent_name, llm_id: llmId, by: ctx.agentId, created: new Date().toISOString(), reason: a.reason,
            before: { general_prompt: cur.general_prompt, begin_message: cur.begin_message },
            after: { ...(a.new_prompt ? { general_prompt: a.new_prompt } : {}), ...(a.new_greeting ? { begin_message: a.new_greeting } : {}) },
            status: 'waiting',
          };
          writeFileSync(join(PROPOSALS, `${id}.json`), JSON.stringify(p, null, 2));
          return ok({ proposal_id: id, agent: ag.agent_name, reason: a.reason, after: p.after,
            tell_the_owner: `Proposal ${id} is saved and nothing has changed yet. To make it live, the owner sends a prompt saying "approve ${id}".` });
        })),

      tool('voice_apply_update',
        'Make an approved proposal live. Works only when the owner’s own prompt for this task says "approve <proposal id>".',
        { proposal_id: z.string().regex(/^[0-9a-f]{6}$/) },
        safe(async (a) => {
          const file = join(PROPOSALS, `${a.proposal_id}.json`);
          if (!existsSync(file)) return fail(`there’s no proposal ${a.proposal_id}.`);
          if (ctx.fromAgent) return fail('only the owner can approve script changes, and this task came from a teammate. Ask the owner to approve it.');
          if (!new RegExp(`\\bapprove\\s+${a.proposal_id}\\b`, 'i').test(ctx.taskPrompt)) return fail(`the owner hasn’t approved ${a.proposal_id}. Tell them: send a prompt saying "approve ${a.proposal_id}".`);
          const p = JSON.parse(readFileSync(file, 'utf8'));
          if (p.status === 'applied') return ok(`Proposal ${a.proposal_id} is already live (since ${p.applied}).`);
          await updateLlm(p.llm_id, p.after);
          p.status = 'applied'; p.applied = new Date().toISOString();
          writeFileSync(file, JSON.stringify(p, null, 2));
          return ok({ applied: a.proposal_id, agent: p.agent_name, changed: Object.keys(p.after) });
        })),
    ],
  });
}
