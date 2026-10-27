import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Google sign-in for Drive and Sheets.
 * .env: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (an OAuth client of type "Desktop app"). Then run `npm run google-login` once.
 *
 * Scope is drive.file: Slave Base can only see and change files it created itself, nothing else in your Drive.
 */
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const TOKEN_FILE = resolve('.google-token.json');

interface Token { access_token: string; refresh_token: string; expires_at: number }

export function googleKeys() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim(), secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  return { id, secret };
}
export const googleReady = () => !!googleKeys() && existsSync(TOKEN_FILE);

export const saveToken = (t: Token) => writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));

async function accessToken() {
  const k = googleKeys();
  if (!k) throw new Error('Google isn’t set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.');
  if (!existsSync(TOKEN_FILE)) throw new Error('Not signed in to Google. Run `npm run google-login` once.');
  const t = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as Token;
  if (Date.now() < t.expires_at - 60_000) return t.access_token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: k.id, client_secret: k.secret, refresh_token: t.refresh_token }),
  });
  const j = await res.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google sign-in expired (${j.error ?? res.status}). Run \`npm run google-login\` again.`);
  saveToken({ ...t, access_token: j.access_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

/** One Google API call. `body` may be JSON, or a ready-made body with its own content type. */
export async function g<T = any>(method: string, url: string, o: { json?: unknown; body?: BodyInit; type?: string; query?: Record<string, string> } = {}): Promise<T> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(o.query ?? {})) u.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}` };
    let body = o.body;
    if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
    else if (o.type) headers['Content-Type'] = o.type;
    const res = await fetch(u, { method, headers, body });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`Google ${method} ${u.pathname} failed (${res.status}): ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Builds a multipart/related upload body (file details + contents) for Drive. */
export function multipart(meta: Record<string, unknown>, content: Buffer | string, contentType: string) {
  const boundary = 'slavebase' + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), Buffer.isBuffer(content) ? content : Buffer.from(content), Buffer.from(`\r\n--${boundary}--`)]);
  return { body, type: `multipart/related; boundary=${boundary}` };
}
