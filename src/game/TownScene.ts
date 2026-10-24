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
      const hit = this.pick(p.x / S, p.y / S);
      if (hit?.type === 'agent') store.select({ type: 'agent', id: hit.id });
      else if (hit?.type === 'place') store.select({ type: 'place', key: hit.key });
    });
    this.game.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const c = this.game.canvas, k = W / c.clientWidth;
      this.zoomAt(Math.exp(-e.deltaY * 0.0018), e.offsetX * k, e.offsetY * k);
    }, { passive: false });
    store.cam.zoomBy = (f) => this.zoomAt(f, W / 2, H / 2);
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
  private frameFor(f: Figure, moving: boolean): { c: HTMLCanvasElement; ox: number; oy: number } {
    const sp = spriteFor(f.id);
    if (sp) {
      const s = sp.sheet;
      const i = moving ? Math.floor(f.dist / 0.22) % s.frames : s.idle;
      return { c: (f.dir === 'left' ? sp.left : sp.right)[i], ox: -s.cell / 2, oy: -s.feetY };
    }
    const n = moving ? 1 + (Math.floor(f.dist / 0.32) % 2) : 0;
    return { c: this.sprites.get(`${f.id}-${f.dir}-${n}`)!, ox: -(SPR_W * PERSON_SCALE) / 2, oy: -FEET_Y * PERSON_SCALE };
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

  private hover(x: number, y: number) {
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
    this.followCam(realDt);
    this.worldImg.setScale(S * this.cam.z).setPosition(-this.cam.x * S * this.cam.z, -this.cam.y * S * this.cam.z);
    if (dt > 0) this.art.update(dt, this.town.occ, this.town.figs, this.town.bell);
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

function bubble(g: CanvasRenderingContext2D, txt: string, x: number, y: number, fg = '#241b2e', bg = '#fffaf0') {
  const R = painter(g);
  g.font = `600 6px ${PF}`;
  g.textBaseline = 'top';
  const w = Math.ceil(g.measureText(txt).width) + 7, h = 10;
  const bx = clamp(Math.round(x - w / 2), 2, W - w - 2);
  const by = Math.max(2, Math.round(y - h));
  R(bx, by, w, h, '#241b2e'); R(bx + 1, by + 1, w - 2, h - 2, bg);
  R(Math.round(x) - 1, by + h, 3, 1, '#241b2e'); R(Math.round(x), by + h + 1, 1, 1, '#241b2e');
  g.fillStyle = fg; g.fillText(txt, bx + 3.5, by + 2);
}
