import type { AgentDef } from '../world/agents';

/**
 * Image sprite sheets for townsfolk drawn in a sprite tool (Sprite AI, PixelLab, Aseprite...).
 *
 * A sheet is a grid of equal square cells read left to right, top to bottom, with the character
 * facing right (or three-quarters right). Left-facing frames are made by mirroring.
 * Put the PNG in public/sprites/ at its original pixel size (no upscaling) and point an agent's
 * `sprite` at it in src/world/agents.ts.
 */
export interface SpriteSheet {
  /** Path under public/, e.g. "/sprites/governor.png". */
  src: string;
  /** Width and height of one cell in pixels. */
  cell: number;
  /** Number of walk frames in the sheet. */
  frames: number;
  /** Which frame to use when standing still. */
  idle: number;
  /** Pixel row of the character's feet inside a cell. */
  feetY: number;
  /** Pixel row of the top of the head inside a cell (used to place name tags). */
  headY: number;
}

export interface SpriteFrames { right: HTMLCanvasElement[]; left: HTMLCanvasElement[]; sheet: SpriteSheet }

const loaded = new Map<string, SpriteFrames>();

function cut(img: HTMLImageElement, s: SpriteSheet, i: number, mirror: boolean) {
  const cols = Math.floor(img.width / s.cell);
  const c = document.createElement('canvas');
  c.width = c.height = s.cell;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  if (mirror) { g.translate(s.cell, 0); g.scale(-1, 1); }
  g.drawImage(img, (i % cols) * s.cell, Math.floor(i / cols) * s.cell, s.cell, s.cell, 0, 0, s.cell, s.cell);
  return c;
}

/** Load every agent's sprite sheet. Agents whose image fails to load fall back to their drawn look. */
export async function loadSprites(defs: AgentDef[]) {
  await Promise.all(defs.filter((d) => d.sprite).map((d) => new Promise<void>((done) => {
    const s = d.sprite!;
    const img = new Image();
    img.onload = () => {
      const idx = Array.from({ length: s.frames }, (_, i) => i);
      loaded.set(d.id, { sheet: s, right: idx.map((i) => cut(img, s, i, false)), left: idx.map((i) => cut(img, s, i, true)) });
      done();
    };
    img.onerror = () => { console.warn(`[sprites] Could not load ${s.src} for ${d.id}; using the drawn look instead.`); done(); };
    img.src = s.src;
  })));
}

export const spriteFor = (id: string) => loaded.get(id);
