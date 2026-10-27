import { createWriteStream, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { callsBetween, type Call } from '../voice/retell';

/**
 * The monthly report each client gets: calls, answered rate, leads and jobs booked, estimated revenue.
 * Numbers come from Retell's call logs and the questions Retell answers after every call
 * (lead_captured, job_booked, is_spam, call_reason; see ANALYSIS_FIELDS in voice/retell.ts).
 */
export const REPORTS_DIR = resolve('output', 'reports');

export interface Client { id: number; business_name: string; contact_name?: string | null; retell_agent_id?: string | null; phone_number?: string | null; avg_job_value?: number | null; monthly_fee?: number | null }

const yes = (v: unknown) => v === true || v === 'true' || v === 'yes';
const ANSWERED_FAIL = /dial_no_answer|dial_busy|dial_failed|error|registered_call_timeout|scam_detected|concurrency_limit|no_valid_payment|invalid_destination|telephony_provider/i;

export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(y, m - 1, 1).getTime(), to = new Date(y, m, 1).getTime();
  return { from, to, label: new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }) };
}

export function stats(calls: Call[], avgJob: number | null | undefined) {
  const inbound = calls.filter((c) => c.direction !== 'outbound');
  const answered = inbound.filter((c) => (c.duration_ms ?? 0) > 0 && !ANSWERED_FAIL.test(c.disconnection_reason ?? ''));
  const data = (c: Call) => c.call_analysis?.custom_analysis_data ?? {};
  const real = answered.filter((c) => !yes(data(c).is_spam));
  const leads = real.filter((c) => yes(data(c).lead_captured) || yes(data(c).job_booked));
  const booked = real.filter((c) => yes(data(c).job_booked));
  const afterHours = real.filter((c) => { if (!c.start_timestamp) return false; const d = new Date(c.start_timestamp); const h = d.getHours(); return d.getDay() === 0 || d.getDay() === 6 || h < 8 || h >= 17; });
  const minutes = answered.reduce((s, c) => s + (c.duration_ms ?? 0), 0) / 60000;
  const reasons = new Map<string, number>();
  for (const c of real) { const r = String(data(c).call_reason ?? '').trim().toLowerCase(); if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1); }
  return {
    calls: inbound.length, answered: answered.length, answered_rate: inbound.length ? answered.length / inbound.length : 0,
    spam: answered.length - real.length, leads: leads.length, jobs_booked: booked.length, after_hours: afterHours.length,
    minutes: Math.round(minutes), est_revenue: avgJob ? booked.length * avgJob : null,
    top_reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    examples: leads.slice(0, 6).map((c) => ({ when: c.start_timestamp ? new Date(c.start_timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '', summary: c.call_analysis?.call_summary ?? '', booked: yes(data(c).job_booked) })),
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export async function makeReport(client: Client, month: string, business = process.env.REPORT_BUSINESS_NAME || 'Your AI receptionist') {
  if (!client.retell_agent_id) throw new Error(`${client.business_name} has no retell_agent_id, so there are no calls to report.`);
  const { from, to, label } = monthRange(month);
  const calls = await callsBetween(client.retell_agent_id, from, to);
  const s = stats(calls, client.avg_job_value);

  mkdirSync(REPORTS_DIR, { recursive: true });
  const slug = client.business_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = join(REPORTS_DIR, `${slug}-${month}.pdf`);
  const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `${client.business_name} – ${label} call report` } });
  const done = new Promise<void>((res, rej) => { const w = createWriteStream(file); w.on('finish', () => res()); w.on('error', rej); doc.pipe(w); });

  const ink = '#1f2a44', soft = '#5b6478', accent = '#2f7d6d', line = '#e3e0d8';
  doc.fillColor(soft).font('Helvetica').fontSize(10).text(business.toUpperCase(), { characterSpacing: 1 });
  doc.moveDown(0.3).fillColor(ink).font('Helvetica-Bold').fontSize(24).text(client.business_name);
  doc.fillColor(soft).font('Helvetica').fontSize(13).text(`Monthly call report · ${label}`);
  doc.moveDown(1.2);

  // Big numbers
  const tiles: [string, string, string][] = [
    ['Calls', String(s.calls), `${s.minutes} minutes talked`],
    ['Answered', pct(s.answered_rate), `${s.answered} of ${s.calls} calls`],
    ['Jobs booked', String(s.jobs_booked), `${s.leads} leads captured`],
    ['Est. revenue', s.est_revenue === null ? '—' : money(s.est_revenue), s.est_revenue === null ? 'add an average job value' : `at ${money(client.avg_job_value!)} a job`],
  ];
  const top = doc.y, w = (doc.page.width - 108 - 30) / 4;
  tiles.forEach(([k, v, sub], i) => {
    const x = 54 + i * (w + 10);
    doc.roundedRect(x, top, w, 86, 6).fillAndStroke('#f7f5f0', line);
    doc.fillColor(soft).font('Helvetica').fontSize(9).text(k.toUpperCase(), x + 10, top + 10, { width: w - 20, characterSpacing: 0.5 });
    doc.fillColor(i === 3 ? accent : ink).font('Helvetica-Bold').fontSize(22).text(v, x + 10, top + 28, { width: w - 20 });
    doc.fillColor(soft).font('Helvetica').fontSize(8.5).text(sub, x + 10, top + 62, { width: w - 20 });
  });
  doc.x = 54; doc.y = top + 110;

  const heading = (t: string) => { doc.moveDown(0.6).fillColor(ink).font('Helvetica-Bold').fontSize(13).text(t, 54); doc.moveDown(0.3); };
  heading('What happened');
  doc.fillColor(ink).font('Helvetica').fontSize(11);
  const bullets = [
    `${s.after_hours} of the ${s.calls} calls came in after hours or on a weekend, when nobody would normally pick up.`,
    `${s.leads} callers left their details or booked${s.jobs_booked ? `, and ${s.jobs_booked} booked a job` : ''}.`,
    ...(s.spam ? [`${s.spam === 1 ? '1 spam or sales call was' : `${s.spam} spam or sales calls were`} screened out and not counted as leads.`] : []),
  ];
  for (const b of bullets) doc.text(`•  ${b}`, { indent: 0, paragraphGap: 4 });

  if (s.top_reasons.length) {
    heading('Why people called');
    doc.font('Helvetica').fontSize(11).fillColor(ink);
    for (const [r, n] of s.top_reasons) doc.text(`•  ${r[0].toUpperCase() + r.slice(1)} (${n})`, { paragraphGap: 3 });
  }
  if (s.examples.length) {
    heading('Recent leads');
    for (const e of s.examples) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(e.booked ? accent : ink).text(`${e.when}${e.booked ? ' · booked' : ''}`);
      doc.font('Helvetica').fontSize(10).fillColor(soft).text(e.summary || '(no summary)', { paragraphGap: 6 });
    }
  }
  doc.moveDown(1).font('Helvetica').fontSize(8.5).fillColor(soft).text(
    'Estimated revenue = jobs booked × your average job value. Counts come from an automatic review of each call and may miss or over-count a few.', 54);
  doc.end();
  await done;
  return { file, month: label, ...s };
}
