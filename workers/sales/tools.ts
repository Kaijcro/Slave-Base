import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchPlaces, usedThisMonth, monthlyLimit } from './places';
import { STATUS, NOT_SENDING, createCampaign, getCampaign, listCampaigns, updateCampaign, activateCampaign, pauseCampaign, addLeads, listReplies, sendingAccounts, type Lead } from './instantly';
import { makeReport, REPORTS_DIR, type Client } from './report';
import { ensureAnalysis } from '../voice/retell';
import { VOICE_DIR } from '../voice/tools';

/**
 * Tools for finding and signing receptionist clients: prospect lists (Google Places), cold email (Instantly),
 * clients and their monthly reports.
 *
 * The rule that matters: agents never send email by themselves. They build draft campaigns and add leads;
 * a campaign starts sending only after the owner sends a prompt saying "approve <id>", and only if nothing
 * changed since the owner saw it. Agents can always pause a campaign.
 */
export const SALES_TOOLS = [
  'sales_guide', 'prospects_search', 'prospects_list', 'prospects_update',
  'outreach_campaigns', 'outreach_create_campaign', 'outreach_update_campaign', 'outreach_add_leads',
  'outreach_request_launch', 'outreach_launch', 'outreach_pause', 'outreach_replies',
  'clients_add', 'clients_list', 'clients_update', 'client_report',
].map((n) => `mcp__sales__${n}`);

const SALES_DIR = resolve('.town-sales');
const APPROVALS = join(SALES_DIR, 'approvals');

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: `Didn't work: ${msg}` }], isError: true });
const safe = <A,>(fn: (a: A) => Promise<ReturnType<typeof ok>>) => async (a: A) => { try { return await fn(a); } catch (e) { return fail((e as Error).message); } };
const tableHint = (m: string) => (/relation|does not exist|schema cache/i.test(m) ? `${m}. The owner needs to run supabase/sales.sql in Supabase once.` : m);

