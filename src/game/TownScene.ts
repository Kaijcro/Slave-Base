import Phaser from 'phaser';
import { W, H, S, PF } from '../config';
import { drawHuman, type Dir } from '../art/human';
import { buildBackground, TownArt } from '../art/town';
import { painter, clamp } from '../art/pixel';
import { PLACES, type PlaceKey } from '../world/places';
import type { Town, Figure } from './Town';
import type { AgentSource } from '../data/types';
import { store } from '../ui/store';

const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
const SPR_W = 16, SPR_H = 26, FEET_Y = 24;

/**
 * Draws the town every frame.
 * Layers, bottom to top: background image -> scenery canvas -> people (Phaser sprites) -> night + labels canvas.
 */
export class TownScene extends Phaser.Scene {
  private art = new TownArt();
  private worldTex!: Phaser.Textures.CanvasTexture;
  private topTex!: Phaser.Textures.CanvasTexture;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private t = 0;

  constructor(private town: Town, private source: AgentSource) {
    super('town');
  }

  create() {
    this.textures.addCanvas('bg', buildBackground());
    this.add.image(0, 0, 'bg').setOrigin(0).setDepth(0);
    this.worldTex = this.textures.createCanvas('world', W * S, H * S)!;
    this.add.image(0, 0, 'world').setOrigin(0).setDepth(1);
    this.topTex = this.textures.createCanvas('top', W * S, H * S)!;
    this.add.image(0, 0, 'top').setOrigin(0).setDepth(100000);

    // Clickable buildings
    for (const [key, p] of Object.entries(PLACES) as [PlaceKey, (typeof PLACES)[PlaceKey]][]) {
      const [rx, ry, rw, rh] = p.rect;
      const z = this.add.zone(rx * S, ry * S, rw * S, rh * S).setOrigin(0).setDepth(key === 'plaza' ? 2 : 3).setInteractive({ useHandCursor: true });
      z.on('pointerdown', () => store.select({ type: 'place', key }));
    }

    // One sprite per person, with a texture for each direction and walk frame
    for (const f of this.town.figs) {
      for (const dir of DIRS) {
        for (let n = 0; n < 3; n++) {
          const tex = this.textures.createCanvas(`${f.id}-${dir}-${n}`, SPR_W * S, SPR_H * S)!;
          const g = tex.getContext();
          g.imageSmoothingEnabled = false;
          g.setTransform(S, 0, 0, S, 0, 0);
          drawHuman(g, f.look, SPR_W / 2, FEET_Y, dir, n === 2 ? 1 : 0, n > 0);
          tex.refresh();
        }
      }
      const s = this.add.sprite(0, 0, `${f.id}-down-0`).setOrigin(0.5, FEET_Y / SPR_H).setInteractive({ useHandCursor: true });
      s.on('pointerdown', () => store.select({ type: 'agent', id: f.id }));
      s.on('pointerover', () => (store.hover = f.id));
      s.on('pointerout', () => { if (store.hover === f.id) store.hover = null; });
      this.sprites.set(f.id, s);
    }
  }

  update(_time: number, delta: number) {
    const realDt = Math.min(0.05, delta / 1000);
    const dt = this.source.mode === 'live' ? realDt : realDt * store.speed;
    if (dt > 0) {
      this.source.tick?.(dt);
      this.t += dt;
    }
    this.town.update(dt, dt > 0 ? realDt : 0);
    if (dt > 0) this.art.update(dt, this.town.occ);

    const mins = this.town.mins;

    // Scenery layer
    const g = this.worldTex.getContext();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W * S, H * S);
    g.setTransform(S, 0, 0, S, 0, 0);
    g.imageSmoothingEnabled = false;
    this.art.drawScenery(g, this.t, mins, this.town.occ);
    const sel = store.sel;
    if (sel.type === 'agent') {
      const f = this.town.byId.get(sel.id);
      if (f && f.state !== 'inside') {
        const pu = 0.5 + 0.5 * Math.sin(this.t * 5);
        g.strokeStyle = `rgba(134,224,189,${0.55 + 0.45 * pu})`;
        g.lineWidth = 1;
        g.beginPath(); g.ellipse(f.x, f.y, 6 + pu, 2.6 + pu * 0.4, 0, 0, Math.PI * 2); g.stroke();
      }
    }
    this.worldTex.refresh();

