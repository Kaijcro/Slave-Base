import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A small Etsy Open API v3 client for the town runner.
 *
 * Research (searching listings, looking up shops) needs only your app's keys.
 * Publishing to your own shop also needs you to sign in once: `npm run etsy-login`,
 * which saves a token in .etsy-token.json on your Mac (never committed).
 *
 * .env:
 *   ETSY_API_KEY=your app's keystring
 *   ETSY_SHARED_SECRET=your app's shared secret
 */
const API = 'https://api.etsy.com/v3/application';
export const TOKEN_FILE = resolve('.etsy-token.json');
export const REDIRECT_URI = 'http://localhost:3003/oauth/redirect';
export const SCOPES = ['listings_r', 'listings_w', 'shops_r', 'shops_w', 'transactions_r'];

interface Token { access_token: string; refresh_token: string; expires_at: number; user_id: number; shop_id?: number }

export function keys() {
  const key = process.env.ETSY_API_KEY?.trim(), secret = process.env.ETSY_SHARED_SECRET?.trim();
  if (!key || !secret) throw new Error('Etsy isn’t set up yet: add ETSY_API_KEY and ETSY_SHARED_SECRET to .env (see README, "AI Enterprizes Etsy shop").');
  return { key, secret, header: `${key}:${secret}` };
}

export const loadToken = (): Token | null => (existsSync(TOKEN_FILE) ? JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) : null);
export const saveToken = (t: Token) => writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));

async function accessToken(): Promise<Token> {
  const t = loadToken();
  if (!t) throw new Error('Not signed in to Etsy. Run `npm run etsy-login` once.');
  if (Date.now() < t.expires_at - 60_000) return t;
  // Access tokens last an hour; refresh tokens last 90 days.
  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: keys().key, refresh_token: t.refresh_token }),
  });
  if (!res.ok) throw new Error(`Etsy sign-in expired. Run \`npm run etsy-login\` again. (${res.status})`);
  const j = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  const next = { ...t, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000 };
  saveToken(next);
  return next;
}

let lastCall = 0;

/** One API call. `auth` adds your sign-in (needed for anything in your own shop). */
export async function etsy<T = any>(method: string, path: string, opts: { query?: Record<string, unknown>; json?: unknown; form?: FormData; auth?: boolean } = {}): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  const headers: Record<string, string> = { 'x-api-key': keys().header };
  if (opts.auth) headers.Authorization = `Bearer ${(await accessToken()).access_token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
  if (opts.form) body = opts.form;
  for (let attempt = 0; ; attempt++) {
    // Etsy allows about 10 calls a second; stay well under it.
    const wait = lastCall + 120 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(url, { method, headers, body });
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`Etsy ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Your shop's id (looked up once after you sign in). */
export async function myShopId(): Promise<number> {
  const t = await accessToken();
  if (t.shop_id) return t.shop_id;
  const me = await etsy<{ shop_id?: number }>('GET', '/users/me', { auth: true });
  if (!me.shop_id) throw new Error('Your Etsy account doesn’t have a shop yet. Open one at etsy.com/sell first.');
  saveToken({ ...t, shop_id: me.shop_id });
  return me.shop_id;
}

/* ---------------- research ---------------- */
export interface HotShop {
  shop_id: number; shop_name: string; url: string; sales: number; opened: string; months_open: number;
  sales_per_month: number; active_listings: number; digital_listings: number; reviews: number | null; rating: number | null;
  matched_listings: { title: string; price: string; favorites: number; tags: string[]; type: string; url: string }[];
}

const money = (p: { amount: number; divisor: number; currency_code: string } | undefined) => (p ? `${(p.amount / p.divisor).toFixed(2)} ${p.currency_code}` : '');

/**
 * Finds young shops with lots of sales that sell what you searched for.
 * It searches Etsy's active listings for each phrase, then looks up every shop that showed up.
 */
