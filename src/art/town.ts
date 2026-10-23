import { W, H, S, PF } from '../config';
import { painter, disc, rng, hash, clamp, type Paint } from './pixel';
import type { PlaceKey } from '../world/places';
import { CX, CY, RING, SIDE_ROAD_Y } from '../world/roads';

/**
 * All of the town's scenery, drawn with code.
 * When you switch to a tileset (LimeZu, Tiled), most of this file is replaced by image layers.
 *
 * Map: an oval ring road around the Town Hall island.
 *   top    -> Refuge Properties (warehouse + office, cars in the bays and the lot)
 *   left   -> Goose Pop Shop
 *   right  -> AI Enterprizes (glass high-rise)
 *   bottom -> road out of town, with two open lots for future businesses
 */

const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export type Occupancy = Record<PlaceKey, number>;

interface Light { x: number; y: number; w: number; h: number; key: string; o: boolean; glow: boolean; a: number }

const SIDEWALK = '#cfc7b6', SEAM = '#b9b09d', ASPHALT = '#5a5c6c', ASPHALT_EDGE = '#4a4c5a', LINE = '#e9d58a';

/** Filled oval drawn row by row, so the edges stay pixel-crisp. */
function oval(P: Paint, cx: number, cy: number, rx: number, ry: number, c: string) {
  for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
    const dy = y + 0.5 - cy;
    if (Math.abs(dy) > ry) continue;
    const hw = rx * Math.sqrt(1 - (dy / ry) ** 2);
    const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
    P(x0, y, x1 - x0, 1, c);
  }
}
const inOval = (x: number, y: number, rx: number, ry: number) => ((x - CX) / rx) ** 2 + ((y - CY) / ry) ** 2 <= 1;

/** Spaces kept clear of trees. */
const BLOCKED: [number, number, number, number][] = [
  [140, 12, 240, 84],   // Refuge Properties + lot
  [0, 96, 132, 104],    // Goose Pop Shop
  [396, 0, 124, 202],   // AI Enterprizes
  [0, 192, 152, 36],    // west road
  [366, 192, 154, 36],  // east road
  [240, 262, 40, 60],   // south road
  [10, 232, 122, 76],   // open lot, south-west
  [388, 232, 122, 76],  // open lot, south-east
];
const blocked = (x: number, y: number) =>
  inOval(x, y, RING.rxo + 12, RING.ryo + 12) || BLOCKED.some(([bx, by, bw, bh]) => x >= bx && x <= bx + bw && y >= by && y <= by + bh);

