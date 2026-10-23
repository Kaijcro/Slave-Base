import { WALK_SPEED, SIM_MINUTES_PER_SECOND } from '../config';
import type { Dir } from '../art/human';
import { PLACES, PLACE_KEYS, onIsland, type PlaceKey } from '../world/places';
import { ATTACH, CX, arc, entry, nearestTheta, plazaPoint, ringPt, type Pt } from '../world/roads';
import type { AgentDef } from '../world/agents';
import type { AgentEvent, EmitOptions, EventKind } from '../data/types';

export type Status = 'working' | 'walking' | 'break' | 'waiting' | 'done';

export interface Figure extends AgentDef {
  x: number;
  y: number;
  state: 'inside' | 'walk' | 'idle';
  at: PlaceKey;
  target: PlaceKey | null;
  path: [number, number][];
  dir: Dir;
  frame: 0 | 1;
  dist: number;
  lo: number;
  status: Status;
  task: string;
  lastOut: string;
  done: number;
  bubble: string;
  bubbleT: number;
  wp: [number, number] | null;
  pause: number;
  idleAfter: number;
  pending: { kind: EventKind; text: string } | null;
}

export interface FeedItem { fig: Figure; kind: EventKind; text: string; place: PlaceKey; mins: number }

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

/**
 * The town's brain. It knows nothing about where events come from:
 * hand it AgentEvents and it moves people around, keeps the feed, and tracks who is inside each building.
 */
export class Town {
  figs: Figure[];
  byId = new Map<string, Figure>();
  occ = Object.fromEntries(PLACE_KEYS.map((k) => [k, 0])) as Record<PlaceKey, number>;
  feed: FeedItem[] = [];
  placeBubble: Partial<Record<PlaceKey, { text: string; t: number }>> = {};
  mins = 8 * 60;
  totalDone = 0;
  onArrive: (id: string, place: PlaceKey) => void = () => {};
  onFeed: (item: FeedItem) => void = () => {};

  constructor(defs: AgentDef[], public mode: 'demo' | 'live') {
    this.figs = defs.map((d, i) => {
      const at: PlaceKey = d.home ?? 'plaza';
      const f: Figure = {
        ...d, x: 0, y: 0, state: 'inside', at, target: null, path: [], dir: 'down', frame: 0, dist: 0,
        lo: (i - (defs.length - 1) / 2) * 1.35, status: 'waiting', task: '', lastOut: 'Nothing yet today', done: 0,
        bubble: '', bubbleT: 0, wp: null, pause: 0, idleAfter: 0, pending: null,
      };
      this.byId.set(d.id, f);
      return f;
    });
    // Everyone starts waiting in Town Square until their first event arrives.
    for (const f of this.figs) this.teleport(f, 'plaza');
    if (mode === 'live') this.mins = minutesOf(new Date());
  }

  /* ---------------- events in ---------------- */
  apply(ev: AgentEvent, o: EmitOptions = {}) {
    const f = this.byId.get(ev.agent_id);
    if (!f) { console.warn(`[town] Unknown agent_id "${ev.agent_id}". Add it to src/world/agents.ts.`); return; }
    if (!(ev.place in PLACES)) { console.warn(`[town] Unknown place "${ev.place}".`); return; }
    const mins = this.mode === 'live' && ev.created_at ? minutesOf(new Date(ev.created_at)) : this.mins;
    const item: FeedItem = { fig: f, kind: ev.kind, text: ev.text, place: ev.kind === 'break' ? 'plaza' : ev.place, mins };
    this.feed.unshift(item);
    if (this.feed.length > 60) this.feed.pop();
    this.onFeed(item);

    switch (ev.kind) {
      case 'progress':
        if (f.state === 'inside') this.placeBubble[f.at] = { text: ev.text, t: 3 };
        else this.say(f, ev.text, 2.5);
        break;
      case 'finished':
        f.lastOut = ev.text;
        f.done++;
        this.totalDone++;
        if (f.state === 'inside') { f.status = 'done'; f.idleAfter = o.instant ? 0.01 : 4; }
        break;
      case 'started':
      case 'break': {
        const dest: PlaceKey = ev.kind === 'break' ? 'plaza' : ev.place;
        f.task = ev.text;
        f.idleAfter = 0;
        const status: Status = ev.kind === 'break' ? 'break' : 'working';
        if (o.instant) { this.teleport(f, dest); f.status = status; return; }
        const here = f.at === dest && (f.state === 'inside' || (dest === 'plaza' && f.state === 'idle'));
        if (here) { f.status = status; this.onArrive(f.id, dest); }
        else this.walkTo(f, dest, { kind: ev.kind, text: ev.text }, ev.kind === 'break' ? ev.text || 'Break time' : intentFor(dest, ev.text));
        break;
      }
    }
  }

  /* ---------------- movement ---------------- */
  private say(f: Figure, text: string, dur: number) { f.bubble = text.length > 34 ? text.slice(0, 33) + '…' : text; f.bubbleT = dur; }

