import { PF } from '../config';
import { pixelText } from '../iso/raster';
import type { PlaceKey } from '../world/places';
import type { Dir } from './human';

/**
 * The inside of each building, seen from above (the classic top-down RPG view:
 * the back wall faces you, the floor runs toward you, furniture shows its top and front).
 *
 * Rooms are drawn on a 520 x 320 pixel grid and shown at 2x.
 * Each room has:
 *  - bg:     floor, walls and anything people never stand in front of (drawn once)
 *  - pieces: furniture that people can be in front of or behind, sorted by its bottom edge
 *  - seats:  where people sit or stand while they work; `owner` keeps a desk for one agent
 *  - animate: blinking screens, bubbles, candles... drawn every frame on top of the background
 */
export const IW = 520, IH = 320;
export type Enterable = Exclude<PlaceKey, 'plaza'>;

export interface Seat { x: number; y: number; dir: Dir; owner?: string }
export interface Piece { y: number; canvas: HTMLCanvasElement; x: number; top: number }
export interface Room {
  key: Enterable;
  bg: HTMLCanvasElement;
  pieces: Piece[];
  seats: Seat[];
  /** Where the door is, so the sidebar and labels can point at it. */
  door: [number, number];
  animate(g: CanvasRenderingContext2D, t: number, busy: number): void;
}

const OUT = '#2b2533';
type Ctx = CanvasRenderingContext2D;
type R = (x: number, y: number, w: number, h: number, c: string) => void;
const painter = (g: Ctx): R => (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return { c, g, P: painter(g) };
}

/** Hard-pixel text (no blur). */
function text(g: Ctx, s: string, x: number, y: number, size: number, color: string, center = false) {
  const t = pixelText(s, size, PF);
  const x0 = center ? Math.round(x - t.w / 2) : x;
  g.fillStyle = color;
  for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) if (t.on(i, j)) g.fillRect(x0 + i, y + j, 1, 1);
  return t.w;
}

let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/* ---------------- building blocks ---------------- */

/** A furniture block seen from above: an outlined top surface with a front face below it. */
function block(P: R, x: number, y: number, w: number, h: number, top: string, front: string, fh: number) {
  P(x - 1, y - 1, w + 2, h + 2, OUT);
  P(x, y, w, h - fh, top);
  P(x, y + h - fh, w, fh, front);
  P(x, y + h - fh, w, 1, OUT);
  P(x, y, w, 1, 'rgba(255,255,255,.25)');
}

/** The back wall across the top of a room, with side walls and the front wall with a door. */
function shell(P: R, wall: string, wallD: string, trim: string, floor: () => void, wallH = 74) {
  floor();
  P(0, 0, IW, wallH, wall);
  P(0, 0, IW, 6, OUT);
  P(0, 6, IW, 3, wallD);
  P(0, wallH - 6, IW, 6, trim);
  P(0, wallH - 6, IW, 1, 'rgba(255,255,255,.3)');
  P(0, wallH, IW, 3, 'rgba(0,0,0,.18)');
  // side walls and front wall (seen from above), with a doorway in the middle of the front
  P(0, 0, 8, IH, OUT); P(IW - 8, 0, 8, IH, OUT);
  P(0, IH - 8, IW / 2 - 26, 8, OUT); P(IW / 2 + 26, IH - 8, IW / 2 - 26, 8, OUT);
  P(8, wallH, 2, IH - wallH - 8, 'rgba(0,0,0,.15)'); P(IW - 10, wallH, 2, IH - wallH - 8, 'rgba(0,0,0,.15)');
  // doormat
  P(IW / 2 - 18, IH - 16, 36, 8, '#7a4a2a'); P(IW / 2 - 16, IH - 15, 32, 6, '#9a6238');
}

function window_(P: R, x: number, y: number, w: number, h: number, frame: string, night = false) {
  P(x - 2, y - 2, w + 4, h + 4, OUT);
  P(x - 1, y - 1, w + 2, h + 2, frame);
  P(x, y, w, h, night ? '#1d2a4a' : '#8fd3f4');
  P(x, y + h - Math.round(h * 0.35), w, Math.round(h * 0.35), night ? '#24365e' : '#6fc06a'); // treetops outside
  for (let i = 0; i < w; i += 7) P(x + i, y + h - Math.round(h * 0.35) - 2, 5, 3, night ? '#24365e' : '#5aa84f');
  P(x + w / 2 - 1, y, 2, h, frame);
  P(x, y + h / 2 - 1, w, 2, frame);
  P(x + 2, y + 2, 3, h / 2 - 4, 'rgba(255,255,255,.55)');
}

function plant(P: R, x: number, y: number, pot = '#c8664f') {
  P(x - 6, y - 8, 12, 9, OUT); P(x - 5, y - 7, 10, 7, pot); P(x - 5, y - 7, 10, 2, 'rgba(255,255,255,.25)');
  const leaf = ['#2e7134', '#3b8a3e', '#54aa46', '#7cc95c'];
  for (const [dx, dy, r] of [[0, -16, 6], [-6, -12, 5], [6, -12, 5], [0, -21, 4], [-3, -18, 4], [4, -19, 3]]) {
    P(x + dx - r, y + dy - r + 1, r * 2, r * 2 - 2, OUT);
  }
  for (const [dx, dy, r] of [[0, -16, 6], [-6, -12, 5], [6, -12, 5], [0, -21, 4], [-3, -18, 4], [4, -19, 3]]) {
    P(x + dx - r + 1, y + dy - r + 2, r * 2 - 2, r * 2 - 4, leaf[1]);
    P(x + dx - r + 1, y + dy - r + 2, r - 1, r - 2, leaf[2]);
  }
  P(x - 2, y - 22, 2, 2, leaf[3]); P(x + 3, y - 15, 2, 2, leaf[3]);
}

