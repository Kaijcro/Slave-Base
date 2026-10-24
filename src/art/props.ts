import { proj, depthOf, frontDepthAt, X0, Y0, type Rect } from '../iso/iso';
import { Pix, col, shade, type Col } from '../iso/raster';
import { OUT, type Drawable, wallText } from './kit';

/**
 * Street furniture and greenery: trees, palms, lamps, benches, fountains, fences, cars and signs.
 * Each is drawn once into a small canvas and placed in the scene as a Drawable.
 */

function hash(a: number, b = 0) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Turn a Pix into a placed sprite drawn at its own screen position. */
export function placed(p: Pix, depth: number, outline = true): Drawable & { canvas: HTMLCanvasElement; x: number; y: number } {
  if (outline) p.outline(OUT);
  const canvas = p.canvas();
  const x = p.x, y = p.y;
  return { depth, canvas, x, y, draw: (g) => g.drawImage(canvas, x, y) };
}

/* ---------------- cars ---------------- */
export type CarDir = 'u+' | 'u-' | 'v+' | 'v-';
export interface CarLook { body: string; style: 'sedan' | 'sport' | 'van' | 'taxi' }

/** Draw a car centered on world (0, 0), facing `dir`, into a new Pix. */
export function carPix(dir: CarDir, look: CarLook): Pix {
  const alongU = dir[0] === 'u';
  const L = look.style === 'van' ? 1.9 : look.style === 'sport' ? 1.8 : 1.7, Wd = 0.86;
  const foot: Rect = alongU ? [-L / 2, -Wd / 2, L / 2, Wd / 2] : [-Wd / 2, -L / 2, Wd / 2, L / 2];
  const p = Pix.around([proj(foot[0], foot[1], 20), proj(foot[2], foot[3], 0), proj(foot[2], foot[1], 0), proj(foot[0], foot[3], 0)], 2);
  const body = col(look.body), bodyD = shade(body, 0.78), bodyL = shade(body, 1.15);
  const glass = col('#2c3b55'), glassL = col('#7f9cc4'), tire = col('#1c1a22'), hub = col('#9a9aa6');
  const head = col('#fff4c2'), tail = col('#e0383c'), grille = col('#2b2533');
  const frontVisible = dir === 'u+' || dir === 'v+';
  const bh = look.style === 'sport' ? 6 : look.style === 'van' ? 10 : 7;
  const z0 = 2;
  // side (the long visible face)
  const sideLen = L * 16;
  const side = (x: number, y: number) => {
    const wx = [sideLen * 0.2, sideLen * 0.78];
    for (const c of wx) if (Math.abs(x - c) < 2.6 && y < 3) return Math.abs(x - c) < 1 && y > 0.5 && y < 2 ? hub : tire;
    if (y < 1) return bodyD;
    if (look.style === 'taxi' && Math.floor(y) === 4) return col('#2b2533');
    return y > bh - 2 ? body : bodyD;
  };
  const end = (front: boolean) => (x: number, y: number) => {
    const w = Wd * 16;
    if (y < 1) return grille;
    if (y > 2 && y < 5 && (x < 3 || x > w - 3)) return front ? head : tail;
    if (front && y > 1 && y < 4 && x > 4 && x < w - 4) return grille;
    return bodyD;
  };
  const sideFace = alongU ? 'left' : 'right';
  const endFace = alongU ? 'right' : 'left';
  p.box(foot, z0, bh, {
    [sideFace]: (x: number, y: number) => side(x, y + z0 - 2),
    [endFace]: end(frontVisible),
    top: () => bodyL,
  } as never);
  // wheels poke below the body
  p.box(foot, 0, z0, { [sideFace]: (x: number) => (Math.abs(x - sideLen * 0.2) < 2.6 || Math.abs(x - sideLen * 0.78) < 2.6 ? tire : 0) } as never);
  if (look.style === 'van') return p;
  // cabin: set back from the front, glass all round
  const ch = look.style === 'sport' ? 4 : 6;
  const fwd = dir === 'u+' || dir === 'v+' ? 1 : -1;
  const inset = 0.08, back = 0.15, front = look.style === 'sport' ? 0.6 : 0.5;
  let cab: Rect;
  if (alongU) cab = fwd > 0 ? [foot[0] + back, foot[1] + inset, foot[2] - front, foot[3] - inset] : [foot[0] + front, foot[1] + inset, foot[2] - back, foot[3] - inset];
  else cab = fwd > 0 ? [foot[0] + inset, foot[1] + back, foot[2] - inset, foot[3] - front] : [foot[0] + inset, foot[1] + front, foot[2] - inset, foot[3] - back];
  const win = (x: number, y: number, len: number) => (x < 1.5 || x > len - 1.5 || y > ch - 1.2 ? body : x < 4 ? glassL : glass);
  p.box(cab, z0 + bh, ch, {
    left: (x, y) => win(x, y, (cab[2] - cab[0]) * 16),
    right: (x, y) => win(x, y, (cab[3] - cab[1]) * 16),
    top: () => (look.style === 'taxi' ? col('#f9e27a') : bodyL),
  });
  if (look.style === 'taxi') {
    const [tx, ty] = proj((cab[0] + cab[2]) / 2, (cab[1] + cab[3]) / 2, z0 + bh + ch);
    p.rect(Math.round(tx) - 2, Math.round(ty) - 2, 5, 2, col('#ffffff'));
  }
  return p;
}

