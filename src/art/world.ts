import { W, H, PF } from '../config';
import { proj, depthOf, inRect, type Pt } from '../iso/iso';
import { buildGround } from '../iso/ground';
import { clamp, rng } from './pixel';
import { Building, type Drawable } from './kit';
import * as B from './buildings';
import * as P from './props';
import { BLOCKS, FOOT, FOUNTAINS, PLAZA, TOWN, CHURCH_U, THROUGH_U, THROUGH_V, nearLine } from '../world/streets';
import type { PlaceKey } from '../world/places';
import type { Figure } from '../game/Town';

/**
 * Everything the town looks like, apart from the people: ground, buildings, trees, street furniture,
 * cars, particles and the day/night cycle. The scene asks it for Drawables each frame and sorts them with the people.
 */

const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export type Occupancy = Record<PlaceKey, number>;

interface Particle { k: 'bub' | 'mail' | 'sig' | 'drop' | 'note'; x: number; y: number; vx: number; vy: number; l: number; m: number; c?: string }
interface Car { axis: 'u' | 'v'; dir: 1 | -1; lane: number; s: number; speed: number; look: P.CarLook; wait: number }
interface Duck { u: number; v: number; a: number; t: number }

const CAR_LOOKS: P.CarLook[] = [
  { body: '#e8473f', style: 'sedan' }, { body: '#3f7fe8', style: 'sedan' }, { body: '#f2c230', style: 'taxi' },
  { body: '#f4f4f4', style: 'van' }, { body: '#2fa59a', style: 'sport' }, { body: '#8a4fd1', style: 'sedan' },
];

export class TownArt {
  ground: HTMLCanvasElement;
  buildings: Partial<Record<PlaceKey, Building>> = {};
  private statics: Drawable[] = [];
  private lampHeads: Pt[] = [];
  private cars: Car[] = [];
  private ducks: Duck[] = [];
  private parts: Particle[] = [];
  private em = { bub: 0, mail: 0, sig: 0, drop: 0, note: 0 };
  private clouds = [{ x: 60, y: 120, s: 1.4 }, { x: 520, y: 420, s: 1.8 }, { x: 860, y: 180, s: 1.2 }];
  private emitters: Record<string, Pt> = {};

  constructor() {
    this.ground = buildGround();
    this.buildings = {
      hall: B.townHall(),
      church: B.church(),
      ...(B.refuge ? { refuge: B.refuge() } : {}),
      ...(B.goose ? { goose: B.goose() } : {}),
      ...(B.aiTower ? { ai: B.aiTower() } : {}),
    } as Partial<Record<PlaceKey, Building>>;
    for (const b of Object.values(this.buildings)) this.statics.push(...b!.strips);
    this.emitters = B.emitters ? B.emitters() : {};
    this.placeProps();
    this.spawnCars();
    for (let i = 0; i < 3; i++) this.ducks.push({ u: 25 + i * 0.6, v: 25 - i * 0.4, a: i * 2, t: 0 });
  }