    // People
    for (const f of this.town.figs) {
      const s = this.sprites.get(f.id)!;
      const visible = f.state !== 'inside';
      s.setVisible(visible);
      if (s.input) s.input.enabled = visible;
      if (!visible) continue;
      const moving = f.state === 'walk' || (f.state === 'idle' && !!f.wp);
      s.setTexture(`${f.id}-${f.dir}-${moving ? 1 + f.frame : 0}`);
      s.setPosition(Math.round(f.x) * S, Math.round(f.y) * S);
      s.setDepth(10 + f.y);
    }

    // Night, badges and speech bubbles
    const tg = this.topTex.getContext();
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, W * S, H * S);
    tg.setTransform(S, 0, 0, S, 0, 0);
    this.art.drawNight(tg, this.t, mins);
    this.drawLabels(tg);
    this.topTex.refresh();
  }

  private drawLabels(g: CanvasRenderingContext2D) {
    const R = painter(g);
    const sel = store.sel;
    if (sel.type === 'place') {
      const [rx, ry, rw, rh] = PLACES[sel.key].rect;
      const pu = 0.5 + 0.5 * Math.sin(this.t * 4);
      g.strokeStyle = `rgba(134,224,189,${0.5 + 0.5 * pu})`; g.lineWidth = 1; g.setLineDash([3, 2]);
      g.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1); g.setLineDash([]);
    }
    g.font = `600 5px ${PF}`;
    g.textBaseline = 'top';
    for (const [k, p] of Object.entries(PLACES) as [PlaceKey, (typeof PLACES)[PlaceKey]][]) {
      if (!p.badge) continue;
      const pb = this.town.placeBubble[k];
      if (pb) { bubble(g, pb.text, p.badge[0], p.badge[1] - 10); }
      const n = this.town.occ[k];
      if (!n) continue;
      const txt = `${n} at work`;
      const w = Math.ceil(g.measureText(txt).width) + 12, h = 9;
      const bx = Math.round(p.badge[0] - w / 2), by = Math.round(p.badge[1] - h);
      R(bx, by, w, h, '#241b2e'); R(bx + 1, by + 1, w - 2, h - 2, '#2f2a4d');
      R(bx + 3, by + 3, 3, 3, Math.sin(this.t * 5) > 0 ? '#86e0bd' : '#3f7f6a');
      g.fillStyle = '#f1ead8'; g.fillText(txt, bx + 8, by + 2);
      R(p.badge[0] - 1, by + h, 3, 1, '#241b2e');
    }
    for (const f of this.town.figs) {
      if (f.state === 'inside') continue;
      const top = f.y - 21 - (f.look.tall ? 1 : 0);
      if (f.bubbleT > 0) bubble(g, f.bubble, f.x, top);
      else if ((sel.type === 'agent' && sel.id === f.id) || store.hover === f.id) bubble(g, firstName(f), f.x, top, '#86e0bd', '#241b2e');
    }
  }
}

const firstName = (f: Figure) => f.name.split(' ')[0];

function bubble(g: CanvasRenderingContext2D, txt: string, x: number, y: number, fg = '#241b2e', bg = '#fffaf0') {
  const R = painter(g);
  g.font = `600 5px ${PF}`;
  g.textBaseline = 'top';
  const w = Math.ceil(g.measureText(txt).width) + 6, h = 9;
  const bx = clamp(Math.round(x - w / 2), 2, W - w - 2);
  const by = Math.max(2, Math.round(y - h));
  R(bx, by, w, h, '#241b2e'); R(bx + 1, by + 1, w - 2, h - 2, bg);
  R(Math.round(x) - 1, by + h, 3, 1, '#241b2e'); R(Math.round(x), by + h + 1, 1, 1, '#241b2e');
  g.fillStyle = fg; g.fillText(txt, bx + 3, by + 2);
}
