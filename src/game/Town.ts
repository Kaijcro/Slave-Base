import { WALK_SPEED, SIM_MINUTES_PER_SECOND, DEMO_START_DAY, CHURCH } from '../config';
import type { Dir } from '../art/human';
import { PLACES, PLACE_KEYS, onSquare, type PlaceKey } from '../world/places';
import { buildWalkGraph, FOUNTAINS, PLAZA, type WalkGraph } from '../world/streets';
import type { Pt } from '../iso/iso';
import type { AgentDef } from '../world/agents';
import type { AgentEvent, EmitOptions, EventKind } from '../data/types';

export type Status = 'working' | 'walking' | 'break' | 'waiting' | 'done' | 'church';

interface Resume { kind: 'started' | 'break'; place: PlaceKey; text: string }

export interface Figure extends AgentDef {
  /** Position on the ground, in world units (see src/iso/iso.ts). */
  u: number;
  v: number;
  state: 'inside' | 'walk' | 'idle';
  at: PlaceKey;
  target: PlaceKey | null;
  path: Pt[];
  /** Walking-network node for each point in `path` (-1 for doors and square spots). */
  via: number[];
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
  wp: Pt | null;
  pause: number;
  idleAfter: number;
  pending: { kind: EventKind; text: string } | null;
  /** Their recent activity, newest first (shown in the agent monitor). */
  log: { mins: number; kind: EventKind; text: string; place: PlaceKey }[];
  /** During the Sunday service: what to go back to afterwards, and when they sat down. */
  resume: Resume | null;
  seatedAt: number | null;
}

export interface FeedItem { fig: Figure; kind: EventKind; text: string; place: PlaceKey; mins: number }

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
const dayNumber = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);

/**
 * The town's brain. It knows nothing about where events come from:
 * hand it AgentEvents and it moves people around, keeps the feed, and tracks who is inside each building.
 * The one thing it decides by itself is church: on Sunday mornings everyone walks there for the service.
 */
export class Town {
  figs: Figure[];
  byId = new Map<string, Figure>();
  occ = Object.fromEntries(PLACE_KEYS.map((k) => [k, 0])) as Record<PlaceKey, number>;
  feed: FeedItem[] = [];
  placeBubble: Partial<Record<PlaceKey, { text: string; t: number }>> = {};
  /** Minutes since midnight on the first day (demo) or of today (live). */
  mins = 8 * 60;
  /** Live mode only: run the sky's day/night cycle fast (a day every 4 minutes) instead of following the real clock. */
  fastDays = false;
  totalDone = 0;
  graph: WalkGraph;
  /** True from the first church bell until the service ends. */
  service = false;
  /** True while the bell is calling people in. */
  bell = false;
  private serviceDay = -1;
  onArrive: (id: string, place: PlaceKey) => void = () => {};
  onFeed: (item: FeedItem) => void = () => {};

  constructor(defs: AgentDef[], public mode: 'demo' | 'live') {
    this.graph = buildWalkGraph(PLACE_KEYS.map((k) => PLACES[k].gate));
    this.figs = defs.map((d, i) => {
      const at: PlaceKey = d.home ?? 'plaza';
      const f: Figure = {
        ...d, u: 0, v: 0, state: 'inside', at, target: null, path: [], via: [], dir: 'down', frame: 0, dist: 0,
        lo: (i - (defs.length - 1) / 2) * 0.09, status: 'waiting', task: '', lastOut: 'Nothing yet today', done: 0,
        bubble: '', bubbleT: 0, wp: null, pause: 0, idleAfter: 0, pending: null, resume: null, seatedAt: null, log: [],
      };
      this.byId.set(d.id, f);
      return f;
    });
    // Everyone starts waiting in Town Square until their first event arrives.
    for (const f of this.figs) this.teleport(f, 'plaza');
    if (mode === 'live') this.mins = minutesOf(new Date());
  }