function rug(P: R, x: number, y: number, w: number, h: number, a: string, b: string) {
  P(x, y, w, h, a); P(x + 3, y + 3, w - 6, h - 6, b); P(x + 6, y + 6, w - 12, h - 12, a);
  for (let i = x + 2; i < x + w - 2; i += 4) { P(i, y - 2, 1, 2, b); P(i, y + h, 1, 2, b); }
}

/** A chair back, drawn in front of someone sitting with their back to us. */
function chairBack(color: string) {
  const { c, P } = canvas(18, 14);
  P(1, 0, 16, 10, OUT); P(2, 1, 14, 8, color); P(2, 1, 14, 2, 'rgba(255,255,255,.25)');
  P(3, 10, 2, 4, OUT); P(13, 10, 2, 4, OUT);
  return c;
}

/** A desk with a computer whose screen faces up the room (toward the back wall). */
function deskPiece(w: number, top: string, front: string, opts: { monitors?: number; extra?: (P: R) => void } = {}) {
  const h = 30;
  const { c, P } = canvas(w + 2, h + 22);
  const oy = 20;
  block(P, 1, oy + 1, w, h, top, front, 9);
  P(3, oy + h - 8 + 1, 2, 8, OUT); P(w - 3, oy + h - 8 + 1, 2, 8, OUT);
  const m = opts.monitors ?? 1;
  const mw = 22, gap = 4, total = m * mw + (m - 1) * gap, mx0 = Math.round((w - total) / 2) + 1;
  for (let i = 0; i < m; i++) {
    const mx = mx0 + i * (mw + gap);
    P(mx - 1, oy - 15, mw + 2, 17, OUT); P(mx, oy - 14, mw, 15, '#3a3e4c'); P(mx + 1, oy - 13, mw - 2, 12, '#1b2234');
    P(mx + mw / 2 - 2, oy + 1, 4, 4, OUT); P(mx + mw / 2 - 6, oy + 4, 12, 2, OUT);
  }
  // keyboard and mug
  P(Math.round(w / 2) - 10, oy + 9, 20, 5, OUT); P(Math.round(w / 2) - 9, oy + 10, 18, 3, '#d9d6e2');
  P(w - 11, oy + 6, 6, 7, OUT); P(w - 10, oy + 7, 4, 5, '#ffffff');
  opts.extra?.(P);
  return { c, oy, screens: Array.from({ length: m }, (_, i) => ({ x: mx0 + i * (mw + gap) + 1, y: oy - 13, w: mw - 2, h: 12 })) };
}

/* ---------------- animation helpers ---------------- */
interface Screen { x: number; y: number; w: number; h: number; style: 'code' | 'chart' | 'sheet' | 'map' | 'social' }
function drawScreen(g: Ctx, s: Screen, t: number, on: boolean, i: number) {
  const P = painter(g);
  if (!on) { P(s.x, s.y, s.w, s.h, '#1b2234'); P(s.x + 1, s.y + 1, 2, 1, '#2c3550'); return; }
  P(s.x, s.y, s.w, s.h, '#0f1e33');
  const k = Math.floor(t * 3 + i * 7);
  if (s.style === 'code') {
    for (let r = 0; r < Math.floor(s.h / 2); r++) {
      const len = 3 + ((r * 7 + k) % 9) * 1.4;
      P(s.x + 1 + ((r * 3) % 4), s.y + 1 + r * 2, Math.min(len, s.w - 3), 1, ['#59e3ff', '#86e0bd', '#f6c560', '#b9b0ff'][(r + k) % 4]);
    }
  } else if (s.style === 'chart') {
    for (let b = 0; b < Math.floor(s.w / 3); b++) {
      const hh = 2 + Math.round(((Math.sin(b * 0.9 + t * 1.5 + i) + 1) / 2) * (s.h - 4));
      P(s.x + 1 + b * 3, s.y + s.h - 1 - hh, 2, hh, b % 3 ? '#59e3ff' : '#86e0bd');
    }
  } else if (s.style === 'sheet') {
    P(s.x, s.y, s.w, s.h, '#e9f2e6');
    for (let r = 0; r < s.h; r += 3) P(s.x, s.y + r, s.w, 1, '#9fc59a');
    for (let cc = 0; cc < s.w; cc += 6) P(s.x + cc, s.y, 1, s.h, '#9fc59a');
    P(s.x + 1, s.y + 1 + ((k % Math.max(1, Math.floor(s.h / 3))) * 3), 5, 2, '#3f9a64');
  } else if (s.style === 'map') {
    P(s.x, s.y, s.w, s.h, '#bfe3a8');
    P(s.x + 3, s.y + 2, s.w - 8, 3, '#8fd3f4');
    for (let p = 0; p < 4; p++) P(s.x + 2 + ((p * 5 + k) % (s.w - 4)), s.y + 5 + ((p * 3) % (s.h - 6)), 2, 2, '#e04a4a');
  } else {
    P(s.x, s.y, s.w, s.h, '#fff3f7');
    P(s.x + 2, s.y + 2, s.w - 4, 5, '#ff86b0');
    P(s.x + 2, s.y + 8, 4 + (k % (s.w - 6)), 1, '#c8664f');
  }
}