export async function findHotShops(phrases: string[], o: { minSales: number; maxMonths: number; perPhrase: number }): Promise<HotShop[]> {
  const byShop = new Map<number, HotShop['matched_listings']>();
  for (const q of phrases) {
    for (let offset = 0; offset < o.perPhrase; offset += 100) {
      const r = await etsy<{ results: any[] }>('GET', '/listings/active', { query: { keywords: q, limit: Math.min(100, o.perPhrase - offset), offset, sort_on: 'score' } });
      for (const l of r.results ?? []) {
        const arr = byShop.get(l.shop_id) ?? [];
        if (arr.length < 6) arr.push({ title: l.title, price: money(l.price), favorites: l.num_favorers ?? 0, tags: l.tags ?? [], type: l.listing_type ?? '', url: l.url });
        byShop.set(l.shop_id, arr);
      }
      if ((r.results ?? []).length < 100) break;
    }
  }
  const out: HotShop[] = [];
  const now = Date.now() / 1000;
  for (const id of byShop.keys()) {
    try {
      const s = await etsy<any>('GET', `/shops/${id}`);
      const opened = s.create_date ?? s.created_timestamp;
      const months = Math.max(1, (now - opened) / (30.44 * 86400));
      const sales = s.transaction_sold_count ?? 0;
      if (sales < o.minSales || months > o.maxMonths) continue;
      out.push({
        shop_id: id, shop_name: s.shop_name, url: s.url, sales, opened: new Date(opened * 1000).toISOString().slice(0, 10), months_open: Math.round(months),
        sales_per_month: Math.round(sales / months), active_listings: s.listing_active_count ?? 0, digital_listings: s.digital_listing_count ?? 0,
        reviews: s.review_count ?? null, rating: s.review_average ?? null, matched_listings: byShop.get(id)!,
      });
    } catch { /* shop closed or hidden */ }
  }
  return out.sort((a, b) => b.sales_per_month - a.sales_per_month);
}

/** A shop's most-favorited active listings: what's working for them. */
export async function topListings(shopId: number, limit = 25) {
  const r = await etsy<{ results: any[] }>('GET', `/shops/${shopId}/listings/active`, { query: { limit: 100, sort_on: 'created', sort_order: 'desc' } });
  return (r.results ?? [])
    .sort((a, b) => (b.num_favorers ?? 0) - (a.num_favorers ?? 0))
    .slice(0, limit)
    .map((l) => ({ title: l.title, price: money(l.price), favorites: l.num_favorers ?? 0, tags: l.tags ?? [], type: l.listing_type, created: new Date((l.created_timestamp ?? 0) * 1000).toISOString().slice(0, 10), url: l.url }));
}

/** Etsy category ids, searched by name (listings need one). */
let taxonomy: { id: number; name: string; path: string }[] | null = null;
export async function findCategory(query: string) {
  if (!taxonomy) {
    const r = await etsy<{ results: any[] }>('GET', '/seller-taxonomy/nodes');
    const flat: { id: number; name: string; path: string }[] = [];
    const walk = (nodes: any[], path: string[]) => { for (const n of nodes) { const p = [...path, n.name]; flat.push({ id: n.id, name: n.name, path: p.join(' > ') }); walk(n.children ?? [], p); } };
    walk(r.results ?? [], []);
    taxonomy = flat;
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return taxonomy.filter((t) => words.every((w) => t.path.toLowerCase().includes(w))).slice(0, 15);
}

/* ---------------- publishing digital downloads ---------------- */
export async function createDigitalListing(o: {
  title: string; description: string; tags: string[]; price: number; taxonomy_id: number;
  images: { path: string; name: string }[]; files: { path: string; name: string }[]; publish: boolean;
}) {
  const shop = await myShopId();
  const listing = await etsy<{ listing_id: number; url: string }>('POST', `/shops/${shop}/listings`, {
    auth: true,
    json: {
      quantity: 999, title: o.title, description: o.description, price: o.price, tags: o.tags,
      who_made: 'i_did', when_made: '2020_2026', is_supply: false, taxonomy_id: o.taxonomy_id, type: 'download', should_auto_renew: false,
    },
  });
  const id = listing.listing_id;
  for (const [i, img] of o.images.entries()) {
    const f = new FormData();
    f.append('image', new Blob([readFileSync(img.path)], { type: 'image/png' }), img.name);
    f.append('rank', String(i + 1));
    await etsy('POST', `/shops/${shop}/listings/${id}/images`, { auth: true, form: f });
  }
  for (const [i, file] of o.files.entries()) {
    const f = new FormData();
    f.append('file', new Blob([readFileSync(file.path)]), file.name);
    f.append('name', file.name);
    f.append('rank', String(i + 1));
    await etsy('POST', `/shops/${shop}/listings/${id}/files`, { auth: true, form: f });
  }
  if (o.publish) await etsy('PATCH', `/shops/${shop}/listings/${id}`, { auth: true, json: { state: 'active' } });
  return { listing_id: id, url: `https://www.etsy.com/listing/${id}`, state: o.publish ? 'active' : 'draft' };
}

/** How your own listings are doing. */
export async function myListingsReport() {
  const shop = await myShopId();
  const r = await etsy<{ results: any[] }>('GET', `/shops/${shop}/listings`, { auth: true, query: { limit: 100, state: 'active' } });
  const s = await etsy<any>('GET', `/shops/${shop}`);
  return {
    shop: s.shop_name, total_sales: s.transaction_sold_count ?? 0, active_listings: s.listing_active_count ?? 0,
    listings: (r.results ?? []).map((l) => ({ title: l.title, price: money(l.price), views: l.views ?? null, favorites: l.num_favorers ?? 0, type: l.listing_type, url: l.url }))
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0)),
  };
}
