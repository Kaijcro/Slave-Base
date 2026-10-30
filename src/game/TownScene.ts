import Phaser from 'phaser';
import { W, H, S, PF, PERSON_SCALE } from '../config';
import { drawHuman, type Dir } from '../art/human';
import { spriteFor } from '../art/sprites';
import { TownArt } from '../art/world';
import { painter, clamp } from '../art/pixel';
import { proj, unproj, depthOf, inRect } from '../iso/iso';
import { PLACES, PLACE_KEYS, PLAZA, type PlaceKey } from '../world/places';
import type { Town, Figure } from './Town';
import type { AgentSource } from '../data/types';
import type { Drawable } from '../art/kit';
import { room, isEnterable, IW, IH, type Room } from '../art/interiors';
import { store } from '../ui/store';

const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
/** Size of one person sprite before scaling, and where their feet are inside it. */
const SPR_W = 16, SPR_H = 26, FEET_Y = 24;

/**
 * Draws the town every frame.
 *  - world layer (1040 x 640, scaled 2x): ground, then buildings, trees, cars and people sorted by depth, then night lighting
 *  - label layer (full resolution): name tags, speech bubbles, "at work" badges and selection outlines
 */
export class TownScene extends Phaser.Scene {
  private art!: TownArt;
  private worldTex!: Phaser.Textures.CanvasTexture;
  private topTex!: Phaser.Textures.CanvasTexture;
  private sprites = new Map<string, HTMLCanvasElement>();
  private t = 0;
  private hoverPlace: PlaceKey | null = null;
  private worldImg!: Phaser.GameObjects.Image;
  /** Camera: top-left corner of the view in town pixels, and zoom (1 = whole town). */
  private cam = { x: 0, y: 0, z: 1 };
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private pinch: number | null = null;
  /** Interior view: a 520 x 320 canvas drawn at 2x over the whole map. */
  private roomCanvas = Object.assign(document.createElement('canvas'), { width: IW, height: IH });
  /** Where each person is drawn inside the current room, for clicking and labels. */
  private inRoom: { f: Figure; x: number; y: number }[] = [];

  constructor(private town: Town, private source: AgentSource) {
    super('town');
  }