/* ---------------- static background ---------------- */
export function buildBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext('2d')!;
  g.setTransform(S, 0, 0, S, 0, 0);
  const B = painter(g);
  const rand = rng(11);

  // grass
  B(0, 0, W, H, '#78b35a');
  for (let i = 0; i < 3200; i++) B((rand() * W) | 0, (rand() * H) | 0, 1, 1, rand() < 0.55 ? '#6aa44f' : '#8bc46b');
  for (let i = 0; i < 160; i++) B((rand() * W) | 0, (rand() * H) | 0, 1, 1, ['#fff3f7', '#ffd96a', '#ff9cc0', '#c9b8ff'][(rand() * 4) | 0]);

  // ring road: sidewalk, then asphalt
  oval(B, CX, CY, RING.rxo + 5, RING.ryo + 5, SIDEWALK);
  oval(B, CX, CY, RING.rxo, RING.ryo, ASPHALT_EDGE);
  oval(B, CX, CY, RING.rxo - 1, RING.ryo - 1, ASPHALT);
  for (let i = 0; i < 900; i++) {
    const x = (rand() * W) | 0, y = (rand() * H) | 0;
    if (inOval(x, y, RING.rxo - 1, RING.ryo - 1) && !inOval(x, y, RING.rxi, RING.ryi)) B(x, y, 1, 1, '#64667a');
  }

  // spokes
  const hRoad = (x0: number, x1: number, y: number, swFrom: number, swTo: number) => {
    B(swFrom, y - 13, swTo - swFrom, 4, SIDEWALK); B(swFrom, y + 9, swTo - swFrom, 4, SIDEWALK);
    for (let x = swFrom; x < swTo; x += 8) { B(x, y - 13, 1, 4, SEAM); B(x, y + 9, 1, 4, SEAM); }
    B(x0, y - 9, x1 - x0, 18, ASPHALT); B(x0, y - 9, x1 - x0, 1, ASPHALT_EDGE); B(x0, y + 8, x1 - x0, 1, ASPHALT_EDGE);
  };
  hRoad(0, 152, SIDE_ROAD_Y, 0, 138);           // west: to Goose Pop
  for (let x = 4; x < 128; x += 16) B(x, SIDE_ROAD_Y - 1, 8, 2, LINE);
  hRoad(368, W, SIDE_ROAD_Y, 382, W);           // east: to AI Enterprizes
  for (let x = 392; x < W; x += 16) B(x, SIDE_ROAD_Y - 1, 8, 2, LINE);
  // south: out of town
  B(247, 270, 4, H - 270, SIDEWALK); B(269, 270, 4, H - 270, SIDEWALK);
  B(251, 262, 18, H - 262, ASPHALT); B(251, 262, 1, H - 262, ASPHALT_EDGE); B(268, 262, 1, H - 262, ASPHALT_EDGE);
  for (let y = 284; y < H; y += 14) B(259, y, 2, 7, LINE);
  // north: Refuge parking lot opening onto the ring
  B(146, 76, 228, 13, '#55576a'); B(146, 88, 228, 1, '#45475a');
  for (let x = 150; x < 372; x += 26) if (x < 246 || x > 274) B(x, 77, 1, 10, '#d9d6e2');
  B(249, 76, 22, 22, ASPHALT);

  // ring center line
  for (let i = 0; i < 72; i += 2) {
    const th = (i / 72) * Math.PI * 2;
    B(Math.round(CX + RING.rx * Math.cos(th)), Math.round(CY + RING.ry * Math.sin(th)), 2, 1, LINE);
  }
  // crosswalks where spokes meet the ring
  for (let y = 203; y < 218; y += 3) { B(138, y, 9, 2, '#e8e4da'); B(373, y, 9, 2, '#e8e4da'); }
  for (let x = 251; x < 269; x += 3) { B(x, 92, 2, 7, '#e8e4da'); B(x, 264, 2, 7, '#e8e4da'); }

  // island: curb, hedge, pavers
  oval(B, CX, CY, RING.rxi, RING.ryi, SIDEWALK);
  oval(B, CX, CY, RING.rxi - 3, RING.ryi - 3, '#4e8f45');
  oval(B, CX, CY, RING.rxi - 7, RING.ryi - 7, '#d9bb8f');
  B(250, 238, 20, 9, '#d9bb8f'); // gap in the hedge for the path in
  g.save();
  g.beginPath(); g.ellipse(CX, CY, RING.rxi - 7, RING.ryi - 7, 0, 0, Math.PI * 2); g.rect(250, 238, 20, 9); g.clip();
  for (let y = 110; y < 250; y += 4) {
    B(150, y, 220, 1, '#c6a679');
    for (let x = 150 + (((y - 110) / 4) % 2 ? 4 : 0); x < 370; x += 8) B(x, y, 1, 4, '#c6a679');
  }
  g.restore();
  for (let i = 0; i < 90; i++) {
    const th = rand() * Math.PI * 2;
    const x = Math.round(CX + (RING.rxi - 5) * Math.cos(th)), y = Math.round(CY + (RING.ryi - 5) * Math.sin(th));
    if (!(y > 236 && x > 248 && x < 272)) B(x, y, 1, 1, rand() < 0.5 ? '#3f7d3f' : '#66b25a');
  }
  // planters in the square
  for (const [x, y] of [[194, 223], [318, 223]]) {
    B(x, y, 9, 6, '#8a5a36'); B(x + 1, y - 2, 7, 3, '#4e9a4a'); B(x + 2, y - 3, 1, 1, '#ff86b0'); B(x + 6, y - 2, 1, 1, '#ffd96a');
  }

  // open lots, ready for future businesses
  for (const lx of [16, 396]) {
    B(lx, 240, 108, 62, '#b8946a');
    for (let i = 0; i < 260; i++) B(lx + ((rand() * 108) | 0), 240 + ((rand() * 62) | 0), 1, 1, rand() < 0.5 ? '#a8845c' : '#c9a57a');
    for (let x = lx; x <= lx + 108; x += 6) { B(x, 238, 1, 4, '#8a5a36'); B(x, 300, 1, 4, '#8a5a36'); }
    B(lx, 239, 109, 1, '#9a6b43'); B(lx, 301, 109, 1, '#9a6b43');
    for (let y = 240; y < 302; y += 6) { B(lx, y, 1, 3, '#8a5a36'); B(lx + 108, y, 1, 3, '#8a5a36'); }
  }
  return c;
}

/* ---------------- animated scenery ---------------- */
interface Tree { x: number; y: number; s: number; ph: number }
interface Particle { k: 'sig' | 'bub' | 'mail' | 'drop'; x: number; y: number; vx: number; vy: number; l: number; m: number; c?: string }

const lampAt = (deg: number): [number, number] => {
  const th = (deg * Math.PI) / 180;
  return [Math.round(CX + (RING.rxo + 4) * Math.cos(th)), Math.round(CY + (RING.ryo + 4) * Math.sin(th))];
};
export const LAMPS: [number, number][] = [
  ...[-140, -40, 40, 140, -170, -10].map(lampAt),
  [30, 223], [110, 223], [410, 223], [490, 223], [245, 300], [276, 300], [212, 214], [308, 214],
];
const FOUNTAINS: [number, number][] = [[184, 192], [336, 192]];