/* ======================================================================
 * Refuge Properties: a loft office with dark wood and black steel,
 * big loft windows, a deal pipeline board, and the garage with the cars.
 * ==================================================================== */
function refugeRoom(): Room {
  seed = 11;
  const { c: bg, g, P } = canvas(IW, IH);
  const WALL = 74;
  shell(P, '#3b3f4f', '#2b2e38', '#8b5a34', () => {
    // warm wood planks in the office, polished concrete in the garage
    for (let y = WALL; y < IH; y += 6) {
      for (let x = 0, n = 0; x < 360; n++) {
        const len = 30 + ((n * 37 + y) % 40);
        P(x, y, Math.min(len, 360 - x), 6, ['#a26d42', '#9a6539', '#ad7748'][(n + y / 6) % 3 | 0]);
        P(x, y, 1, 6, '#6e4426');
        x += len;
      }
      P(0, y + 5, 360, 1, '#7d5030');
    }
    P(360, WALL, IW - 360, IH - WALL, '#bdbdb7');
    for (let i = 0; i < 260; i++) P(360 + rand() * 160, WALL + rand() * 240, 2, 1, rand() < 0.5 ? '#b0b0aa' : '#c9c9c4');
    for (let x = 372; x < IW; x += 54) P(x, 210, 2, 90, '#f2f2ee'); // parking lines
  });
  // loft windows across the office wall
  for (const x of [22, 96, 170]) window_(P, x, 16, 60, 42, '#23262e');
  // REFUGE PROPERTIES sign and the deal pipeline board
  P(244, 14, 110, 16, OUT); P(245, 15, 108, 14, '#23262e');
  text(g, 'REFUGE PROPERTIES', 299, 18, 6, '#f6c560', true);
  P(250, 34, 100, 30, OUT); P(251, 35, 98, 28, '#f4f4ee');
  text(g, 'DEAL PIPELINE', 300, 37, 5, '#3a3446', true);
  const notes = ['#ffd84a', '#ff9cc0', '#86e0bd', '#9fd3f4'];
  for (let col = 0; col < 4; col++) {
    P(254 + col * 24, 45, 1, 16, '#c9c5bb');
    for (let r = 0; r < 3 - (col === 3 ? 1 : 0); r++) P(256 + col * 24, 46 + r * 5, 9, 4, notes[(col + r) % 4]);
  }
  // garage: glass partition, roll-up door and the cars from above
  P(356, WALL, 4, 236, OUT); P(357, WALL, 2, 236, '#9fd3f4');
  P(372, 10, 136, 58, OUT); P(373, 11, 134, 56, '#c9ccd6');
  for (let y = 13; y < 66; y += 3) P(373, y, 134, 1, '#b0b4c0');
  topCar(P, 392, 214, '#d7263d', true);
  topCar(P, 448, 214, '#1c1c24', false);
  P(372, 92, 30, 16, OUT); P(373, 93, 28, 14, '#c8664f'); P(373, 93, 28, 3, '#e07a5f'); // toolbox
  rug(P, 40, 220, 150, 70, '#3f4a6b', '#55618a');

  const pieces: Piece[] = [];
  const screens: Screen[] = [];
  const add = (x: number, top: number, cv: HTMLCanvasElement, bottom: number) => pieces.push({ x, top, canvas: cv, y: bottom });
  // three desks facing the windows
  const desks: [number, string, Screen['style'], number, (P: R) => void][] = [
    [30, 'dex', 'social', 1, (Q) => { for (let i = 0; i < 4; i++) { Q(8 + i * 2, 21 + i, 14, 6, OUT); Q(9 + i * 2, 22 + i, 12, 4, '#ffffff'); } }],
    [130, 'hank', 'map', 1, (Q) => { Q(80, 23, 6, 14, OUT); Q(81, 24, 4, 12, '#e8dcc0'); Q(77, 24, 2, 2, '#c8664f'); }],
    [230, 'theo', 'sheet', 2, (Q) => { Q(6, 24, 10, 8, OUT); Q(7, 25, 8, 6, '#f6c560'); }],
  ];
  const seats: Seat[] = [];
  const chair = chairBack('#2b2e38');
  for (const [x, owner, style, n, extra] of desks) {
    const d = deskPiece(96, '#3c404d', '#2b2e38', { monitors: n, extra });
    add(x, 110, d.c, 110 + d.c.height);
    for (const s of d.screens) screens.push({ x: x + s.x, y: 110 + s.y, w: s.w, h: s.h, style });
    seats.push({ x: x + 49, y: 182, dir: 'up', owner });
    add(x + 40, 168, chair, 184);
  }
  // meeting table for visitors
  const { c: table, P: T } = canvas(132, 44);
  block(T, 1, 1, 130, 34, '#5a3a22', '#3e2716', 8);
  for (const [px, py] of [[20, 8], [62, 6], [100, 9]]) { T(px, py, 14, 10, OUT); T(px + 1, py + 1, 12, 8, '#ffffff'); }
  T(4, 34, 3, 8, OUT); T(125, 34, 3, 8, OUT);
  add(50, 236, table, 280);
  for (const x of [66, 116, 160]) seats.push({ x, y: 234, dir: 'down' });
  seats.push({ x: 116, y: 300, dir: 'up' });
  // coffee bar and plants
  const { c: coffee, P: C } = canvas(40, 40);
  block(C, 1, 14, 38, 24, '#2b2e38', '#1d1f2a', 8);
  C(8, 2, 14, 16, OUT); C(9, 3, 12, 14, '#c9ccd6'); C(12, 12, 6, 4, '#3a2a1a');
  add(300, 214, coffee, 252);
  const pl = canvas(16, 28); plant(pl.P, 8, 27); add(14, 64, pl.c, 92); add(336, 64, pl.c, 92); add(320, 268, pl.c, 296);

  return {
    key: 'refuge', bg, pieces, seats, door: [IW / 2, IH],
    animate(g2, t, busy) {
      screens.forEach((s, i) => drawScreen(g2, s, t, busy > 0 || i === 0, i));
      // the coffee machine steams
      const Q = painter(g2);
      for (let i = 0; i < 3; i++) { const k = (t * 0.8 + i / 3) % 1; Q(314 + Math.sin(k * 6 + i) * 2, 222 - k * 14, 1, 2, `rgba(255,255,255,${0.6 * (1 - k)})`); }
    },
  };
}

