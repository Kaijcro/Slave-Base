import { W, H } from '../config';
import { unproj } from './iso';
import { col, shade, type Col } from './raster';
import { BLOCKS, CHURCH_U, FOOT, FOUNTAINS, PLAZA, THROUGH_U, THROUGH_V, nearLine, type BlockType } from '../world/streets';

/**
 * The ground: grass, roads, sidewalks, the square and the parks.
 * It never changes, so it is painted once: every screen pixel is mapped back to the ground point
 * under it, and `groundAt` decides its color. Trees, lamps and buildings are drawn on top later.
 */

const C = {
  grass: col('#7cc145'), grassD: col('#6db53a'), grassL: col('#8fd152'), grassDD: col('#5a9e31'),
  meadow: col('#86c64a'),
  walk: col('#dedad2'), seam: col('#c6c1b7'), curb: col('#f1eee8'), curbShadow: col('#45464f'),
  asphalt: col('#5c5e69'), asphaltD: col('#545661'), asphaltL: col('#666874'),
  lane: col('#f4cf3a'), zebra: col('#f3f2ec'),
  paver: col('#e9d6ad'), paverD: col('#d8c193'), paverL: col('#f3e6c6'),
  stone: col('#cfd2d8'), stoneD: col('#b9bdc6'),
  path: col('#e6d4a2'), pathD: col('#d4c08b'),
  dirt: col('#c9a06b'), dirtD: col('#b48a57'), dirtL: col('#d8b27f'),
  water: col('#4fb4e3'), waterD: col('#3c9fd0'), waterL: col('#8fdcf5'), sand: col('#ecd9a0'),
  hedge: col('#3f8f3a'), hedgeL: col('#55a64a'),
  granite: col('#3a4152'), graniteL: col('#454d60'), cyan: col('#59e3ff'),
  concrete: col('#c9c9c4'), concreteD: col('#b7b7b1'), white: col('#f6f6f2'),
  mint: col('#a6e3cf'), mintD: col('#8fd1bb'),
  flowers: ['#ff6f91', '#ffd84a', '#ffffff', '#b28bff', '#ff9a3c'].map((c) => col(c)),
};

/** Stable pseudo-random number 0..1 for a pixel. */
function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const frac = (x: number) => x - Math.floor(x);

function grass(x: number, y: number, base = C.grass): Col {
  const r = hash(x, y);
  if (r < 0.06) return C.grassD;
  if (r < 0.1) return C.grassL;
  if (r > 0.9985) return C.flowers[(hash(x, y, 3) * 5) | 0];
  // soft larger patches
  const p = hash(x >> 3, y >> 2, 7);
  return p < 0.25 ? shade(base, 0.96) : base;
}

export function groundAt(u: number, v: number, x: number, y: number): Col {
  const uIn = u >= -2 && u <= 32, vIn = v >= -2 && v <= 32;
  const [du, lu] = nearLine(u), [dv, lv] = nearLine(v);
  // A: a street running along v at u = lu.  B: a street running along u at v = lv.
  // Inside town every street exists; outside it only the two through roads carry on.
  const aOk = du <= 2 && (vIn || lu === THROUGH_U);
  const bOk = dv <= 2 && (uIn || lv === THROUGH_V);
  if (aOk || bOk) return street(u, v, x, y, aOk ? du : 9, bOk ? dv : 9, lu, lv, aOk, bOk);
  if (uIn && vIn) return block(BLOCKS[`${Math.floor(u / 10)},${Math.floor(v / 10)}`], u - Math.floor(u / 10) * 10, v - Math.floor(v / 10) * 10, u, v, x, y);
  return country(u, v, x, y);
}

