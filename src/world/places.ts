import type { Pt, Rect } from '../iso/iso';
import { CHURCH_U, PLAZA } from './streets';

/**
 * Every location in town. The keys here are what agents report in the `place` column
 * of the agent_events table, so keep them short and stable.
 *
 * - door:  where people step inside and disappear (world units)
 * - gate:  the spot on the sidewalk in front of the door, where the walking network joins
 * - badge: where the "2 at work" tag floats: [u, v, height in pixels]
 * - rect:  screen area used for the sidebar preview; filled in when the town art is built
 *
 * The church is not a work place: nobody reports `church`. The town sends everyone there on Sunday mornings.
 */
export const PLACE_KEYS = ['refuge', 'goose', 'ai', 'plaza', 'hall', 'church'] as const;
export type PlaceKey = (typeof PLACE_KEYS)[number];

export interface Place {
  name: string;
  biz: string;
  door: Pt | null;
  gate: Pt;
  color: string;
  badge: [number, number, number] | null;
  rect: [number, number, number, number];
}

export const PLACES: Record<PlaceKey, Place> = {
  refuge: { name: 'Refuge Properties', biz: 'Real estate investing: loft office and garage', door: [25.6, 7.5], gate: [25.6, 8.5], color: '#c8664f', badge: [25.2, 5, 96], rect: [0, 0, 1, 1] },
  goose:  { name: 'Goose Pop Shop',    biz: 'Dirty soda shop',                             door: [26.7, 25], gate: [28.5, 25],   color: '#ff86b0', badge: [24.7, 25, 92],  rect: [0, 0, 1, 1] },
  ai:     { name: 'AI Enterprizes',    biz: 'Building new income-generating AI businesses', door: [7.6, 25], gate: [8.5, 25],     color: '#5fb4ff', badge: [5, 25, 300],   rect: [0, 0, 1, 1] },
  plaza:  { name: 'Town Square',       biz: 'Where agents wait and take breaks',           door: null,       gate: [15, 18.5],    color: '#e3c08a', badge: null,           rect: [0, 0, 1, 1] },
  hall:   { name: 'Town Hall',         biz: 'Daily briefs and review',                     door: [15, 15.1], gate: [15, 18.5],    color: '#86e0bd', badge: [15, 13.5, 132], rect: [0, 0, 1, 1] },
  church: { name: 'Church',            biz: 'Where the whole town goes on Sunday morning', door: [CHURCH_U, -7.9], gate: [CHURCH_U, -6.6], color: '#f1ead8', badge: [13, -11, 150], rect: [0, 0, 1, 1] },
};

/** Places where agents do business work (Town Hall and the square are shared). */
export const BIZ: PlaceKey[] = ['refuge', 'goose', 'ai'];

export const isPlace = (s: string): s is PlaceKey => (PLACE_KEYS as readonly string[]).includes(s);
/** Town Hall opens straight onto Town Square, so people walk directly between them. */
export const onSquare = (k: PlaceKey) => k === 'hall' || k === 'plaza';

export { PLAZA };
export type { Rect };
