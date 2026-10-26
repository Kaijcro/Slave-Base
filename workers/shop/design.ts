import { mkdirSync, readdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import PDFDocument from 'pdfkit';
// @ts-expect-error no types published
import SVGtoPDF from 'svg-to-pdfkit';

/**
 * The design studio. Agents draw a design as SVG (vector graphics); this turns it into:
 *  - print-ready PNG files at the right sizes for each product type
 *  - a Canva-editable PDF (text stays real text in fonts Canva also has) with an "edit in Canva" page
 *  - the SVG itself, for Cricut/Silhouette cutting
 *  - listing photos (mockups) for Etsy
 */
export const SHOP_DIR = resolve('output/shop');
const FONT_DIR = resolve('workers/assets/fonts');

/* ---------------- fonts: free for commercial use (SIL OFL) and all available in Canva ---------------- */
export const FONTS: Record<string, { weights: Record<string, string>; italic?: string; use: string }> = {
  'Bebas Neue': { weights: { 400: 'BebasNeue_400Regular.ttf' }, use: 'tall bold all-caps headlines' },
  'Anton': { weights: { 400: 'Anton_400Regular.ttf' }, use: 'heavy condensed headlines' },
  'Abril Fatface': { weights: { 400: 'AbrilFatface_400Regular.ttf' }, use: 'high-contrast display serif' },
  'DM Serif Display': { weights: { 400: 'DMSerifDisplay_400Regular.ttf' }, use: 'elegant display serif' },
  'Playfair Display': { weights: { 400: 'PlayfairDisplay_400Regular.ttf', 700: 'PlayfairDisplay_700Bold.ttf' }, italic: 'PlayfairDisplay_400Regular_Italic.ttf', use: 'classic serif, has italic' },
  'Montserrat': { weights: { 400: 'Montserrat_400Regular.ttf', 700: 'Montserrat_700Bold.ttf', 900: 'Montserrat_900Black.ttf' }, use: 'clean modern sans (400, 700, 900)' },
  'Poppins': { weights: { 400: 'Poppins_400Regular.ttf', 600: 'Poppins_600SemiBold.ttf', 800: 'Poppins_800ExtraBold.ttf' }, use: 'friendly geometric sans (400, 600, 800)' },
  'Lobster': { weights: { 400: 'Lobster_400Regular.ttf' }, use: 'bold retro script' },
  'Pacifico': { weights: { 400: 'Pacifico_400Regular.ttf' }, use: 'casual surf-style script' },
  'Caveat': { weights: { 400: 'Caveat_400Regular.ttf', 700: 'Caveat_700Bold.ttf' }, use: 'handwritten (400, 700)' },
};
const fontFiles = () => readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf')).map((f) => join(FONT_DIR, f));

/* ---------------- product types ---------------- */
export type Kind = 'wall_art' | 'printable' | 'svg_cut_file' | 'sticker' | 'tshirt' | 'mug' | 'shop_banner' | 'shop_icon';
interface KindSpec {
  label: string; w: number; h: number; transparent: boolean; digital: boolean; branding?: boolean;
  png: { name: string; w: number; h: number }[];
  pdf?: { w: number; h: number; label: string }; // page size in points (72 per inch)
  svgFile?: boolean;
  hint: string;
}
export const KINDS: Record<Kind, KindSpec> = {
  wall_art: {
    label: 'Printable wall art', w: 1600, h: 2000, transparent: false, digital: true,
    png: [{ name: 'print-8x10.png', w: 2400, h: 3000 }, { name: 'print-16x20.png', w: 4800, h: 6000 }],
    pdf: { w: 576, h: 720, label: '8 × 10 in' }, hint: 'Full-bleed artwork with a background. 4:5 portrait.',
  },
  printable: {
    label: 'Printable page (planner, checklist, sign, invitation)', w: 1700, h: 2200, transparent: false, digital: true,
    png: [{ name: 'page-letter.png', w: 2550, h: 3300 }], pdf: { w: 612, h: 792, label: 'US Letter 8.5 × 11 in' },
    hint: 'A page people fill in or print, US Letter. Keep text as real <text> so it is editable in Canva.',
  },
  svg_cut_file: {
    label: 'SVG cut file (Cricut / Silhouette)', w: 1000, h: 1000, transparent: true, digital: true,
    png: [{ name: 'design.png', w: 3000, h: 3000 }], pdf: { w: 720, h: 720, label: '10 × 10 in' }, svgFile: true,
    hint: 'Solid shapes in 1–3 flat colors, no gradients, no thin hairlines (min stroke 6). Transparent background.',
  },
  sticker: {
    label: 'Digital sticker / sticker design', w: 1000, h: 1000, transparent: true, digital: true,
    png: [{ name: 'sticker.png', w: 3000, h: 3000 }], pdf: { w: 576, h: 576, label: '8 × 8 in' }, svgFile: true,
    hint: 'One bold, compact shape with a clear silhouette. Transparent background.',
  },
  tshirt: {
    label: 'T-shirt print (Printify)', w: 1500, h: 1800, transparent: true, digital: false,
    png: [{ name: 'print.png', w: 4500, h: 5400 }], hint: 'Chest print, transparent background, readable from 2 m. Pick colors that work on the shirt colors you choose.',
  },
  mug: {
    label: 'Mug wrap (Printify, 11 oz)', w: 990, h: 462, transparent: false, digital: false,
    png: [{ name: 'print.png', w: 2475, h: 1155 }], hint: 'Wide wrap; keep important art in the left and right thirds (the handle is in the middle).',
  },
  shop_banner: {
    label: 'Etsy shop banner (big banner)', w: 1680, h: 420, transparent: false, digital: false, branding: true,
    png: [{ name: 'banner.png', w: 3360, h: 840 }],
    hint: 'The wide banner at the top of the shop. Phones crop the sides, so keep the shop name and key art in the middle half.',
  },
  shop_icon: {
    label: 'Etsy shop icon (logo)', w: 500, h: 500, transparent: false, digital: false, branding: true,
    png: [{ name: 'icon.png', w: 1000, h: 1000 }],
    hint: 'Square logo shown small and often in a circle: one bold mark or initials, keep it inside the middle 80%.',
  },
};

/* ---------------- checks ---------------- */
export function checkSvg(svg: string, kind: Kind): string[] {
  const k = KINDS[kind], problems: string[] = [];
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) problems.push('It must start with an <svg> element.');
  const vb = svg.match(/viewBox\s*=\s*["']\s*([\d.\-]+)[\s,]+([\d.\-]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!vb) problems.push(`Add viewBox="0 0 ${k.w} ${k.h}" to the <svg>.`);
  else if (Math.abs(Number(vb[3]) / Number(vb[4]) - k.w / k.h) > 0.01) problems.push(`The viewBox must be ${k.w} × ${k.h} (it is ${vb[3]} × ${vb[4]}).`);
  if (/<script|<foreignObject|on\w+\s*=/i.test(svg)) problems.push('No scripts, event handlers or <foreignObject>.');
  if (/<image\b/i.test(svg)) problems.push('No <image> elements: draw everything as vector shapes and text.');
  if (/(href|url\()\s*=?\s*["']?\s*https?:/i.test(svg) || /@import/i.test(svg)) problems.push('No outside links, web fonts or @import.');
  for (const fam of fontFamilies(svg)) if (!FONTS[fam]) problems.push(`Font "${fam}" isn’t available. Use one of: ${Object.keys(FONTS).join(', ')}.`);
  if (/style\s*=\s*["'][^"']*font-family/i.test(svg)) problems.push('Put fonts in attributes (font-family="Montserrat" font-weight="700"), not in style="".');
  if (svg.length > 400_000) problems.push('The SVG is too large; simplify it.');
  return [...new Set(problems)];
}
function fontFamilies(svg: string) {
  const out = new Set<string>();
  for (const m of svg.matchAll(/font-family\s*[:=]\s*["']?([^"';>]+)/gi)) out.add(m[1].split(',')[0].trim().replace(/^['"]|['"]$/g, ''));
  return out;
}

/* ---------------- rendering ---------------- */
export function renderPng(svg: string, width: number, opts: { background?: string } = {}) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: opts.background,
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Montserrat' },
  });
  return r.render().asPng();
}

/** For the PDF, tag each text element's font with its weight so the right font file is embedded. */
function tagFontsForPdf(svg: string) {
  return svg.replace(/<(text|tspan|g)\b([^>]*)>/gi, (whole, tag: string, attrs: string) => {
    const fam = attrs.match(/font-family\s*=\s*["']([^"']+)["']/i)?.[1]?.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!fam || !FONTS[fam]) return whole;
    const wt = attrs.match(/font-weight\s*=\s*["']?(\w+)/i)?.[1] ?? '400';
    const italic = /font-style\s*=\s*["']?italic/i.test(attrs);
    const w = wt === 'bold' ? '700' : wt === 'normal' ? '400' : wt;
    return `<${tag}${attrs.replace(/font-family\s*=\s*["'][^"']+["']/i, `font-family="${fam}|${w}|${italic ? 'i' : ''}"`)}>`;
  });
}
function fontFileFor(tagged: string) {
  const [fam, w = '400', it] = tagged.split('|');
  const f = FONTS[fam] ?? FONTS.Montserrat;
  if (it === 'i' && f.italic) return join(FONT_DIR, f.italic);
  const ws = Object.keys(f.weights).map(Number);
  const best = ws.reduce((a, b) => (Math.abs(b - Number(w)) < Math.abs(a - Number(w)) ? b : a), ws[0]);
  return join(FONT_DIR, f.weights[best]);
}

/** A PDF whose text stays editable when imported into Canva, plus a page explaining how. */
export function writePdf(svg: string, kind: Kind, title: string, file: string): Promise<void> {
  const k = KINDS[kind], page = k.pdf!;
  return new Promise((done, fail) => {
    const doc = new PDFDocument({ size: [page.w, page.h], margin: 0, info: { Title: title, Author: 'Designed with AI assistance' } });
    const out = createWriteStream(file);
    out.on('finish', () => done()); out.on('error', fail);
    doc.pipe(out);
    SVGtoPDF(doc, tagFontsForPdf(svg), 0, 0, {
      width: page.w, height: page.h, preserveAspectRatio: 'xMidYMid meet', assumePt: false,
      fontCallback: (family: string) => {
        const path = fontFileFor(family.replace(/^['"]|['"]$/g, ''));
        try { doc.registerFont(path, path); } catch { /* already registered */ }
        return path;
      },
    });
    // How to edit
    doc.addPage({ size: [page.w, page.h], margin: 48 });
    const S = Math.min(page.w, page.h) / 612;
    doc.registerFont('ui', join(FONT_DIR, 'Montserrat_400Regular.ttf'));
    doc.registerFont('uib', join(FONT_DIR, 'Montserrat_700Bold.ttf'));
    doc.font('uib').fontSize(22 * S).fillColor('#222').text('How to edit this design in Canva', { align: 'left' });
    doc.moveDown(0.6).font('ui').fontSize(11.5 * S).fillColor('#333');
    const steps = [
      'Go to canva.com and sign in. A free Canva account works.',
      'Click "Create", then "Import file", and choose this PDF.',
      'Canva opens it as a design: click any text to change the words, and any shape to change its color.',
      'Delete this instructions page in Canva (page 2) before you print.',
      'Download as "PDF Print" for printing, or "PNG" for screens.',
    ];
    steps.forEach((s, i) => doc.text(`${i + 1}.  ${s}`, { paragraphGap: 6 * S }));
    const used = [...fontFamilies(svg)];
    doc.moveDown(0.8).font('uib').text('Fonts used (all free in Canva)');
    doc.font('ui').text(used.length ? used.join(', ') : 'None (shapes only)');
    doc.moveDown(0.8).font('uib').text('Also included');
    doc.font('ui').text(`Print-ready PNG files${k.svgFile ? ' and an SVG for Cricut or Silhouette' : ''}. Printing size: ${page.label}.`);
    doc.moveDown(1.2).fontSize(9 * S).fillColor('#777').text('This is a digital download; no physical item will be shipped. Designed by our shop with the help of AI tools. Not affiliated with Canva. For personal use; please don’t resell or share the files.');
    doc.end();
  });
}

/* ---------------- listing photos ---------------- */
const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
const MW = 2700, MH = 2025; // 4:3, the shape Etsy shows in search

function wallMockup(art: Buffer) {
  const fw = 880, fh = 1100, x = (MW - fw) / 2, y = 190;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MW} ${MH}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3ede4"/><stop offset="1" stop-color="#e6ddd0"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="24" stdDeviation="22" flood-color="#3a2a1a" flood-opacity="0.28"/></filter>
    <radialGradient id="light" cx="0.3" cy="0.1" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${MW}" height="${MH}" fill="url(#wall)"/>
  <rect width="${MW}" height="${MH}" fill="url(#light)"/>
  <g filter="url(#sh)"><rect x="${x - 34}" y="${y - 34}" width="${fw + 68}" height="${fh + 68}" fill="#2b2622"/></g>
  <rect x="${x - 22}" y="${y - 22}" width="${fw + 44}" height="${fh + 44}" fill="#fbfaf7"/>
  <image href="${dataUri(art)}" x="${x}" y="${y}" width="${fw}" height="${fh}" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="1560" width="${MW}" height="${MH - 1560}" fill="#d9cfc1"/>
  <rect x="600" y="1500" width="1500" height="80" rx="8" fill="#b88a5a"/><rect x="600" y="1576" width="1500" height="22" fill="#9a6f45"/>
  <path d="M1880 1500 q-30 -160 40 -230 q70 70 40 230z" fill="#7a9a6a"/><path d="M1930 1500 q20 -190 110 -220 q20 120 -60 220z" fill="#5f8456"/>
  <rect x="1850" y="1390" width="130" height="112" rx="18" fill="#efe6d8"/>
  <rect x="760" y="1430" width="190" height="72" rx="10" fill="#e8dccb"/><rect x="790" y="1400" width="130" height="34" rx="8" fill="#cdbfa9"/>
</svg>`;
}

function cardMockup(art: Buffer, bg: string, sticker: boolean) {
  const s = 1300, x = (MW - s) / 2, y = (MH - s) / 2;
  const die = sticker
    ? `<filter id="die" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="26" result="d"/><feFlood flood-color="#ffffff"/><feComposite in2="d" operator="in" result="w"/><feDropShadow in="w" dx="0" dy="18" stdDeviation="16" flood-color="#000" flood-opacity="0.22" result="ws"/><feMerge><feMergeNode in="ws"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    : `<filter id="die"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000" flood-opacity="0.12"/></filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MW} ${MH}">
  <defs>${die}</defs>
  <rect width="${MW}" height="${MH}" fill="${bg}"/>
  ${sticker ? '' : `<rect x="${x - 70}" y="${y - 70}" width="${s + 140}" height="${s + 140}" rx="48" fill="#ffffff" filter="url(#die)"/>`}
  <image href="${dataUri(art)}" x="${x}" y="${y}" width="${s}" height="${s}" ${sticker ? 'filter="url(#die)"' : ''}/>
</svg>`;
}

function whatYouGet(art: Buffer, kind: Kind, title: string) {
  const k = KINDS[kind];
  const items = [
    'Editable PDF — open it in Canva (free) to change any text or color',
    ...k.png.map((p) => `High-resolution PNG — ${p.w} × ${p.h} px, 300 dpi`),
    ...(k.svgFile ? ['SVG cut file — for Cricut, Silhouette and other cutters'] : []),
    'Instant download — nothing is shipped',
  ];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MW} ${MH}">
  <rect width="${MW}" height="${MH}" fill="#fbf7f1"/>
  <rect x="140" y="160" width="1000" height="${1000 * (k.h / k.w) > 1700 ? 1700 : 1000 * (k.h / k.w)}" fill="#fff" stroke="#e9e1d4" stroke-width="6"/>
  <image href="${dataUri(art)}" x="160" y="180" width="960" height="${Math.min(1660, 960 * (k.h / k.w))}" preserveAspectRatio="xMidYMid meet"/>
  <text x="1300" y="330" font-family="Montserrat" font-weight="900" font-size="110" fill="#2b2533">EDITABLE IN CANVA</text>
  <text x="1300" y="430" font-family="Montserrat" font-weight="400" font-size="58" fill="#6b6377">${esc(title.length > 42 ? title.slice(0, 41) + '…' : title)}</text>
  ${items.map((t, i) => `<circle cx="1330" cy="${612 + i * 170}" r="22" fill="#86c9a8"/><text x="1385" y="${632 + i * 170}" font-family="Poppins" font-weight="600" font-size="52" fill="#2b2533">${esc(t.split(' — ')[0])}</text>${t.includes(' — ') ? `<text x="1385" y="${700 + i * 170}" font-family="Poppins" font-weight="400" font-size="42" fill="#6b6377">${esc(t.split(' — ')[1])}</text>` : ''}`).join('\n  ')}
  <text x="1300" y="1820" font-family="Poppins" font-weight="400" font-size="40" fill="#8a8296">Digital download · not affiliated with Canva</text>
</svg>`;
}

const BGS = ['#f6e7e1', '#e3efe7', '#e6ecf6', '#f5efd9', '#efe6f4'];

/* ---------------- the whole job ---------------- */
export interface DesignResult {
  design_id: string; kind: Kind; dir: string; files: { path: string; name: string }[]; images: { path: string; name: string }[]; preview: string; print?: string;
}

export async function makeDesign(o: { name: string; kind: Kind; svg: string; title?: string }): Promise<DesignResult> {
  const slug = o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design';
  const id = `${new Date().toISOString().slice(0, 10)}-${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const k = KINDS[o.kind];
  const dir = join(SHOP_DIR, 'designs', id);
  mkdirSync(join(dir, 'listing-photos'), { recursive: true });
  writeFileSync(join(dir, 'design.svg'), o.svg);

  const files: DesignResult['files'] = [];
  for (const p of k.png) {
    const path = join(dir, p.name);
    writeFileSync(path, renderPng(o.svg, p.w, { background: k.transparent ? undefined : '#ffffff' }));
    files.push({ path, name: `${slug}-${p.name}` });
  }
  if (k.digital && k.pdf) {
    const path = join(dir, 'editable-canva.pdf');
    await writePdf(o.svg, o.kind, o.title ?? o.name, path);
    files.unshift({ path, name: `${slug}-editable-canva.pdf` });
  }
  if (k.svgFile) files.push({ path: join(dir, 'design.svg'), name: `${slug}.svg` });

  const images: DesignResult['images'] = [];
  if (k.digital) {
    const art = renderPng(o.svg, 1400, { background: k.transparent ? undefined : '#ffffff' });
    const bg = BGS[Math.floor(Math.random() * BGS.length)];
    const scenes = o.kind === 'wall_art' || o.kind === 'printable'
      ? [wallMockup(art), whatYouGet(art, o.kind, o.title ?? o.name)]
      : [cardMockup(art, bg, o.kind === 'sticker'), whatYouGet(art, o.kind, o.title ?? o.name)];
    scenes.forEach((svg, i) => {
      const path = join(dir, 'listing-photos', `photo-${i + 1}.png`);
      writeFileSync(path, renderPng(svg, MW));
      images.push({ path, name: `${slug}-${i + 1}.png` });
    });
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ design_id: id, kind: o.kind, name: o.name, title: o.title ?? o.name, files, images, created: new Date().toISOString() }, null, 2));
  const preview = join(dir, 'preview.png');
  writeFileSync(preview, renderPng(o.svg, 900, { background: k.transparent ? '#d8d2c8' : '#ffffff' }));
  return { design_id: id, kind: o.kind, dir, files, images, preview, print: k.digital || k.branding ? undefined : files[0].path };
}
