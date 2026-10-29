import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * AI image generation (Google Gemini API) for the shop: illustrations, photo backgrounds and photo mockups.
 * .env: GEMINI_API_KEY (aistudio.google.com/apikey, on a Google Cloud project with billing).
 * Optional: GEMINI_IMAGE_MODEL, IMAGE_DAILY_LIMIT (default 40 images a day; each costs a few cents).
 */
const API = 'https://generativelanguage.googleapis.com/v1beta';
const USAGE_FILE = resolve('output/shop/image-usage.json');
export const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview';

export const imageReady = () => !!process.env.GEMINI_API_KEY?.trim();
export const imageLimit = () => Math.max(0, Number(process.env.IMAGE_DAILY_LIMIT ?? 40));
const today = () => new Date().toISOString().slice(0, 10);
function usage(): Record<string, number> {
  try { return existsSync(USAGE_FILE) ? JSON.parse(readFileSync(USAGE_FILE, 'utf8')) : {}; } catch { return {}; }
}
export const imagesToday = () => usage()[today()] ?? 0;
function countImage() {
  const u = usage();
  u[today()] = (u[today()] ?? 0) + 1;
  mkdirSync(resolve('output/shop'), { recursive: true });
  writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2));
}

function key() {
  const k = process.env.GEMINI_API_KEY?.trim();
  if (!k) throw new Error('Image generation isn’t set up yet: the owner needs to add GEMINI_API_KEY to .env (see README, "AI artwork").');
  return k;
}

async function call(method: string, path: string, body?: unknown) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { 'x-goog-api-key': key(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
    const text = await res.text();
    return { status: res.status, ok: res.ok, json: text ? JSON.parse(text) : {}, text };
  }
}

/** If the configured model doesn't exist (Google renames previews), pick the best image model the key can use. */
let chosen: string | null = null;
async function model() {
  if (chosen) return chosen;
  chosen = process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
  return chosen;
}
async function discover() {
  const r = await call('GET', '/models?pageSize=200');
  const names: string[] = (r.json.models ?? [])
    .filter((m: any) => /image/i.test(m.name) && !/imagen/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m: any) => String(m.name).replace(/^models\//, ''));
  const pick = names.find((n) => /flash/.test(n) && !/lite/.test(n)) ?? names.find((n) => /flash/.test(n)) ?? names[0];
  if (!pick) throw new Error('No image model is available for this Google key. Check that billing is on for the key’s project.');
  chosen = pick;
  return pick;
}

export type Aspect = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9';

/** One image from a text prompt, optionally with reference images (e.g. a design to photograph). */
export async function generateImage(o: { prompt: string; aspect: Aspect; size?: '1K' | '2K'; refs?: { data: Buffer; mime: string }[] }) {
  if (imagesToday() >= imageLimit()) throw new Error(`Today’s image limit (${imageLimit()}) is used up, to keep costs down. It resets tomorrow, or the owner can raise IMAGE_DAILY_LIMIT.`);
  const body = {
    contents: [{ role: 'user', parts: [...(o.refs ?? []).map((r) => ({ inlineData: { mimeType: r.mime, data: r.data.toString('base64') } })), { text: o.prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: o.aspect, imageSize: o.size ?? '2K' } },
  };
  let m = await model();
  let r = await call('POST', `/models/${m}:generateContent`, body);
  if (r.status === 404) { m = await discover(); r = await call('POST', `/models/${m}:generateContent`, body); }
  if (!r.ok) throw new Error(`Google image generation failed (${r.status}): ${r.text.slice(0, 300)}`);
  const parts: any[] = r.json.candidates?.[0]?.content?.parts ?? [];
  const img = parts.filter((p) => !p.thought && (p.inlineData ?? p.inline_data)).pop();
  if (!img) {
    const why = r.json.promptFeedback?.blockReason ?? r.json.candidates?.[0]?.finishReason ?? parts.find((p) => p.text)?.text ?? 'no image returned';
    throw new Error(`No image came back (${String(why).slice(0, 200)}). Rephrase the prompt and try again.`);
  }
  countImage();
  const d = img.inlineData ?? img.inline_data;
  return { data: Buffer.from(d.data, 'base64'), mime: String(d.mimeType ?? d.mime_type ?? 'image/png'), model: m, used_today: imagesToday(), limit: imageLimit() };
}

/** Width and height of a PNG or JPEG. */
export function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}
export const extFor = (mime: string) => (/jpe?g/i.test(mime) ? '.jpg' : /webp/i.test(mime) ? '.webp' : '.png');
export const mimeFor = (file: string) => (/\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png');
