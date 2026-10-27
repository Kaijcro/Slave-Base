import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { marked } from 'marked';
import { AGENTS } from '../../src/world/agents';
import { client } from '../report';
import { g, multipart } from './google';

/**
 * Copies your agents' work into a "Slave Base" folder in your Google Drive:
 *  - .md, .html and .txt files become Google Docs (re-uploaded in place when an agent changes them)
 *  - .csv files become Google Sheets, PDFs are copied as they are
 *  - the prospects and clients tables become two Google Sheets, refreshed after every task
 * Folders mirror output/ (agent folders get the agent's name). What was uploaded is remembered in .town-drive.json.
 */
const OUT = resolve('output');
const STATE_FILE = resolve('.town-drive.json');
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DOC = 'application/vnd.google-apps.document', SHEET = 'application/vnd.google-apps.spreadsheet', FOLDER = 'application/vnd.google-apps.folder';

/** Folders under output/ that hold machine files, not things to read. */
const SKIP_DIRS = ['shop/designs'];
const MAX_BYTES = 20 * 1024 * 1024;

interface State { root?: string; folders: Record<string, string>; files: Record<string, { id: string; mtime: number; size: number }>; sheets: Record<string, string> }
const load = (): State => {
  try { if (existsSync(STATE_FILE)) return { folders: {}, files: {}, sheets: {}, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch { /* start over */ }
  return { folders: {}, files: {}, sheets: {} };
};
const save = (s: State) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

const folderName = (seg: string, depth: number) => {
  if (depth === 0) {
    const a = AGENTS.find((x) => x.id === seg);
    if (a) return a.name;
    if (seg === 'results') return 'Results';
    if (seg === 'shop') return 'Etsy shop';
    if (seg === 'reports') return 'Client reports';
  }
  return seg;
};

async function exists(id: string) {
  try { const f = await g<{ trashed?: boolean }>('GET', `${DRIVE}/files/${id}`, { query: { fields: 'id,trashed' } }); return !f.trashed; } catch { return false; }
}

async function ensureRoot(s: State) {
  if (s.root && (await exists(s.root))) return s.root;
  // First run, or the folder was deleted: start fresh.
  const f = await g<{ id: string }>('POST', `${DRIVE}/files`, { json: { name: process.env.GOOGLE_DRIVE_FOLDER || 'Slave Base', mimeType: FOLDER }, query: { fields: 'id' } });
  Object.assign(s, { root: f.id, folders: {}, files: {}, sheets: {} });
  save(s);
  return f.id;
}

async function folderFor(s: State, relDir: string): Promise<string> {
  if (!relDir) return s.root!;
  if (s.folders[relDir]) return s.folders[relDir];
  const parts = relDir.split('/');
  const parent = await folderFor(s, parts.slice(0, -1).join('/'));
  const f = await g<{ id: string }>('POST', `${DRIVE}/files`, { json: { name: folderName(parts[parts.length - 1], parts.length - 1), mimeType: FOLDER, parents: [parent] }, query: { fields: 'id' } });
  s.folders[relDir] = f.id;
  save(s);
  return f.id;
}

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    const rel = relative(OUT, p).split(sep).join('/');
    if (e.isDirectory()) { if (!SKIP_DIRS.some((d) => rel === d || rel.startsWith(d + '/'))) walk(p, out); }
    else out.push(p);
  }
  return out;
}

/** What a local file becomes in Drive: [upload content type, Drive type (null = keep as is), name]. */
function convert(path: string): { content: Buffer | string; type: string; driveType: string | null; name: string } | null {
  const ext = extname(path).toLowerCase(), base = path.split(sep).pop()!.slice(0, -ext.length || undefined);
  const text = () => readFileSync(path, 'utf8');
  switch (ext) {
    case '.md': case '.markdown':
      return { content: `<!doctype html><html><head><meta charset="utf-8"></head><body>${marked.parse(text(), { async: false }) as string}</body></html>`, type: 'text/html', driveType: DOC, name: base };
    case '.html': case '.htm': return { content: text(), type: 'text/html', driveType: DOC, name: base };
    case '.txt': return { content: text(), type: 'text/plain', driveType: DOC, name: base };
    case '.csv': return { content: text(), type: 'text/csv', driveType: SHEET, name: base };
    case '.pdf': return { content: readFileSync(path), type: 'application/pdf', driveType: null, name: base + ext };
    default: return null;
  }
}

async function upload(s: State, path: string) {
  const rel = relative(OUT, path).split(sep).join('/');
  const st = statSync(path);
  const known = s.files[rel];
  if (known && known.mtime === st.mtimeMs && known.size === st.size) return false;
  if (st.size > MAX_BYTES) return false;
  const c = convert(path);
  if (!c) return false;
  if (known) {
    try {
      const m = multipart({}, c.content, c.type);
      await g('PATCH', `${UPLOAD}/files/${known.id}`, { body: m.body, type: m.type, query: { uploadType: 'multipart', fields: 'id' } });
      s.files[rel] = { id: known.id, mtime: st.mtimeMs, size: st.size };
      save(s);
      return true;
    } catch { /* deleted in Drive or couldn't be replaced: make a new copy below */ }
  }
  const parent = await folderFor(s, rel.split('/').slice(0, -1).join('/'));
  const m = multipart({ name: c.name, parents: [parent], ...(c.driveType ? { mimeType: c.driveType } : {}) }, c.content, c.type);
  const f = await g<{ id: string }>('POST', `${UPLOAD}/files`, { body: m.body, type: m.type, query: { uploadType: 'multipart', fields: 'id' } });
  if (known) await g('PATCH', `${DRIVE}/files/${known.id}`, { json: { trashed: true } }).catch(() => {});
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
    if (id && !(await exists(id))) id = '';
    if (!id) {
      const f = await g<{ id: string }>('POST', `${DRIVE}/files`, { json: { name: t.title, mimeType: SHEET, parents: [s.root] }, query: { fields: 'id' } });
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

export async function syncAll(o: { log?: (m: string) => void } = {}) {
  const s = load();
  await ensureRoot(s);
  let docs = 0;
  for (const p of walk(OUT)) {
    try { if (await upload(s, p)) docs++; }
    catch (e) { o.log?.(`   Drive: couldn’t copy ${relative(OUT, p)}: ${(e as Error).message.slice(0, 160)}`); }
  }
  const sheets = await syncTables(s);
  return { docs, sheets, folderUrl: `https://drive.google.com/drive/folders/${s.root}` };
}
