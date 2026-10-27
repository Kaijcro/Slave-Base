import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Finds local businesses (plumbers, HVAC, garage doors...) with Google Places Text Search (New).
 * .env: GOOGLE_PLACES_API_KEY (Google Cloud > APIs & Services > Credentials; enable "Places API (New)").
 *
 * Cost: asking for phone and website makes each request an "Enterprise" Text Search. Google gives
 * 1,000 of those free each month (up to 20 businesses each), so the runner stops at
 * GOOGLE_PLACES_MONTHLY_LIMIT (default 900) to stay inside the free amount.
 */
export interface Place {
  name: string; category?: string; address?: string; city?: string; state?: string; phone?: string; website?: string;
  rating?: number; reviews?: number; source: 'google'; source_id: string; closed: boolean;
}

const USAGE_FILE = resolve('.town-places-usage.json');
const month = () => new Date().toISOString().slice(0, 7);
export const monthlyLimit = () => Number(process.env.GOOGLE_PLACES_MONTHLY_LIMIT || 900);
export function usedThisMonth() {
  try { const u = existsSync(USAGE_FILE) ? JSON.parse(readFileSync(USAGE_FILE, 'utf8')) : {}; return Number(u[month()] ?? 0); } catch { return 0; }
}
function countRequest() {
  let u: Record<string, number> = {};
  try { if (existsSync(USAGE_FILE)) u = JSON.parse(readFileSync(USAGE_FILE, 'utf8')); } catch { u = {}; }
  u[month()] = (u[month()] ?? 0) + 1;
  writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2));
}

function key() {
  const k = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!k) throw new Error('Google Places isn’t set up yet: add GOOGLE_PLACES_API_KEY to .env (see README, "Prospects and outreach").');
  return k;
}

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount', 'places.businessStatus', 'places.primaryTypeDisplayName', 'nextPageToken',
].join(',');

const cleanSite = (u?: string) => (u ? u.replace(/[?#].*$/, '').replace(/\/$/, '') : undefined);

/** One search, e.g. "plumber in Stuart, FL". Google returns at most 60 results (3 pages of 20). */
export async function searchPlaces(query: string, limit: number) {
  const k = key();
  const out: Place[] = [];
  let pageToken: string | undefined, requests = 0;
  while (out.length < limit) {
    if (usedThisMonth() >= monthlyLimit()) {
      if (!requests) throw new Error(`This month’s Google Places limit (${monthlyLimit()} searches) is used up, to stay inside Google’s free amount. It resets on the 1st, or the owner can raise GOOGLE_PLACES_MONTHLY_LIMIT.`);
      break;
    }
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': k, 'X-Goog-FieldMask': FIELDS },
      // Same body on every page (Google requires it); only pageToken changes.
      body: JSON.stringify({ textQuery: query, pageSize: 20, regionCode: 'US', languageCode: 'en', includePureServiceAreaBusinesses: true, ...(pageToken ? { pageToken } : {}) }),
    });
    countRequest(); requests++;
    const text = await res.text();
    if (!res.ok) throw new Error(`Google Places failed (${res.status}): ${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    for (const p of j.places ?? []) {
      const comp = (t: string) => (p.addressComponents ?? []).find((c: any) => c.types?.includes(t));
      out.push({
        name: p.displayName?.text ?? '', category: p.primaryTypeDisplayName?.text, address: p.formattedAddress,
        city: comp('locality')?.longText, state: comp('administrative_area_level_1')?.shortText,
        phone: p.nationalPhoneNumber, website: cleanSite(p.websiteUri), rating: p.rating, reviews: p.userRatingCount,
        source: 'google', source_id: p.id, closed: !!p.businessStatus && p.businessStatus !== 'OPERATIONAL',
      });
    }
    pageToken = j.nextPageToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 2000)); // the next-page token takes a moment to become valid
  }
  return { places: out.filter((p) => p.name && !p.closed).slice(0, limit), requests, used: usedThisMonth(), limit: monthlyLimit() };
}
