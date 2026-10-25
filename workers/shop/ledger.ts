import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOP_DIR } from './design';

/** A record of everything the agents have published, used for the daily limit and reports. */
export interface Published { at: string; channel: 'etsy' | 'printify'; kind: string; title: string; url: string; design_id: string; state: string; price: number }
const FILE = join(SHOP_DIR, 'published.json');

export function readLedger(): Published[] {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
}
export function record(p: Published) {
  mkdirSync(SHOP_DIR, { recursive: true });
  const all = readLedger();
  all.push(p);
  writeFileSync(FILE, JSON.stringify(all, null, 2));
}
export function publishedToday() {
  const today = new Date().toDateString();
  return readLedger().filter((p) => p.state !== 'draft' && new Date(p.at).toDateString() === today).length;
}
export const dailyLimit = () => Math.max(0, Number(process.env.SHOP_DAILY_LIMIT ?? 5));
export const autoPublish = () => (process.env.SHOP_AUTO_PUBLISH ?? 'true').toLowerCase() !== 'false';