/** Copy a car into a building drawing (used for the cars in Refuge's garage). */
export function drawCarInto(dest: Pix, u: number, v: number, dir: CarDir, look: CarLook, keep?: (x: number, y: number, under: Col) => boolean) {
  const c = carPix(dir, look);
  c.outline(OUT);
  const [sx, sy] = proj(u, v);
  dest.blit(c, Math.round(sx - X0), Math.round(sy - Y0), keep);
}

const carCache = new Map<string, { canvas: HTMLCanvasElement; ox: number; oy: number }>();
/** A ready-to-draw car sprite; `ox, oy` is where to draw it relative to the car's screen position. */
export function carSprite(dir: CarDir, look: CarLook) {
  const k = dir + look.body + look.style;
  let s = carCache.get(k);
  if (!s) {
    const p = carPix(dir, look);
    p.outline(OUT);
    s = { canvas: p.canvas(), ox: p.x - X0, oy: p.y - Y0 };
    carCache.set(k, s);
  }
  return s;
}
export function parkedCar(u: number, v: number, dir: CarDir, look: CarLook): Drawable {
  const s = carSprite(dir, look);
  const [x, y] = proj(u, v);
  return { depth: depthOf(u, v) + 4, draw: (g) => g.drawImage(s.canvas, Math.round(x) + s.ox, Math.round(y) + s.oy) };
}

/* ---------------- trees ---------------- */
interface Blob { x: number; y: number; r: number }
function canopy(p: Pix, blobs: Blob[], tones: [Col, Col, Col, Col], seed: number) {
  const [dark, mid, light, hi] = tones;
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
    let best = -1, lit = 0;
    for (const b of blobs) {
      const dx = x + 0.5 - b.x, dy = y + 0.5 - b.y, d = Math.hypot(dx, dy * 1.1);
      if (d <= b.r) { const k = 1 - d / b.r; if (k > best) { best = k; lit = (-dx - dy * 1.3) / b.r; } }
    }
    if (best < 0) continue;
    const n = hash(x * 7 + seed, y * 13);
    let c = lit > 0.45 ? light : lit < -0.35 ? dark : mid;
    if (lit > 0.75 && n < 0.5) c = hi;
    if (n < 0.08) c = c === light ? mid : c === mid ? dark : c;
    p.put(x, y, c);
  }
}

