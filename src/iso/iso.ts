/**
 * Isometric projection.
 *
 * The world is laid out on a flat grid of (u, v) "units". One unit is one sidewalk tile:
 *   - moving +u goes down-right on screen, +v goes down-left
 *   - z is height in pixels
 * Every screen pixel the town draws lives on a W x H grid, and 2:1 pixel staircases make the diagonals crisp.
 */
export const TU = 16; // screen pixels across per unit
export const TV = 8; // screen pixels down per unit
export const X0 = 520; // screen position of world (0, 0)
export const Y0 = 136;

export type Pt = [number, number];
export type V3 = [number, number, number];

/** World (u, v, z) to screen pixels. */
export const proj = (u: number, v: number, z = 0): Pt => [X0 + (u - v) * TU, Y0 + (u + v) * TV - z];

/** Screen pixels to the ground point (u, v) under them. */
export function unproj(x: number, y: number): Pt {
  const a = (x - X0) / TU, b = (y - Y0) / TV;
  return [(a + b) / 2, (b - a) / 2];
}

/** Draw order: things lower on screen (closer to the viewer) are drawn later. */
export const depthOf = (u: number, v: number) => Y0 + (u + v) * TV;

/** Footprint rectangle on the ground: [u0, v0, u1, v1]. */
export type Rect = [number, number, number, number];

export const inRect = (u: number, v: number, r: Rect) => u >= r[0] && u <= r[2] && v >= r[1] && v <= r[3];

/**
 * Screen-space depth of a footprint's front edge at screen column x.
 * Big buildings are drawn in thin vertical strips, each sorted by this value,
 * so people walking past a building are hidden behind it or drawn in front of it correctly.
 */
export function frontDepthAt(x: number, f: Rect): number {
  const [u0, v0, u1, v1] = f;
  const k = (x - X0) / TU;
  let best = -Infinity;
  const uOnFront = k + v1; // along the +v face (v = v1)
  if (uOnFront >= u0 - 1e-6 && uOnFront <= u1 + 1e-6) best = Math.max(best, uOnFront + v1);
  const vOnRight = u1 - k; // along the +u face (u = u1)
  if (vOnRight >= v0 - 1e-6 && vOnRight <= v1 + 1e-6) best = Math.max(best, u1 + vOnRight);
  if (best === -Infinity) best = k > 0 ? u1 + v0 : u0 + v1; // past the corners
  return Y0 + best * TV;
}
