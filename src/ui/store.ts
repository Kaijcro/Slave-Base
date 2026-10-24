import type { PlaceKey } from '../world/places';

export type Selection = { type: 'agent'; id: string } | { type: 'place'; key: PlaceKey };

/** Tiny shared state between the game canvas and the sidebar. */
export const store = {
  sel: { type: 'agent', id: 'hank' } as Selection,
  hover: null as string | null,
  speed: 1,
  /** The person the map camera is following, if any. */
  follow: null as string | null,
  /** Map camera controls, filled in by the town scene once it starts. */
  cam: { zoomBy: (_f: number) => {}, reset: () => {}, zoom: 1 },
  listeners: new Set<() => void>(),
  select(s: Selection) {
    this.sel = s;
    this.listeners.forEach((fn) => fn());
  },
  setFollow(id: string | null) {
    this.follow = id;
    this.listeners.forEach((fn) => fn());
  },
};