/** A car seen from above. */
function topCar(P: R, x: number, y: number, body: string, stripe: boolean) {
  P(x - 1, y - 1, 42, 78, OUT);
  P(x, y, 40, 76, body);
  P(x + 4, y + 16, 32, 14, '#2c3b55'); P(x + 5, y + 17, 10, 3, '#7f9cc4');
  P(x + 5, y + 54, 30, 9, '#2c3b55');
  P(x + 4, y + 31, 32, 22, body); P(x + 4, y + 31, 32, 2, 'rgba(255,255,255,.3)');
  if (stripe) { P(x + 16, y, 3, 76, '#ffffff'); P(x + 21, y, 3, 76, '#ffffff'); }
  P(x + 2, y + 1, 8, 3, '#fff4c2'); P(x + 30, y + 1, 8, 3, '#fff4c2');
  P(x + 2, y + 73, 8, 2, '#e0383c'); P(x + 30, y + 73, 8, 2, '#e0383c');
  P(x - 2, y + 10, 2, 10, OUT); P(x + 40, y + 10, 2, 10, OUT); P(x - 2, y + 56, 2, 10, OUT); P(x + 40, y + 56, 2, 10, OUT);
}

/* ======================================================================
 * Goose Pop Shop: mint and white tiles, a pink counter with soda fountains,
 * a menu board, syrup shelves, a neon goose and little cafe tables.
 * ==================================================================== */
