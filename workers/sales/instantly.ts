import 'dotenv/config';

/**
 * A small Instantly (API v2) client for cold email.
 * .env: INSTANTLY_API_KEY (Instantly > Settings > Integrations > API keys; scopes: campaigns:all, leads:all, emails:read, accounts:read)
 *
 * Nothing here sends email by itself. New campaigns are drafts; only activateCampaign starts sending,
 * and the tools only call it after the owner approves (see tools.ts).
 */
const API = 'https://api.instantly.ai/api/v2';

function key() {
  const k = process.env.INSTANTLY_API_KEY?.trim();
  if (!k) throw new Error('Instantly isn’t set up yet: add INSTANTLY_API_KEY to .env (see README, "Prospects and outreach").');
  return k;
}

export async function ins<T = any>(method: string, path: string, o: { body?: unknown; query?: Record<string, unknown> } = {}): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key()}`, ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`Instantly ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

export const STATUS: Record<number, string> = { 0: 'draft', 1: 'active (sending)', 2: 'paused', 3: 'completed', 4: 'running subsequences', [-99]: 'account suspended', [-1]: 'accounts unhealthy', [-2]: 'bounce protect' };
/** Draft and paused campaigns don’t send, so leads and emails may be changed without approval. */
export const NOT_SENDING = new Set([0, 2]);

export interface Step { subject: string; body: string; delay_days: number }
export interface Campaign { id: string; name: string; status: number; sequences?: { steps: { type: string; delay: number; delay_unit?: string; variants: { subject: string; body: string; v_disabled?: boolean }[] }[] }[]; email_list?: string[]; daily_limit?: number | null; campaign_schedule?: unknown; timestamp_updated?: string }

/** Sending accounts: INSTANTLY_SENDING_ACCOUNTS, or every account connected in Instantly. */
export async function sendingAccounts(): Promise<string[]> {
  const env = (process.env.INSTANTLY_SENDING_ACCOUNTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.length) return env;
  const r = await ins<{ items?: { email: string }[] }>('GET', '/accounts', { query: { limit: 100 } });
  return (r.items ?? []).map((a) => a.email);
}

export async function createCampaign(o: { name: string; steps: Step[]; dailyLimit: number }) {
  const tz = process.env.INSTANTLY_TIMEZONE || 'America/Detroit'; // US Eastern in Instantly's list
  const accounts = await sendingAccounts();
  return ins<Campaign>('POST', '/campaigns', {
    body: {
      name: o.name,
      campaign_schedule: {
        schedules: [{
          name: 'Weekdays',
          timing: { from: process.env.INSTANTLY_SEND_FROM || '08:00', to: process.env.INSTANTLY_SEND_TO || '17:00' },
          days: { 0: false, 1: true, 2: true, 3: true, 4: true, 5: true, 6: false }, // 0 = Sunday
          timezone: tz,
        }],
      },
      sequences: [{ steps: o.steps.map((s) => ({ type: 'email', delay: s.delay_days, delay_unit: 'days', variants: [{ subject: s.subject, body: s.body }] })) }],
      ...(accounts.length ? { email_list: accounts } : {}),
      daily_limit: o.dailyLimit,
      stop_on_reply: true,
      insert_unsubscribe_header: true,
      text_only: true,
      link_tracking: false,
      open_tracking: false,
    },
  });
}

export const getCampaign = (id: string) => ins<Campaign>('GET', `/campaigns/${id}`);
export const listCampaigns = () => ins<{ items?: Campaign[] }>('GET', '/campaigns', { query: { limit: 100 } }).then((r) => r.items ?? []);
export const updateCampaign = (id: string, fields: Record<string, unknown>) => ins<Campaign>('PATCH', `/campaigns/${id}`, { body: fields });
export const activateCampaign = (id: string) => ins<Campaign>('POST', `/campaigns/${id}/activate`, { body: {} });
export const pauseCampaign = (id: string) => ins<Campaign>('POST', `/campaigns/${id}/pause`, { body: {} });

export interface Lead { email: string; first_name?: string; last_name?: string; company_name?: string; website?: string; phone?: string; personalization?: string; custom_variables?: Record<string, string | number | boolean | null> }
export const addLeads = (campaignId: string, leads: Lead[]) =>
  ins<{ leads_uploaded: number; duplicated_leads: number; skipped_count: number; invalid_email_count: number; in_blocklist: number; created_leads?: { index: number; id: string; email: string }[] }>(
    'POST', '/leads/add', { body: { campaign_id: campaignId, leads, skip_if_in_workspace: true } });

export interface Email { id: string; from_address_email?: string; to_address_email_list?: string; subject?: string; body?: { text?: string; html?: string }; content_preview?: string; timestamp_email?: string; timestamp_created?: string; ue_type?: number; campaign_id?: string; lead?: string; is_unread?: boolean | number; ai_interest_value?: number }
/** Replies people sent back. */
export async function listReplies(o: { campaignId?: string; limit: number; unreadOnly?: boolean }) {
  const r = await ins<{ items?: Email[] }>('GET', '/emails', {
    query: { campaign_id: o.campaignId, limit: Math.min(100, o.limit), email_type: 'received', ...(o.unreadOnly ? { is_unread: true } : {}) },
  });
  // ue_type 2 = received. Double-check in case the filter is ignored.
  return (r.items ?? []).filter((e) => e.ue_type === undefined || e.ue_type === 2);
}
