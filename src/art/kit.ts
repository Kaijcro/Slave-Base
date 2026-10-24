import { proj, frontDepthAt, type Rect } from '../iso/iso';
import { Pix, col, pixelText, type Col } from '../iso/raster';
import { PF } from '../config';

/**
 * Shared building blocks for the town art: the Building type, the outline color, and small helpers.
 */
export const OUT = col('#2b2533');

export interface Drawable {
  /** Screen y used for sorting: higher numbers are closer to the viewer and drawn later. */
  depth: number;
  draw(g: CanvasRenderingContext2D): void;
}

/** A building drawn into its own canvas, cut into thin strips so people sort correctly in front of or behind it. */
export class Building {
  base: HTMLCanvasElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  glow: HTMLCanvasElement | null;
  outline: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  private alpha: Uint8ClampedArray;
  strips: Drawable[] = [];

  constructor(public key: string, pix: Pix, depthFoot: Rect, public animate?: (b: Building, t: number, busy: boolean) => void) {
    pix.outline(OUT);
    this.x = pix.x; this.y = pix.y; this.w = pix.w; this.h = pix.h;
    this.base = pix.canvas();
    this.glow = pix.glowCanvas();
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.base, 0, 0);
    this.alpha = new Uint8ClampedArray(this.w * this.h);
    for (let i = 0; i < this.w * this.h; i++) this.alpha[i] = pix.data[i] ? 1 : 0;
    this.outline = makeOutline(pix);
    const SW = 4;
    for (let sx = 0; sx < this.w; sx += SW) {
      const w = Math.min(SW, this.w - sx);
      const depth = frontDepthAt(this.x + sx + w / 2, depthFoot);
      this.strips.push({ depth, draw: (g) => g.drawImage(this.canvas, sx, 0, w, this.h, this.x + sx, this.y, w, this.h) });
    }
  }

  /** Redraw animated parts (signs, flags, lights) on top of the static art. Coordinates are screen pixels. */
  frame(t: number, busy: boolean) {
    if (!this.animate) return;
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.drawImage(this.base, 0, 0);
    g.setTransform(1, 0, 0, 1, -this.x, -this.y);
    this.animate(this, t, busy);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  hit(x: number, y: number) {
    x = Math.floor(x - this.x); y = Math.floor(y - this.y);
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.alpha[y * this.w + x] === 1;
  }
}

/** A 1-pixel mint ring around a building's silhouette, shown when it is selected. */
function makeOutline(p: Pix) {
  const o = new Pix(p.x - 1, p.y - 1, p.w + 2, p.h + 2);
  const c = col('#86e0bd');
  for (let y = -1; y <= p.h; y++) for (let x = -1; x <= p.w; x++) {
    const inside = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < p.w && yy < p.h && p.data[yy * p.w + xx] !== 0;
    if (inside(x, y)) continue;
    if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)) o.put(p.x + x, p.y + y, c);
  }
  return o.canvas();
}

/** A drawing surface big enough for a footprint up to height h. */
export function pixFor(foot: Rect, h: number, pad = 4) {
  const [u0, v0, u1, v1] = foot;
  const pts: [number, number][] = [];
  for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) { pts.push(proj(u, v, 0)); pts.push(proj(u, v, h)); }
  return Pix.around(pts, pad);
}

export const inBox = (x: number, y: number, x0: number, y0: number, w: number, h: number) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;

/** Pixel text laid out in wall coordinates: returns a test for (x, y) on that wall. */
export function wallText(txt: string, size: number, cx: number, top: number) {
  const t = pixelText(txt, size, PF);
  const x0 = Math.round(cx - t.w / 2);
  return { w: t.w, h: t.h, x0, on: (x: number, y: number) => t.on(Math.floor(x) - x0, Math.floor(top - y)) };
}

/** Repeating horizontal siding boards. */
export const siding = (y: number, step: number, base: Col, line: Col) => (Math.floor(y) % step === 0 ? line : base);

/** Is (x, y) inside an arched window of width w whose rectangular part spans y0..y1 and arch rises above y1? */
export function arch(x: number, y: number, x0: number, w: number, y0: number, y1: number) {
  if (x < x0 || x >= x0 + w || y < y0) return false;
  if (y < y1) return true;
  const r = w / 2, cx = x0 + r, dx = x + 0.5 - cx, dy = y - y1;
  return dx * dx + dy * dy <= r * r;
}
