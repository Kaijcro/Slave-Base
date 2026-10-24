import type { Pt, Rect } from '../iso/iso';

/**
 * The street grid.
 *
 * Streets run along u = 0, 10, 20, 30 and v = 0, 10, 20, 30, making a 3 x 3 grid of blocks.
 * Each street is 2 units of road with a 1-unit sidewalk on each side, so a block's buildable
 * area is u (or v) from 10b + 2 to 10b + 8.
 *
 * The outer streets are the edge of town. Two through roads (u = 20 and v = 20) carry on
 * out into the countryside, and a footpath leads north to the church.
 */
export const LINES = [0, 10, 20, 30];
export const TOWN: Rect = [-2, -2, 32, 32];
export const THROUGH_U = 20; // the north-south road that leaves town (constant u)
export const THROUGH_V = 20; // the east-west road that leaves town (constant v)

export type BlockType = 'park' | 'refuge' | 'palms' | 'goose' | 'square' | 'playground' | 'courts' | 'ai' | 'pond';

/**
 * What is on each block, keyed by "column,row" (u-block, v-block).
 * The businesses sit on three corners with Town Hall in the middle, so every building has parks around it.
 */
export const BLOCKS: Record<string, BlockType> = {
  '0,0': 'park', '1,0': 'palms', '2,0': 'refuge',
  '0,1': 'playground', '1,1': 'square', '2,1': 'courts',
  '0,2': 'ai', '1,2': 'pond', '2,2': 'goose',
};

/** Building footprints, in world units. */
export const FOOT = {
  refuge: [22.4, 2.8, 28, 7.2] as Rect,
  goose: [23, 23, 26.4, 27] as Rect,
  ai: [2.7, 22.7, 7.3, 27.3] as Rect,
  hall: [12.4, 12.3, 17.6, 14.8] as Rect,
  church: [11, -15, 15, -8.2] as Rect,
};

/** Town Square: the paved area in front of Town Hall where people wait and take breaks. */
export const PLAZA: Rect = [12.4, 15.9, 17.6, 17.9];
/** Two small fountains flank the walkway up to Town Hall's steps. */
export const FOUNTAINS: Pt[] = [[13.4, 16.9], [16.6, 16.9]];

/** The church footpath leaves town across the north street at u = CHURCH_U. */
export const CHURCH_U = 13;

/** Distance from a value to the nearest street line, and that line. */
export function nearLine(x: number): [number, number] {
  let best = Infinity, line = 0;
  for (const L of LINES) { const d = Math.abs(x - L); if (d < best) { best = d; line = L; } }
  return [best, line];
}

export const blockOf = (u: number, v: number) => `${Math.floor(u / 10)},${Math.floor(v / 10)}`;

/* ---------------- walking network ---------------- */

/**
 * People walk along the sidewalk around each block (a loop 1.5 units in from the street center),
 * cross at the crosswalks, and leave the loop at a "gate" in front of each building.
 */
export class WalkGraph {
  nodes: Pt[] = [];
  adj: number[][] = [];
  private index = new Map<string, number>();

  node(p: Pt): number {
    const k = `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    let i = this.index.get(k);
    if (i === undefined) { i = this.nodes.length; this.nodes.push([p[0], p[1]]); this.adj.push([]); this.index.set(k, i); }
    return i;
  }
  link(a: number, b: number) {
    if (a === b || this.adj[a].includes(b)) return;
    this.adj[a].push(b); this.adj[b].push(a);
  }
  find(p: Pt) { return this.index.get(`${p[0].toFixed(2)},${p[1].toFixed(2)}`); }

  /** Put a point onto the straight edge it lies on, splitting that edge in two. */
  insert(p: Pt): number {
    const existing = this.find(p);
    if (existing !== undefined) return existing;
    for (let a = 0; a < this.nodes.length; a++) {
      for (const b of this.adj[a]) {
        if (b < a) continue;
        const [ax, ay] = this.nodes[a], [bx, by] = this.nodes[b];
        const onU = Math.abs(ay - by) < 1e-6 && Math.abs(p[1] - ay) < 1e-6 && p[0] > Math.min(ax, bx) && p[0] < Math.max(ax, bx);
        const onV = Math.abs(ax - bx) < 1e-6 && Math.abs(p[0] - ax) < 1e-6 && p[1] > Math.min(ay, by) && p[1] < Math.max(ay, by);
        if (onU || onV) {
          const n = this.node(p);
          this.adj[a] = this.adj[a].filter((x) => x !== b); this.adj[b] = this.adj[b].filter((x) => x !== a);
          this.link(a, n); this.link(n, b);
          return n;
        }
      }
    }
    throw new Error(`Gate ${p} is not on any sidewalk`);
  }

  /** Shortest route between two nodes (Dijkstra), as a list of node ids. */
  route(from: number, to: number): number[] {
    const n = this.nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
    dist[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === to) break;
      done[u] = true;
      for (const v of this.adj[u]) {
        const d = dist[u] + Math.hypot(this.nodes[u][0] - this.nodes[v][0], this.nodes[u][1] - this.nodes[v][1]);
        if (d < dist[v]) { dist[v] = d; prev[v] = u; }
      }
    }
    const out: number[] = [];
    for (let i = to; i >= 0; i = prev[i]) { out.unshift(i); if (i === from) break; }
    return out[0] === from ? out : [from, to];
  }

  nearest(p: Pt) {
    let best = 0, bd = Infinity;
    this.nodes.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  }
}

export function buildWalkGraph(gates: Pt[]): WalkGraph {
  const g = new WalkGraph();
  const lo = 1.5, hi = 8.5;
  for (let bi = 0; bi < 3; bi++) {
    for (let bj = 0; bj < 3; bj++) {
      const u0 = bi * 10 + lo, u1 = bi * 10 + hi, v0 = bj * 10 + lo, v1 = bj * 10 + hi;
      const a = g.node([u0, v0]), b = g.node([u1, v0]), c = g.node([u1, v1]), d = g.node([u0, v1]);
      g.link(a, b); g.link(b, c); g.link(c, d); g.link(d, a);
      // crosswalks to the neighbouring blocks
      if (bi < 2) { g.link(b, g.node([u1 + 3, v0])); g.link(c, g.node([u1 + 3, v1])); }
      if (bj < 2) { g.link(d, g.node([u0, v1 + 3])); g.link(c, g.node([u1, v1 + 3])); }
    }
  }
  // the footpath north to the church: mid-block crosswalk, then up the hill
  const onRing = g.insert([CHURCH_U, 1.5]);
  const across = g.node([CHURCH_U, -1.5]);
  g.link(onRing, across);
  for (const p of gates) {
    if (g.find(p) !== undefined) continue;
    if (p[0] === CHURCH_U && p[1] < -1.5) g.link(across, g.node(p));
    else g.insert(p);
  }
  return g;
}
