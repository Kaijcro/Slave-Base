import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { marked } from 'marked';
import { AGENTS } from '../../src/world/agents';
import { client } from '../report';
import { g, multipart } from './google';

/**
 * Copies your agents' work into ONE "Slave Base" folder in your Google Drive, organized by business:
 *
 *   Slave Base/
 *     Etsy shop (SupperClubPrints)/   research, branding, and Designs/ (each design's Canva PDF + a preview)
 *     Porchlight Front Desk/          receptionist work, Prospects and Clients sheets, Client reports/
 *     Refuge Properties/  Goose Pop Shop/  Town Hall/
 *     Agent results/<Agent>/          every finished task, named by date and outcome
 *     Team notes/<Agent>/             each agent's own working files
 *
 *  .md/.html/.txt become Google Docs, .csv Google Sheets, PDFs and previews are copied as they are.
 *  The root folder is tagged, so every run finds the same one; a new one is made only if you delete it.
 */
const OUT = resolve('output');
const STATE_FILE = resolve('.town-drive.json');
const LOCK_FILE = resolve('.town-drive.lock');
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DOC = 'application/vnd.google-apps.document', SHEET = 'application/vnd.google-apps.spreadsheet', FOLDER = 'application/vnd.google-apps.folder';
const LAYOUT = 2;
const TAG = 'root-v2';
const MAX_BYTES = 20 * 1024 * 1024;

export const BUSINESS = {
  etsy: 'Etsy shop (SupperClubPrints)',
  porchlight: 'Porchlight Front Desk',
  refuge: 'Refuge Properties',
  goose: 'Goose Pop Shop',
  hall: 'Town Hall',
} as const;
/** The shared folders agents save business documents in (under output/), and where each lands in Drive. */
export const BUSINESS_DIRS: Record<string, string[]> = {
  shop: [BUSINESS.etsy], etsy: [BUSINESS.etsy],
  porchlight: [BUSINESS.porchlight], receptionist: [BUSINESS.porchlight], sales: [BUSINESS.porchlight], voice: [BUSINESS.porchlight],
  reports: [BUSINESS.porchlight, 'Client reports'],
  refuge: [BUSINESS.refuge], 'real-estate': [BUSINESS.refuge],
  goose: [BUSINESS.goose],
  'town-hall': [BUSINESS.hall], hall: [BUSINESS.hall],
};