/** A round leafy tree; returns the sprite with its base at (0, 0). */
export function treeSprite(seed: number) {
  const s = hash(seed, 1), r = 8 + Math.round(s * 4);
  const p = new Pix(-r * 2, -r * 3 - 14, r * 4, r * 3 + 18);
  const trunk = col('#7a5232'), trunkD = col('#5a3a22');
  p.rect(-1, -12, 3, 12, trunk); p.rect(1, -12, 1, 12, trunkD);
  const top = -10 - r;
  const tones: [Col, Col, Col, Col] = hash(seed, 2) < 0.3
    ? [col('#2f7a3a'), col('#3f9a45'), col('#5cbb4f'), col('#86d86a')]
    : [col('#2e7134'), col('#3b8a3e'), col('#54aa46'), col('#7cc95c')];
  canopy(p, [
    { x: 0.5, y: top, r }, { x: -r * 0.55, y: top + r * 0.45, r: r * 0.72 }, { x: r * 0.6, y: top + r * 0.5, r: r * 0.7 },
    { x: 0, y: top + r * 0.7, r: r * 0.75 }, { x: r * 0.15, y: top - r * 0.35, r: r * 0.6 },
  ], tones, seed);
  return finishWithShadow(p, r + 2, 4);
}

/** A Florida palm: a curved ringed trunk and drooping fronds. */
export function palmSprite(seed: number) {
  const H = 30 + Math.round(hash(seed, 3) * 10), lean = (hash(seed, 4) - 0.5) * 8;
  const p = new Pix(-24, -H - 18, 48, H + 22);
  const trunk = col('#a7825a'), trunkD = col('#7e5f3e'), ring = col('#c9a77d');
  const tx = (k: number) => Math.round(lean * k * k);
  for (let y = 0; y < H; y++) {
    const k = y / H, x = tx(k);
    p.put(x - 1, -y, trunkD); p.put(x, -y, y % 3 === 0 ? ring : trunk); p.put(x + 1, -y, y % 3 === 0 ? ring : trunk);
  }
  const cx = tx(1), cy = -H;
  const g1 = col('#2f8f3e'), g2 = col('#48b04b'), g3 = col('#6fd162'), gd = col('#226c30');
  const n = 7, off = hash(seed, 5) * 6;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2, len = 13 + hash(seed, 10 + i) * 5;
    const dx = Math.cos(a), dy = Math.sin(a) * 0.5;
    for (let s = 0; s <= len; s++) {
      const k = s / len;
      const x = Math.round(cx + dx * s), y = Math.round(cy + dy * s + k * k * 9 - Math.sin(k * Math.PI) * 3);
      // thick near the crown, tapering to a point
      const th = k < 0.6 ? 3 : k < 0.85 ? 2 : 1;
      p.put(x, y - 1, g3);
      if (th > 1) p.put(x, y, g2);
      if (th > 2) p.put(x, y + 1, g1);
      if (s % 2 === 0 && s > 3 && k < 0.9) p.put(x, y + th, gd); // leaflets hanging down
    }
  }
  p.rect(cx - 1, cy + 1, 2, 2, col('#6b4a22')); p.put(cx + 1, cy + 2, col('#8a5f2a'));
  return finishWithShadow(p, 9, 3);
}

/** Outline the sprite, then add a soft ground shadow under it. */
function finishWithShadow(p: Pix, rx: number, ry: number) {
  p.outline(OUT);
  const sh = col('#1b2a1a', 70);
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    if ((x / rx) ** 2 + (y / ry) ** 2 <= 1 && !p.get(x + 2, y)) p.put(x + 2, y, sh);
  }
  return { canvas: p.canvas(), ox: p.x, oy: p.y };
}

export function sprite(u: number, v: number, s: { canvas: HTMLCanvasElement; ox: number; oy: number }, depthBias = 0): Drawable {
  const [x, y] = proj(u, v);
  const X = Math.round(x), Y = Math.round(y);
  return { depth: depthOf(u, v) + depthBias, draw: (g) => g.drawImage(s.canvas, X + s.ox, Y + s.oy) };
}

/* ---------------- street furniture ---------------- */
export function lampSprite() {
  const p = new Pix(-3, -32, 7, 34);
  const pole = col('#3a3550');
  p.rect(0, -28, 1, 28, pole); p.rect(-1, 0, 3, 1, pole); p.rect(-1, -1, 3, 1, pole);
  p.rect(-2, -31, 5, 2, pole); p.rect(-1, -29, 3, 1, col('#f6e3a0'));
  p.outline(OUT);
  p.rect(-1, -29, 3, 1, col('#f6e3a0'));
  return { canvas: p.canvas(), ox: p.x, oy: p.y };
}