  /* ---------------- calendar ---------------- */
  /** 0 = Sunday ... 6 = Saturday. */
  weekday() {
    if (this.mode === 'live') return new Date().getDay();
    return (DEMO_START_DAY + Math.floor(this.mins / 1440)) % 7;
  }
  private dayIndex() { return this.mode === 'live' ? dayNumber(new Date()) : Math.floor(this.mins / 1440); }
  /** A running clock in minutes, used to time how long people have sat in church. */
  private clock() { return this.mode === 'live' ? Date.now() / 60000 : this.mins; }

  /* ---------------- events in ---------------- */
  apply(ev: AgentEvent, o: EmitOptions = {}) {
    const f = this.byId.get(ev.agent_id);
    if (!f) { console.warn(`[town] Unknown agent_id "${ev.agent_id}". Add it to src/world/agents.ts.`); return; }
    if (!(ev.place in PLACES)) { console.warn(`[town] Unknown place "${ev.place}".`); return; }
    const mins = this.mode === 'live' && ev.created_at ? minutesOf(new Date(ev.created_at)) : this.mins;
    const item: FeedItem = { fig: f, kind: ev.kind, text: ev.text, place: ev.kind === 'break' ? 'plaza' : ev.place, mins };
    this.feed.unshift(item);
    if (this.feed.length > 60) this.feed.pop();
    f.log.unshift({ mins, kind: ev.kind, text: ev.text, place: item.place });
    if (f.log.length > 30) f.log.pop();
    this.onFeed(item);

    const inChurch = this.service && !o.instant;
    switch (ev.kind) {
      case 'progress':
        if (f.state === 'inside') this.placeBubble[f.at] = { text: ev.text, t: 3 };
        else this.say(f, ev.text, 2.5);
        break;
      case 'finished':
        f.lastOut = ev.text;
        f.done++;
        this.totalDone++;
        if (f.state === 'inside' && !inChurch) { f.status = 'done'; f.idleAfter = o.instant ? 0.01 : 4; }
        if (inChurch && f.resume?.kind === 'started') f.resume = null;
        break;
      case 'started':
      case 'break': {
        const dest: PlaceKey = ev.kind === 'break' ? 'plaza' : ev.place;
        f.task = ev.text;
        f.idleAfter = 0;
        // Agents keep reporting during the service; people pick it up when they leave church.
        if (inChurch) { f.resume = { kind: ev.kind, place: dest, text: ev.text }; return; }
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

  /** A random open spot in Town Square, clear of the fountains. */
  plazaPoint(): Pt {
    const [u0, v0, u1, v1] = PLAZA;
    for (let i = 0; i < 50; i++) {
      const p: Pt = [u0 + 0.4 + Math.random() * (u1 - u0 - 0.8), v0 + 0.3 + Math.random() * (v1 - v0 - 0.6)];
      if (FOUNTAINS.every(([fu, fv]) => Math.hypot(p[0] - fu, p[1] - fv) > 1.15)) return p;
    }
    return [15, 17.4];
  }

  /** A short stroll inside the square that doesn't pass through a fountain. */
  private wanderPoint(f: Figure): Pt | null {
    for (let i = 0; i < 12; i++) {
      const p = this.plazaPoint();
      const clear = FOUNTAINS.every(([cu, cv]) => {
        const du = p[0] - f.u, dv = p[1] - f.v, L = du * du + dv * dv || 1;
        const k = Math.max(0, Math.min(1, ((cu - f.u) * du + (cv - f.v) * dv) / L));
        return Math.hypot(f.u + du * k - cu, f.v + dv * k - cv) > 0.95;
      });
      if (clear) return p;
    }
    f.pause = 1;
    return null;
  }

  teleport(f: Figure, dest: PlaceKey) {
    if (f.state === 'inside') this.occ[f.at] = Math.max(0, this.occ[f.at] - 1);
    f.at = dest; f.path = []; f.via = []; f.target = null; f.pending = null;
    if (dest === 'plaza') { [f.u, f.v] = this.plazaPoint(); f.state = 'idle'; f.status = 'waiting'; f.pause = Math.random() * 2; }
    else { [f.u, f.v] = PLACES[dest].door!; f.state = 'inside'; this.occ[dest]++; }
  }

  walkTo(f: Figure, dest: PlaceKey, pending: Figure['pending'], intent: string) {
    if (f.state === 'inside') {
      this.occ[f.at] = Math.max(0, this.occ[f.at] - 1);
      [f.u, f.v] = PLACES[f.at].door!;
    }
    const G = this.graph, lo = f.lo;
    const end: Pt = dest === 'plaza' ? this.plazaPoint() : [...PLACES[dest].door!];
    const P: Pt[] = [], via: number[] = [];
    const off = (i: number): Pt => [G.nodes[i][0] + lo, G.nodes[i][1] + lo];

    // Where the walk starts on the network.
    let start: number;
    const from: PlaceKey | null = f.state === 'walk' ? null : f.at;
    if (from && onSquare(from) && onSquare(dest)) {
      // Town Hall and the square share the same paved area: walk across, around the fountains.
      if (from === 'plaza') P.push([f.u, 17.8], [15 + lo, 17.8]);
      P.push([15 + lo, 15.7]);
      if (dest === 'plaza') P.push([15 + lo, 17.8], [end[0], 17.8]);
      P.push(end);
      P.forEach(() => via.push(-1));
      return this.go(f, dest, P, via, pending, intent);
    }
    if (from) start = G.find(PLACES[from].gate)!;
    else {
      // Already walking somewhere else: carry on to the next corner, then re-route from there.
      const next = f.via.find((n) => n >= 0);
      start = next ?? G.nearest([f.u - lo, f.v - lo]);
    }
    const goal = G.find(PLACES[dest].gate)!;
    // Inside the square, step to its front edge first so nobody walks through a fountain.
    if (from === 'plaza') { P.push([f.u, 17.8]); via.push(-1); }
    if (from === 'plaza' || from === 'hall') { P.push([15 + lo, 17.9]); via.push(-1); }
    for (const n of G.route(start, goal)) { P.push(off(n)); via.push(n); }
    if (dest === 'plaza' || dest === 'hall') { P.push([15 + lo, 17.9]); via.push(-1); }
    if (dest === 'plaza') { P.push([end[0], 17.8]); via.push(-1); }
    P.push(end); via.push(-1);
    this.go(f, dest, P, via, pending, intent);
  }

  private go(f: Figure, dest: PlaceKey, P: Pt[], via: number[], pending: Figure['pending'], intent: string) {
    f.path = P; f.via = via; f.target = dest; f.state = 'walk'; f.status = 'walking'; f.dist = 0; f.pending = pending; f.wp = null;
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
      f.status = dest === 'church' ? 'church' : 'working';
      if (dest === 'church') f.seatedAt = this.clock();
    }
    if (pending) this.onArrive(f.id, dest);
  }

  /* ---------------- Sunday service ---------------- */
  private startService() {
    this.service = true; this.bell = true; this.serviceDay = this.dayIndex();
    for (const f of this.figs) {
      // Remember what they were doing so they can go back to it after church.
      if (f.state === 'walk' && f.target && f.pending && f.pending.kind !== 'progress' && f.pending.kind !== 'finished') {
        f.resume = { kind: f.pending.kind, place: f.target, text: f.pending.text };
      } else if (f.state === 'inside' && (f.status === 'working')) f.resume = { kind: 'started', place: f.at, text: f.task };
      else if (f.status === 'break') f.resume = { kind: 'break', place: 'plaza', text: f.task || 'Break time' };
      else f.resume = null;
      f.idleAfter = 0; f.seatedAt = null;
      this.walkTo(f, 'church', null, 'Off to church');
    }
  }

  private endService() {
    this.service = false; this.bell = false;
    for (const f of this.figs) {
      const r = f.resume;
      f.resume = null; f.seatedAt = null;
      if (r) this.walkTo(f, r.place, { kind: r.kind, text: r.text }, r.kind === 'break' ? r.text : intentFor(r.place, r.text));
      else this.walkTo(f, 'plaza', null, 'Back to town');
    }
  }

  private checkService() {
    // Church follows the real calendar in live mode, even when the sky is running fast.
    const m = this.mode === 'live' ? minutesOf(new Date()) : ((this.mins % 1440) + 1440) % 1440;
    if (!this.service) {
      if (this.weekday() === CHURCH.day && m >= CHURCH.start && m < CHURCH.end && this.serviceDay !== this.dayIndex()) this.startService();
      return;
    }
    const seated = this.figs.every((f) => f.state === 'inside' && f.at === 'church');
    if (seated) this.bell = false;
    const now = this.clock();
    const restedEnough = this.figs.every((f) => f.seatedAt !== null && now - f.seatedAt >= CHURCH.minStay);
    const pastEnd = this.weekday() !== CHURCH.day || m >= CHURCH.end;
    if (pastEnd && (restedEnough || m >= CHURCH.end + 120 || this.weekday() !== CHURCH.day)) this.endService();
  }

  /* ---------------- per-frame ---------------- */
  update(dt: number, realDt: number) {
    if (this.mode === 'demo') this.mins += dt * SIM_MINUTES_PER_SECOND;
    else if (this.fastDays) this.mins = (this.mins + realDt * SIM_MINUTES_PER_SECOND) % 1440;
    else this.mins = minutesOf(new Date());
    for (const k of Object.keys(this.placeBubble) as PlaceKey[]) { const b = this.placeBubble[k]!; b.t -= realDt; if (b.t <= 0) delete this.placeBubble[k]; }
    if (dt > 0) this.checkService();

    for (const f of this.figs) {
      f.bubbleT -= dt;
      if (f.state === 'walk') {
        const p = f.path[0];
        const dx = p[0] - f.u, dy = p[1] - f.v, d = Math.hypot(dx, dy), sp = WALK_SPEED * f.speed * dt;
        if (d <= sp) { f.u = p[0]; f.v = p[1]; f.path.shift(); f.via.shift(); if (!f.path.length) this.arrive(f); }
        else this.stepToward(f, dx, dy, d, sp);
      } else if (f.state === 'idle') {
        if (f.wp) {
          const dx = f.wp[0] - f.u, dy = f.wp[1] - f.v, d = Math.hypot(dx, dy), sp = 0.9 * dt;
          if (d <= sp) { f.wp = null; f.pause = 1.2 + Math.random() * 2; f.dir = 'down'; }
          else this.stepToward(f, dx, dy, d, sp);
        } else { f.pause -= dt; if (f.pause <= 0) f.wp = this.wanderPoint(f); }
      } else if (f.idleAfter > 0 && !this.service) {
        // Finished and no new task yet: wander out to Town Square to wait.
        f.idleAfter -= realDt;
        if (f.idleAfter <= 0) { f.idleAfter = 0; this.walkTo(f, 'plaza', null, 'Done! Waiting for work'); }
      }
    }
  }

  private stepToward(f: Figure, dx: number, dy: number, d: number, sp: number) {
    f.u += (dx / d) * sp; f.v += (dy / d) * sp;
    // On screen, +u runs down-right and +v down-left, so left/right comes from (du - dv).
    const sx = dx - dy;
    f.dir = Math.abs(sx) > 0.05 * d ? (sx > 0 ? 'right' : 'left') : dx + dy > 0 ? 'down' : 'up';
    f.dist += sp;
    f.frame = ((f.dist / 0.32) | 0) % 2 as 0 | 1;
  }

  workingCount() { return this.figs.filter((f) => f.state === 'inside' && f.at !== 'church').length; }
}

function intentFor(dest: PlaceKey, text: string) {
  if (dest === 'hall') return 'Filing a report';
  return text.length < 26 ? text : 'To ' + PLACES[dest].name;
}