function gooseRoom(): Room {
  seed = 22;
  const { c: bg, g, P } = canvas(IW, IH);
  const WALL = 74;
  shell(P, '#f7ecd4', '#e3d4b6', '#ff86b0', () => {
    for (let y = WALL; y < IH; y += 16) for (let x = 0; x < IW; x += 16) {
      P(x, y, 16, 16, (Math.floor(x / 16) + Math.floor((y - WALL) / 16)) % 2 ? '#ffffff' : '#a6e3cf');
      P(x, y, 16, 1, 'rgba(0,0,0,.05)');
    }
  });
  // pink stripe and wainscot
  P(8, 46, IW - 16, 6, '#ff86b0');
  for (let x = 8; x < IW - 8; x += 6) P(x, 52, 3, 16, '#fff6e3');
  // menu board
  P(170, 10, 180, 50, OUT); P(172, 12, 176, 46, '#2f2a3a');
  text(g, 'GOOSE POP MENU', 260, 15, 6, '#ffd2e4', true);
  const menu = [['GOOSE JUICE', '$5'], ['DIRTY DR', '$5'], ['COCO LIME', '$6'], ['PINK HONK', '$6']];
  menu.forEach(([n, p], i) => { const cx = i % 2 ? 268 : 180; const cy = 29 + Math.floor(i / 2) * 12; text(g, n, cx, cy, 5, '#f1ead8'); text(g, p, cx + 70, cy, 5, '#f6c560'); });
  // syrup shelves
  for (const sx of [24, 384]) {
    P(sx, 18, 112, 4, OUT); P(sx, 40, 112, 4, OUT); P(sx + 1, 18, 110, 3, '#c98a3a'); P(sx + 1, 40, 110, 3, '#c98a3a');
    const cols = ['#ff6f91', '#ffd84a', '#7fd8c0', '#b28bff', '#ff9a3c', '#59c3ff', '#e0383c'];
    for (let i = 0; i < 12; i++) {
      const bx = sx + 4 + i * 9, c1 = cols[(i + sx) % cols.length];
      P(bx, 7, 6, 11, OUT); P(bx + 1, 8, 4, 9, c1); P(bx + 2, 4, 2, 4, OUT);
      P(bx, 29, 6, 11, OUT); P(bx + 1, 30, 4, 9, cols[(i + 3) % cols.length]); P(bx + 2, 26, 2, 4, OUT);
    }
  }
  // neon goose outline on the wall (lit in animate)
  const neon: [number, number][] = [];
  const goose = ['....##', '...#..#', '...#.##', '...#.#', '..#..#', '.#....#####', '#..........#', '#.........#', '.#.......#', '..#######'];
  goose.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') neon.push([440 + i * 2, 52 + j * 2]); }));
  // checker rug by the door and a goose plush corner
  rug(P, 196, 250, 128, 40, '#ff86b0', '#ffd2e4');

  const pieces: Piece[] = [];
  const add = (x: number, top: number, cv: HTMLCanvasElement, bottom: number) => pieces.push({ x, top, canvas: cv, y: bottom });
  // the long counter: staff stand behind it (above it on screen), facing the room
  const { c: counter, P: K } = canvas(330, 60);
  block(K, 1, 20, 328, 38, '#fff6e3', '#ff86b0', 22);
  for (let x = 4; x < 326; x += 10) K(x, 40, 4, 17, '#ff9cc0');
  // soda fountain with taps
  K(20, 2, 60, 22, OUT); K(21, 3, 58, 20, '#c9ccd6'); K(21, 3, 58, 4, '#e8e8ee');
  for (let i = 0; i < 5; i++) { K(26 + i * 11, 12, 5, 9, OUT); K(27 + i * 11, 13, 3, 6, ['#ff6f91', '#ffd84a', '#7fd8c0', '#b28bff', '#ff9a3c'][i]); }
  // cups stack, register, tip jar
  for (let i = 0; i < 4; i++) { K(100 + i * 9, 10, 7, 12, OUT); K(101 + i * 9, 11, 5, 10, '#ffffff'); K(101 + i * 9, 14, 5, 2, '#ff86b0'); }
  K(220, 6, 30, 18, OUT); K(221, 7, 28, 16, '#3a3446'); K(224, 9, 22, 6, '#86e0bd');
  K(270, 12, 12, 12, OUT); K(271, 13, 10, 10, '#d9f4fb'); K(273, 18, 6, 3, '#86c870');
  add(96, 74, counter, 134);
  const seats: Seat[] = [
    { x: 236, y: 98, dir: 'down', owner: 'marisol' }, // at the register
    { x: 150, y: 98, dir: 'down' },
  ];
  // cafe tables: June works at one with her laptop
  const tables: [number, number, string | undefined][] = [[70, 188, 'june'], [200, 196, undefined], [330, 188, undefined], [440, 220, undefined]];
  for (const [tx, ty, owner] of tables) {
    const { c: tb, P: B } = canvas(44, 34);
    B(4, 0, 36, 22, OUT); B(5, 1, 34, 18, '#ffffff'); B(5, 1, 34, 3, '#ffd2e4'); B(5, 19, 34, 2, '#d9d4cc');
    B(20, 22, 4, 10, OUT);
    if (owner) { B(12, 4, 20, 12, OUT); B(13, 5, 18, 10, '#c9ccd6'); B(14, 6, 16, 7, '#fff3f7'); B(15, 7, 12, 2, '#ff86b0'); }
    else { B(10, 6, 6, 9, OUT); B(11, 7, 4, 7, '#ff86b0'); B(28, 5, 6, 9, OUT); B(29, 6, 4, 7, '#7fd8c0'); }
    add(tx - 22, ty - 30, tb, ty + 4);
    seats.push({ x: tx, y: ty + 30, dir: 'up', owner });
  }
  const pl = canvas(16, 28); plant(pl.P, 8, 27, '#7fd8c0'); add(14, 64, pl.c, 92); add(490, 64, pl.c, 92); add(490, 280, pl.c, 308);

  return {
    key: 'goose', bg, pieces, seats, door: [IW / 2, IH],
    animate(g2, t, busy) {
      const Q = painter(g2);
      const on = busy > 0 ? Math.sin(t * 7) > -0.7 : Math.sin(t * 1.3) > -0.97;
      for (const [x, y] of neon) Q(x, y, 2, 2, on ? '#ff9cc0' : '#8a4a6a');
      // fizzing bubbles over the soda fountain
      for (let i = 0; i < (busy ? 8 : 3); i++) {
        const k = (t * 0.7 + i / 8) % 1;
        Q(124 + i * 7 + Math.sin(k * 9 + i) * 2, 96 - k * 22, 1, 1, i % 2 ? '#ffd2e2' : '#ffffff');
      }
      if (busy && Math.sin(t * 4) > 0) Q(320, 85, 22, 6, '#86e0bd'); // register screen flashes
    },
  };
}

/* ======================================================================
 * AI Enterprizes: dark floor with glowing cyan lines, a big screen wall,
 * server racks with blinking lights, triple-monitor desks and beanbags.
 * ==================================================================== */
