import { proj, type Rect, type V3 } from './iso';

/**
 * A tiny pixel rasterizer for isometric art.
 *
 * Every surface (a wall, a roof, a sign) is a flat 3D parallelogram. For each screen pixel it covers,
 * we work out where on that surface the pixel lands and ask a "shader" function what color it is.
 * Because the surface coordinates follow the wall, windows and bricks automatically come out skewed
 * on the 2:1 isometric grid, with hard pixel edges.
 */

/** Colors are packed as 0xAABBGGRR so they can be written straight into ImageData. */
export type Col = number;
const cache = new Map<string, Col>();
export function col(hex: string, a = 255): Col {
  const k = hex + a;
  let c = cache.get(k);
  if (c === undefined) {
    const n = parseInt(hex.slice(1), 16);
    c = ((a << 24) | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0;
    cache.set(k, c);
  }
  return c;
}
/** Scale a color's brightness (k < 1 darkens, k > 1 lightens). */
export function shade(c: Col, k: number): Col {
  const r = Math.min(255, Math.round((c & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round(((c >> 16) & 255) * k));
  return ((c & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
}
export function mix(a: Col, b: Col, t: number): Col {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return ((255 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/** What a shader gets for each pixel. s, t run 0..1 across the surface; the e* values are pixel distances to its four edges. */
export interface Frag {
  s: number;
  t: number;
  /** distance in pixels to the s = 0 and s = 1 edges */
  es0: number;
  es1: number;
  /** distance in pixels to the t = 0 and t = 1 edges */
  et0: number;
  et1: number;
  x: number;
  y: number;
}
/** Return a color, or 0 to leave the pixel alone (a hole, like an arch's outside corner). */
export type Shader = (f: Frag) => Col;
/** Shader for a wall: x = pixels from the wall's left end, y = pixels up from its bottom. */
export type WallShader = (x: number, y: number, f: Frag) => Col;
/** Shader for a flat top: u, v = units from the rectangle's back corner. */
export type TopShader = (u: number, v: number, f: Frag) => Col;

const F: Frag = { s: 0, t: 0, es0: 0, es1: 0, et0: 0, et1: 0, x: 0, y: 0 };

export class Pix {
  data: Uint32Array;
  glow: Uint32Array;
  private hasGlow = false;

  /** A drawing surface covering screen pixels [x, x + w) x [y, y + h). */
  constructor(public x: number, public y: number, public w: number, public h: number) {
    this.data = new Uint32Array(w * h);
    this.glow = new Uint32Array(w * h);
  }

  static around(points: [number, number][], pad = 2) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const x = Math.floor(Math.min(...xs)) - pad, y = Math.floor(Math.min(...ys)) - pad;
    return new Pix(x, y, Math.ceil(Math.max(...xs)) - x + pad, Math.ceil(Math.max(...ys)) - y + pad);
  }

  put(x: number, y: number, c: Col) {
    x -= this.x; y -= this.y;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    this.data[y * this.w + x] = c;
  }
  get(x: number, y: number): Col {
    x -= this.x; y -= this.y;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }
  /** Mark a pixel as a window that lights up at night. */
  lit(x: number, y: number, c: Col) {
    x -= this.x; y -= this.y;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.glow[y * this.w + x] = c;
    this.hasGlow = true;
  }
  rect(x: number, y: number, w: number, h: number, c: Col) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, c);
  }

  /** Any flat parallelogram: corner o, edges a and b, all in world (u, v, z). */
  quad(o: V3, a: V3, b: V3, sh: Shader, glow?: Shader) {
    const p0 = proj(o[0], o[1], o[2]);
    const pa = proj(o[0] + a[0], o[1] + a[1], o[2] + a[2]);
    const pb = proj(o[0] + b[0], o[1] + b[1], o[2] + b[2]);
    const ax = pa[0] - p0[0], ay = pa[1] - p0[1], bx = pb[0] - p0[0], by = pb[1] - p0[1];
    const det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-6) return;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const xs = [p0[0], pa[0], pb[0], pa[0] + bx], ys = [p0[1], pa[1], pb[1], pa[1] + by];
    const x0 = Math.max(this.x, Math.floor(Math.min(...xs))), x1 = Math.min(this.x + this.w, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(this.y, Math.floor(Math.min(...ys))), y1 = Math.min(this.y + this.h, Math.ceil(Math.max(...ys)));
    const ad = Math.abs(det);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - p0[0], dy = y + 0.5 - p0[1];
        const s = (dx * by - dy * bx) / det;
        const t = (ax * dy - ay * dx) / det;
        if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;
        F.s = s; F.t = t; F.x = x; F.y = y;
        F.es0 = (s * ad) / lb; F.es1 = ((1 - s) * ad) / lb;
        F.et0 = (t * ad) / la; F.et1 = ((1 - t) * ad) / la;
        const c = sh(F);
        if (c) {
          this.data[(y - this.y) * this.w + (x - this.x)] = c;
          if (glow) {
            const g = glow(F);
            if (g) { this.glow[(y - this.y) * this.w + (x - this.x)] = g; this.hasGlow = true; }
          }
        }
      }
    }
  }

  /** A vertical wall from ground point (u0, v0) to (u1, v1), from height z0 up h pixels. */
  wall(u0: number, v0: number, u1: number, v1: number, z0: number, h: number, sh: WallShader, glow?: WallShader) {
    // Always run the wall left to right on screen, so x counts from its left end.
    if (proj(u1, v1)[0] < proj(u0, v0)[0]) [u0, v0, u1, v1] = [u1, v1, u0, v0];
    const L = Math.abs(proj(u1, v1)[0] - proj(u0, v0)[0]);
    this.quad([u0, v0, z0], [u1 - u0, v1 - v0, 0], [0, 0, h], (f) => sh(f.s * L, f.t * h, f), glow && ((f) => glow(f.s * L, f.t * h, f)));
  }

  /** A flat horizontal surface over rectangle r at height z. */
  top(r: Rect, z: number, sh: TopShader, glow?: TopShader) {
    const du = r[2] - r[0], dv = r[3] - r[1];
    this.quad([r[0], r[1], z], [du, 0, 0], [0, dv, 0], (f) => sh(f.s * du, f.t * dv, f), glow && ((f) => glow(f.s * du, f.t * dv, f)));
  }

  /** A solid block: its +u face (right), +v face (left) and top. */
  box(r: Rect, z0: number, h: number, s: { top?: TopShader; left?: WallShader; right?: WallShader }, g: { left?: WallShader; right?: WallShader } = {}) {
    const [u0, v0, u1, v1] = r;
    if (s.right) this.wall(u1, v1, u1, v0, z0, h, s.right, g.right);
    if (s.left) this.wall(u0, v1, u1, v1, z0, h, s.left, g.left);
    if (s.top) this.top(r, z0 + h, s.top);
  }

  /** Darken the outermost ring of pixels, the chunky outline typical of this pixel-art style. */
  outline(c: Col) {
    const { w, h, data } = this;
    const edge: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!data[i]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !data[i - 1] || !data[i + 1] || !data[i - w] || !data[i + w]) edge.push(i);
      }
    }
    for (const i of edge) data[i] = c;
  }

  private toCanvas(buf: Uint32Array) {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(buf);
    g.putImageData(img, 0, 0);
    return c;
  }
  canvas() { return this.toCanvas(this.data); }
  glowCanvas() { return this.hasGlow ? this.toCanvas(this.glow) : null; }

  /** Copy another Pix on top of this one, shifted by (dx, dy); `keep` can limit which pixels change. */
  blit(src: Pix, dx = 0, dy = 0, keep?: (x: number, y: number, under: Col) => boolean) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.data[y * src.w + x];
      if (!c) continue;
      const X = src.x + x + dx, Y = src.y + y + dy;
      if (keep && !keep(X, Y, this.get(X, Y))) continue;
      this.put(X, Y, c);
    }
  }
}

/* ---------------- pixel text ---------------- */

/**
 * Renders text as hard pixels (no blurry anti-aliasing), optionally skewed onto an isometric wall.
 * slope +0.5 follows a wall that runs down-right (+u); -0.5 follows one that runs down-left (+v... seen as up-right).
 */
export function pixelText(txt: string, size: number, font: string, weight = 600): { w: number; h: number; on: (x: number, y: number) => boolean } {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = `${weight} ${size}px ${font}`;
  const w = Math.ceil(g.measureText(txt).width) + 2, h = Math.ceil(size * 1.3) + 2;
  c.width = w; c.height = h;
  g.font = `${weight} ${size}px ${font}`;
  g.textBaseline = 'top';
  g.fillStyle = '#000';
  g.fillText(txt, 1, 1);
  const d = g.getImageData(0, 0, w, h).data;
  // trim empty rows so callers can center vertically
  let top = h, bot = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 110) { top = Math.min(top, y); bot = Math.max(bot, y); }
  const th = Math.max(0, bot - top + 1);
  return { w, h: th, on: (x, y) => x >= 0 && x < w && y >= 0 && y < th && d[((y + top) * w + x) * 4 + 3] > 110 };
}
