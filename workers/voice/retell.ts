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
  });
  return { agent_id: agent.agent_id, llm_id: llm.llm_id };
}

export const getAgent = (id: string) => rt<{ agent_id: string; agent_name?: string; voice_id: string; response_engine: { type: string; llm_id?: string } }>('GET', `/get-agent/${id}`);
export const getLlm = (id: string) => rt<{ llm_id: string; general_prompt?: string; begin_message?: string }>('GET', `/get-retell-llm/${id}`);
export const updateLlm = (id: string, fields: { general_prompt?: string; begin_message?: string }) => rt('PATCH', `/update-retell-llm/${id}`, fields);
export const updateAgent = (id: string, fields: { voice_id?: string; agent_name?: string }) => rt('PATCH', `/update-agent/${id}`, fields);

export interface PhoneNumber { phone_number: string; phone_number_pretty?: string; nickname?: string; inbound_agents?: { agent_id: string; weight: number }[]; inbound_agent_id?: string | null }
export const listNumbers = () => rt<PhoneNumber[]>('GET', '/v2/list-phone-numbers');
export const pointNumber = (num: string, agentId: string) =>
  rt('PATCH', `/update-phone-number/${encodeURIComponent(num)}`, { inbound_agents: [{ agent_id: agentId, weight: 1 }] });

export interface Call {
  call_id: string; agent_id: string; call_status: string; from_number?: string; to_number?: string; direction?: string;
  start_timestamp?: number; duration_ms?: number; transcript?: string; recording_url?: string; disconnection_reason?: string;
  call_analysis?: { call_summary?: string; user_sentiment?: string; call_successful?: boolean; in_voicemail?: boolean };
}
export const listCalls = (o: { agentId?: string; limit: number }) =>
  rt<Call[]>('POST', '/v3/list-calls', {
    limit: o.limit, sort_order: 'descending',
    ...(o.agentId ? { filter_criteria: { agent: [{ agent_id: o.agentId }] } } : {}),
  }).then((r: any) => (Array.isArray(r) ? r : r.calls ?? r.data ?? []) as Call[]);
export const getCall = (id: string) => rt<Call>('GET', `/v2/get-call/${id}`);