function aiRoom(): Room {
  seed = 33;
  const { c: bg, P } = canvas(IW, IH);
  const WALL = 74;
  shell(P, '#14203a', '#0f1830', '#59e3ff', () => {
    P(0, WALL, IW, IH - WALL, '#1d2536');
    for (let y = WALL; y < IH; y += 20) P(0, y, IW, 1, '#28324a');
    for (let x = 0; x < IW; x += 20) P(x, WALL, 1, IH - WALL, '#28324a');
    P(0, 200, IW, 1, '#59e3ff'); P(260, WALL, 1, IH - WALL, '#2ea6c8');
  });
  // the big screen wall
  P(150, 10, 220, 54, OUT); P(152, 12, 216, 50, '#0b1222');
  // server racks
  const leds: [number, number][] = [];
  for (const rx of [430, 470]) {
    P(rx, 8, 34, 62, OUT); P(rx + 1, 9, 32, 60, '#2a3142');
    for (let y = 12; y < 66; y += 6) { P(rx + 3, y, 28, 4, '#1a1f2c'); leds.push([rx + 5, y + 1], [rx + 9, y + 1], [rx + 26, y + 2]); }
  }
  // glass wall on the left with the city view
  window_(P, 24, 14, 96, 44, '#59e3ff', true);
  rug(P, 330, 230, 150, 60, '#28324a', '#3a4152');

  const pieces: Piece[] = [];
  const screens: Screen[] = [];
  const add = (x: number, top: number, cv: HTMLCanvasElement, bottom: number) => pieces.push({ x, top, canvas: cv, y: bottom });
  const seats: Seat[] = [];
  const chair = chairBack('#2c5a92');
  const desks: [number, number, string, Screen['style']][] = [[40, 108, 'priya', 'chart'], [170, 108, 'kofi', 'code']];
  for (const [x, y, owner, style] of desks) {
    const d = deskPiece(110, '#e8ecf2', '#9aa4b8', { monitors: 3 });
    add(x, y, d.c, y + d.c.height);
    for (const s of d.screens) screens.push({ x: x + s.x, y: y + s.y, w: s.w, h: s.h, style });
    seats.push({ x: x + 56, y: y + 72, dir: 'up', owner });
    add(x + 47, y + 58, chair, y + 74);
  }
  // a whiteboard of ideas and beanbags for visitors
  const { c: wb, P: Wb } = canvas(70, 52);
  Wb(1, 1, 68, 40, OUT); Wb(2, 2, 66, 38, '#f4f4ee');
  for (let i = 0; i < 5; i++) Wb(6, 6 + i * 7, 20 + ((i * 13) % 30), 2, ['#3f7fe8', '#e8473f', '#3f9a64', '#3a3446', '#f4c430'][i]);
  Wb(10, 41, 3, 10, OUT); Wb(56, 41, 3, 10, OUT);
  add(310, 108, wb, 160);
  for (const [bx, by, col] of [[350, 250, '#ff86b0'], [410, 262, '#f4c430'], [460, 246, '#59e3ff']] as [number, number, string][]) {
    const { c: bb, P: Bb } = canvas(36, 26);
    Bb(2, 4, 32, 20, OUT); Bb(3, 5, 30, 18, col); Bb(6, 7, 14, 6, 'rgba(255,255,255,.35)');
    add(bx - 18, by - 22, bb, by - 4);
    seats.push({ x: bx, y: by - 2, dir: 'down' });
  }
  seats.push({ x: 120, y: 270, dir: 'up' }, { x: 200, y: 270, dir: 'up' });
  const pl = canvas(16, 28); plant(pl.P, 8, 27, '#3a4152'); add(14, 64, pl.c, 92); add(140, 64, pl.c, 92);

  return {
    key: 'ai', bg, pieces, seats, door: [IW / 2, IH],
    animate(g2, t, busy) {
      const Q = painter(g2);
      // screen wall: a growing revenue chart and a headline
      const n = 26;
      for (let b = 0; b < n; b++) {
        const grow = busy ? 1 : 0.6;
        const h = 4 + Math.round((b / n) * 30 * grow + Math.sin(b * 1.3 + t * 2) * 3);
        Q(158 + b * 8, 58 - h, 6, h, b === n - 1 ? '#86e0bd' : '#2ea6c8');
      }
      Q(156, 15, 80, 7, '#0b1222');
      g2.fillStyle = busy ? `hsl(${(t * 80) % 360} 90% 70%)` : '#59e3ff';
      g2.fillRect(158, 16, Math.round(40 + 30 * ((Math.sin(t) + 1) / 2)), 2);
      leds.forEach(([x, y], i) => Q(x, y, 2, 2, Math.sin(t * (3 + (i % 5)) + i) > 0 ? (i % 3 ? '#5dff8a' : '#59e3ff') : '#1f4a2a'));
      screens.forEach((s, i) => drawScreen(g2, s, t, busy > 0 || i % 3 === 1, i));
    },
  };
}

/* ======================================================================
 * Town Hall: marble floor, a red carpet up to the governor's desk,
 * wood-paneled walls with portraits, flags, bookshelves and a clock.
 * ==================================================================== */