  create() {
    this.art = new TownArt();
    // tell the sidebar where each place is on screen, for its little preview picture
    for (const k of PLACE_KEYS) {
      const b = this.art.buildings[k];
      if (b) PLACES[k].rect = [b.x, b.y, b.w, b.h];
    }
    const [px0, py0] = proj(PLAZA[0], PLAZA[3]), [px1] = proj(PLAZA[2], PLAZA[1]);
    PLACES.plaza.rect = [px0 - 10, py0 - 90, px1 - px0 + 20, 110];

    this.worldTex = this.textures.createCanvas('world', W, H)!;
    this.worldImg = this.add.image(0, 0, 'world').setOrigin(0).setScale(S);
    this.topTex = this.textures.createCanvas('top', W * S, H * S)!;
    this.add.image(0, 0, 'top').setOrigin(0);

    const ps = PERSON_SCALE;
    for (const f of this.town.figs) for (const dir of DIRS) for (let n = 0; n < 3; n++) {
      const c = document.createElement('canvas');
      c.width = SPR_W * ps; c.height = SPR_H * ps;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.setTransform(ps, 0, 0, ps, 0, 0);
      drawHuman(g, f.look, SPR_W / 2, FEET_Y, dir, n === 2 ? 1 : 0, n > 0);
      this.sprites.set(`${f.id}-${dir}-${n}`, c);
    }

    // Zoom and pan: scroll or pinch to zoom, drag to move around, click to select.
    this.input.addPointer(1);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (store.inside) { this.drag = null; return; }
      this.drag = { x: p.x, y: p.y, cx: this.cam.x, cy: this.cam.y, moved: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        // two fingers: pinch to zoom around their midpoint
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (this.pinch) this.zoomAt(d / this.pinch, (p1.x + p2.x) / 2 / S, (p1.y + p2.y) / 2 / S);
        this.pinch = d;
        if (this.drag) this.drag.moved = true;
        return;
      }
      this.pinch = null;
      if (this.drag && p.isDown) {
        const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
        if (!this.drag.moved && Math.hypot(dx, dy) > 8) { this.drag.moved = true; store.setFollow(null); }
        if (this.drag.moved) {
          this.cam.x = this.drag.cx - dx / S / this.cam.z;
          this.cam.y = this.drag.cy - dy / S / this.cam.z;
          this.clampCam();
          this.input.setDefaultCursor('grabbing');
          return;
        }
      }
      this.hover(p.x / S, p.y / S);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const wasDrag = this.drag?.moved;
      this.drag = null; this.pinch = null;
      if (wasDrag) { this.input.setDefaultCursor('default'); return; }
      if (store.inside) {
        const hot = this.hotAt(p.x / S, p.y / S);
        if (hot) { store.openPanel(hot.id); return; }
        const who = this.pickInRoom(p.x / S, p.y / S);
        if (who) store.select({ type: 'agent', id: who.id });
        return;
      }
      const hit = this.pick(p.x / S, p.y / S);
      if (hit?.type === 'agent') store.select({ type: 'agent', id: hit.id });
      else if (hit?.type === 'place') {
        // clicking a building takes you inside it
        if (isEnterable(hit.key)) store.enter(hit.key);
        else store.select({ type: 'place', key: hit.key });
      }
    });
    this.game.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (store.inside) return;
      const c = this.game.canvas, k = W / c.clientWidth;
      this.zoomAt(Math.exp(-e.deltaY * 0.0018), e.offsetX * k, e.offsetY * k);
    }, { passive: false });
    store.cam.zoomBy = (f) => this.zoomAt(f, W / 2, H / 2);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && store.inside) store.enter(null); });
    store.cam.reset = () => { store.setFollow(null); this.cam = { x: 0, y: 0, z: 1 }; store.cam.zoom = 1; };
  }

  /* ---------------- camera ---------------- */
  /** Zoom by factor f, keeping the town point under screen position (sx, sy) in place. */
  private zoomAt(f: number, sx: number, sy: number) {
    const z = clamp(this.cam.z * f, 1, 3.5);
    const wx = this.cam.x + sx / this.cam.z, wy = this.cam.y + sy / this.cam.z;
    this.cam.z = z;
    if (!store.follow) { this.cam.x = wx - sx / z; this.cam.y = wy - sy / z; }
    this.clampCam();
    store.cam.zoom = z;
  }
  private clampCam() {
    const c = this.cam;
    c.x = clamp(c.x, 0, W - W / c.z);
    c.y = clamp(c.y, 0, H - H / c.z);
  }
  /** Screen position (in un-zoomed town pixels) of a town pixel. */
  private toView(x: number, y: number): [number, number] { return [(x - this.cam.x) * this.cam.z, (y - this.cam.y) * this.cam.z]; }
  private followCam(realDt: number) {
    const f = store.follow ? this.town.byId.get(store.follow) : null;
    if (!f) return;
    if (this.cam.z < 2) this.cam.z = Math.min(2, this.cam.z + realDt * 3);
    store.cam.zoom = this.cam.z;
    const [u, v] = f.state === 'inside' && PLACES[f.at].door ? PLACES[f.at].door! : [f.u, f.v];
    const [x, y] = proj(u, v, 20);
    const tx = x - W / 2 / this.cam.z, ty = y - H / 2 / this.cam.z;
    const k = Math.min(1, realDt * 4);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    this.clampCam();
  }

  /* ---------------- people ---------------- */
  /** The image to draw for a person this frame, and where it goes relative to their feet. */
  private frameFor(f: Figure, moving: boolean, dir: Dir = f.dir): { c: HTMLCanvasElement; ox: number; oy: number } {
    const sp = spriteFor(f.id);
    if (sp) {
      const s = sp.sheet;
      const i = moving ? Math.floor(f.dist / 0.22) % s.frames : s.idle;
      return { c: (dir === 'left' ? sp.left : sp.right)[i], ox: -s.cell / 2, oy: -s.feetY };
    }
    const n = moving ? 1 + (Math.floor(f.dist / 0.32) % 2) : 0;
    return { c: this.sprites.get(`${f.id}-${dir}-${n}`)!, ox: -(SPR_W * PERSON_SCALE) / 2, oy: -FEET_Y * PERSON_SCALE };
  }
  /** How tall a person stands, in town pixels (for name tags and clicking). */
  private heightOf(f: Figure) {
    const sp = spriteFor(f.id);
    return sp ? sp.sheet.feetY - sp.sheet.headY : (21 + (f.look.tall ? 1 : 0)) * PERSON_SCALE;
  }

  /* ---------------- picking ---------------- */
  private feet(f: Figure) { const [x, y] = proj(f.u, f.v); return [Math.round(x), Math.round(y)]; }

  private pick(vx: number, vy: number): { type: 'agent'; id: string } | { type: 'place'; key: PlaceKey } | null {
    const x = this.cam.x + vx / this.cam.z, y = this.cam.y + vy / this.cam.z;
    const ps = PERSON_SCALE;
    let best: Figure | null = null;
    for (const f of this.town.figs) {
      if (f.state === 'inside') continue;
      const [fx, fy] = this.feet(f);
      if (x >= fx - 5 * ps && x <= fx + 5 * ps && y >= fy - this.heightOf(f) && y <= fy + 2) if (!best || fy > this.feet(best)[1]) best = f;
    }
    if (best) return { type: 'agent', id: best.id };
    // buildings, front-most first
    const hits = (Object.entries(this.art.buildings) as [PlaceKey, NonNullable<TownArt['buildings'][PlaceKey]>][]).filter(([, b]) => b.hit(x, y));
    if (hits.length) {
      hits.sort((a, b) => (b[1].y + b[1].h) - (a[1].y + a[1].h));
      return { type: 'place', key: hits[0][0] };
    }
    const [u, v] = unproj(x, y);
    if (inRect(u, v, [PLAZA[0], PLAZA[1] - 0.6, PLAZA[2], PLAZA[3]])) return { type: 'place', key: 'plaza' };
    return null;
  }

  /** A clickable object in the current room (room pixels are 2 town pixels each). */
  private hotAt(vx: number, vy: number) {
    if (!store.inside) return null;
    const x = vx / 2, y = vy / 2;
    return room(store.inside).hotspots?.find((h) => x >= h.x - 2 && x <= h.x + h.w + 2 && y >= h.y - 2 && y <= h.y + h.h + 2) ?? null;
  }

  private pickInRoom(vx: number, vy: number): Figure | null {
    // room pixels are 2 town pixels each
    const x = vx / 2, y = vy / 2;
    let best: { f: Figure; y: number } | null = null;
    for (const p of this.inRoom) {
      if (x >= p.x - 8 && x <= p.x + 8 && y >= p.y - this.heightOf(p.f) && y <= p.y + 2 && (!best || p.y > best.y)) best = { f: p.f, y: p.y };
    }
    return best?.f ?? null;
  }

  private hover(x: number, y: number) {
    if (store.inside) {
      const who = this.pickInRoom(x, y);
      const hot = who ? null : this.hotAt(x, y);
      store.hover = who?.id ?? null;
      store.hoverHot = hot?.id ?? null;
      this.hoverPlace = null;
      this.input.setDefaultCursor(who || hot ? 'pointer' : 'default');
      return;
    }
    const hit = this.pick(x, y);
    store.hover = hit?.type === 'agent' ? hit.id : null;
    this.hoverPlace = hit?.type === 'place' ? hit.key : null;
    this.input.setDefaultCursor(hit ? 'pointer' : 'default');
  }

  /* ---------------- frame ---------------- */
  update(_time: number, delta: number) {
    const realDt = Math.min(0.05, delta / 1000);
    const dt = this.source.mode === 'live' ? realDt : realDt * store.speed;
    if (dt > 0) {
      this.source.tick?.(dt);
      this.t += dt;
    }
    this.town.update(dt, dt > 0 ? realDt : 0);
    if (dt > 0) this.art.update(dt, this.town.occ, this.town.figs, this.town.bell);
    if (store.inside) return this.drawInside(room(store.inside));
    this.followCam(realDt);
    this.worldImg.setScale(S * this.cam.z).setPosition(-this.cam.x * S * this.cam.z, -this.cam.y * S * this.cam.z);
    const mins = this.town.mins;

    const g = this.worldTex.getContext();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.art.ground, 0, 0);
    this.art.drawClouds(g, mins);

    const items: Drawable[] = this.art.drawables(this.t, this.town.occ, this.town.bell);
    const sel = store.sel;
    for (const f of this.town.figs) {
      if (f.state === 'inside') continue;
      const [fx, fy] = this.feet(f);
      const moving = f.state === 'walk' || (f.state === 'idle' && !!f.wp);
      const spr = this.frameFor(f, moving);
      const chosen = sel.type === 'agent' && sel.id === f.id;
      items.push({
        depth: depthOf(f.u, f.v) + 0.5,
        draw: (gg) => {
          if (chosen) {
            const pu = 0.5 + 0.5 * Math.sin(this.t * 5);
            gg.strokeStyle = `rgba(134,224,189,${0.55 + 0.45 * pu})`;
            gg.lineWidth = 1;
            gg.beginPath(); gg.ellipse(fx + 0.5, fy, 9 + pu, 4 + pu * 0.5, 0, 0, Math.PI * 2); gg.stroke();
          }
          gg.drawImage(spr.c, fx + spr.ox, fy + spr.oy);
        },
      });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw(g);
    this.art.drawParticles(g);
    this.art.drawNight(g, this.t, mins, this.town.occ);
    this.worldTex.refresh();

    // Labels at full resolution
    const tg = this.topTex.getContext();
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, W * S, H * S);
    tg.imageSmoothingEnabled = false;
    tg.setTransform(S, 0, 0, S, 0, 0);
    this.drawLabels(tg);
    this.topTex.refresh();
  }

  /* ---------------- inside a building ---------------- */
  private drawInside(rm: Room) {
    this.worldImg.setScale(S).setPosition(0, 0);
    const g = this.roomCanvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(rm.bg, 0, 0);
    const busy = this.town.occ[rm.key];
    rm.animate(g, this.t, busy);

    // Seat everyone who is inside: owners at their own desks, everyone else in the free seats.
    const here = this.town.figs.filter((f) => f.state === 'inside' && f.at === rm.key);
    const taken = new Set<number>();
    const placed: { f: Figure; x: number; y: number; dir: Dir }[] = [];
    const seatOf = (f: Figure) => {
      let i = rm.seats.findIndex((s, k) => s.owner === f.id && !taken.has(k));
      if (i < 0) i = rm.seats.findIndex((s, k) => !s.owner && !taken.has(k));
      if (i < 0) i = rm.seats.findIndex((s, k) => !taken.has(k) && !here.some((h) => h.id === s.owner));
      return i;
    };
    for (const f of [...here].sort((a, b) => Number(rm.seats.some((s) => s.owner === b.id)) - Number(rm.seats.some((s) => s.owner === a.id)))) {
      const i = seatOf(f);
      if (i >= 0) { taken.add(i); const s = rm.seats[i]; placed.push({ f, x: s.x, y: s.y, dir: s.dir }); }
      else placed.push({ f, x: IW / 2 + (placed.length % 5) * 18 - 36, y: IH - 24, dir: 'up' });
    }
    this.inRoom = placed;

    const items: { y: number; draw: () => void }[] = rm.pieces.map((p) => ({ y: p.y, draw: () => g.drawImage(p.canvas, p.x, p.top) }));
    const sel = store.sel;
    for (const p of placed) {
      const spr = this.frameFor(p.f, false, p.dir);
      // a little bob while they work
      const bob = p.f.status === 'working' && Math.sin(this.t * 3 + p.x) > 0.6 ? 1 : 0;
      items.push({
        y: p.y,
        draw: () => {
          g.fillStyle = 'rgba(20,16,40,.22)'; g.fillRect(p.x - 7, p.y - 1, 14, 3);
          if (sel.type === 'agent' && sel.id === p.f.id) {
            const pu = 0.5 + 0.5 * Math.sin(this.t * 5);
            g.strokeStyle = `rgba(134,224,189,${0.55 + 0.45 * pu})`; g.lineWidth = 1;
            g.beginPath(); g.ellipse(p.x + 0.5, p.y, 10 + pu, 4 + pu * 0.5, 0, 0, Math.PI * 2); g.stroke();
          }
          g.drawImage(spr.c, p.x + spr.ox, p.y + spr.oy - bob);
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    // clickable objects: a soft pulse always, a bright outline on hover
    for (const h of rm.hotspots ?? []) {
      const on = store.hoverHot === h.id, pu = 0.5 + 0.5 * Math.sin(this.t * 3);
      g.strokeStyle = on ? '#86e0bd' : `rgba(232,194,90,${0.25 + 0.35 * pu})`;
      g.lineWidth = 1;
      g.strokeRect(h.x - 1.5, h.y - 1.5, h.w + 3, h.h + 3);
    }
    // evening light through the windows
    const L = TownArt.lighting(this.town.mins);
    if (L.night > 0.05) { g.fillStyle = `rgba(16,18,64,${L.night * 0.25})`; g.fillRect(0, 0, IW, IH); }

    const wg = this.worldTex.getContext();
    wg.setTransform(1, 0, 0, 1, 0, 0);
    wg.imageSmoothingEnabled = false;
    wg.drawImage(this.roomCanvas, 0, 0, W, H);
    this.worldTex.refresh();

    // Labels: everyone's name, speech bubbles, and what's happening in the room
    const tg = this.topTex.getContext();
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, W * S, H * S);
    tg.setTransform(S, 0, 0, S, 0, 0);
    const pb = this.town.placeBubble[rm.key];
    if (pb) bubble(tg, pb.text, W / 2, H - 40, '#241b2e', '#fffaf0', 14);
    for (const p of placed) {
      const top = (p.y - this.heightOf(p.f)) * 2;
      const chosen = (sel.type === 'agent' && sel.id === p.f.id) || store.hover === p.f.id;
      if (p.f.bubbleT > 0) bubble(tg, p.f.bubble, p.x * 2, top - 2, '#241b2e', '#fffaf0', 14);
      else bubble(tg, firstName(p.f), p.x * 2, top - 2, chosen ? '#241b2e' : '#86e0bd', chosen ? '#86e0bd' : '#241b2e', 13);
    }
    if (!placed.length) bubble(tg, 'Nobody is in right now', W / 2, H / 2, '#f1ead8', '#241b2e', 16);
    for (const h of rm.hotspots ?? []) {
      const on = store.hoverHot === h.id;
      bubble(tg, on ? `Open ${h.label}` : h.label, (h.x + h.w / 2) * 2, h.y * 2 - 4, on ? '#241b2e' : '#f1ead8', on ? '#86e0bd' : '#2f2a4d', 13);
    }
  }

  private drawLabels(g: CanvasRenderingContext2D) {
    const R = painter(g);
    const sel = store.sel;
    // selected or hovered building: a pulsing outline around it
    const outlined = new Set<PlaceKey>();
    if (sel.type === 'place') outlined.add(sel.key);
    if (this.hoverPlace) outlined.add(this.hoverPlace);
    const z = this.cam.z;
    g.setTransform(S * z, 0, 0, S * z, -this.cam.x * S * z, -this.cam.y * S * z);
    for (const k of outlined) {
      const pu = 0.5 + 0.5 * Math.sin(this.t * 4);
      const b = this.art.buildings[k];
      g.globalAlpha = k === (sel.type === 'place' ? sel.key : null) ? 0.55 + 0.45 * pu : 0.45;
      if (b) g.drawImage(b.outline, b.x - 1, b.y - 1);
      else if (k === 'plaza') {
        g.strokeStyle = '#86e0bd'; g.lineWidth = 1; g.setLineDash([3, 2]);
        const c = [proj(PLAZA[0], PLAZA[1]), proj(PLAZA[2], PLAZA[1]), proj(PLAZA[2], PLAZA[3]), proj(PLAZA[0], PLAZA[3])];
        g.beginPath(); c.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); g.setLineDash([]);
      }
      g.globalAlpha = 1;
    }
    g.setTransform(S, 0, 0, S, 0, 0);
    g.font = `600 6px ${PF}`;
    g.textBaseline = 'top';
    for (const k of PLACE_KEYS) {
      const p = PLACES[k];
      if (!p.badge) continue;
      const [bx, by] = this.toView(...proj(p.badge[0], p.badge[1], p.badge[2]));
      const pb = this.town.placeBubble[k];
      if (pb) bubble(g, pb.text, bx, by - 12);
      const n = this.town.occ[k];
      if (!n) continue;
      const txt = k === 'church' ? `${n} at church` : `${n} at work`;
      const w = Math.ceil(g.measureText(txt).width) + 13, h = 10;
      const x0 = Math.round(bx - w / 2), y0 = Math.round(by - h);
      R(x0, y0, w, h, '#241b2e'); R(x0 + 1, y0 + 1, w - 2, h - 2, '#2f2a4d');
      R(x0 + 3, y0 + 3, 4, 4, Math.sin(this.t * 5) > 0 ? '#86e0bd' : '#3f7f6a');
      g.fillStyle = '#f1ead8'; g.fillText(txt, x0 + 9, y0 + 2);
      R(Math.round(bx) - 1, y0 + h, 3, 1, '#241b2e');
    }
    for (const f of this.town.figs) {
      if (f.state === 'inside') continue;
      const [fx, fy] = this.toView(...this.feet(f) as [number, number]);
      const top = fy - Math.round(this.heightOf(f) * z);
      if (f.bubbleT > 0) bubble(g, f.bubble, fx, top);
      else if ((sel.type === 'agent' && sel.id === f.id) || store.hover === f.id) bubble(g, firstName(f), fx, top, '#86e0bd', '#241b2e');
    }
  }
}

const firstName = (f: Figure) => f.name.split(' ')[0];

function bubble(g: CanvasRenderingContext2D, txt: string, x: number, y: number, fg = '#241b2e', bg = '#fffaf0', size = 6) {
  const R = painter(g);
  g.font = `600 ${size}px ${PF}`;
  g.textBaseline = 'top';
  const pad = Math.round(size * 0.6), w = Math.ceil(g.measureText(txt).width) + pad * 2 + 1, h = Math.round(size * 1.7);
  const bx = clamp(Math.round(x - w / 2), 2, W - w - 2);
  const by = Math.max(2, Math.round(y - h));
  R(bx, by, w, h, '#241b2e'); R(bx + 1, by + 1, w - 2, h - 2, bg);
  R(Math.round(x) - 1, by + h, 3, 1, '#241b2e'); R(Math.round(x), by + h + 1, 1, 1, '#241b2e');
  g.fillStyle = fg; g.fillText(txt, bx + pad + 0.5, by + Math.round(size * 0.35));
}