  /* ---------------- set dressing ---------------- */
  private placeProps() {
    const S = this.statics;
    const lamp = P.lampSprite();
    const addLamp = (u: number, v: number) => { S.push(P.sprite(u, v, lamp)); const [x, y] = proj(u, v); this.lampHeads.push([Math.round(x), Math.round(y) - 30]); };
    // a lamp on each block corner, at the curb
    for (let bi = 0; bi < 3; bi++) for (let bj = 0; bj < 3; bj++) {
      const a = bi * 10 + 1.12, b = bj * 10 + 1.12, c = bi * 10 + 8.88, d = bj * 10 + 8.88;
      if ((bi + bj) % 2 === 0) { addLamp(a, b); addLamp(c, d); } else { addLamp(c, b); addLamp(a, d); }
    }
    // traffic lights at the inner crossings
    for (const [u, v, g] of [[10, 10, true], [20, 10, false], [10, 20, false], [20, 20, true]] as [number, number, boolean][]) {
      S.push(P.sprite(u + 1.12, v - 1.12, P.trafficLightSprite(g)));
      S.push(P.sprite(u - 1.12, v + 1.12, P.trafficLightSprite(!g)));
    }
    // Town Square
    for (const [u, v] of FOUNTAINS) S.push(P.fountainPix(u, v));
    addLamp(12.6, 17.7); addLamp(17.4, 17.7);
    S.push(P.benchPix(12.9, 16.1, false), P.benchPix(17.1, 16.1, false));

    const rand = rng(42);
    const tree = (u: number, v: number) => S.push(P.sprite(u, v, P.treeSprite((u * 31 + v * 17) | 0)));
    const palm = (u: number, v: number) => S.push(P.sprite(u, v, P.palmSprite((u * 13 + v * 29) | 0)));
    const bush = (u: number, v: number) => S.push(P.sprite(u, v, P.bushSprite((u * 7 + v * 11) | 0)));

    for (const [key, type] of Object.entries(BLOCKS)) {
      const [bi, bj] = key.split(',').map(Number);
      const ou = bi * 10, ov = bj * 10;
      const onPath = (a: number, b: number) => Math.abs(a - b) < 0.7 || Math.abs(a + b - 10) < 0.7 || Math.abs(Math.hypot(a - 5, b - 5) - 1.5) < 0.8 || Math.hypot(a - 5, b - 5) < 1.6;
      if (type === 'park' || type === 'palms') {
        for (let a = 2.7; a <= 7.4; a += 1.15) for (let b = 2.7; b <= 7.4; b += 1.15) {
          const ja = a + (rand() - 0.5) * 0.5, jb = b + (rand() - 0.5) * 0.5;
          if (onPath(ja, jb) || rand() < 0.25) continue;
          if (type === 'palms') palm(ou + ja, ov + jb); else tree(ou + ja, ov + jb);
        }
        if (type === 'park') S.push(P.statuePix(ou + 5, ov + 5));
        S.push(P.benchPix(ou + 3.6, ov + 5, false), P.benchPix(ou + 6.4, ov + 5, false));
      }
      if (type === 'pond') {
        for (let a = 2.6; a <= 7.5; a += 0.9) for (let b = 2.6; b <= 7.5; b += 0.9) {
          const e = ((a - 5) / 2.5) ** 2 + ((b - 5) / 2.1) ** 2, r = Math.hypot(a - 5, (b - 5) * 1.15);
          if (e > 1.25 && Math.abs(r - 3.05) > 0.5 && rand() < 0.55) (rand() < 0.5 ? palm : tree)(ou + a, ov + b);
        }
        S.push(P.benchPix(ou + 5, ov + 7.85, true));
      }
      if (type === 'lot') {
        S.push(P.signPix(ou + 5, ov + 7.2, true, [{ t: 'OPEN LOT', size: 6, fg: '#3a2a1a' }, { t: 'YOUR NEXT BUSINESS', size: 4, fg: '#7a4a2a' }], '#f6e3a0'));
        S.push(P.fencePix(ou + 2.3, ov + 2.3, ou + 7.7, ov + 2.3, '#a0744a'), P.fencePix(ou + 2.3, ov + 2.3, ou + 2.3, ov + 7.7, '#a0744a'));
        S.push(P.fencePix(ou + 7.7, ov + 2.3, ou + 7.7, ov + 7.7, '#a0744a'), P.fencePix(ou + 2.3, ov + 7.7, ou + 4.1, ov + 7.7, '#a0744a'), P.fencePix(ou + 5.9, ov + 7.7, ou + 7.7, ov + 7.7, '#a0744a'));
      }
      if (type === 'square') {
        // hedges and planters already in the ground; a few palms on the corners
        palm(ou + 2.5, ov + 2.5); palm(ou + 7.5, ov + 2.5); palm(ou + 2.5, ov + 7.6); palm(ou + 7.5, ov + 7.6);
      }
      if (type === 'goose') {
        S.push(P.fencePix(7.9, 12.7, 7.9, 14.4), P.fencePix(7.9, 15.6, 7.9, 17.3), P.fencePix(6.4, 17.3, 7.9, 17.3), P.fencePix(6.4, 12.7, 7.9, 12.7));
        S.push(P.umbrellaPix(7.25, 13.6, '#ff86b0'), P.umbrellaPix(7.25, 16.45, '#7fd8c0'));
        bush(2.6, 12.6); bush(2.6, 17.4); tree(2.6, 15);
      }
      if (type === 'ai') { palm(ou + 2.4, ov + 2.4); palm(ou + 7.6, ov + 7.6); palm(ou + 2.4, ov + 7.6); }
      if (type === 'refuge') { tree(ou + 2.2, ov + 2.5); tree(ou + 2.2, ov + 5); palm(ou + 2.2, ov + 7.5); }
    }
    // street palms along the curbs of the main streets
    for (let s = 3; s < 30; s += 4) {
      if (nearLine(s)[0] < 2.5) continue;
      palm(s, 10 + 1.12); palm(s, 20 - 1.12);
    }
    // parked cars and the red sports car out front at Refuge
    S.push(P.parkedCar(13.4, 7.7, 'u+', { body: '#d7263d', style: 'sport' }));
    S.push(P.parkedCar(4.5, 9.45, 'u-', CAR_LOOKS[1]), P.parkedCar(26.5, 9.45, 'u-', CAR_LOOKS[5]), P.parkedCar(10.55, 4.5, 'v+', CAR_LOOKS[0]));
    S.push(P.parkedCar(29.45, 25, 'v-', CAR_LOOKS[3]), P.parkedCar(0.55, 6, 'v+', CAR_LOOKS[4]), P.parkedCar(14, 30.55, 'u+', CAR_LOOKS[2]));
    // hydrants and bins
    const hyd = P.hydrantSprite(), bin = P.binSprite();
    for (const [u, v] of [[8.9, 4], [21.1, 16], [11.1, 26], [28.9, 13]]) S.push(P.sprite(u, v, hyd));
    for (const [u, v] of [[18.9, 18.9], [1.1, 18], [11.2, 1.2], [28.8, 28.8]]) S.push(P.sprite(u, v, bin));

    // the church yard: fence, bushes, a bench
    const [cu0, cv0, cu1, cv1] = FOOT.church;
    S.push(P.fencePix(cu0 - 0.9, cv1 + 1.2, CHURCH_U - 0.6, cv1 + 1.2), P.fencePix(CHURCH_U + 0.6, cv1 + 1.2, cu1 + 0.9, cv1 + 1.2));
    S.push(P.fencePix(cu1 + 0.9, cv0 - 0.9, cu1 + 0.9, cv1 + 1.2), P.fencePix(cu0 - 0.9, cv0 - 0.9, cu0 - 0.9, cv1 + 1.2), P.fencePix(cu0 - 0.9, cv0 - 0.9, cu1 + 0.9, cv0 - 0.9));
    bush(cu1 + 0.5, cv1 + 0.4); bush(cu0 - 0.5, cv1 + 0.4); bush(cu1 + 0.5, cv0 + 1);
    S.push(P.benchPix(cu1 + 1.6, cv1 - 1.5, false));

    // the countryside: trees and palms everywhere that isn't road, water or churchyard
    const visible = (u: number, v: number) => { const [x, y] = proj(u, v); return x > -20 && x < W + 20 && y > 10 && y < H + 50; };
    for (let u = -24; u < 56; u += 1.3) for (let v = -40; v < 60; v += 1.3) {
      const ju = u + (rand() - 0.5) * 0.9, jv = v + (rand() - 0.5) * 0.9;
      if (inRect(ju, jv, [TOWN[0] - 0.6, TOWN[1] - 0.6, TOWN[2] + 0.6, TOWN[3] + 0.6])) continue;
      if (!visible(ju, jv)) continue;
      if (Math.abs(ju - THROUGH_U) < 2.8 || Math.abs(jv - THROUGH_V) < 2.8) continue;
      if (inRect(ju, jv, [cu0 - 1.6, cv0 - 1.6, cu1 + 1.6, cv1 + 2])) continue;
      if (Math.abs(ju - CHURCH_U) < 1.2 && jv > cv1 && jv < -1) continue;
      if (((ju - 4) / 9) ** 2 + ((jv - 41) / 5.5) ** 2 < 1.3) continue;
      const r = rand();
      if (r < 0.42) tree(ju, jv); else if (r < 0.6) palm(ju, jv); else if (r < 0.72) bush(ju, jv);
    }
  }

