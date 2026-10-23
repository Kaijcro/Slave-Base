/**
 * Every location in town. The keys here are what agents report in the `place` column
 * of the agent_events table, so keep them short and stable.
 *
 * - door:  where people walk to before going inside (town pixels)
 * - rect:  clickable area [x, y, width, height]
 * - badge: where the "2 at work" tag floats
 *
 * How each place connects to the ring road lives in roads.ts.
 */
export const PLACE_KEYS = ['refuge', 'goose', 'ai', 'plaza', 'hall'] as const;
export type PlaceKey = (typeof PLACE_KEYS)[number];

export interface Place {
  name: string;
  biz: string;
  door: [number, number] | null;
  rect: [number, number, number, number];
  color: string;
  badge: [number, number] | null;
}

export const PLACES: Record<PlaceKey, Place> = {
  refuge: { name: 'Refuge Properties', biz: 'Real estate investing: warehouse and office', door: [260, 76],  rect: [146, 4, 228, 86],    color: '#c8664f', badge: [260, 12] },
  goose:  { name: 'Goose Pop Shop',    biz: 'Dirty soda shop',                             door: [67, 196],  rect: [6, 100, 120, 98],    color: '#ff86b0', badge: [60, 136] },
  ai:     { name: 'AI Enterprizes',    biz: 'Building new income-generating AI businesses', door: [456, 196], rect: [400, 2, 112, 196],   color: '#5fb4ff', badge: [432, 18] },
  plaza:  { name: 'Town Square',       biz: 'Where agents wait and take breaks',           door: null,       rect: [160, 116, 200, 132], color: '#e3c08a', badge: null },
  hall:   { name: 'Town Hall',         biz: 'Daily briefs and review',                     door: [260, 212], rect: [204, 124, 112, 92],  color: '#86e0bd', badge: [260, 124] },
};

/** Places where agents do business work (Town Hall and the square are shared). */
export const BIZ: PlaceKey[] = ['refuge', 'goose', 'ai'];

export const isPlace = (s: string): s is PlaceKey => (PLACE_KEYS as readonly string[]).includes(s);
export const onIsland = (k: PlaceKey) => k === 'hall' || k === 'plaza';