export function trafficLightSprite(green: boolean) {
  const p = new Pix(-3, -30, 7, 32);
  const pole = col('#2f2d3a');
  p.rect(0, -22, 1, 22, pole); p.rect(-1, 0, 3, 1, pole);
  p.rect(-2, -30, 5, 9, col('#23212c'));
  p.put(0, -28, green ? col('#5a2a2a') : col('#ff4d4d'));
  p.put(0, -26, col('#5a4a20'));
  p.put(0, -24, green ? col('#5dff8a') : col('#1f4a2a'));
  return { canvas: p.canvas(), ox: p.x, oy: p.y };
}

export function benchPix(u: number, v: number, alongU: boolean): Drawable {
  const r: Rect = alongU ? [u - 0.55, v - 0.13, u + 0.55, v + 0.13] : [u - 0.13, v - 0.55, u + 0.13, v + 0.55];
  const q = Pix.around([proj(r[0], r[1], 12), proj(r[2], r[3], 0), proj(r[2], r[1], 0), proj(r[0], r[3], 0)], 2);
  const wood = col('#b8743c'), woodD = col('#8a522a'), iron = col('#2f2d3a');
  // back rest on the far side, then the seat
  const back: Rect = alongU ? [r[0], r[1], r[2], r[1] + 0.06] : [r[0], r[1], r[0] + 0.06, r[3]];
  q.box(back, 4, 7, { left: (x, y) => (Math.floor(y) % 3 === 0 ? woodD : wood), right: (x, y) => (Math.floor(y) % 3 === 0 ? woodD : wood), top: () => wood });
  q.box(r, 0, 4, { left: (x, y) => (y >= 3 ? wood : x < 2 || x > (alongU ? 16 : 3) ? iron : 0), right: (x, y) => (y >= 3 ? woodD : x < 2 || x > (alongU ? 3 : 16) ? iron : 0), top: (a) => (Math.floor(a * 8) % 2 ? wood : shade(wood, 1.1)) });
  return placed(q, depthOf(alongU ? u : u + 0.13, alongU ? v + 0.13 : v));
}

/** A round stone fountain with a center bowl. Water spray is animated separately. */
export function fountainPix(u: number, v: number): Drawable {
  const r = 0.78;
  const q = Pix.around([proj(u - r, v - r, 22), proj(u + r, v + r, 0), proj(u + r, v - r, 0), proj(u - r, v + r, 0)], 2);
  const stone = col('#d8d2c4'), stoneD = col('#b8b1a1'), water = col('#56b9e6'), waterL = col('#a6e4f8');
  for (let z = 0; z <= 4; z++) {
    q.top([u - r, v - r, u + r, v + r], z, (a, b) => {
      const d = Math.hypot(a - r, b - r);
      if (d > r) return 0;
      if (z < 4) return stoneD;
      if (d > r - 0.16) return stone;
      return Math.floor(d * 9) % 3 === 0 ? waterL : water;
    });
  }
  const cr = 0.12;
  q.box([u - cr, v - cr, u + cr, v + cr], 4, 9, { left: () => stone, right: () => stoneD, top: () => stone });
  for (let z = 13; z <= 15; z++) {
    q.top([u - 0.32, v - 0.32, u + 0.32, v + 0.32], z, (a, b) => {
      const d = Math.hypot(a - 0.32, b - 0.32);
      if (d > 0.32) return 0;
      return z < 15 ? stoneD : d > 0.22 ? stone : water;
    });
  }
  return placed(q, depthOf(u, v) + 6);
}

