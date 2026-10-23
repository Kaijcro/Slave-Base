export type Paint = (x: number, y: number, w: number, h: number, c: string) => void;

/** Returns a fill-rectangle helper bound to a canvas context. Every drawing in the town is built from these. */
export const painter = (g: CanvasRenderingContext2D): Paint => (x, y, w, h, c) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};

/** A filled pixel circle, drawn row by row so it keeps hard pixel edges. */
export function disc(P: Paint, cx: number, cy: number, r: number, c: string) {
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt(r * r - dy * dy));
    P(cx - hw, cy + dy, hw * 2 + 1, 1, c);
  }
}

/** Small seeded random generator, so grass speckles and trees land in the same place every load. */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hcache: Record<string, number> = {};
/** Stable 0..1 number for a string (used to decide which windows glow at night). */
export function hash(s: string) {
  if (s in hcache) return hcache[s];
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (hcache[s] = ((h >>> 0) % 1000) / 1000);
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