  private spawnCars() {
    const looks = CAR_LOOKS;
    let k = 0;
    for (const axis of ['u', 'v'] as const) for (const dir of [1, -1] as const) for (let i = 0; i < 2; i++) {
      this.cars.push({ axis, dir, lane: (axis === 'u' ? THROUGH_V : THROUGH_U) + (dir > 0 ? 0.5 : -0.5) * (axis === 'u' ? 1 : -1), s: -14 + i * 28 + k * 7, speed: 3.2 + (k % 3) * 0.4, look: looks[k % looks.length], wait: 0 });
      k++;
    }
  }

  private carPos(c: Car): [number, number] { return c.axis === 'u' ? [c.s, c.lane] : [c.lane, c.s]; }

  /* ---------------- animation ---------------- */
  update(dt: number, occ: Occupancy, figs: Figure[], bell: boolean) {
    for (const c of this.clouds) { c.x += dt * 6; if (c.x > W + 80) c.x = -80; }
    // cars: drive the through roads, stopping for the crossing and for people on crosswalks
    for (const c of this.cars) {
      const [u, v] = this.carPos(c);
      const ahead = (s: number) => c.axis === 'u' ? (c.s + c.dir * s) : (c.s + c.dir * s);
      let stop = false;
      for (const o of this.cars) {
        if (o === c) continue;
        const [ou, ov] = this.carPos(o);
        if (o.axis === c.axis && o.dir === c.dir && o.lane === c.lane) { const d = (o.s - c.s) * c.dir; if (d > 0 && d < 2.6) stop = true; }
        if (o.axis !== c.axis && Math.abs(ou - 20) < 1.3 && Math.abs(ov - 20) < 1.3) {
          const d = (20 - c.s) * c.dir;
          if (d > 0.9 && d < 2.4) stop = true;
        }
      }
      for (const f of figs) {
        if (f.state !== 'walk') continue;
        const along = c.axis === 'u' ? f.u : f.v, across = c.axis === 'u' ? f.v : f.u;
        const d = (along - c.s) * c.dir;
        if (d > 0.6 && d < 2.2 && Math.abs(across - (c.axis === 'u' ? THROUGH_V : THROUGH_U)) < 1.4) stop = true;
      }
      void u; void v; void ahead;
      if (!stop) c.s += c.dir * c.speed * dt;
      if (c.dir > 0 && c.s > 46) c.s = -16;
      if (c.dir < 0 && c.s < -16) c.s = 46;
    }
    for (const d of this.ducks) {
      d.t += dt;
      d.a += dt * 0.25 * (Math.sin(d.t * 0.3) + 0.4);
      const nu = 25 + Math.cos(d.a) * 1.5, nv = 25 + Math.sin(d.a) * 1.2;
      d.u = nu; d.v = nv;
    }
    if (!reduce) {
      const e = this.em, Pp = this.parts, em = this.emitters;
      if (em.goose) { e.bub += dt * (occ.goose ? 6 : 2); while (e.bub > 1) { e.bub--; Pp.push({ k: 'bub', x: em.goose[0] + Math.random() * 2, y: em.goose[1], vx: Math.random() * 4 - 2, vy: -8 - Math.random() * 6, l: 1.4, m: 1.4, c: Math.random() < 0.5 ? '#ffd2e2' : '#ffffff' }); } }
      if (em.refuge && occ.refuge) { e.mail += dt * 1.5; while (e.mail > 1) { e.mail--; Pp.push({ k: 'mail', x: em.refuge[0], y: em.refuge[1], vx: 8 + Math.random() * 10, vy: -14 - Math.random() * 8, l: 2, m: 2 }); } }
      if (em.ai && occ.ai) { e.sig += dt * 5; while (e.sig > 1) { e.sig--; Pp.push({ k: 'sig', x: em.ai[0] + Math.random() * 3 - 1, y: em.ai[1], vx: Math.random() * 10 - 5, vy: -10 - Math.random() * 6, l: 0.9, m: 0.9, c: Math.random() < 0.5 ? '#86e0bd' : '#5fe3ff' }); } }
      e.drop += dt * 24;
      while (e.drop > 1) { e.drop--; const [fu, fv] = FOUNTAINS[(Math.random() * 2) | 0]; const [x, y] = proj(fu, fv, 17); Pp.push({ k: 'drop', x: x + Math.random() * 2 - 1, y, vx: Math.random() * 12 - 6, vy: -12 - Math.random() * 6, l: 0.75, m: 0.75 }); }
      if (bell && em.church) { e.note += dt * 1.6; while (e.note > 1) { e.note--; Pp.push({ k: 'note', x: em.church[0], y: em.church[1], vx: 6 + Math.random() * 6, vy: -10 - Math.random() * 4, l: 2.2, m: 2.2 }); } }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.l -= dt;
      if (p.l <= 0) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'drop') p.vy += 50 * dt;
      if (p.k === 'mail') p.vy += 4 * dt;
      if (p.k === 'bub' || p.k === 'note') p.vx += Math.sin(p.l * 8) * dt * 8;
    }
  }

  /** Static scenery plus moving cars and ducks, ready to be sorted with the people. */
  drawables(t: number, occ: Occupancy, bell: boolean): Drawable[] {
    for (const [k, b] of Object.entries(this.buildings) as [PlaceKey, Building][]) b.frame(t, k === 'church' ? bell : occ[k] > 0);
    const out = this.statics.slice();
    for (const c of this.cars) {
      const [u, v] = this.carPos(c);
      const dir: P.CarDir = c.axis === 'u' ? (c.dir > 0 ? 'u+' : 'u-') : c.dir > 0 ? 'v+' : 'v-';
      const s = P.carSprite(dir, c.look);
      const [x, y] = proj(u, v);
      out.push({ depth: depthOf(u, v) + 4, draw: (g) => g.drawImage(s.canvas, Math.round(x) + s.ox, Math.round(y) + s.oy) });
    }
    for (const d of this.ducks) {
      const [x, y] = proj(d.u, d.v);
      const bob = Math.round(Math.sin(t * 2 + d.a) * 0.6);
      out.push({ depth: depthOf(d.u, d.v), draw: (g) => {
        const X = Math.round(x), Y = Math.round(y) + bob;
        g.fillStyle = '#2b2533'; g.fillRect(X - 3, Y - 4, 7, 4);
        g.fillStyle = '#ffffff'; g.fillRect(X - 2, Y - 3, 5, 2); g.fillRect(X + 1, Y - 5, 2, 2);
        g.fillStyle = '#ff9a2a'; g.fillRect(X + 3, Y - 4, 1, 1);
      } });
    }
    return out;
  }

  /** Clouds' shadows, under everything else that moves. */
  drawClouds(g: CanvasRenderingContext2D, mins: number) {
    const L = TownArt.lighting(mins);
    if (L.day < 0.05) return;
    g.fillStyle = `rgba(20,30,50,${0.07 * Math.min(1, L.day * 2)})`;
    for (const c of this.clouds) for (const [dx, dy, r] of [[0, 0, 26], [22, 5, 20], [-20, 6, 17], [8, -8, 16]]) {
      g.beginPath(); g.ellipse(c.x + dx * c.s, c.y + dy * c.s, r * c.s, r * 0.5 * c.s, 0, 0, Math.PI * 2); g.fill();
    }
  }

  drawParticles(g: CanvasRenderingContext2D) {
    for (const p of this.parts) {
      const f = p.l / p.m, x = Math.round(p.x), y = Math.round(p.y);
      if (p.k === 'mail') {
        g.globalAlpha = Math.min(1, f * 1.5);
        g.fillStyle = '#ffffff'; g.fillRect(x, y, 4, 3); g.fillStyle = '#c8664f'; g.fillRect(x + 1, y + 1, 2, 1);
      } else if (p.k === 'note') {
        g.globalAlpha = Math.min(1, f * 1.4);
        g.fillStyle = '#ffe9a0'; g.fillRect(x, y, 2, 2); g.fillRect(x + 1, y - 4, 1, 4); g.fillRect(x + 2, y - 4, 2, 1);
      } else if (p.k === 'drop') { g.globalAlpha = 1; g.fillStyle = '#d4f1fb'; g.fillRect(x, y, 1, 1); }
      else { g.globalAlpha = Math.min(1, f * 1.6); g.fillStyle = p.c!; g.fillRect(x, y, 1, 1); }
      g.globalAlpha = 1;
    }
  }

  /** Light level for a time of day in minutes. night: 0 (noon) .. 1 (midnight). */
  static lighting(mins: number) {
    const h = (mins / 60) % 24;
    const sun = Math.sin((Math.PI * (h - 5.5)) / 13);
    const s = h > 5.5 && h < 18.5 ? Math.max(0, sun) : 0;
    const k = clamp(s / 0.45, 0, 1);
    const night = 1 - k * k * (3 - 2 * k);
    const warm = s > 0 ? clamp(1 - s / 0.5, 0, 1) * 0.24 * (1 - night * 0.6) : 0;
    return { night, warm, day: s };
  }

  /** Night tint, then lit windows, street lamps and car headlights on top. */
  drawNight(g: CanvasRenderingContext2D, t: number, mins: number, occ: Occupancy) {
    const L = TownArt.lighting(mins);
    if (L.warm > 0.005) { g.fillStyle = `rgba(255,140,70,${L.warm})`; g.fillRect(0, 0, W, H); }
    if (L.night > 0.01) { g.fillStyle = `rgba(16,18,64,${L.night * 0.62})`; g.fillRect(0, 0, W, H); }
    if (L.night <= 0.08) return;
    const n = L.night;
    for (const [k, b] of Object.entries(this.buildings) as [PlaceKey, Building][]) {
      if (!b.glow) continue;
      g.globalAlpha = n * (occ[k] > 0 || k === 'hall' ? 0.95 : 0.6);
      g.drawImage(b.glow, b.x, b.y);
    }
    g.globalAlpha = 1;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [x, y] of this.lampHeads) {
      const gr = g.createRadialGradient(x, y + 4, 0, x, y + 8, 26);
      gr.addColorStop(0, `rgba(255,205,120,${0.4 * n})`); gr.addColorStop(1, 'rgba(255,205,120,0)');
      g.fillStyle = gr; g.fillRect(x - 26, y - 20, 52, 56);
    }
    for (const c of this.cars) {
      const [u, v] = this.carPos(c);
      const [x, y] = proj(u + (c.axis === 'u' ? c.dir * 1.2 : 0), v + (c.axis === 'v' ? c.dir * 1.2 : 0));
      const gr = g.createRadialGradient(x, y - 3, 0, x, y - 3, 14);
      gr.addColorStop(0, `rgba(255,240,190,${0.35 * n})`); gr.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = gr; g.fillRect(x - 14, y - 17, 28, 28);
    }
    g.restore();
    for (const [x, y] of this.lampHeads) { g.fillStyle = `rgba(255,236,170,${n})`; g.fillRect(x - 1, y + 1, 3, 1); }
    void t; void PF;
  }
}

export { inRect, PLAZA };