/** A white picket fence running from (u0, v0) to (u1, v1); `gap` skips a stretch for a gate. */
export function fencePix(u0: number, v0: number, u1: number, v1: number, color = '#ffffff'): Drawable {
  const q = Pix.around([proj(u0, v0, 10), proj(u1, v1, 10), proj(u0, v0, 0), proj(u1, v1, 0)], 2);
  const c = col(color), d = shade(c, 0.82);
  q.wall(u0, v0, u1, v1, 0, 10, (x, y) => {
    const k = Math.floor(x) % 4;
    if (y >= 3 && y < 4.2) return d;
    if (y >= 6.5 && y < 7.7) return d;
    if (k < 2) return y > 8.6 && k === 1 ? 0 : c;
    return 0;
  });
  const f: Rect = [Math.min(u0, u1), Math.min(v0, v1), Math.max(u0, u1), Math.max(v0, v1)];
  const p = placed(q, 0);
  return { depth: frontDepthAt(p.x + p.canvas.width / 2, f) + 1, draw: p.draw };
}

/** A patio table under a striped umbrella. */
export function umbrellaPix(u: number, v: number, stripe: string): Drawable {
  const r = 0.6;
  const q = Pix.around([proj(u - r, v - r, 26), proj(u + r, v + r, 0), proj(u + r, v - r, 18), proj(u - r, v + r, 18)], 2);
  const s1 = col(stripe), s2 = col('#ffffff'), pole = col('#7a6a5a');
  q.top([u - 0.3, v - 0.3, u + 0.3, v + 0.3], 6, (a, b) => (Math.hypot(a - 0.3, b - 0.3) < 0.3 ? col('#ffffff') : 0));
  const [px, py] = proj(u, v);
  q.rect(Math.round(px), Math.round(py) - 22, 1, 22, pole);
  for (let z = 18; z <= 21; z++) {
    const rr = r * (1 - (z - 18) * 0.22);
    q.top([u - rr, v - rr, u + rr, v + rr], z, (a, b) => {
      const da = a - rr, db = b - rr;
      if (Math.hypot(da, db) > rr) return 0;
      const ang = Math.atan2(db, da);
      return Math.floor((ang + Math.PI) / (Math.PI / 4)) % 2 ? s1 : s2;
    });
  }
  return placed(q, depthOf(u, v) + 2);
}

/** A sign board on two posts, facing down-left (along u) or down-right (along v). */
export function signPix(u: number, v: number, alongU: boolean, lines: { t: string; size: number; fg: string }[], bg: string): Drawable {
  const half = 1.35;
  const a: [number, number] = alongU ? [u - half, v] : [u, v + half];
  const b: [number, number] = alongU ? [u + half, v] : [u, v - half];
  const q = Pix.around([proj(a[0], a[1], 30), proj(b[0], b[1], 30), proj(a[0], a[1], 0), proj(b[0], b[1], 0)], 3);
  const post = col('#5a4636'), board = col(bg);
  const L = half * 2 * 16;
  const texts = lines.map((l, i) => ({ w: wallText(l.t, l.size, L / 2, 27 - i * 8), fg: col(l.fg) }));
  q.wall(a[0], a[1], b[0], b[1], 0, 30, (x, y) => {
    if (y < 12) return (x > 4 && x < 6.5) || (x > L - 6.5 && x < L - 4) ? post : 0;
    for (const t of texts) if (t.w.on(x, y)) return t.fg;
    return y > 28.5 || y < 13 ? shade(board, 0.8) : board;
  });
  return placed(q, depthOf(u, v) + 1);
}

/** A small goose statue on a stone pedestal, the centerpiece of the north park. */
export function statuePix(u: number, v: number): Drawable {
  const r = 0.35;
  const q = Pix.around([proj(u - r, v - r, 34), proj(u + r, v + r, 0), proj(u + r, v - r, 0), proj(u - r, v + r, 0)], 4);
  const st = col('#d8d2c4'), stD = col('#b4ad9d'), gold = col('#e8c25a'), goldD = col('#b8902f'), goldL = col('#fff0a8');
  q.box([u - r, v - r, u + r, v + r], 0, 12, { left: (x, y) => (y > 10 ? col('#ece6d8') : st), right: () => stD, top: () => col('#ece6d8') });
  const [x, y] = proj(u, v, 12);
  const gx = Math.round(x) - 6, gy = Math.round(y) - 14;
  const R = (dx: number, dy: number, w: number, h: number, c: Col) => q.rect(gx + dx, gy + dy, w, h, c);
  R(0, 7, 10, 5, gold); R(1, 6, 8, 1, goldL); R(2, 8, 5, 2, goldD); R(8, 1, 2, 6, gold); R(8, -1, 4, 3, gold); R(12, 0, 2, 1, col('#ff9a2a')); R(10, 0, 1, 1, OUT);
  return placed(q, depthOf(u, v) + 2);
}

