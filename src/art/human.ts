import { painter } from './pixel';

export type Dir = 'down' | 'up' | 'left' | 'right';

/**
 * Everything that makes a townsperson look unique.
 * Mix and match these to design a new agent.
 */
export interface Look {
  skin: string;
  hair: string;
  style: 'short' | 'curly' | 'afro' | 'bald' | 'buns' | 'bob' | 'swoop' | 'braid';
  shirt: string;
  pattern?: 'collar' | 'jacket' | 'plaid' | 'cardigan' | 'overalls' | 'vest' | 'coat' | 'hoodie';
  accent: string;
  pants: string;
  legs: 'pants' | 'skirt' | 'shorts';
  shoes: string;
  hat?: { type: 'cowboy' | 'visor'; color: string };
  glasses?: string;
  beard?: string;
  mustache?: string;
  earrings?: string;
  headphones?: string;
  backpack?: string;
  bow?: string;
  freckles?: boolean;
  tall?: boolean;
}

/**
 * Draws one person with their feet at (x, y), in town pixels.
 * `step` is the walk frame (0 or 1); `walking` lifts the legs and swings the arms.
 */
export function drawHuman(g: CanvasRenderingContext2D, L: Look, x: number, y: number, dir: Dir, step: number, walking: boolean) {
  const P = painter(g);
  x = Math.round(x);
  y = Math.round(y);
  const ox = x - 4;
  const t = L.tall ? 1 : 0;
  const u = y - t;
  const side = dir === 'left' || dir === 'right';
  const back = dir === 'up';
  const liftL = walking && step === 0 ? 1 : 0;
  const liftR = walking && step === 1 ? 1 : 0;

  // shadow
  P(ox, y - 1, 8, 2, 'rgba(20,16,40,.28)');

  // legs and shoes
  const legC = L.legs === 'pants' ? L.pants : L.skin;
  const l1 = side ? ox + 2 : ox + 1;
  const l2 = side ? ox + 4 : ox + 5;
  P(l1, y - 5 - t, 2, 4 + t - liftL, legC);
  P(l2, y - 5 - t, 2, 4 + t - liftR, legC);
  P(l1, y - 1 - liftL, 2, 1, L.shoes);
  P(l2, y - 1 - liftR, 2, 1, L.shoes);
  if (L.legs === 'skirt') {
    P(ox + 1, u - 6, 6, 3, L.pants);
    P(ox + 1, u - 4, 6, 1, 'rgba(0,0,0,.12)');
  }
  if (L.legs === 'shorts') P(ox + 1, u - 6, 6, 2, L.pants);

  // torso
  if (L.pattern === 'coat') {
    P(ox + 1, u - 10, 6, 7, L.shirt);
    P(ox + 1, u - 7, 6, 1, L.accent);
    if (!back) P(ox + 4, u - 9, 1, 5, L.accent);
  } else P(ox + 1, u - 10, 6, 5, L.shirt);
  P(ox + 1, u - 6, 6, 1, 'rgba(0,0,0,.12)');
  if (!back) {
    switch (L.pattern) {
      case 'collar': P(ox + 3, u - 10, 2, 1, L.accent); break;
      case 'jacket': P(ox + 3, u - 10, 2, 5, L.accent); P(ox + 3, u - 9, 1, 1, '#2b2540'); break;
      case 'plaid':
        P(ox + 1, u - 8, 6, 1, 'rgba(30,20,40,.35)');
        P(ox + 3, u - 10, 1, 5, 'rgba(30,20,40,.3)');
        P(ox + 5, u - 10, 1, 5, 'rgba(30,20,40,.2)');
        break;
      case 'cardigan': P(ox + 3, u - 10, 2, 5, L.accent); P(ox + 2, u - 8, 1, 1, '#f6c560'); break;
      case 'overalls':
        P(ox + 2, u - 8, 4, 3, L.accent);
        P(ox + 2, u - 10, 1, 2, L.accent);
        P(ox + 5, u - 10, 1, 2, L.accent);
        P(ox + 3, u - 8, 1, 1, '#f6c560');
        break;
      case 'vest':
        P(ox + 1, u - 10, 2, 5, L.accent);
        P(ox + 5, u - 10, 2, 5, L.accent);
        if (L.bow) P(ox + 3, u - 10, 2, 1, L.bow);
        break;
      case 'hoodie': P(ox + 2, u - 7, 4, 1, L.accent); P(ox + 3, u - 10, 1, 2, '#e9e2d0'); break;
    }
  }

  // arms
  const aL = walking && step === 1 ? 1 : 0;
  const aR = walking && step === 0 ? 1 : 0;
  P(ox, u - 10 + aL, 1, 3, L.shirt);
  P(ox, u - 7 + aL, 1, 1, L.skin);
  P(ox + 7, u - 10 + aR, 1, 3, L.shirt);
  P(ox + 7, u - 7 + aR, 1, 1, L.skin);

  if (L.backpack) {
    if (back) P(ox + 2, u - 10, 4, 4, L.backpack);
    else if (side) P(dir === 'left' ? ox + 6 : ox, u - 10, 2, 4, L.backpack);
    else { P(ox + 1, u - 10, 1, 3, L.backpack); P(ox + 6, u - 10, 1, 3, L.backpack); }
  }

  // head and face
  P(ox + 1, u - 15, 6, 5, L.skin);
  P(ox + 1, u - 11, 6, 1, 'rgba(0,0,0,.08)');
  if (!back) {
    const eyes = dir === 'left' ? [1, 3] : dir === 'right' ? [4, 6] : [2, 5];
    if (L.glasses) P(ox + 1, u - 13, 6, 1, L.glasses);
    eyes.forEach((e) => P(ox + e, u - 13, 1, 1, '#241b2e'));
    if (!side) {
      P(ox + 1, u - 12, 1, 1, 'rgba(255,110,110,.35)');
      P(ox + 6, u - 12, 1, 1, 'rgba(255,110,110,.35)');
    }
    if (L.freckles) { P(ox + 2, u - 12, 1, 1, '#c8794e'); P(ox + 5, u - 12, 1, 1, '#c8794e'); }
  }

  // hair
  const hc = L.hair;
  const shine = 'rgba(255,255,255,.12)';
  if (back && L.style !== 'bald') P(ox + 1, u - 15, 6, 4, hc);
  switch (L.style) {
    case 'short':
      P(ox + 1, u - 16, 6, 2, hc); P(ox + 1, u - 14, 1, 1, hc); P(ox + 6, u - 14, 1, 1, hc);
      break;
    case 'curly':
      P(ox, u - 17, 8, 2, hc); P(ox, u - 15, 1, 4, hc); P(ox + 7, u - 15, 1, 4, hc); P(ox + 1, u - 15, 6, 1, hc);
      P(ox + 1, u - 17, 1, 1, shine); P(ox + 4, u - 16, 1, 1, shine);
      break;
    case 'afro':
      P(ox, u - 20, 8, 1, hc); P(ox - 1, u - 19, 10, 4, hc); P(ox - 1, u - 15, 2, 3, hc); P(ox + 7, u - 15, 2, 3, hc);
      P(ox + 1, u - 15, 6, 1, hc); P(ox + 1, u - 19, 2, 1, 'rgba(255,255,255,.1)');
      break;
    case 'bald':
      P(ox + 2, u - 15, 2, 1, 'rgba(255,255,255,.22)');
      break;
    case 'buns':
      P(ox + 1, u - 16, 6, 2, hc); P(ox + 1, u - 14, 1, 1, hc); P(ox + 6, u - 14, 1, 1, hc);
      P(ox - 1, u - 19, 3, 3, hc); P(ox + 6, u - 19, 3, 3, hc);
      P(ox, u - 18, 1, 1, 'rgba(255,255,255,.25)'); P(ox + 7, u - 18, 1, 1, 'rgba(255,255,255,.25)');
      break;
    case 'bob':
      P(ox, u - 16, 8, 2, hc); P(ox, u - 14, 1, 4, hc); P(ox + 7, u - 14, 1, 4, hc); P(ox + 1, u - 14, 2, 1, hc);
      break;
    case 'swoop':
      P(ox + 2, u - 18, 5, 1, hc); P(ox + 1, u - 17, 7, 1, hc); P(ox + 1, u - 16, 6, 1, hc);
      P(ox + 4, u - 15, 3, 1, hc); P(ox + 1, u - 15, 1, 1, hc);
      break;
    case 'braid':
      P(ox + 1, u - 16, 6, 2, hc); P(ox + 1, u - 14, 1, 1, hc); P(ox + 6, u - 14, 1, 1, hc);
      P(ox + 7, u - 14, 1, 7, hc); P(ox + 7, u - 8, 1, 1, '#f6c560');
      P(ox + 7, u - 12, 1, 1, shine); P(ox + 7, u - 10, 1, 1, shine);
      break;
  }
  if (!back) {
    if (L.beard) {
      P(ox + 1, u - 12, 1, 2, L.beard); P(ox + 6, u - 12, 1, 2, L.beard);
      P(ox + 1, u - 11, 6, 1, L.beard); P(ox + 3, u - 12, 2, 1, L.beard);
    }
    if (L.mustache) P(ox + 2, u - 12, 4, 1, L.mustache);
  }
  if (L.earrings) { P(ox, u - 12, 1, 1, L.earrings); P(ox + 7, u - 12, 1, 1, L.earrings); }
  if (L.headphones) {
    P(ox + 1, u - 17, 6, 1, '#2b2540'); P(ox, u - 16, 1, 2, '#2b2540'); P(ox + 7, u - 16, 1, 2, '#2b2540');
    P(ox, u - 14, 1, 2, L.headphones); P(ox + 7, u - 14, 1, 2, L.headphones);
  }
  if (L.hat) {
    const c = L.hat.color;
    if (L.hat.type === 'cowboy') {
      P(ox + 1, u - 19, 6, 3, c); P(ox + 3, u - 19, 2, 1, 'rgba(0,0,0,.25)'); P(ox + 1, u - 17, 6, 1, '#2b2540');
      P(ox - 2, u - 16, 12, 1, c); P(ox - 2, u - 17, 1, 1, c); P(ox + 9, u - 17, 1, 1, c);
    }
    if (L.hat.type === 'visor') {
      P(ox + 1, u - 16, 6, 1, c);
      P(dir === 'left' ? ox : ox + 1, u - 15, 7, 1, c);
    }
  }
}