const PROSPECT_STATUS = ['new', 'queued', 'emailed', 'replied', 'interested', 'demo_sent', 'won', 'lost', 'do_not_contact'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function demoNumber(agentId?: string | null) {
  if (!agentId) return null;
  try {
    const demos = JSON.parse(readFileSync(join(VOICE_DIR, 'demos.json'), 'utf8')) as { agent_id: string; number?: string }[];
    return demos.find((d) => d.agent_id === agentId)?.number ?? null;
  } catch { return null; }
}

/** Everything the owner approves: the emails, who sends them, the daily limit and the exact lead list. */
async function snapshot(db: SupabaseClient, campaignId: string) {
  const c = await getCampaign(campaignId);
  const { data, error } = await db.from('prospects').select('email').eq('campaign_id', campaignId);
  if (error) throw new Error(tableHint(error.message));
  const steps = (c.sequences?.[0]?.steps ?? []).map((s) => ({ delay: s.delay, unit: s.delay_unit ?? 'days', variants: s.variants.filter((v) => !v.v_disabled).map((v) => ({ subject: v.subject, body: v.body })) }));
  const leads = (data ?? []).map((r) => String(r.email).toLowerCase()).sort();
  const content = { name: c.name, steps, email_list: [...(c.email_list ?? [])].sort(), daily_limit: c.daily_limit ?? null, leads };
  return { campaign: c, content, hash: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
}

export function salesServer(ctx: { db: SupabaseClient; taskPrompt: string; fromAgent: string | null | undefined; agentId: string }) {
  const db = ctx.db;
  const ownerApproved = (id: string) => !ctx.fromAgent && new RegExp(`\\bapprove\\s+${id}\\b`, 'i').test(ctx.taskPrompt);

  return createSdkMcpServer({
    name: 'sales',
    version: '1.0.0',
    tools: [
      tool('sales_guide', 'Read this first: how prospecting, cold email, clients and reports work, and the rules.', {}, safe(async () => ok([
        'RECEPTIONIST SALES TOOLS',
        '',
        'FIND PROSPECTS',
        '- prospects_search with a business type and area (e.g. "plumber", "Stuart, FL"). Saves new businesses to the prospects table and skips ones we already have.',
        `- Each search uses 1 to 3 Google requests; the monthly cap keeps us inside Google’s free amount (${usedThisMonth()}/${monthlyLimit()} used this month). Search specific towns, not whole states.`,
        '- Google doesn’t give emails. For each prospect worth contacting, WebFetch their website (contact/about pages) to find a business email and the owner’s name, then prospects_update. Never guess an email address.',
        '- Good prospects: owner-run trades (HVAC, plumbing, garage doors, roofing, electrical) with a website, 10+ reviews and a 4.0+ rating.',
        '',
        'COLD EMAIL (Instantly)',
        '- outreach_create_campaign makes a DRAFT (nothing sends). Plain text, short, one clear ask. 2 to 4 steps, 2 to 4 days apart.',
        '- Variables: {{firstName}}, {{companyName}}, {{personalization}} (your one line per lead), {{demo_number}} (their demo line, if one was built).',
        '- Every email must be honest: no fake "Re:" subjects, no pretending you know them, a real sender. Instantly adds the unsubscribe header.',
        '- outreach_add_leads adds prospects that have an email (only to draft or paused campaigns).',
        '- outreach_request_launch shows the owner exactly what will send and returns an approval id. Tell the owner the id.',
        '- Only when the owner’s own prompt says "approve <id>", call outreach_launch with it. If anything changed since, it refuses; request again.',
        '- outreach_pause is always allowed. outreach_replies reads replies; update each prospect’s status (replied, interested, do_not_contact for anyone who says stop).',
        '- Never send or reply to emails yourself. Draft replies for the owner in your result instead.',
        '',
        'CLIENTS AND REPORTS',
        '- clients_add when the owner says a business signed up (with their Retell agent id and average job value).',
        '- client_report makes the monthly PDF (calls, answered rate, jobs booked, estimated revenue) in output/reports.',
      ].join('\n')))),

      /* ---------------- prospects ---------------- */
      tool('prospects_search', 'Find local businesses on Google (e.g. plumbers in Stuart, FL) and save new ones as prospects. Returns the new ones.',
        {
          business_type: z.string().min(3).max(60).describe('e.g. "plumber", "HVAC contractor", "garage door repair"'),
          area: z.string().min(3).max(80).describe('A town or county and state, e.g. "Stuart, FL"'),
          limit: z.number().int().min(1).max(60).default(40).describe('Google returns 60 at most'),
          min_reviews: z.number().int().min(0).default(0),
        },
        safe(async (a) => {
          const search = `${a.business_type} in ${a.area}`;
          const r = await searchPlaces(search, a.limit);
          const rows = r.places.filter((p) => (p.reviews ?? 0) >= a.min_reviews).map((p) => ({
            name: p.name, category: p.category, search, address: p.address, city: p.city, state: p.state, phone: p.phone,
            website: p.website, rating: p.rating, reviews: p.reviews, source: p.source, source_id: p.source_id,
          }));
          if (!rows.length) return ok({ search, found: 0, google_requests: r.requests, used_this_month: `${r.used}/${r.limit}` });
          const { data, error } = await db.from('prospects').upsert(rows, { onConflict: 'source_id', ignoreDuplicates: true }).select('id, name, phone, website, rating, reviews');
          if (error) throw new Error(tableHint(error.message));
          return ok({
            search, found: rows.length, new: data?.length ?? 0, already_had: rows.length - (data?.length ?? 0),
            google_requests: r.requests, used_this_month: `${r.used}/${r.limit}`,
            without_website: (data ?? []).filter((p) => !p.website).length,
            new_prospects: data,
          });
        })),

      tool('prospects_list', 'List saved prospects, filtered by status, search text, or whether they still need an email.',
        {
          status: z.enum(PROSPECT_STATUS).optional(),
          text: z.string().optional().describe('Matches name, city or category'),
          needs_email: z.boolean().optional().describe('true = only ones with a website but no email yet'),
          limit: z.number().int().min(1).max(200).default(50),
        },
        safe(async (a) => {
          let q = db.from('prospects').select('id, name, contact_name, category, city, state, phone, website, email, rating, reviews, status, demo_agent_id, campaign_id, notes').order('id', { ascending: false }).limit(a.limit);
          if (a.status) q = q.eq('status', a.status);
          if (a.text) { const t = a.text.replace(/[,()%]/g, ' '); q = q.or(`name.ilike.%${t}%,city.ilike.%${t}%,category.ilike.%${t}%`); }
          if (a.needs_email) q = q.is('email', null).not('website', 'is', null);
          const { data, error } = await q;
          if (error) throw new Error(tableHint(error.message));
          return ok(data);
        })),

      tool('prospects_update', 'Save what you learned about a prospect: email or owner name from their website, status, demo, notes.',
        {
          id: z.number().int(),
          email: z.string().regex(EMAIL_RE).optional().describe('Only an address you actually saw on their site'),
          contact_name: z.string().max(80).optional(),
          status: z.enum(PROSPECT_STATUS).optional(),
          demo_agent_id: z.string().optional(),
          notes: z.string().max(2000).optional().describe('Replaces the notes; include anything worth keeping'),
        },
        safe(async (a) => {
          const { id, ...fields } = a;
          const { data, error } = await db.from('prospects').update({ ...fields, ...(fields.email ? { email: fields.email.toLowerCase() } : {}), updated_at: new Date().toISOString() }).eq('id', id).select('id, name, email, contact_name, status').maybeSingle();
          if (error) throw new Error(tableHint(error.message));
          if (!data) return fail(`there’s no prospect ${id}.`);
          return ok(data);
        })),

      /* ---------------- cold email ---------------- */
      tool('outreach_campaigns', 'List the Instantly campaigns and whether each is sending.', {},
        safe(async () => ok((await listCampaigns()).map((c) => ({ campaign_id: c.id, name: c.name, status: STATUS[c.status] ?? String(c.status) }))))),

      tool('outreach_create_campaign', 'Create a DRAFT cold email campaign in Instantly. Nothing sends until the owner approves it.',
        {
          name: z.string().min(3).max(100),
          steps: z.array(z.object({
            subject: z.string().min(2).max(120),
            body: z.string().min(40).max(3000).describe('Plain text. Use {{firstName}}, {{companyName}}, {{personalization}}, {{demo_number}}.'),
            delay_days: z.number().int().min(0).max(14).describe('Days after the previous step (0 for the first)'),
          })).min(1).max(4),
          daily_limit: z.number().int().min(5).max(200).default(30).describe('Most new emails a day; keep low for new inboxes'),
        },
        safe(async (a) => {
          const steps = a.steps.map((s, i) => ({ ...s, delay_days: i === 0 ? 0 : Math.max(1, s.delay_days), body: s.body.replace(/\r?\n/g, '<br>') }));
          const c = await createCampaign({ name: a.name, steps, dailyLimit: a.daily_limit });
          const accounts = c.email_list ?? [];
          return ok({
            campaign_id: c.id, name: c.name, status: STATUS[c.status] ?? 'draft', sending_accounts: accounts,
            ...(accounts.length ? {} : { warning: 'No sending email accounts are connected in Instantly yet. The owner must connect one before it can be launched.' }),
            next: 'Add leads with outreach_add_leads, then outreach_request_launch.',
          });
        })),

      tool('outreach_update_campaign', 'Change a draft or paused campaign’s emails, name or daily limit.',
        {
          campaign_id: z.string().min(5),
          name: z.string().min(3).max(100).optional(),
          steps: z.array(z.object({ subject: z.string().min(2).max(120), body: z.string().min(40).max(3000), delay_days: z.number().int().min(0).max(14) })).min(1).max(4).optional(),
          daily_limit: z.number().int().min(5).max(200).optional(),
        },
        safe(async (a) => {
          const c = await getCampaign(a.campaign_id);
          if (!NOT_SENDING.has(c.status)) return fail(`this campaign is ${STATUS[c.status] ?? c.status}. Pause it first with outreach_pause.`);
          await updateCampaign(a.campaign_id, {
            ...(a.name ? { name: a.name } : {}), ...(a.daily_limit ? { daily_limit: a.daily_limit } : {}),
            ...(a.steps ? { sequences: [{ steps: a.steps.map((s, i) => ({ type: 'email', delay: i === 0 ? 0 : Math.max(1, s.delay_days), delay_unit: 'days', variants: [{ subject: s.subject, body: s.body.replace(/\r?\n/g, '<br>') }] })) }] } : {}),
          });
          return ok({ updated: a.campaign_id, note: 'Any earlier approval for this campaign no longer matches; request a new one.' });
        })),

      tool('outreach_add_leads', 'Add prospects (that have an email) to a draft or paused campaign. Optionally give each a one-line {{personalization}}.',
        {
          campaign_id: z.string().min(5),
          prospect_ids: z.array(z.number().int()).min(1).max(200),
          personalization: z.record(z.string(), z.string().max(300)).default({}).describe('prospect id → one line about them, e.g. "Saw you’re the only 24/7 plumber in Palm City."'),
        },
        safe(async (a) => {
          const c = await getCampaign(a.campaign_id);
          if (!NOT_SENDING.has(c.status)) return fail(`this campaign is ${STATUS[c.status] ?? c.status}, so new leads would be emailed without approval. Pause it first, or use a new draft.`);
          const { data, error } = await db.from('prospects').select('id, name, contact_name, email, website, phone, status, campaign_id, demo_agent_id').in('id', a.prospect_ids);
          if (error) throw new Error(tableHint(error.message));
          const skipped: string[] = [], leads: Lead[] = [], ids: number[] = [];
          for (const p of data ?? []) {
            if (!p.email || !EMAIL_RE.test(p.email)) { skipped.push(`${p.name}: no email`); continue; }
            if (['do_not_contact', 'won', 'lost'].includes(p.status)) { skipped.push(`${p.name}: status ${p.status}`); continue; }
            if (p.campaign_id && p.campaign_id !== a.campaign_id) { skipped.push(`${p.name}: already in another campaign`); continue; }
            const first = (p.contact_name ?? '').trim().split(/\s+/)[0] || undefined;
            const num = demoNumber(p.demo_agent_id);
            leads.push({
              email: p.email.toLowerCase(), first_name: first, company_name: p.name, website: p.website ?? undefined, phone: p.phone ?? undefined,
              personalization: a.personalization[String(p.id)] ?? undefined,
              ...(num ? { custom_variables: { demo_number: num } } : {}),
            });
            ids.push(p.id);
          }
          const missing = a.prospect_ids.filter((id) => !(data ?? []).some((p) => p.id === id));
          if (!leads.length) return fail(`no prospects could be added. ${[...skipped, ...missing.map((m) => `${m}: not found`)].join('; ')}`);
          const r = await addLeads(a.campaign_id, leads);
          const { error: e2 } = await db.from('prospects').update({ campaign_id: a.campaign_id, status: 'queued', updated_at: new Date().toISOString() }).in('id', ids);
          if (e2) throw new Error(tableHint(e2.message));
          return ok({ added: r.leads_uploaded, duplicates: r.duplicated_leads, skipped_by_instantly: r.skipped_count, invalid_emails: r.invalid_email_count, blocklisted: r.in_blocklist, skipped, not_found: missing });
        })),

      tool('outreach_request_launch', 'Ask the owner to approve a campaign. Saves exactly what will send and returns an approval id for the owner.',
        { campaign_id: z.string().min(5) },
        safe(async (a) => {
          const s = await snapshot(db, a.campaign_id);
          if (!NOT_SENDING.has(s.campaign.status)) return fail(`this campaign is already ${STATUS[s.campaign.status] ?? s.campaign.status}.`);
          if (!s.content.steps.length) return fail('the campaign has no emails.');
          if (!s.content.leads.length) return fail('the campaign has no leads yet. Use outreach_add_leads first.');
          if (!s.content.email_list.length && !(await sendingAccounts()).length) return fail('no sending email account is connected in Instantly. The owner must connect one first.');
          const id = randomBytes(3).toString('hex');
          mkdirSync(APPROVALS, { recursive: true });
          writeFileSync(join(APPROVALS, `${id}.json`), JSON.stringify({ id, kind: 'launch_campaign', campaign_id: a.campaign_id, hash: s.hash, content: s.content, by: ctx.agentId, created: new Date().toISOString(), status: 'waiting' }, null, 2));
          return ok({
            approval_id: id, campaign: s.content.name, leads: s.content.leads.length, sends_from: s.content.email_list, daily_limit: s.content.daily_limit,
            emails: s.content.steps.map((st, i) => ({ step: i + 1, wait_days: st.delay, subject: st.variants[0]?.subject, body: st.variants[0]?.body.replace(/<br\s*\/?>/g, '\n') })),
            tell_the_owner: `Show the owner the emails above and the lead count. Nothing has been sent. To start sending, the owner sends a prompt saying "approve ${id}".`,
          });
        })),

      tool('outreach_launch', 'Start sending an approved campaign. Works only when the owner’s own prompt says "approve <approval id>" and nothing changed since.',
        { approval_id: z.string().regex(/^[0-9a-f]{6}$/) },
        safe(async (a) => {
          const file = join(APPROVALS, `${a.approval_id}.json`);
          if (!existsSync(file)) return fail(`there’s no approval request ${a.approval_id}.`);
          if (ctx.fromAgent) return fail('only the owner can approve sending, and this task came from a teammate.');
          if (!ownerApproved(a.approval_id)) return fail(`the owner hasn’t approved ${a.approval_id}. Tell them: send a prompt saying "approve ${a.approval_id}".`);
          const ap = JSON.parse(readFileSync(file, 'utf8'));
          if (ap.status === 'launched') return ok(`Already launched (${ap.launched}).`);
          const now = await snapshot(db, ap.campaign_id);
          if (now.hash !== ap.hash) return fail('the campaign changed after the owner was asked (emails, sender, limit or leads). Nothing was sent. Use outreach_request_launch again and show the owner the new version.');
          await activateCampaign(ap.campaign_id);
          ap.status = 'launched'; ap.launched = new Date().toISOString();
          writeFileSync(file, JSON.stringify(ap, null, 2));
          await db.from('prospects').update({ status: 'emailed', updated_at: ap.launched }).eq('campaign_id', ap.campaign_id).eq('status', 'queued');
          return ok({ launched: ap.campaign_id, campaign: ap.content.name, leads: ap.content.leads.length, note: 'Instantly sends on weekdays within the sending hours, up to the daily limit.' });
        })),

      tool('outreach_pause', 'Pause a campaign (stops sending). Always allowed.', { campaign_id: z.string().min(5) },
        safe(async (a) => { await pauseCampaign(a.campaign_id); return ok({ paused: a.campaign_id }); })),

      tool('outreach_replies', 'Read replies from prospects. Marks matching prospects as "replied". Never answer them yourself; draft replies for the owner.',
        { campaign_id: z.string().optional(), unread_only: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(30) },
        safe(async (a) => {
          const replies = await listReplies({ campaignId: a.campaign_id, limit: a.limit, unreadOnly: a.unread_only });
          const out = [];
          for (const e of replies) {
            const from = (e.from_address_email ?? '').toLowerCase();
            const { data } = await db.from('prospects').select('id, name, status').eq('email', from).maybeSingle();
            if (data && ['queued', 'emailed'].includes(data.status)) await db.from('prospects').update({ status: 'replied', updated_at: new Date().toISOString() }).eq('id', data.id);
            const text = (e.body?.text ?? e.content_preview ?? (e.body?.html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\n>.*$/s, '').trim();
            out.push({ from, prospect: data ? { id: data.id, name: data.name } : null, when: e.timestamp_email ?? e.timestamp_created, subject: e.subject, text: text.slice(0, 2000), interest: e.ai_interest_value ?? null });
          }
          return ok(out);
        })),

      /* ---------------- clients ---------------- */
      tool('clients_add', 'Add a paying client (when the owner says they signed). Sets up their receptionist for the monthly report.',
        {
          business_name: z.string().min(2).max(100),
          contact_name: z.string().max(80).optional(), email: z.string().regex(EMAIL_RE).optional(), phone: z.string().max(30).optional(),
          retell_agent_id: z.string().optional().describe('Their receptionist in Retell'), phone_number: z.string().max(30).optional(),
          monthly_fee: z.number().min(0).optional(), avg_job_value: z.number().min(0).optional().describe('Their average job, for estimated revenue'),
          start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), status: z.enum(['trial', 'active']).default('active'),
          prospect_id: z.number().int().optional(),
        },
        safe(async (a) => {
          const { data, error } = await db.from('clients').insert(a).select('*').single();
          if (error) throw new Error(tableHint(error.message));
          if (a.prospect_id) await db.from('prospects').update({ status: 'won', updated_at: new Date().toISOString() }).eq('id', a.prospect_id);
          let added: string[] = [];
          if (a.retell_agent_id && process.env.RETELL_API_KEY) added = await ensureAnalysis(a.retell_agent_id);
          return ok({ client: data, ...(added.length ? { report_fields_added_to_receptionist: added } : {}) });
        })),

      tool('clients_list', 'List clients.', { status: z.enum(['trial', 'active', 'paused', 'cancelled']).optional() },
        safe(async (a) => {
          let q = db.from('clients').select('*').order('id');
          if (a.status) q = q.eq('status', a.status);
          const { data, error } = await q;
          if (error) throw new Error(tableHint(error.message));
          return ok(data);
        })),

      tool('clients_update', 'Change a client’s details or status.',
        {
          id: z.number().int(),
          contact_name: z.string().max(80).optional(), email: z.string().regex(EMAIL_RE).optional(), phone: z.string().max(30).optional(),
          retell_agent_id: z.string().optional(), phone_number: z.string().max(30).optional(), monthly_fee: z.number().min(0).optional(),
          avg_job_value: z.number().min(0).optional(), status: z.enum(['trial', 'active', 'paused', 'cancelled']).optional(), notes: z.string().max(2000).optional(),
        },
        safe(async (a) => {
          const { id, ...fields } = a;
          const { data, error } = await db.from('clients').update(fields).eq('id', id).select('*').maybeSingle();
          if (error) throw new Error(tableHint(error.message));
          if (!data) return fail(`there’s no client ${id}.`);
          if (fields.retell_agent_id && process.env.RETELL_API_KEY) await ensureAnalysis(fields.retell_agent_id);
          return ok(data);
        })),

      tool('client_report', 'Make a client’s monthly PDF report (calls, answered rate, jobs booked, estimated revenue). Default: last month.',
        { client_id: z.number().int(), month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM') },
        safe(async (a) => {
          const { data, error } = await db.from('clients').select('*').eq('id', a.client_id).maybeSingle();
          if (error) throw new Error(tableHint(error.message));
          if (!data) return fail(`there’s no client ${a.client_id}.`);
          const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
          const month = a.month ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const r = await makeReport(data as Client, month);
          return ok({ ...r, file: r.file, folder: REPORTS_DIR, note: 'The owner reviews and sends it; you can’t email it.' });
        })),
    ],
  });
}