export function hydrantSprite() {
  const p = new Pix(-2, -7, 5, 8);
  const r = col('#e0383c'), d = col('#a32428');
  p.rect(-1, -5, 3, 5, r); p.rect(1, -5, 1, 5, d); p.rect(-2, -4, 5, 1, r); p.rect(-1, -6, 3, 1, d);
  p.outline(OUT);
  return { canvas: p.canvas(), ox: p.x, oy: p.y };
}

export function binSprite() {
  const p = new Pix(-3, -9, 7, 10);
  const g = col('#3f8a5a'), d = col('#2e6a44');
  p.rect(-2, -7, 5, 7, g); p.rect(1, -7, 2, 7, d); p.rect(-2, -8, 5, 1, col('#56a874'));
  p.outline(OUT);
  return { canvas: p.canvas(), ox: p.x, oy: p.y };
}

export function bushSprite(seed: number) {
  const r = 4 + Math.round(hash(seed, 7) * 2);
  const p = new Pix(-r * 2, -r * 2 - 2, r * 4, r * 2 + 4);
  const flower = hash(seed, 8) < 0.4;
  canopy(p, [{ x: 0, y: -r, r }, { x: -r * 0.7, y: -r * 0.6, r: r * 0.7 }, { x: r * 0.7, y: -r * 0.6, r: r * 0.7 }],
    [col('#2e7134'), col('#3b8a3e'), col('#54aa46'), col('#7cc95c')], seed);
  if (flower) for (let i = 0; i < 6; i++) p.put(Math.round((hash(seed, 20 + i) - 0.5) * r * 2.4), -Math.round(hash(seed, 30 + i) * r * 1.6) - 1, col(['#ff6f91', '#ffd84a', '#ffffff'][i % 3]));
  return finishWithShadow(p, r + 1, 2);
}