export class TownArt {
  private g!: CanvasRenderingContext2D;
  private R!: Paint;
  private ox = 0;
  private oy = 0;
  lights: Light[] = [];
  private trees: Tree[] = [];
  private parts: Particle[] = [];
  private em = { sig: 0, bub: 0, mail: 0, drop: 0 };
  private clouds = [{ x: 40, y: 60, s: 1 }, { x: 260, y: 240, s: 1.3 }, { x: 430, y: 110, s: 0.9 }];
  private neon = { on: true, x: 0, y: 0 };
  private beacon = false;

  constructor() {
    const r = rng(5);
    for (let y = 8; y < H; y += 15) {
      for (let x = 4; x < W; x += 17) {
        const tx = x + ((r() * 8 - 4) | 0), ty = y + ((r() * 6 - 3) | 0);
        if (r() < 0.25 || blocked(tx, ty)) continue;
        this.trees.push({ x: tx, y: ty, s: 4 + ((r() * 3) | 0), ph: r() * 6 });
      }
    }
    this.trees.sort((a, b) => a.y - b.y);
  }

  /** Light level for a time of day in minutes. night: 0 (noon) .. 1 (midnight). */
  static lighting(mins: number) {
    const h = (mins / 60) % 24;
    const sun = Math.sin((Math.PI * (h - 5.5)) / 13);
    const s = h > 5.5 && h < 18.5 ? Math.max(0, sun) : 0;
    const k = clamp(s / 0.45, 0, 1);
    const night = 1 - k * k * (3 - 2 * k);
    const warm = s > 0 ? clamp(1 - s / 0.5, 0, 1) * 0.24 * (1 - night * 0.6) : 0;
    return { night, warm, day: s };
  }