interface State { layout?: number; root?: string; folders: Record<string, string>; files: Record<string, { id: string; mtime: number; size: number }>; sheets: Record<string, string> }
const load = (): State => {
  try { if (existsSync(STATE_FILE)) return { folders: {}, files: {}, sheets: {}, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch { /* start over */ }
  return { folders: {}, files: {}, sheets: {} };
};
const save = (s: State) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const pretty = (seg: string) => seg.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Only a definite "gone" (404 or in the trash) counts as missing; any other error stops the sync instead of starting over. */
async function gone(id: string) {
  try { const f = await g<{ trashed?: boolean }>('GET', `${DRIVE}/files/${id}`, { query: { fields: 'id,trashed' } }); return !!f.trashed; }
  catch (e) { if (/\(404\)/.test((e as Error).message)) return true; throw e; }
}

async function ensureRoot(s: State) {
  if (s.layout === LAYOUT && s.root && !(await gone(s.root))) return s.root;
  // Find the tagged folder (made by this or another run of Slave Base) before making a new one.
  const q = `appProperties has { key='slavebase' and value='${TAG}' } and mimeType='${FOLDER}' and trashed=false`;
  const found = await g<{ files: { id: string }[] }>('GET', `${DRIVE}/files`, { query: { q, fields: 'files(id)', orderBy: 'createdTime', pageSize: '10' } });
  if (found.files?.[0]) {
    if (s.root !== found.files[0].id) Object.assign(s, { root: found.files[0].id, folders: {}, files: {}, sheets: {} });
  } else {
    // First run of this layout: label the old, messy copies so you can delete them, then start clean.
    const old = await g<{ files: { id: string; name: string }[] }>('GET', `${DRIVE}/files`, { query: { q: `name='${(process.env.GOOGLE_DRIVE_FOLDER || 'Slave Base').replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and 'root' in parents and trashed=false`, fields: 'files(id,name)', pageSize: '50' } });
    for (const f of old.files ?? []) await g('PATCH', `${DRIVE}/files/${f.id}`, { json: { name: 'Slave Base (old copy, safe to delete)' } }).catch(() => {});
    const f = await g<{ id: string }>('POST', `${DRIVE}/files`, { json: { name: process.env.GOOGLE_DRIVE_FOLDER || 'Slave Base', mimeType: FOLDER, appProperties: { slavebase: TAG } }, query: { fields: 'id' } });
    Object.assign(s, { root: f.id, folders: {}, files: {}, sheets: {} });
  }
  s.layout = LAYOUT;
  save(s);
  return s.root!;
}

/** A folder path under the root, e.g. ["Porchlight Front Desk", "Client reports"]; made once and remembered. */
async function folderFor(s: State, dirs: string[]): Promise<string> {
  if (!dirs.length) return s.root!;
  const key = dirs.join('/');
  if (s.folders[key]) return s.folders[key];
  const parent = await folderFor(s, dirs.slice(0, -1));
  const f = await g<{ id: string }>('POST', `${DRIVE}/files`, { json: { name: dirs[dirs.length - 1], mimeType: FOLDER, parents: [parent] }, query: { fields: 'id' } });
  s.folders[key] = f.id;
  save(s);
  return f.id;
}

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const designNames = new Map<string, string>();
function designName(dir: string) {
  if (!designNames.has(dir)) {
    let n = dir;
    try { const m = JSON.parse(readFileSync(join(OUT, 'shop', 'designs', dir, 'meta.json'), 'utf8')); n = String(m.title ?? m.name ?? dir); } catch { /* keep the folder name */ }
    designNames.set(dir, n.replace(/[\\/]+/g, '-').slice(0, 90));
  }
  return designNames.get(dir)!;
}

/** Where a file under output/ goes in Drive (folders + name), or null to leave it out. */
function placeOf(rel: string): { dirs: string[]; name?: string } | null {
  const parts = rel.split('/');
  const [top, ...rest] = parts;
  const file = parts[parts.length - 1];
  if (top === 'shop') {
    if (rest[0] === 'designs') {
      // Only what a person wants from a design: the Canva-editable PDF and one preview image.
      if (rest.length !== 3) return null;
      const name = designName(rest[1]);
      if (file === 'editable-canva.pdf') return { dirs: [BUSINESS.etsy, 'Designs'], name: `${name}.pdf` };
      if (file === 'preview.png') return { dirs: [BUSINESS.etsy, 'Designs'], name: `${name} (preview).png` };
      return null;
    }
    if (['artwork', 'backgrounds'].includes(rest[0])) return null; // raw image material
    return { dirs: [BUSINESS.etsy, ...rest.slice(0, -1).map(pretty)] };
  }
  if (top === 'results') return { dirs: ['Agent results', ...rest.slice(0, -1)] };
  if (BUSINESS_DIRS[top]) return { dirs: [...BUSINESS_DIRS[top], ...rest.slice(0, -1).map(pretty)] };
  const agent = AGENTS.find((a) => a.id === top);
  if (agent) return { dirs: ['Team notes', agent.name, ...rest.slice(0, -1).map(pretty)] };
  return { dirs: ['Other', ...parts.slice(0, -1).map(pretty)] };
}

/** What a local file becomes in Drive. */
function convert(path: string, name?: string): { content: Buffer | string; type: string; driveType: string | null; name: string } | null {
  const ext = extname(path).toLowerCase(), base = name ?? path.split(sep).pop()!.slice(0, -ext.length || undefined);
  const text = () => readFileSync(path, 'utf8');
  switch (ext) {
    case '.md': case '.markdown':
      return { content: `<!doctype html><html><head><meta charset="utf-8"></head><body>${marked.parse(text(), { async: false }) as string}</body></html>`, type: 'text/html', driveType: DOC, name: base };
    case '.html': case '.htm': return { content: text(), type: 'text/html', driveType: DOC, name: base };
    case '.txt': return { content: text(), type: 'text/plain', driveType: DOC, name: base };
    case '.csv': return { content: text(), type: 'text/csv', driveType: SHEET, name: base };
    case '.pdf': return { content: readFileSync(path), type: 'application/pdf', driveType: null, name: name ?? base + ext };
    case '.png': return name ? { content: readFileSync(path), type: 'image/png', driveType: null, name } : null; // only images we chose (design previews)
    default: return null;
  }
}

async function upload(s: State, path: string) {
  const rel = relative(OUT, path).split(sep).join('/');
  const place = placeOf(rel);
  if (!place) return false;
  const st = statSync(path);
  const known = s.files[rel];
  if (known && known.mtime === st.mtimeMs && known.size === st.size) return false;
  if (st.size > MAX_BYTES) return false;
  const c = convert(path, place.name);
  if (!c) return false;
  if (known) {
    if (!(await gone(known.id))) {
      const m = multipart({ name: c.name }, c.content, c.type);
      await g('PATCH', `${UPLOAD}/files/${known.id}`, { body: m.body, type: m.type, query: { uploadType: 'multipart', fields: 'id' } });
      s.files[rel] = { id: known.id, mtime: st.mtimeMs, size: st.size };
      save(s);
      return true;
    }
  }
  const parent = await folderFor(s, place.dirs);
  const m = multipart({ name: c.name, parents: [parent], ...(c.driveType ? { mimeType: c.driveType } : {}) }, c.content, c.type);
  const f = await g<{ id: string }>('POST', `${UPLOAD}/files`, { body: m.body, type: m.type, query: { uploadType: 'multipart', fields: 'id' } });
  s.files[rel] = { id: f.id, mtime: st.mtimeMs, size: st.size };
  save(s);
  return true;
}

/* ---------------- live sheets from Supabase ---------------- */
const TABLES = [
  {
    key: 'prospects', title: 'Prospects', order: 'id',
    cols: [['ID', 'id'], ['Business', 'name'], ['Contact', 'contact_name'], ['Category', 'category'], ['City', 'city'], ['State', 'state'], ['Phone', 'phone'], ['Website', 'website'], ['Email', 'email'], ['Rating', 'rating'], ['Reviews', 'reviews'], ['Status', 'status'], ['Demo agent', 'demo_agent_id'], ['Campaign', 'campaign_id'], ['Notes', 'notes'], ['Found', 'created_at']],
  },
  {
    key: 'clients', title: 'Clients', order: 'id',
    cols: [['ID', 'id'], ['Business', 'business_name'], ['Contact', 'contact_name'], ['Email', 'email'], ['Phone', 'phone'], ['Receptionist number', 'phone_number'], ['Monthly fee', 'monthly_fee'], ['Avg job value', 'avg_job_value'], ['Start date', 'start_date'], ['Status', 'status'], ['Retell agent', 'retell_agent_id'], ['Notes', 'notes']],
  },
] as const;

const cell = (k: string, v: unknown) => {
  if (v === null || v === undefined) return '';
  if (k === 'status') return String(v).replace(/_/g, ' ');
  if (k === 'created_at') return String(v).slice(0, 10);
  return typeof v === 'number' ? v : String(v);
};

async function syncTables(s: State) {
  let db;
  try { db = client(); } catch { return 0; }
  let n = 0;
  for (const t of TABLES) {
    const { data, error } = await db.from(t.key).select('*').order(t.order).limit(5000);
    if (error) continue; // table not set up yet (supabase/sales.sql)
    let id = s.sheets[t.key];
    if (id && (await gone(id))) id = '';
    if (!id) {
      const parent = await folderFor(s, [BUSINESS.porchlight]);
      const f = await g<{ id: string }>('POST', `${DRIVE}/files`, { json: { name: t.title, mimeType: SHEET, parents: [parent] }, query: { fields: 'id' } });
      id = f.id;
      s.sheets[t.key] = id;
      save(s);
      const meta = await g<{ sheets: { properties: { sheetId: number } }[] }>('GET', `${SHEETS}/${id}`, { query: { fields: 'sheets.properties' } });
      const sheetId = meta.sheets[0].properties.sheetId;
      await g('POST', `${SHEETS}/${id}:batchUpdate`, { json: { requests: [
        { updateSheetProperties: { properties: { sheetId, title: t.title, gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.92, blue: 0.89 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
      ] } });
    }
    const meta = await g<{ sheets: { properties: { title: string } }[] }>('GET', `${SHEETS}/${id}`, { query: { fields: 'sheets.properties.title' } });
    const tab = `'${meta.sheets[0].properties.title.replace(/'/g, "''")}'`;
    const values = [t.cols.map((c) => c[0]), ...(data ?? []).map((r: any) => t.cols.map(([, k]) => cell(k, r[k])))];
    await g('POST', `${SHEETS}/${id}/values/${encodeURIComponent(`${tab}!A:Z`)}:clear`, { json: {} });
    await g('PUT', `${SHEETS}/${id}/values/${encodeURIComponent(`${tab}!A1`)}`, { json: { values }, query: { valueInputOption: 'RAW' } });
    n++;
  }
  return n;
}

/** One sync at a time, even across processes (the runner and npm run drive-sync). */
function lock() {
  try {
    if (existsSync(LOCK_FILE)) {
      const l = JSON.parse(readFileSync(LOCK_FILE, 'utf8')) as { pid: number; at: number };
      let alive = false;
      try { process.kill(l.pid, 0); alive = true; } catch { alive = false; }
      if (alive && l.pid !== process.pid && Date.now() - l.at < 20 * 60_000) return false;
    }
  } catch { /* stale or broken lock: take it */ }
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }));
  return true;
}
const unlock = () => { try { unlinkSync(LOCK_FILE); } catch { /* already gone */ } };

export async function syncAll(o: { log?: (m: string) => void } = {}) {
  if (!lock()) return { docs: 0, sheets: 0, folderUrl: '', skipped: true };
  try {
    const s = load();
    await ensureRoot(s);
    let docs = 0;
    for (const p of walk(OUT)) {
      try { if (await upload(s, p)) docs++; }
      catch (e) { o.log?.(`   Drive: couldn’t copy ${relative(OUT, p)}: ${(e as Error).message.slice(0, 160)}`); }
    }
    const sheets = await syncTables(s);
    return { docs, sheets, folderUrl: `https://drive.google.com/drive/folders/${s.root}`, skipped: false };
  } finally { unlock(); }
}
