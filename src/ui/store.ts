import type { PlaceKey } from '../world/places';

export type Selection = { type: 'agent'; id: string } | { type: 'place'; key: PlaceKey };

/** Tiny shared state between the game canvas and the sidebar. */
export const store = {
  sel: { type: 'agent', id: 'hank' } as Selection,
  hover: null as string | null,
  speed: 1,
  listeners: new Set<() => void>(),
  select(s: Selection) {
    this.sel = s;
    this.listeners.forEach((fn) => fn());
  },
};