function street(u: number, v: number, x: number, y: number, du: number, dv: number, lu: number, lv: number, A: boolean, B: boolean): Col {
  const roadA = A && du <= 1, roadB = B && dv <= 1;
  if (roadA || roadB) {
    // curb shadow along the road edge
    if ((roadA && !roadB && du > 0.94 && dv > 1) || (roadB && !roadA && dv > 0.94 && du > 1)) return C.curbShadow;
    const r = hash(x, y, 1);
    let c = r < 0.08 ? C.asphaltD : r > 0.95 ? C.asphaltL : C.asphalt;
    if (roadA && roadB) {
      // intersection: a manhole in the middle
      const mu = u - lu, mv = v - lv;
      if (mu * mu + mv * mv < 0.09) return mu * mu + mv * mv < 0.05 ? C.asphaltL : C.asphaltD;
      return c;
    }
    if (roadA) {
      // zebra crossing where a cross street meets this one
      if (dv > 1.08 && dv < 1.92 && B) return frac((u - lu + 1) * 3.5) < 0.55 ? C.zebra : c;
      if (du < 0.045 && frac(v * 0.8) < 0.5) return C.lane;
    } else {
      if (du > 1.08 && du < 1.92 && A) return frac((v - lv + 1) * 3.5) < 0.55 ? C.zebra : c;
      // the church crosswalk on the north street
      if (lv === 0 && Math.abs(u - CHURCH_U) < 0.7) return frac((v + 1) * 3.5) < 0.55 ? C.zebra : c;
      if (dv < 0.045 && frac(u * 0.8) < 0.5) return C.lane;
    }
    return c;
  }
  // sidewalk with a light curb on the road side and tile seams
  if ((A && du <= 1.1) || (B && dv <= 1.1)) return C.curb;
  if (frac(u) < 0.07 || frac(v) < 0.07) return C.seam;
  return hash(x, y, 2) < 0.04 ? C.seam : C.walk;
}

function block(t: BlockType, a: number, b: number, u: number, v: number, x: number, y: number): Col {
  // a, b: position inside the block, from 2 to 8
  switch (t) {
    case 'park': return park(a, b, x, y, false);
    case 'palms': return park(a, b, x, y, true);
    case 'square': return square(a, b, u, v, x, y);
    case 'refuge': return refugeYard(a, b, u, v, x, y);
    case 'goose': return gooseYard(a, b, u, v, x, y);
    case 'ai': return aiPlaza(a, b, x, y);
    case 'lot': return lot(a, b, x, y);
    case 'pond': return pond(a, b, x, y);
  }
}

function hedgeRim(a: number, b: number, x: number, y: number): Col | 0 {
  if (a < 2.25 || a > 7.75 || b < 2.25 || b > 7.75) return hash(x, y, 4) < 0.2 ? C.hedgeL : C.hedge;
  return 0;
}

function park(a: number, b: number, x: number, y: number, palms: boolean): Col {
  const w = 0.28;
  const ca = a - 5, cb = b - 5, r = Math.hypot(ca, cb);
  const onPath = Math.abs(a - b) < w || Math.abs(a + b - 10) < w || Math.abs(r - 1.5) < w;
  if (r < 1.5 - w) return palms ? (hash(x, y, 9) < 0.5 ? C.flowers[(hash(x, y, 8) * 5) | 0] : C.grassDD) : (r < 0.7 ? C.paverD : C.paver);
  if (onPath) return hash(x, y, 5) < 0.12 ? C.pathD : C.path;
  return grass(x, y, palms ? C.meadow : C.grass);
}

function square(a: number, b: number, u: number, v: number, x: number, y: number): Col {
  const rim = hedgeRim(a, b, x, y);
  if (rim && !(b > 7.6 && Math.abs(a - 5) < 0.9)) return rim; // gap in the hedge at the front
  // fountains get a dark basin rim; the fountain itself is drawn as a prop
  for (const [fu, fv] of FOUNTAINS) if (Math.hypot(u - fu, v - fv) < 0.95) return C.stoneD;
  const [pu0, pv0, pu1, pv1] = PLAZA;
  if (u > pu0 && u < pu1 && v > pv0 && v < pv1) {
    // a star pattern of pavers in the middle of the square
    const ca = u - 15, cb = v - 16.9;
    if (Math.abs(ca) + Math.abs(cb) * 1.2 < 0.9) return frac((ca + cb) * 2) < 0.5 ? C.paverL : C.paverD;
  }
  // big stone pavers
  if (frac(u * 1.5) < 0.06 || frac(v * 1.5) < 0.06) return C.paverD;
  return hash(x, y, 6) < 0.05 ? C.paverL : C.paver;
}