  teleport(f: Figure, dest: PlaceKey) {
    if (f.state === 'inside') this.occ[f.at] = Math.max(0, this.occ[f.at] - 1);
    f.at = dest; f.path = []; f.target = null; f.pending = null;
    if (dest === 'plaza') { const p = plazaPoint(); f.x = p[0]; f.y = p[1]; f.state = 'idle'; f.status = 'waiting'; f.pause = Math.random() * 2; }
    else { const d = PLACES[dest].door!; f.x = d[0]; f.y = d[1]; f.state = 'inside'; this.occ[dest]++; }
  }

  walkTo(f: Figure, dest: PlaceKey, pending: Figure['pending'], intent: string) {
    if (f.state === 'inside') {
      this.occ[f.at] = Math.max(0, this.occ[f.at] - 1);
      const d = PLACES[f.at].door!;
      f.x = d[0]; f.y = d[1];
    }
    // Where they are leaving from: a building or the square, or somewhere mid-walk.
    const from: PlaceKey | null = f.state === 'walk' ? null : f.at;
    const end: Pt = dest === 'plaza' ? plazaPoint() : [...PLACES[dest].door!];
    const lo = f.lo;
    const P: Pt[] = [];
    if (from && onIsland(from) && onIsland(dest)) {
      // Town Hall and the square share the island: walk straight across.
      P.push([CX + lo * 0.5, 232], end);
    } else {
      let th: number;
      if (from) {
        const out = entry(from, lo, [f.x, f.y]).reverse(); // door -> spoke -> ring
        P.push(...out.slice(1));
        th = ATTACH[from];
      } else {
        th = nearestTheta(f.x, f.y);
        P.push(ringPt(th, lo));
      }
      P.push(...arc(th, ATTACH[dest], lo)); // around the ring
      P.push(...entry(dest, lo, end).slice(1)); // ring -> spoke -> door
    }
    f.path = P; f.target = dest; f.state = 'walk'; f.status = 'walking'; f.dist = 0; f.pending = pending; f.wp = null;
    this.say(f, intent, 2.8);
  }

  private arrive(f: Figure) {
    const dest = f.target!;
    f.at = dest; f.target = null;
    const pending = f.pending;
    f.pending = null;
    if (dest === 'plaza') {
      f.state = 'idle'; f.wp = null; f.pause = 1;
      f.status = pending?.kind === 'break' ? 'break' : 'waiting';
    } else {
      f.state = 'inside'; this.occ[dest]++;
      f.status = 'working';
    }
    if (pending) this.onArrive(f.id, dest);
  }

  /* ---------------- per-frame ---------------- */
  update(dt: number, realDt: number) {
    if (this.mode === 'live') this.mins = minutesOf(new Date());
    else this.mins += dt * SIM_MINUTES_PER_SECOND;
    for (const k of Object.keys(this.placeBubble) as PlaceKey[]) { const b = this.placeBubble[k]!; b.t -= realDt; if (b.t <= 0) delete this.placeBubble[k]; }

    for (const f of this.figs) {
      f.bubbleT -= dt;
      if (f.state === 'walk') {
        const p = f.path[0];
        const dx = p[0] - f.x, dy = p[1] - f.y, d = Math.hypot(dx, dy), sp = WALK_SPEED * f.speed * dt;
        if (d <= sp) { f.x = p[0]; f.y = p[1]; f.path.shift(); if (!f.path.length) this.arrive(f); }
        else this.stepToward(f, dx, dy, d, sp);
      } else if (f.state === 'idle') {
        if (f.wp) {
          const dx = f.wp[0] - f.x, dy = f.wp[1] - f.y, d = Math.hypot(dx, dy), sp = 10 * dt;
          if (d <= sp) { f.wp = null; f.pause = 1.2 + Math.random() * 2; f.dir = 'down'; }
          else this.stepToward(f, dx, dy, d, sp);
        } else { f.pause -= dt; if (f.pause <= 0) f.wp = plazaPoint(); }
      } else if (f.idleAfter > 0) {
        // Finished and no new task yet: wander out to Town Square to wait.
        f.idleAfter -= realDt;
        if (f.idleAfter <= 0) { f.idleAfter = 0; this.walkTo(f, 'plaza', null, 'Done! Waiting for work'); }
      }
    }
  }

  private stepToward(f: Figure, dx: number, dy: number, d: number, sp: number) {
    f.x += (dx / d) * sp; f.y += (dy / d) * sp;
    f.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    f.dist += sp;
    f.frame = ((f.dist / 3.2) | 0) % 2 as 0 | 1;
  }

  workingCount() { return this.figs.filter((f) => f.state === 'inside').length; }
}

function intentFor(dest: PlaceKey, text: string) {
  if (dest === 'hall') return 'Filing a report';
  return text.length < 26 ? text : 'To ' + PLACES[dest].name;
}
