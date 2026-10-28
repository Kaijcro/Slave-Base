import 'dotenv/config';

/**
 * A small Retell AI client for the receptionist business.
 * .env: RETELL_API_KEY=key_...   (Retell dashboard > Settings > API Keys)
 * Optional: RETELL_MODEL (default gpt-4.1), RETELL_VOICE_ID (default: the first ElevenLabs voice)
 */
const API = 'https://api.retellai.com';

export function retellKey() {
  const k = process.env.RETELL_API_KEY?.trim();
  if (!k) throw new Error('Retell isn’t set up yet: add RETELL_API_KEY to .env (see README, "Receptionist business").');
  return k;
}

export async function rt<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${retellKey()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`Retell ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

export interface Voice { voice_id: string; voice_name: string; provider: string; gender: string; accent?: string; age?: string; preview_audio_url?: string }
export const listVoices = () => rt<Voice[]>('GET', '/list-voices');

export async function defaultVoice() {
  if (process.env.RETELL_VOICE_ID) return process.env.RETELL_VOICE_ID;
  const v = await listVoices();
  const pick = v.find((x) => x.provider === 'elevenlabs' && x.gender === 'female') ?? v.find((x) => x.provider === 'elevenlabs') ?? v[0];
  if (!pick) throw new Error('Retell returned no voices.');
  return pick.voice_id;
}

/** What Retell checks after every call; the monthly report counts these. Results land in call_analysis.custom_analysis_data. */
export const ANALYSIS_FIELDS = [
  { type: 'boolean', name: 'lead_captured', description: 'True if the caller left their name and a callback number, or booked, for a job or quote.' },
  { type: 'boolean', name: 'job_booked', description: 'True if the caller booked or confirmed an appointment, visit or job during the call.' },
  { type: 'boolean', name: 'is_spam', description: 'True if the call was spam, a sales pitch to the business, a robocall or a wrong number.' },
  { type: 'string', name: 'call_reason', description: 'In 2 to 5 words, why they called (e.g. "leaking water heater").' },
];

/** Adds the report fields to an existing agent if it doesn't have them. */
export async function ensureAnalysis(agentId: string) {
  const a = await rt<{ post_call_analysis_data?: { name: string }[] }>('GET', `/get-agent/${agentId}`);
  const have = new Set((a.post_call_analysis_data ?? []).map((f) => f.name));
  const missing = ANALYSIS_FIELDS.filter((f) => !have.has(f.name));
  if (missing.length) await rt('PATCH', `/update-agent/${agentId}`, { post_call_analysis_data: [...(a.post_call_analysis_data ?? []), ...missing] });
  return missing.map((f) => f.name);
}

/** One phone agent = a "Retell LLM" (the script) + an agent (voice and call settings) that uses it. */
export async function createAgent(o: { name: string; prompt: string; greeting: string; voice_id?: string }) {
  const llm = await rt<{ llm_id: string }>('POST', '/create-retell-llm', {
    general_prompt: o.prompt,
    begin_message: o.greeting,
    start_speaker: 'agent',
    model: process.env.RETELL_MODEL || 'gpt-4.1',
    general_tools: [{ type: 'end_call', name: 'end_call', description: 'End the call when the caller is finished or says goodbye.' }],
  });
  const agent = await rt<{ agent_id: string }>('POST', '/create-agent', {
    agent_name: o.name,
    voice_id: o.voice_id || (await defaultVoice()),
    response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
    post_call_analysis_data: ANALYSIS_FIELDS,
  });
  return { agent_id: agent.agent_id, llm_id: llm.llm_id };
}

export const getAgent = (id: string) => rt<{ agent_id: string; agent_name?: string; voice_id: string; response_engine: { type: string; llm_id?: string } }>('GET', `/get-agent/${id}`);
export const getLlm = (id: string) => rt<{ llm_id: string; general_prompt?: string; begin_message?: string }>('GET', `/get-retell-llm/${id}`);
export const updateLlm = (id: string, fields: { general_prompt?: string; begin_message?: string }) => rt('PATCH', `/update-retell-llm/${id}`, fields);
export const updateAgent = (id: string, fields: { voice_id?: string; agent_name?: string }) => rt('PATCH', `/update-agent/${id}`, fields);

export interface PhoneNumber { phone_number: string; phone_number_pretty?: string; nickname?: string; inbound_agents?: { agent_id: string; weight: number }[]; inbound_agent_id?: string | null }
/** GET /v2/list-phone-numbers returns { items, has_more, pagination_key }. */
export async function listNumbers() {
  const out: PhoneNumber[] = [];
  let key: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r: any = await rt('GET', `/v2/list-phone-numbers?limit=1000${key ? `&pagination_key=${encodeURIComponent(key)}` : ''}`);
    out.push(...(Array.isArray(r) ? r : r.items ?? []));
    if (Array.isArray(r) || !r.has_more || !r.pagination_key) break;
    key = r.pagination_key;
  }
  return out;
}
export const pointNumber = (num: string, agentId: string) =>
  rt('PATCH', `/update-phone-number/${encodeURIComponent(num)}`, { inbound_agents: [{ agent_id: agentId, weight: 1 }] });

export interface Call {
  call_id: string; agent_id: string; call_status: string; from_number?: string; to_number?: string; direction?: string;
  start_timestamp?: number; duration_ms?: number; transcript?: string; recording_url?: string; disconnection_reason?: string;
  call_analysis?: { call_summary?: string; user_sentiment?: string; call_successful?: boolean; in_voicemail?: boolean; custom_analysis_data?: Record<string, unknown> };
}
/** POST /v3/list-calls returns { items, has_more, pagination_key }. */
const callItems = (r: any): Call[] => (Array.isArray(r) ? r : r.items ?? r.calls ?? []);
export const listCalls = (o: { agentId?: string; limit: number }) =>
  rt('POST', '/v3/list-calls', {
    limit: o.limit, sort_order: 'descending',
    ...(o.agentId ? { filter_criteria: { agent: [{ agent_id: o.agentId }] } } : {}),
  }).then(callItems);
export const getCall = (id: string) => rt<Call>('GET', `/v2/get-call/${id}`);

/** Every call for one agent between two times (ms since 1970). */
export async function callsBetween(agentId: string, from: number, to: number) {
  const out: Call[] = [];
  let key: string | undefined;
  for (let page = 0; page < 50; page++) {
    const r: any = await rt('POST', '/v3/list-calls', {
      limit: 1000, sort_order: 'descending', ...(key ? { pagination_key: key } : {}),
      filter_criteria: { agent: [{ agent_id: agentId }], start_timestamp: { type: 'range', op: 'bt', value: [from, to - 1] } },
    });
    out.push(...callItems(r).filter((c) => !c.start_timestamp || (c.start_timestamp >= from && c.start_timestamp < to)));
    if (!r.has_more || !r.pagination_key) break;
    key = r.pagination_key;
  }
  return out;
}