function refugeYard(a: number, b: number, u: number, v: number, x: number, y: number): Col {
  const [, , , v1] = FOOT.refuge;
  if (a < 2.4) return grass(x, y);
  if (v > v1) {
    // concrete apron in front of the garage bays, with parking stripes
    if (frac(u * 0.5 + 0.35) < 0.03) return C.white;
    return hash(x, y, 7) < 0.06 ? C.concreteD : C.concrete;
  }
  return hash(x, y, 7) < 0.3 ? C.concreteD : C.concrete;
}

function gooseYard(a: number, b: number, u: number, v: number, x: number, y: number): Col {
  // patio in front of the shop: mint and white checkered tiles
  if (a > 6.4 && b > 2.6 && b < 7.4) return (Math.floor(u * 2) + Math.floor(v * 2)) % 2 ? C.white : C.mint;
  // flower beds along the sides
  if (b < 2.7 || b > 7.3) return hash(x, y, 11) < 0.35 ? C.flowers[(hash(x, y, 12) * 4) | 0] : C.grassDD;
  return grass(x, y);
}

function aiPlaza(a: number, b: number, x: number, y: number): Col {
  // dark granite with glowing cyan inlay lines
  if (Math.abs(a - 2.3) < 0.04 || Math.abs(b - 2.3) < 0.04 || Math.abs(a - 7.7) < 0.04 || Math.abs(b - 7.7) < 0.04) return C.cyan;
  if (frac(a) < 0.05 || frac(b) < 0.05) return C.graniteL;
  return hash(x, y, 13) < 0.05 ? C.graniteL : C.granite;
}

function lot(a: number, b: number, x: number, y: number): Col {
  if (a < 2.3 || a > 7.7 || b < 2.3 || b > 7.7) return grass(x, y);
  // tire tracks
  if (Math.abs(b - 4.6) < 0.12 || Math.abs(b - 5.4) < 0.12) return C.dirtD;
  const r = hash(x, y, 14);
  return r < 0.12 ? C.dirtD : r > 0.9 ? C.dirtL : C.dirt;
}

function pond(a: number, b: number, x: number, y: number): Col {
  const e = ((a - 5) / 2.5) ** 2 + ((b - 5) / 2.1) ** 2;
  if (e < 0.82) {
    // ripples
    if (hash(x >> 1, y, 15) < 0.03) return C.waterL;
    return e < 0.4 ? C.waterD : C.water;
  }
  if (e < 1) return C.sand;
  const r = Math.hypot(a - 5, (b - 5) * 1.15);
  if (Math.abs(r - 3.05) < 0.22) return C.path;
  return grass(x, y);
}

function country(u: number, v: number, x: number, y: number): Col {
  // the church footpath and churchyard
  if (Math.abs(u - CHURCH_U) < 0.38 && v > -8 && v < -2) return frac(v * 1.2) < 0.08 ? C.pathD : C.path;
  const [cu0, cv0, cu1, cv1] = FOOT.church;
  if (u > cu0 - 0.6 && u < cu1 + 0.6 && v > cv0 - 0.6 && v < cv1 + 0.9) return frac(u) < 0.06 || frac(v) < 0.06 ? C.stoneD : C.stone;
  // a lake south-west of town
  const le = ((u - 4) / 9) ** 2 + ((v - 41) / 5.5) ** 2;
  if (le < 1) return hash(x >> 1, y, 16) < 0.03 ? C.waterL : le < 0.55 ? C.waterD : C.water;
  if (le < 1.12) return C.sand;
  return grass(x, y, C.meadow);
}

export function buildGround(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const px = new Uint32Array(img.data.buffer);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [u, v] = unproj(x + 0.5, y + 0.5);
      px[y * W + x] = groundAt(u, v, x, y);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