function hallRoom(): Room {
  seed = 44;
  const { c: bg, g, P } = canvas(IW, IH);
  const WALL = 74;
  shell(P, '#8b5a34', '#6e4426', '#efe6d3', () => {
    for (let y = WALL; y < IH; y += 20) for (let x = 0; x < IW; x += 20) {
      P(x, y, 20, 20, (Math.floor(x / 20) + Math.floor((y - WALL) / 20)) % 2 ? '#efe9da' : '#d8d2c4');
      P(x + 2, y + 2, 4, 1, 'rgba(255,255,255,.5)');
    }
    // red carpet from the door to the governor's desk
    P(IW / 2 - 30, 120, 60, IH - 120, '#a8322d');
    P(IW / 2 - 26, 120, 52, IH - 120, '#c23b4a');
    for (let y = 124; y < IH; y += 8) { P(IW / 2 - 28, y, 2, 4, '#e8c25a'); P(IW / 2 + 26, y, 2, 4, '#e8c25a'); }
  });
  // wood panels
  for (let x = 12; x < IW - 12; x += 40) { P(x, 12, 34, 50, '#7a4c2c'); P(x + 1, 13, 32, 1, '#a26d42'); }
  // town seal on the wall
  for (let r = 20; r > 0; r--) { const k = r / 20; P(260 - r, 36 - Math.round(r * 0.9), r * 2, Math.round(r * 1.8), r > 17 ? '#b8902f' : r > 15 ? '#e8c25a' : k > 0.5 ? '#2f6f5a' : '#86e0bd'); }
  text(g, 'TOWN', 260, 30, 5, '#f1ead8', true);
  // flags
  for (const [fx, c1, c2] of [[200, '#86e0bd', '#2f6f5a'], [306, '#3f7fe8', '#e8473f']] as [number, string, string][]) {
    P(fx, 10, 2, 60, '#e8c25a');
    P(fx + 2, 12, 16, 22, OUT); P(fx + 3, 13, 14, 20, c1); P(fx + 3, 20, 14, 6, c2);
  }
  // portraits
  for (const [px, col] of [[60, '#c98e62'], [430, '#e0a985']] as [number, string][]) {
    P(px - 2, 14, 32, 40, '#e8c25a'); P(px, 16, 28, 36, '#3a3446');
    P(px + 8, 22, 12, 12, col); P(px + 6, 34, 16, 18, '#26355e'); P(px + 8, 20, 12, 4, '#7a5a3a');
  }
  // clock
  P(140, 18, 26, 26, OUT); P(141, 19, 24, 24, '#efe6d3');

  const pieces: Piece[] = [];
  const add = (x: number, top: number, cv: HTMLCanvasElement, bottom: number) => pieces.push({ x, top, canvas: cv, y: bottom });
  // the governor's big desk: he sits behind it, facing the room
  const { c: big, P: Bg } = canvas(150, 52);
  block(Bg, 1, 14, 148, 36, '#5a3a22', '#3e2716', 16);
  Bg(10, 36, 128, 1, '#6e4426');
  Bg(14, 4, 26, 14, OUT); Bg(15, 5, 24, 12, '#ffffff'); Bg(17, 7, 18, 1, '#9aa4b8'); Bg(17, 10, 14, 1, '#9aa4b8');
  Bg(64, 8, 20, 8, OUT); Bg(65, 9, 18, 6, '#2f6f5a'); // nameplate
  Bg(110, 2, 10, 16, OUT); Bg(111, 3, 8, 6, '#e8c25a'); Bg(114, 9, 2, 8, '#e8c25a'); // lamp
  add(185, 104, big, 156);
  const seats: Seat[] = [{ x: 260, y: 116, dir: 'down', owner: 'governor' }];
  // Inês's desk with in-trays and stacks of reports
  const d = deskPiece(96, '#7a4c2c', '#5a3a22', { monitors: 1, extra: (Q) => { for (let i = 0; i < 3; i++) { Q(6, 18 - i * 3, 16, 4, OUT); Q(7, 19 - i * 3, 14, 2, '#ffffff'); } Q(74, 15, 16, 8, OUT); Q(75, 16, 14, 6, '#e8c25a'); } });
  add(36, 150, d.c, 150 + d.c.height);
  seats.push({ x: 85, y: 222, dir: 'up', owner: 'ines' });
  add(76, 208, chairBack('#a8322d'), 224);
  const inesScreen: Screen = { x: 36 + d.screens[0].x, y: 150 + d.screens[0].y, w: d.screens[0].w, h: d.screens[0].h, style: 'sheet' };
  // filing cabinets and bookshelves
  const { c: shelf, P: Sh } = canvas(76, 66);
  Sh(1, 1, 74, 64, OUT); Sh(2, 2, 72, 62, '#5a3a22');
  for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) Sh(5 + i * 7 + (r % 2), 6 + r * 15, 5, 12, ['#a8322d', '#26355e', '#2f6f5a', '#c98a3a', '#efe6d3'][(i + r) % 5]);
  add(426, 76, shelf, 142);
  const { c: cab, P: Cb } = canvas(30, 44);
  block(Cb, 1, 1, 28, 42, '#9aa4b8', '#7d879b', 34);
  for (let i = 0; i < 3; i++) Cb(10, 14 + i * 10, 10, 2, OUT);
  add(384, 98, cab, 142);
  // visitor chairs facing the governor
  for (const x of [200, 320]) {
    seats.push({ x, y: 196, dir: 'up' });
    add(x - 9, 182, chairBack('#26355e'), 198);
  }
  seats.push({ x: 380, y: 250, dir: 'up' }, { x: 440, y: 250, dir: 'up' });
  const pl = canvas(16, 28); plant(pl.P, 8, 27, '#efe6d3'); add(170, 64, pl.c, 92); add(334, 64, pl.c, 92);

  return {
    key: 'hall', bg, pieces, seats, door: [IW / 2, IH],
    animate(g2, t, busy) {
      const Q = painter(g2);
      // clock hands go round
      const a = t * 0.5, b = t * 0.04;
      for (let r = 1; r < 9; r++) Q(153 + Math.round(Math.sin(a) * r), 31 - Math.round(Math.cos(a) * r), 1, 1, OUT);
      for (let r = 1; r < 6; r++) Q(153 + Math.round(Math.sin(b) * r), 31 - Math.round(Math.cos(b) * r), 1, 1, '#a8322d');
      drawScreen(g2, inesScreen, t, true, 0);
      if (busy) { const k = (t * 0.5) % 1; Q(212, 112 - k * 10, 6, 4, `rgba(255,255,255,${1 - k})`); } // papers flutter
    },
  };
}