  update(dt: number, occ: Occupancy) {
    for (const c of this.clouds) { c.x += dt * 5; if (c.x > W + 40) c.x = -40; }
    if (!reduce) {
      const e = this.em, P = this.parts;
      e.bub += dt * (occ.goose ? 6 : 2);
      while (e.bub > 1) { e.bub--; P.push({ k: 'bub', x: 34.5 + Math.random() * 2, y: 103, vx: Math.random() * 4 - 2, vy: -8 - Math.random() * 6, l: 1.4, m: 1.4, c: Math.random() < 0.5 ? '#ffd2e2' : '#ffffff' }); }
      if (occ.refuge) { e.mail += dt * 1.6; while (e.mail > 1) { e.mail--; P.push({ k: 'mail', x: 283, y: 66, vx: 8 + Math.random() * 10, vy: -14 - Math.random() * 8, l: 2, m: 2 }); } }
      if (occ.ai) { e.sig += dt * 5; while (e.sig > 1) { e.sig--; P.push({ k: 'sig', x: 455 + Math.random() * 3, y: 6, vx: Math.random() * 10 - 5, vy: -10 - Math.random() * 6, l: 0.9, m: 0.9, c: Math.random() < 0.5 ? '#86e0bd' : '#5fb4ff' }); } }
      e.drop += dt * 20;
      while (e.drop > 1) { e.drop--; const [fx, fy] = FOUNTAINS[(Math.random() * 2) | 0]; P.push({ k: 'drop', x: fx + Math.random() * 2 - 1, y: fy - 10, vx: Math.random() * 12 - 6, vy: -12 - Math.random() * 6, l: 0.7, m: 0.7 }); }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.l -= dt;
      if (p.l <= 0) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'drop') p.vy += 50 * dt;
      if (p.k === 'mail') p.vy += 4 * dt;
      if (p.k === 'bub') p.vx += Math.sin(p.l * 12) * dt * 6;
    }
  }

  /** Everything that sits under the people: trees, fountains, buildings, lamps, particles. */
  drawScenery(g: CanvasRenderingContext2D, t: number, mins: number, occ: Occupancy) {
    this.g = g; this.R = painter(g); this.lights = [];
    const L = TownArt.lighting(mins);
    if (L.day > 0.05) {
      for (const c of this.clouds) {
        g.fillStyle = `rgba(30,40,60,${0.07 * Math.min(1, L.day * 2)})`;
        for (const [dx, dy, r] of [[0, 0, 14], [12, 3, 11], [-11, 4, 9], [5, -5, 9]]) {
          g.beginPath(); g.ellipse(c.x + dx, c.y + dy, r * c.s, r * 0.55 * c.s, 0, 0, Math.PI * 2); g.fill();
        }
      }
    }
    for (const tr of this.trees) this.tree(tr, t);
    for (const [x, y] of FOUNTAINS) this.fountain(x, y, t);
    this.openLots();
    this.refuge(t, occ.refuge > 0);
    this.shift(-4, -56, () => this.goose(t, occ.goose > 0));
    this.ai(t, occ.ai > 0);
    this.shift(-164, -40, () => this.hall(t, occ.hall > 0));
    for (const [x, y] of LAMPS) this.lamp(x, y);
    this.drawParticles();
  }

  /** Night tint and glowing windows, drawn above the people. */
  drawNight(g: CanvasRenderingContext2D, t: number, mins: number) {
    const L = TownArt.lighting(mins);
    if (L.warm > 0.005) { g.fillStyle = `rgba(255,140,70,${L.warm})`; g.fillRect(0, 0, W, H); }
    if (L.night > 0.01) { g.fillStyle = `rgba(16,18,64,${L.night * 0.6})`; g.fillRect(0, 0, W, H); }
    if (L.night <= 0.08) return;
    const n = L.night;
    const isLit = (w: Light) => w.o || hash(w.key) < 0.38;
    for (const w of this.lights) {
      if (!isLit(w)) continue;
      const fl = w.o ? 1 : 0.85 + 0.15 * Math.sin(t * 2 + hash(w.key) * 30);
      g.fillStyle = `rgba(255,210,120,${n * 0.92 * fl * w.a})`;
      g.fillRect(w.x, w.y, w.w, w.h);
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const w of this.lights) {
      if (!w.glow || !isLit(w)) continue;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2, r = Math.max(w.w, w.h) * 1.3;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(255,180,90,${0.22 * n * w.a})`); gr.addColorStop(1, 'rgba(255,180,90,0)');
      g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    for (const [x, y] of LAMPS) {
      const gr = g.createRadialGradient(x + 0.5, y - 12, 0, x + 0.5, y - 8, 18);
      gr.addColorStop(0, `rgba(255,205,120,${0.42 * n})`); gr.addColorStop(1, 'rgba(255,205,120,0)');
      g.fillStyle = gr; g.fillRect(x - 18, y - 30, 37, 38);
    }
    if (this.beacon) {
      const gr = g.createRadialGradient(456, 6, 0, 456, 6, 10);
      gr.addColorStop(0, `rgba(255,70,90,${0.7 * n})`); gr.addColorStop(1, 'rgba(255,70,90,0)');
      g.fillStyle = gr; g.fillRect(446, -4, 20, 20);
    }
    g.restore();
    for (const [x, y] of LAMPS) { g.fillStyle = `rgba(255,236,170,${n})`; g.fillRect(x - 1, y - 12, 3, 1); }
    if (this.neon.on) {
      g.save(); g.shadowColor = '#ff5f9a'; g.shadowBlur = 14 * n; g.font = `600 6px ${PF}`; g.textBaseline = 'top';
      g.fillStyle = '#ffc2d8'; g.fillText('GOOSE POP', this.neon.x, this.neon.y); g.restore();
    }
  }

  /* ---------- helpers ---------- */
  /** Draw a building at an offset (lets Goose Pop and Town Hall keep their original drawings). */
  private shift(dx: number, dy: number, fn: () => void) {
    this.g.save(); this.g.translate(dx, dy); this.ox = dx; this.oy = dy;
    fn();
    this.g.restore(); this.ox = 0; this.oy = 0;
  }
  private light(x: number, y: number, w: number, h: number, key: string, o: boolean, glow = true, a = 1) {
    this.lights.push({ x: x + this.ox, y: y + this.oy, w, h, key, o, glow, a });
  }
  private win(x: number, y: number, w: number, h: number, key: string, o: boolean) {
    const R = this.R;
    R(x - 1, y - 1, w + 2, h + 2, '#2b2540'); R(x, y, w, h, '#9fd3e6'); R(x, y, w, 1, '#c9ecf7');
    R(x, y + h - 1, w, 1, '#7fb6cc'); R(x + 1, y + 1, 1, Math.max(1, h - 3), '#d9f4fb');
    this.light(x, y, w, h, key, o);
  }
  private sign(txt: string, cx: number, y: number, fg: string, bg: string, size = 5) {
    const g = this.g;
    g.font = `600 ${size}px ${PF}`;
    const w = Math.ceil(g.measureText(txt).width);
    const x = Math.round(cx - w / 2);
    this.R(x - 3, y, w + 6, size + 3, bg);
    g.fillStyle = fg; g.textBaseline = 'top'; g.fillText(txt, x, y + 1.5);
  }
  private tree(tr: Tree, t: number) {
    const R = this.R;
    const sw = reduce ? 0 : Math.round(Math.sin(t * 1.3 + tr.ph) * 0.6);
    R(tr.x - 1, tr.y - 5, 2, 5, '#6b4a2f'); R(tr.x - 3, tr.y, 7, 1, 'rgba(20,30,20,.25)');
    disc(R, tr.x + sw, tr.y - 5 - tr.s, tr.s, '#3f7d3f');
    disc(R, tr.x + sw - 1, tr.y - 6 - tr.s, tr.s - 1, '#4e9a4a');
    disc(R, tr.x + sw - 2, tr.y - 7 - tr.s, Math.max(1, tr.s - 3), '#66b25a');
  }
  private lamp(x: number, y: number) {
    const R = this.R;
    R(x, y - 12, 1, 12, '#3a3550'); R(x - 1, y - 14, 3, 2, '#3a3550'); R(x, y - 12, 1, 1, '#f6e3a0'); R(x - 1, y, 3, 1, '#3a3550');
  }
  private fountain(cx: number, cy: number, t: number) {
    const g = this.g, R = this.R;
    g.fillStyle = '#8f8676'; g.beginPath(); g.ellipse(cx, cy + 1, 12, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#bdb3a0'; g.beginPath(); g.ellipse(cx, cy, 12, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5fb7d6'; g.beginPath(); g.ellipse(cx, cy, 9.5, 5, 0, 0, Math.PI * 2); g.fill();
    if (!reduce) {
      const ph = (t * 0.6) % 1;
      g.strokeStyle = `rgba(230,248,255,${0.6 * (1 - ph)})`; g.lineWidth = 0.6;
      g.beginPath(); g.ellipse(cx, cy, 2 + ph * 7, 1 + ph * 3.5, 0, 0, Math.PI * 2); g.stroke();
    }
    R(cx - 2, cy - 10, 4, 10, '#bdb3a0'); R(cx - 2, cy - 10, 1, 10, '#d8cfbd'); R(cx - 5, cy - 11, 10, 2, '#a39a88'); R(cx - 3, cy - 12, 6, 1, '#5fb7d6');
  }
  private openLots() {
    for (const lx of [16, 396]) {
      const R = this.R;
      R(lx + 44, 254, 1, 16, '#5a4636'); R(lx + 64, 254, 1, 16, '#5a4636');
      this.sign('OPEN LOT', lx + 54, 248, '#3a2a1a', '#f6e3a0');
      this.sign('YOUR NEXT BUSINESS', lx + 54, 257, '#f1ead8', '#3a2a1a', 4);
      R(lx + 20, 286, 5, 4, '#ff8a3d'); R(lx + 21, 284, 3, 2, '#ff8a3d'); R(lx + 21, 286, 3, 1, '#ffffff');
      R(lx + 86, 280, 5, 4, '#ff8a3d'); R(lx + 87, 278, 3, 2, '#ff8a3d'); R(lx + 87, 280, 3, 1, '#ffffff');
    }
  }
  private drawParticles() {
    const g = this.g, R = this.R;
    for (const p of this.parts) {
      const f = p.l / p.m;
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.k === 'mail') {
        g.globalAlpha = Math.min(1, f * 1.5);
        R(x, y, 4, 3, '#ffffff'); R(x, y, 4, 1, '#d9d3e6'); R(x + 1, y + 1, 2, 1, '#c8664f');
        g.globalAlpha = 1;
      } else if (p.k === 'drop') R(x, y, 1, 1, '#d4f1fb');
      else { g.globalAlpha = Math.min(1, f * 1.6); R(x, y, 1, 1, p.c!); g.globalAlpha = 1; }
    }
  }

  /* ---------- cars ---------- */
  private car(x: number, y: number, body: string, style: 'sport' | 'muscle' | 'vintage' | 'truck', stripe = '#ffffff') {
    const R = this.R;
    R(x + 1, y + 11, 18, 1, 'rgba(0,0,0,.35)');
    if (style === 'truck') {
      R(x, y + 4, 20, 7, body); R(x + 3, y - 1, 14, 6, body); R(x + 4, y, 12, 3, '#9fd3e6'); R(x + 5, y, 3, 1, '#d9f4fb');
      R(x + 4, y - 2, 12, 1, '#2b2540'); R(x + 5, y - 2, 2, 1, '#ffd96a'); R(x + 9, y - 2, 2, 1, '#ffd96a'); R(x + 13, y - 2, 2, 1, '#ffd96a');
      R(x, y + 5, 20, 1, 'rgba(255,255,255,.25)');
    } else if (style === 'sport') {
      R(x, y + 5, 20, 6, body); R(x + 4, y + 2, 12, 4, body); R(x + 5, y + 3, 10, 2, '#9fd3e6'); R(x + 6, y + 3, 3, 1, '#d9f4fb');
      R(x + 8, y + 2, 1, 9, stripe); R(x + 11, y + 2, 1, 9, stripe); R(x - 1, y + 6, 1, 2, body); R(x + 20, y + 6, 1, 2, body);
      R(x, y + 5, 20, 1, 'rgba(255,255,255,.25)');
    } else if (style === 'muscle') {
      R(x, y + 4, 20, 7, body); R(x + 3, y + 1, 14, 4, body); R(x + 4, y + 2, 12, 2, '#7fb6cc'); R(x + 5, y + 2, 3, 1, '#c9ecf7');
      R(x + 8, y + 4, 1, 7, stripe); R(x + 11, y + 4, 1, 7, stripe); R(x + 7, y + 4, 6, 1, '#16151d');
      R(x, y + 4, 20, 1, 'rgba(255,255,255,.2)');
    } else {
      R(x + 1, y + 4, 18, 7, body); R(x, y + 6, 20, 4, body); R(x + 4, y + 1, 12, 4, body); R(x + 5, y + 2, 10, 2, '#9fd3e6'); R(x + 6, y + 2, 3, 1, '#d9f4fb');
      R(x + 2, y + 4, 16, 1, 'rgba(255,255,255,.3)'); R(x + 2, y + 6, 2, 2, '#fff6c8'); R(x + 16, y + 6, 2, 2, '#fff6c8');
    }
    if (style !== 'vintage') { R(x + 1, y + 7, 3, 1, '#fff6c8'); R(x + 16, y + 7, 3, 1, '#fff6c8'); }
    R(x + 7, y + 8, 6, 2, '#2b2540');
    R(x, y + 10, 20, 1, style === 'vintage' ? '#e8e4da' : '#c9ccd6');
    const wh = style === 'truck' ? 4 : 3;
    R(x + 1, y + 12 - wh + 1, 3, wh - 1, '#16151d'); R(x + 16, y + 12 - wh + 1, 3, wh - 1, '#16151d');
  }

  /* ---------- buildings ---------- */
  /** Refuge Properties: a warehouse with roll-up bays on each side of a modern office. */
  private refuge(t: number, o: boolean) {
    const R = this.R;
    // sawtooth roof with skylights
    for (let x = 150; x < 370; x += 20) {
      for (let k = 0; k < 8; k++) {
        const w = Math.max(2, Math.round(20 - (7 - k) * 2.4));
        R(x, 14 + k, w, 1, k % 2 ? '#868c9c' : '#8d93a3');
        R(x, 14 + k, 2, 1, '#9fd3e6');
      }
    }
    R(148, 22, 224, 4, '#6c7282'); R(148, 26, 224, 1, '#4d5262');
    // corrugated walls
    R(150, 27, 72, 49, '#b7bcc8'); R(298, 27, 72, 49, '#b7bcc8');
    for (let x = 151; x < 370; x += 3) if (x < 222 || x >= 298) R(x, 27, 1, 49, '#a2a8b6');
    R(150, 27, 220, 2, '#9ca2b0');
    // office
    R(222, 27, 76, 49, '#3b3f4f'); R(222, 27, 1, 49, '#2b2e3b'); R(297, 27, 1, 49, '#2b2e3b');
    this.sign('REFUGE PROPERTIES', 260, 28, '#f6c560', '#23262f');
    this.win(227, 39, 18, 9, 'rf1', o); this.win(251, 39, 18, 9, 'rf2', o); this.win(275, 39, 18, 9, 'rf3', o);
    this.win(227, 52, 18, 8, 'rf4', o); this.win(275, 52, 18, 8, 'rf5', o);
    R(248, 55, 24, 2, '#c8664f');
    R(252, 58, 16, 18, '#1d1f2a'); R(253, 59, 14, 17, '#7fb6cc'); R(260, 59, 1, 17, '#1d1f2a'); R(258, 66, 1, 2, '#f6c560'); R(262, 66, 1, 2, '#f6c560');
    this.light(253, 59, 14, 17, 'rfd', o);
    // mailbox (mailers fly out when someone is working)
    R(280, 68, 6, 5, '#3c5a9a'); R(280, 68, 6, 1, '#5b7fd1'); R(282, 73, 1, 3, '#2b2540');
    if (o) R(286, 66, 1, 3, '#e04a4a');
    // four roll-up bays with cars
    const bays = [158, 190, 306, 338];
    const cars: [string, 'sport' | 'muscle' | 'vintage' | 'truck', string][] = [
      ['#d7263d', 'sport', '#ffffff'], ['#1c1c24', 'muscle', '#ff8a3d'], ['#2fa59a', 'vintage', '#ffffff'], ['#f2c230', 'truck', '#ffffff'],
    ];
    bays.forEach((bx, i) => {
      R(bx - 1, 45, 26, 31, '#2b2540'); R(bx, 46, 24, 30, '#2a2838'); R(bx, 70, 24, 6, '#3a3848'); R(bx + 10, 47, 4, 1, '#f6e3a0');
      for (let x = bx; x < bx + 24; x += 4) R(x, 75, 2, 1, '#f6c560');
      const [body, style, stripe] = cars[i];
      this.car(bx + 2, 62, body, style, stripe);
      let d: number;
      if (i === 1) d = o && !reduce ? Math.round(clamp(15 + 17 * Math.sin(t * 0.7), 2, 30)) : 30;
      else d = [3, 0, 3, 13][i];
      if (d > 0) {
        R(bx, 46, 24, d, '#c9ccd6');
        for (let r = 1; r < d; r += 2) R(bx, 46 + r, 24, 1, '#b0b4c0');
        R(bx, 46 + d - 1, 24, 1, '#8d93a3');
      }
      if (30 - d > 6) this.light(bx, 46 + d, 24, 30 - d, 'bay' + i, o, false, 0.35);
      // hazard lights blink on the car in the working bay
      if (o && i === 1 && d < 20 && Math.sin(t * 6) > 0) { R(bx + 3, 69, 3, 1, '#ffb020'); R(bx + 18, 69, 3, 1, '#ffb020'); }
    });
    // show cars parked in the lot
    this.car(176, 76, '#f4f4f4', 'sport', '#2f6fd6');
    this.car(214, 76, '#6b2fa0', 'muscle', '#f6c560');
    this.car(318, 76, '#e8562a', 'vintage');
  }

  /** AI Enterprizes: a glass high-rise with a light-up crown and a scrolling news ticker. */
  private ai(t: number, o: boolean) {
    const g = this.g, R = this.R;
    const tx = 420, tw = 72, top = 30, bot = 162;
    // crown and antenna
    R(tx + 10, top - 14, tw - 20, 6, '#1d2a44'); R(tx + 4, top - 8, tw - 8, 8, '#1d2a44');
    for (let x = tx + 5; x < tx + tw - 5; x += 2) {
      const c = o ? `hsl(${(t * 80 + x * 7) % 360} 85% 65%)` : '#5fb4ff';
      R(x, top - 3, 2, 1, c);
    }
    R(455, 6, 2, 10, '#8a93a8'); R(452, 12, 8, 1, '#8a93a8');
    this.beacon = Math.sin(t * 3) > 0.3;
    R(455, 4, 2, 2, this.beacon ? '#ff4a5a' : '#5a2a33');
    // tower
    R(tx - 1, top - 1, tw + 2, bot - top + 1, '#162238');
    R(tx, top, tw, bot - top, '#2c5a92');
    R(tx + tw - 12, top, 12, bot - top, '#234a7a');
    let r = 0;
    for (let y = top + 12; y < bot - 3; y += 7, r++) {
      let c = 0;
      for (let x = tx + 3; x < tx + tw - 4; x += 8, c++) {
        R(x, y, 6, 4, x > tx + tw - 13 ? '#4d86bf' : '#5f9fd6');
        this.light(x, y, 6, 4, `ai${r}_${c}`, o, false);
      }
    }
    // a glint of sky sweeping across the glass
    if (!reduce) {
      g.save(); g.beginPath(); g.rect(tx, top, tw, bot - top); g.clip();
      const sweep = ((t * 0.12) % 1.6) - 0.3;
      for (let y = top; y < bot; y++) R(Math.round(tx + sweep * (tw + 80) - (y - top) * 0.45), y, 7, 1, 'rgba(255,255,255,.16)');
      g.restore();
    }
    const holo = o ? `hsl(${(t * 60) % 360} 90% 72%)` : '#9fe6ff';
    this.sign('AI ENTERPRIZES', tx + tw / 2, top + 2, holo, '#101828');
    // podium, ticker and lobby
    R(404, 160, 104, 7, '#101828');
    g.save(); g.beginPath(); g.rect(405, 160, 102, 7); g.clip();
    g.font = `600 5px ${PF}`; g.textBaseline = 'top'; g.fillStyle = o ? '#86e0bd' : '#5fb4ff';
    const msg = o ? 'NEW AI BUSINESS IN THE WORKS  ·  TESTING PRICES  ·  REVENUE UP  ·  ' : 'AI ENTERPRIZES  ·  IDEAS TO INCOME  ·  ';
    const mw = g.measureText(msg).width;
    const off = reduce ? 0 : (t * 14) % mw;
    for (let x = 406 - off; x < 508; x += mw) g.fillText(msg, x, 161);
    g.restore();
    R(404, 167, 104, 29, '#1d2a44');
    R(406, 170, 100, 24, '#7fc8e8');
    for (let x = 406; x < 506; x += 10) R(x, 170, 1, 24, '#1d2a44');
    R(406, 181, 100, 1, '#1d2a44'); R(406, 170, 100, 1, '#c9ecf7');
    this.light(406, 170, 100, 24, 'ailobby', true);
    R(440, 180, 32, 2, '#5fb4ff');
    R(444, 182, 24, 14, '#101828'); R(445, 183, 22, 13, '#9fd3e6'); R(456, 183, 1, 13, '#101828');
    R(410, 192, 8, 4, '#3e6439'); R(411, 190, 6, 2, '#4e9a4a'); R(494, 192, 8, 4, '#3e6439'); R(495, 190, 6, 2, '#4e9a4a');
  }

  private gooseBird(gx: number, gy: number) {
    const R = this.R;
    R(gx - 1, gy + 6, 2, 2, '#ffffff'); R(gx, gy + 6, 12, 5, '#ffffff'); R(gx + 1, gy + 5, 10, 1, '#ffffff'); R(gx + 1, gy + 11, 10, 1, '#e3dfe8');
    R(gx + 3, gy + 7, 6, 2, '#e3dfe8'); R(gx + 9, gy + 1, 2, 5, '#ffffff'); R(gx + 9, gy - 1, 4, 3, '#ffffff');
    R(gx + 13, gy, 3, 1, '#ff9a2a'); R(gx + 13, gy + 1, 2, 1, '#e07a14'); R(gx + 11, gy, 1, 1, '#241b2e');
    R(gx + 4, gy + 12, 1, 2, '#ff9a2a'); R(gx + 7, gy + 12, 1, 2, '#ff9a2a');
  }
  /** Goose Pop Shop, unchanged; drawn in its own coordinates and shifted into place. */
  private goose(t: number, o: boolean) {
    const g = this.g, R = this.R;
    R(12, 186, 116, 3, '#d97fa3'); R(14, 189, 112, 15, '#f2a2c0'); for (let x = 14; x < 126; x += 8) R(x, 203, 4, 1, '#d97fa3');
    R(30, 170, 12, 2, '#ffd2e2');
    for (let k = 0; k < 16; k++) { const inset = Math.floor(k / 6); R(31 + inset, 172 + k, 10 - inset * 2, 1, k >= 5 && k < 8 ? '#ff86b0' : '#fff5f8'); }
    R(38, 160, 2, 10, '#ff86b0'); R(38, 160, 2, 1, '#ffd2e2');
    this.gooseBird(86, 172 + (reduce ? 0 : Math.round(Math.sin(t * 2.2))));
    R(14, 204, 112, 48, '#a6e3cf'); R(14, 204, 112, 2, '#86c9b3');
    R(36, 206, 70, 10, '#3a2140');
    this.neon.on = o ? Math.sin(t * 7) > -0.7 : Math.sin(t * 1.3) > -0.97;
    g.font = `600 6px ${PF}`; g.textBaseline = 'top';
    const nw = g.measureText('GOOSE POP').width;
    const nx = Math.round(71 - nw / 2), ny = 207.5;
    this.neon.x = nx + this.ox; this.neon.y = ny + this.oy;
    g.fillStyle = this.neon.on ? '#ff9cc0' : '#6a3a56'; g.fillText('GOOSE POP', nx, ny);
    for (let x = 14; x < 126; x += 6) { const c = ((x - 14) / 6) % 2 ? '#fff5f8' : '#ff86b0'; R(x, 217, 6, 6, c); R(x + 1, 223, 4, 1, c); }
    this.win(20, 228, 34, 16, 'g1', o); this.win(88, 228, 32, 16, 'g2', o);
    R(61, 230, 20, 22, '#3a2140'); R(62, 231, 18, 21, '#9fd3e6'); R(70, 231, 2, 21, '#3a2140'); R(64, 240, 4, 1, '#ff86b0');
    R(26, 247, 8, 5, '#3a2140'); R(27, 248, 6, 1, '#ffd96a'); R(27, 250, 4, 1, '#f1ead8');
  }
  /** Town Hall, drawn in its original coordinates and shifted to the center island. */
  private hall(t: number, o: boolean) {
    const R = this.R;
    R(462, 168, 1, 30, '#d9d6e2');
    const sp = reduce ? 0 : o ? 5 : 2.5;
    for (let i = 0; i < 9; i++) { const yo = Math.round(Math.sin(t * sp - i * 0.7) * 1.1); R(463 + i, 169 + yo, 1, 5, i % 2 ? '#86e0bd' : '#6fd0ab'); }
    for (let k = 0; k < 14; k++) { const hw = 8 + k * 3; R(424 - hw, 182 + k, hw * 2, 1, k === 13 ? '#c9c2b0' : '#efe9da'); }
    R(377, 196, 94, 3, '#c9c2b0');
    R(380, 199, 88, 49, '#e8e2d0'); R(386, 203, 76, 43, '#5f5c74');
    [[391, 9], [405, 9], [433, 9], [447, 9]].forEach(([x, w], i) => { R(x, 205, w, 22, '#4c4962'); this.light(x, 205, w, 22, 'h' + i, o); });
    for (const x of [386, 400, 414, 428, 442, 456]) { R(x, 201, 5, 45, '#f6f2e8'); R(x + 4, 201, 1, 45, '#d6cfbd'); R(x - 1, 200, 7, 2, '#e0d9c6'); R(x - 1, 244, 7, 2, '#e0d9c6'); }
    R(420, 228, 8, 18, '#5b3a24'); R(420, 228, 8, 1, '#7a5030');
    R(376, 246, 96, 3, '#d6cfbd'); R(372, 249, 104, 3, '#c9c2b0');
    this.sign('TOWN HALL', 424, 187, '#2b2540', '#efe9da');
  }
}
