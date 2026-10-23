import type { PlaceKey } from './places';

/**
 * The road network: one oval ring road around the Town Hall island,
 * with a short road (a "spoke") from the ring to each building.
 *
 * People walk: out of their building along its spoke -> around the ring -> in along the next spoke.
 * `lo` is each person's lane offset, so they don't all walk on the exact same line.
 */
export type Pt = [number, number];

export const CX = 260;
export const CY = 182;
/** Outer and inner edges of the ring's asphalt, and the center line people walk on. */
export const RING = { rxo: 124, ryo: 90, rxi: 100, ryi: 66, rx: 112, ry: 78 };

/** The side roads to Goose Pop and AI Enterprizes run along y = 210. */
export const SIDE_ROAD_Y = 210;
const SIDE = Math.asin((SIDE_ROAD_Y - CY) / RING.ry);

/** Where on the ring (as an angle) each place's spoke joins. */
export const ATTACH: Record<PlaceKey, number> = {
  refuge: -Math.PI / 2, // top
  ai: SIDE, // right
  goose: Math.PI - SIDE, // left
  hall: Math.PI / 2, // bottom, into the island
  plaza: Math.PI / 2,
};

/** Y position of the gap in the hedge where people step onto the island. */
export const ISLAND_GATE_Y = 238;

export function ringPt(th: number, lo: number): Pt {
  return [CX + (RING.rx + lo) * Math.cos(th), CY + (RING.ry + lo * 0.7) * Math.sin(th)];
}

export function nearestTheta(x: number, y: number) {
  return Math.atan2((y - CY) / RING.ry, (x - CX) / RING.rx);
}

/** Points from the ring to a place's door (or to `end`), ring point first. */
export function entry(k: PlaceKey, lo: number, end: Pt): Pt[] {
  const r = ringPt(ATTACH[k], lo);
  const s = lo * 0.5;
  switch (k) {
    case 'refuge': return [r, [CX + s, 86], end];
    case 'goose':
    case 'ai': return [r, [end[0], SIDE_ROAD_Y + s], end];
    default: return [r, [CX + s, ISLAND_GATE_Y], end];
  }
}

/** Points along the ring from angle a to angle b, taking the shorter way round. */
export function arc(a: number, b: number, lo: number): Pt[] {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 18)));
  const P: Pt[] = [];
  for (let k = 1; k <= n; k++) P.push(ringPt(a + (d * k) / n, lo));
  return P;
}

/** A random open spot in Town Square, the paved area in front of Town Hall. */
export function plazaPoint(): Pt {
  for (let i = 0; i < 40; i++) {
    const y = 216 + Math.random() * 18;
    const hw = 90 * Math.sqrt(Math.max(0, 1 - ((y - CY) / 58) ** 2)) - 8;
    const x = CX - hw + Math.random() * hw * 2;
    const nearPlanter = Math.abs(y - 226) < 5 && (Math.abs(x - 198) < 8 || Math.abs(x - 322) < 8);
    if (hw > 10 && !nearPlanter) return [x, y];
  }
  return [CX - 20, 224];
}