/* ======================================================================
 * Church: white walls, tall stained-glass windows, wooden pews,
 * a red aisle runner and an altar with flickering candles.
 * ==================================================================== */
function churchRoom(): Room {
  seed = 55;
  const { c: bg, P } = canvas(IW, IH);
  const WALL = 80;
  shell(P, '#f6f4ee', '#dcd9d2', '#c9c5bb', () => {
    for (let y = WALL; y < IH; y += 7) {
      for (let x = 0, n = 0; x < IW; n++) { const len = 40 + ((n * 23 + y) % 30); P(x, y, len, 7, ['#b07a46', '#a6703e', '#ba844f'][(n + y / 7) % 3 | 0]); P(x, y, 1, 7, '#7d5030'); x += len; }
      P(0, y + 6, IW, 1, '#8a5a34');
    }
    P(IW / 2 - 18, 110, 36, IH - 110, '#a8322d'); P(IW / 2 - 15, 110, 30, IH - 110, '#c23b4a');
  }, WALL);
  // stained-glass windows
  const glass = ['#e8473f', '#3f7fe8', '#f4c430', '#3f9a64', '#b28bff'];
  for (const wx of [40, 120, 370, 450]) {
    P(wx - 2, 10, 32, 62, OUT);
    for (let y = 0; y < 58; y++) for (let x = 0; x < 28; x++) {
      const dy = y - 14, dx = x - 14;
      if (y < 14 && dx * dx + dy * dy > 196) continue;
      P(wx + x, 12 + y, 1, 1, (x % 7 === 0 || y % 9 === 0) ? OUT : glass[(Math.floor(x / 7) + Math.floor(y / 9)) % 5]);
    }
  }
  // cross above the altar
  P(256, 10, 8, 40, '#e8c25a'); P(246, 20, 28, 8, '#e8c25a'); P(257, 11, 2, 38, '#fff0a8');

  const pieces: Piece[] = [];
  const add = (x: number, top: number, cv: HTMLCanvasElement, bottom: number) => pieces.push({ x, top, canvas: cv, y: bottom });
  // altar with candles
  const { c: altar, P: A } = canvas(120, 40);
  block(A, 1, 12, 118, 26, '#ffffff', '#e8e4da', 12);
  A(4, 18, 112, 4, '#a8322d'); A(56, 22, 8, 14, '#e8c25a');
  for (const cx of [14, 30, 88, 104]) { A(cx, 2, 4, 12, OUT); A(cx + 1, 3, 2, 10, '#fff6e3'); }
  add(200, 88, altar, 128);
  const flames = [14, 30, 88, 104].map((cx) => [200 + cx + 1, 88] as [number, number]);
  // pews: two columns, five rows; everyone sits facing the altar
  const seats: Seat[] = [];
  for (let r = 0; r < 5; r++) {
    const y = 160 + r * 30;
    for (const [x0, w] of [[60, 160], [IW / 2 + 26, 160]] as [number, number][]) {
      const { c: pew, P: Pw } = canvas(w + 2, 20);
      block(Pw, 1, 1, w, 18, '#7a4c2c', '#5a3a22', 10);
      Pw(1, 1, w, 3, '#8b5a34');
      add(x0, y, pew, y + 20);
      for (let s = 0; s < 3; s++) seats.push({ x: x0 + 30 + s * 50, y: y - 2, dir: 'up' });
    }
  }
  // order seats so people fill the front rows first
  seats.sort((a, b) => a.y - b.y || Math.abs(a.x - IW / 2) - Math.abs(b.x - IW / 2));

  return {
    key: 'church', bg, pieces, seats, door: [IW / 2, IH],
    animate(g2, t) {
      const Q = painter(g2);
      flames.forEach(([x, y], i) => {
        const f = Math.sin(t * 9 + i * 2) > 0;
        Q(x, y - 4 - (f ? 1 : 0), 2, 3 + (f ? 1 : 0), '#ffb020'); Q(x, y - 2, 2, 1, '#fff6c8');
      });
      // sunlight through the stained glass
      g2.globalAlpha = 0.12 + 0.04 * Math.sin(t * 0.5);
      for (const wx of [40, 120, 370, 450]) for (let i = 0; i < 5; i++) Q(wx + i * 6, 84 + i * 2, 6, 60, ['#e8473f', '#3f7fe8', '#f4c430', '#3f9a64', '#b28bff'][i]);
      g2.globalAlpha = 1;
    },
  };
}

let rooms: Partial<Record<Enterable, Room>> | null = null;
/** Rooms are drawn the first time someone goes inside. */
export function room(key: Enterable): Room {
  rooms ??= {};
  return (rooms[key] ??= ({ refuge: refugeRoom, goose: gooseRoom, ai: aiRoom, hall: hallRoom, church: churchRoom } as const)[key]());
}
export const isEnterable = (k: PlaceKey): k is Enterable => k !== 'plaza';