/* ---------------- parks and recreation ---------------- */
function line(p: Pix, x0: number, y0: number, x1: number, y1: number, c: Col) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    p.put(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** A swing set with two swings; the frame runs along u. */
export function swingSetPix(u: number, v: number): Drawable {
  const q = Pix.around([proj(u - 1, v - 0.5, 26), proj(u + 1, v + 0.5, 0), proj(u + 1, v - 0.5, 0), proj(u - 1, v + 0.5, 0)], 3);
  const frame = col('#e8473f'), frameD = col('#b8302a'), rope = col('#6b5a4a'), seat = col('#3f7fe8');
  const top = (du: number) => proj(u + du, v, 22);
  for (const du of [-0.9, 0.9]) {
    const [tx, ty] = top(du);
    for (const dv of [-0.4, 0.4]) { const [gx, gy] = proj(u + du, v + dv, 0); line(q, tx, ty, gx, gy, dv > 0 ? frame : frameD); }
  }
  const [ax, ay] = top(-0.9), [bx, by] = top(0.9);
  line(q, ax, ay, bx, by, frame); line(q, ax, ay - 1, bx, by - 1, frame);
  for (const du of [-0.4, 0.4]) {
    const [rx, ry] = top(du), [sx, sy] = proj(u + du, v, 5);
    line(q, rx - 2, ry, sx - 2, sy, rope); line(q, rx + 2, ry, sx + 2, sy, rope);
    q.rect(Math.round(sx) - 3, Math.round(sy), 7, 2, seat);
  }
  return placed(q, depthOf(u, v + 0.4));
}

/** A slide: a little tower with a ladder and a yellow chute running down toward +u. */
export function slidePix(u: number, v: number): Drawable {
  const q = Pix.around([proj(u - 0.4, v - 0.4, 28), proj(u + 1.6, v + 0.4, 0), proj(u + 1.6, v - 0.4, 0), proj(u - 0.4, v + 0.4, 0)], 3);
  const post = col('#3f7fe8'), postD = col('#2c5fb8'), deck = col('#f4c430'), chute = col('#f7d24a'), chuteD = col('#d6a91c');
  const r: [number, number, number, number] = [u - 0.3, v - 0.3, u + 0.3, v + 0.3];
  q.box(r, 0, 16, { left: (x, y) => (x < 2 || x > 7.6 ? post : Math.floor(y) % 4 === 0 ? postD : 0), right: (x) => (x < 2 || x > 7.6 ? postD : 0), top: () => deck });
  q.box(r, 16, 7, { left: (x, y) => (x < 2 || x > 7.6 || y > 5 ? post : 0), right: (x, y) => (x < 2 || x > 7.6 || y > 5 ? postD : 0) });
  q.quad([u + 0.3, v - 0.22, 16], [0, 0.44, 0], [1.25, 0, -15], (f) => (f.s < 0.15 || f.s > 0.85 ? chuteD : chute));
  return placed(q, depthOf(u + 1.2, v + 0.3));
}

/** A basketball hoop on a pole; the backboard faces along u toward `face`. */
export function hoopPix(u: number, v: number, face: 1 | -1): Drawable {
  const q = Pix.around([proj(u - 0.6, v - 0.6, 34), proj(u + 0.6, v + 0.6, 0), proj(u + 0.6, v - 0.6, 0), proj(u - 0.6, v + 0.6, 0)], 3);
  const pole = col('#3a3550'), board = col('#ffffff'), rim = col('#ff6a2a');
  const [px, py] = proj(u, v);
  q.rect(Math.round(px), Math.round(py) - 26, 1, 26, pole);
  q.wall(u + face * 0.15, v - 0.35, u + face * 0.15, v + 0.35, 22, 10, (x, y) => (x < 1 || x > 10 || y < 1 || y > 9 ? pole : (Math.abs(x - 5.6) < 2.2 && y < 5 && y > 1.5 && (x < 4 || x > 7 || y < 2.5 || y > 4) ? rim : board)));
  const [rx, ry] = proj(u + face * 0.35, v, 23);
  q.rect(Math.round(rx) - 2, Math.round(ry), 5, 1, rim); q.rect(Math.round(rx) - 1, Math.round(ry) + 1, 3, 2, col('#f1ead8'));
  return placed(q, depthOf(u, v));
}

/** A tennis net across the court, running along v. */
export function netPix(u: number, v0: number, v1: number): Drawable {
  const q = Pix.around([proj(u, v0, 7), proj(u, v1, 7), proj(u, v0, 0), proj(u, v1, 0)], 2);
  const mesh = col('#2b2533'), tape = col('#ffffff'), post = col('#3a3550');
  q.wall(u, v0, u, v1, 0, 6, (x, y) => {
    const L = (v1 - v0) * 16;
    if (x < 1 || x > L - 1) return post;
    if (y > 4.8) return tape;
    return (Math.floor(x) + Math.floor(y)) % 2 === 0 ? mesh : 0;
  });
  return placed(q, depthOf(u, v1) + 0.5, false);
}

/** A rounded climbing dome made of colorful bars. */
export function domePix(u: number, v: number): Drawable {
  const r = 0.55;
  const q = Pix.around([proj(u - r, v - r, 18), proj(u + r, v + r, 0), proj(u + r, v - r, 0), proj(u - r, v + r, 0)], 3);
  const cols = [col('#ff86b0'), col('#59c3ff'), col('#f4c430'), col('#7fd8c0')];
  for (let z = 0; z <= 14; z += 2) {
    const rr = r * Math.sqrt(1 - (z / 15) ** 2);
    q.top([u - rr, v - rr, u + rr, v + rr], z, (a, b) => {
      const d = Math.hypot(a - rr, b - rr);
      if (d > rr || d < rr - 0.09) return 0;
      const ang = Math.atan2(b - rr, a - rr);
      return cols[Math.floor((ang + Math.PI) / (Math.PI / 2)) % 4];
    });
  }
  return placed(q, depthOf(u, v) + 2);
}
