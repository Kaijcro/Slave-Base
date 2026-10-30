import { store } from './store';
import { COMPANIES, loadFinance, totals, type Entry, type FinanceData } from '../data/finance';

/**
 * The Finances panel: opens over the map when you click the vault in Town Hall.
 * Spending (invested) is negative in the sheet, income positive.
 */
const INVESTED = '#e46a52', INCOME = '#2fa98a'; // checked for colorblind separation on the panel color

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = (n: number, sign = false) => `${sign && n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (iso?: string | null) => {
  if (!iso) return 'not synced yet';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString();
};
const shortDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function mountFinance() {
  const wrap = document.querySelector('.mapwrap') as HTMLElement;
  const el = document.createElement('section');
  el.className = 'finpanel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Finances');
  el.hidden = true;
  wrap.appendChild(el);

  let data: FinanceData | null = null;
  let filter = 'All';
  let showAll = false;
  let timer: number | undefined;

  const refresh = async () => {
    try { data = await loadFinance(); } catch (e) { data = { state: 'error', message: (e as Error).message, entries: [] }; }
    render();
  };

  function render() {
    if (!data) { el.innerHTML = head('') + '<p class="fin-note">Loading…</p>'; return; }
    if (data.state !== 'ok') { el.innerHTML = head('') + `<p class="fin-note">${message(data)}</p>`; return; }
    const companies = [...COMPANIES, ...(data.entries.some((e) => !(COMPANIES as readonly string[]).includes(e.company)) ? ['Other'] : [])];
    const of = (c: string) => data!.entries.filter((e) => (c === 'Other' ? !(COMPANIES as readonly string[]).includes(e.company) : e.company === c));
    const all = totals(data.entries);
    const per = companies.map((c) => ({ c, t: totals(of(c)) }));
    const maxBar = Math.max(1, ...per.map((p) => Math.max(p.t.invested, p.t.income)));
    const rows = filter === 'All' ? data.entries : of(filter);

    el.innerHTML = `
      ${head(`From your Finances sheet · updated ${ago(data.syncedAt)}${data.demo ? ' · sample numbers' : ''}`)}
      ${data.problems?.length ? `<p class="fin-warn">Some sheet rows were skipped: ${data.problems.slice(0, 4).map((p) => `row ${p.row} (${esc(p.issue)})`).join(', ')}${data.problems.length > 4 ? ` and ${data.problems.length - 4} more` : ''}.</p>` : ''}
      <div class="fin-kpis">
        ${kpi('Total invested', usd(all.invested), 'money spent across all businesses', INVESTED)}
        ${kpi('Total income', usd(all.income), 'money earned', INCOME)}
        ${kpi('Net', usd(all.net, true), all.net >= 0 ? 'ahead overall' : 'still in the build phase', null)}
        ${kpi('Entries', String(all.count), 'rows in the sheet', null)}
      </div>
      <div class="fin-legend"><span><i style="background:${INVESTED}"></i>Invested</span><span><i style="background:${INCOME}"></i>Income</span></div>
      <div class="fin-biz">
        ${per.map(({ c, t }) => `
          <button type="button" class="fin-card${filter === c ? ' on' : ''}" data-c="${esc(c)}" title="Show ${esc(c)} entries">
            <h4>${esc(c)}</h4>
            <div class="fin-bar" title="Invested ${usd(t.invested)}"><span style="width:${(t.invested / maxBar) * 100}%;background:${INVESTED}"></span><b>${usd(t.invested)}</b><small>invested</small></div>
            <div class="fin-bar" title="Income ${usd(t.income)}"><span style="width:${(t.income / maxBar) * 100}%;background:${INCOME}"></span><b>${usd(t.income)}</b><small>income</small></div>
            <p class="fin-net">Net <b class="${t.net < 0 ? 'neg' : 'pos'}">${usd(t.net, true)}</b> · ${t.count} ${t.count === 1 ? 'entry' : 'entries'}</p>
          </button>`).join('')}
      </div>
      <div class="fin-tx">
        <div class="fin-tx-head">
          <h4>${filter === 'All' ? 'All entries' : esc(filter)}</h4>
          <div class="fin-tabs">${['All', ...companies].map((c) => `<button type="button" data-f="${esc(c)}" class="${filter === c ? 'on' : ''}">${esc(c === 'SupperClubPrints (Etsy)' ? 'Etsy' : c === 'Porchlight Front Desk' ? 'Porchlight' : c === 'Refuge Properties' ? 'Refuge' : c === 'Goose Pop Shop' ? 'Goose Pop' : c)}</button>`).join('')}</div>
        </div>
        ${rows.length ? `<table><thead><tr><th>Date</th><th>Description</th><th>Company</th><th class="num">Amount</th></tr></thead><tbody>
          ${(showAll ? rows : rows.slice(0, 25)).map((e: Entry) => `<tr><td>${shortDate(e.date)}</td><td>${esc(e.description)}</td><td>${esc(e.company)}</td><td class="num ${e.amount < 0 ? 'neg' : 'pos'}">${usd(e.amount, true)}</td></tr>`).join('')}
        </tbody></table>${rows.length > 25 && !showAll ? `<button type="button" class="fin-more">Show all ${rows.length}</button>` : ''}`
        : '<p class="fin-note">No entries yet. Add rows to the Finances sheet and they show up here within a few minutes.</p>'}
      </div>`;
  }

  function head(sub: string) {
    const url = data?.sheetUrl;
    return `<header class="fin-head"><div><h3>Finances</h3>${sub ? `<p>${sub}</p>` : ''}</div>
      <div class="fin-actions">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Open sheet ↗</a>` : ''}<button type="button" class="fin-close" aria-label="Close">✕</button></div></header>`;
  }
  const kpi = (label: string, value: string, note: string, color: string | null) =>
    `<div class="fin-kpi">${color ? `<i style="background:${color}"></i>` : ''}<span>${label}</span><b>${value}</b><small>${note}</small></div>`;
  function message(d: FinanceData) {
    if (d.state === 'signin') return 'Sign in (in the Agent monitor under the map) to see your finances.';
    if (d.state === 'not-owner') return 'Only the town’s owner can see finances.';
    if (d.state === 'setup') return 'Finances aren’t set up yet: run supabase/finance.sql in Supabase, then restart the town runner.';
    return `Couldn’t load finances: ${esc(d.message ?? 'unknown error')}`;
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.fin-close')) return store.openPanel(null);
    const f = t.closest<HTMLElement>('[data-f]')?.dataset.f ?? t.closest<HTMLElement>('[data-c]')?.dataset.c;
    if (f) { filter = filter === f && f !== 'All' ? 'All' : f; showAll = false; render(); return; }
    if (t.closest('.fin-more')) { showAll = true; render(); }
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && store.panel) { e.stopImmediatePropagation(); store.openPanel(null); } }, true);

  store.listeners.add(() => {
    const open = store.panel === 'finance' && store.inside === 'hall';
    if (store.panel && store.inside !== 'hall') store.panel = null;
    if (open === !el.hidden) return;
    el.hidden = !open;
    document.body.classList.toggle('panel-open', open);
    if (open) { data = null; render(); void refresh(); timer = window.setInterval(refresh, 60_000); }
    else window.clearInterval(timer);
  });
}
