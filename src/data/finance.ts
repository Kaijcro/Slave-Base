import { supabase, supabaseConfig } from './client';

/**
 * Finances for the Town Hall vault. The numbers live in the "Finances" Google Sheet in your Slave Base
 * Drive folder; the town runner copies its rows into Supabase (owner-only) every few minutes.
 * Amounts: money spent (invested) is negative, money earned is positive.
 */
export const COMPANIES = ['SupperClubPrints (Etsy)', 'Porchlight Front Desk', 'Refuge Properties', 'Goose Pop Shop'] as const;

export interface Entry { row: number; date: string; amount: number; description: string; company: string }
export interface FinanceData {
  state: 'ok' | 'signin' | 'not-owner' | 'setup' | 'error';
  message?: string;
  entries: Entry[];
  sheetUrl?: string | null;
  syncedAt?: string | null;
  problems?: { row: number; issue: string }[];
  demo?: boolean;
}

export async function loadFinance(): Promise<FinanceData> {
  if (!supabaseConfig() || new URLSearchParams(location.search).has('demo')) return demoFinance();
  const sb = supabase();
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return { state: 'signin', entries: [] };
  const { data: owner } = await sb.rpc('is_town_owner');
  if (!owner) return { state: 'not-owner', entries: [] };
  const [rows, meta] = await Promise.all([
    sb.from('finance_entries').select('row_number, entry_date, amount, description, company').order('entry_date', { ascending: false }).order('row_number', { ascending: false }).limit(5000),
    sb.from('finance_meta').select('sheet_url, synced_at, problems').eq('id', 1).maybeSingle(),
  ]);
  if (rows.error) return { state: /relation|does not exist|schema cache/i.test(rows.error.message) ? 'setup' : 'error', message: rows.error.message, entries: [] };
  return {
    state: 'ok',
    entries: (rows.data ?? []).map((r: any) => ({ row: r.row_number, date: r.entry_date, amount: Number(r.amount), description: r.description ?? '', company: r.company ?? 'Other' })),
    sheetUrl: meta.data?.sheet_url ?? null, syncedAt: meta.data?.synced_at ?? null, problems: meta.data?.problems ?? [],
  };
}

function demoFinance(): FinanceData {
  const e: [string, number, string, string][] = [
    ['2026-10-02', -19.99, 'Etsy listing fees (20 listings)', COMPANIES[0]],
    ['2026-10-05', -12, 'Canva Pro', COMPANIES[0]],
    ['2026-10-14', 31.5, 'Etsy payout', COMPANIES[0]],
    ['2026-10-22', 48.75, 'Etsy payout', COMPANIES[0]],
    ['2026-10-26', -10, 'Retell starting credit', COMPANIES[1]],
    ['2026-10-27', -2, 'Demo phone number', COMPANIES[1]],
    ['2026-10-29', -4.2, 'Google image generation', COMPANIES[0]],
    ['2026-09-29', -185, 'Mailers (150 postcards)', COMPANIES[2]],
    ['2026-10-10', -60, 'Skip tracing credits', COMPANIES[2]],
    ['2026-10-01', -240, 'Syrups, cups and ice', COMPANIES[3]],
    ['2026-10-12', 410, 'Weekend pop-up sales', COMPANIES[3]],
    ['2026-10-19', 365, 'Farmers market sales', COMPANIES[3]],
  ];
  return { state: 'ok', demo: true, entries: e.map(([date, amount, description, company], i) => ({ row: i + 2, date, amount, description, company })).sort((a, b) => b.date.localeCompare(a.date)), syncedAt: new Date().toISOString(), problems: [] };
}

export interface Totals { invested: number; income: number; net: number; count: number }
export function totals(entries: Entry[]): Totals {
  let invested = 0, income = 0;
  for (const e of entries) e.amount < 0 ? (invested += -e.amount) : (income += e.amount);
  return { invested, income, net: income - invested, count: entries.length };
}
