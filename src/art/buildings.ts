import { proj, type Rect } from '../iso/iso';
import { col, shade, mix, type Col, type Frag } from '../iso/raster';
import { FOOT } from '../world/streets';
import { Building, pixFor, inBox, wallText, siding, arch } from './kit';
import { drawCarInto, type CarLook } from './props';

/**
 * The town's buildings, each drawn from your reference photos as isometric pixel art.
 * Walls are described as "shaders": functions that get a position on the wall (x across, y up, in pixels)
 * and return a color. That keeps windows, siding and signs crisp and correctly skewed.
 */

const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const WARM = col('#ffd27a');

/* ======================================================================
 * Town Hall: a classical stone civic building with a columned portico,
 * tall arched windows lit gold at night, and a dark slate roof.
 * ==================================================================== */
export function townHall(): Building {
  const [u0, v0, u1, v1] = FOOT.hall;
  const p = pixFor([u0, v0, u1, 15.9], 140);
  const stone = col('#efe6d3'), stoneR = col('#d6cbb3'), stoneTop = col('#f8f2e4'), seam = col('#ddd2bb'), seamR = col('#c4b89f');
  const plinth = col('#c7bba3'), plinthR = col('#b1a68e');
  const glass = col('#4c5a7a'), glassL = col('#7e90b5'), frame = col('#a8997f');
  const slate = col('#4a5165'), slateR = col('#3c4255'), slateTop = col('#5a6178'), slateL = col('#646b82');
  const HW = 54;
  const LF = (u1 - u0) * 16, LS = (v1 - v0) * 16;
  const floors: [number, number][] = [[8, 21], [29, 41]];

  const windowAt = (x: number, y: number, xs: number[]) => {
    for (const wx of xs) for (const [y0, y1] of floors) {
      if (arch(x, y, wx, 7, y0, y1)) return arch(x, y, wx + 1, 5, y0 + 1, y1) ? (x - wx === 2 && y > y0 + 3 ? glassL : glass) : frame;
    }
    return 0;
  };
  const wallShader = (base: Col, sm: Col, pl: Col, xs: number[]) => (x: number, y: number) => {
    if (y < 6) return y < 1 ? shade(pl, 0.85) : pl;
    if (y >= 49) return y >= 52 ? stoneTop : (Math.floor(x) % 4 < 2 ? shade(base, 0.9) : base); // cornice with dentils
    const w = windowAt(x, y, xs);
    if (w) return w;
    if (Math.floor(y) % 7 === 0) return sm; // stone courses
    return base;
  };
  const glowShader = (xs: number[]) => (x: number, y: number) => (windowAt(x, y, xs) && windowAt(x, y, xs) !== frame ? WARM : 0);

  const frontXs = [4, 13, LF - 20, LF - 11];
  const sideXs = [6, 17, 28].filter((x) => x + 7 < LS);
  p.box([u0, v0, u1, v1], 0, HW, {
    left: wallShader(stone, seam, plinth, frontXs),
    right: wallShader(stoneR, seamR, plinthR, sideXs),
    top: () => stoneTop,
  }, { left: glowShader(frontXs), right: glowShader(sideXs) });

  // Slate mansard roof with dormers
  const roof: Rect = [u0 + 0.3, v0 + 0.3, u1 - 0.3, v1 - 0.3];
  const dormer = (x: number, y: number) => y > 3 && y < 10 && Math.floor(x) % 16 > 5 && Math.floor(x) % 16 < 11;
  p.box(roof, 54, 15, {
    left: (x, y) => (dormer(x, y) ? (y > 8 ? slateL : WARM) : Math.floor(y) % 3 === 0 ? slateL : slate),
    right: (x, y) => (dormer(x, y) ? (y > 8 ? slate : WARM) : Math.floor(y) % 3 === 0 ? slate : slateR),
    top: (u, v) => (Math.floor((u + v) * 3) % 2 ? slateTop : shade(slateTop, 0.94)),
  }, { left: (x, y) => (dormer(x, y) && y <= 8 ? WARM : 0), right: (x, y) => (dormer(x, y) && y <= 8 ? WARM : 0) });

  // Portico: four columns, a frieze with the name, and a triangular pediment
  const pu0 = 13.6, pu1 = 16.4, pv1 = 15.35;
  const PW = (pu1 - pu0) * 16;
  const name = wallText('TOWN HALL', 6, PW / 2, 55);
  const colX = [3, 15, PW - 21, PW - 9];
  p.box([pu0, v1, pu1, pv1], 0, 50, {
    right: (x, y) => (y < 4 ? plinthR : stoneR),
    top: () => stoneTop,
    left: (x, y) => {
      if (y < 4) return plinth;
      if (y >= 44) return y >= 48 ? stoneTop : shade(stone, 0.93); // capitals band
      for (const cx of colX) if (x >= cx && x < cx + 6) return x === cx + 5 ? stoneR : x === cx ? stoneTop : y > 40 ? stoneTop : stone;
      // recessed wall behind the columns, with the doors
      if (inBox(x, y, PW / 2 - 6, 4, 12, 20)) return x === PW / 2 ? col('#3b2416') : col('#6b4428');
      return col('#7d7766');
    },
  });
  // frieze above the columns
  p.wall(pu0, pv1, pu1, pv1, 50, 9, (x, y) => (name.on(x, y + 50) ? col('#3a3446') : y < 1 || y >= 8 ? stoneTop : stone));
  // pediment: triangle on the front, sloped roof behind it
  p.quad([pu0 - 0.1, pv1, 59], [pu1 - pu0 + 0.2, 0, 0], [0, 0, 17], (f: Frag) => {
    const lim = 1 - Math.abs(2 * f.s - 1);
    if (f.t > lim) return 0;
    if (lim - f.t < 0.09 || f.t < 0.1) return stoneTop;
    return f.t > 0.3 && f.t < 0.55 && Math.abs(f.s - 0.5) < 0.06 ? col('#d2b45a') : stone; // a gold medallion
  });
  p.quad([pu1 + 0.1, v1, 59], [0, pv1 - v1, 0], [-(pu1 - pu0 + 0.2) / 2, 0, 17], () => slateR);
  // steps
  p.box([pu0 - 0.2, pv1, pu1 + 0.2, pv1 + 0.25], 0, 4, { left: (x, y) => (y >= 3 ? stoneTop : plinth), right: () => plinthR, top: () => stoneTop });
  p.box([pu0 - 0.4, pv1 + 0.25, pu1 + 0.4, pv1 + 0.5], 0, 2, { left: (x, y) => (y >= 1 ? stoneTop : plinth), right: () => plinthR, top: () => stoneTop });

  const flagBase = proj(15, (v0 + v1) / 2, 69);
  return new Building('hall', p, [u0, v0, u1, pv1], (b, t, busy) => {
    const g = b.ctx;
    const [fx, fy] = flagBase;
    g.fillStyle = '#d9d6e2'; g.fillRect(fx, fy - 26, 1, 26);
    const sp = reduce ? 0 : busy ? 5 : 2.5;
    for (let i = 0; i < 11; i++) {
      const yo = Math.round(Math.sin(t * sp - i * 0.7) * 1.1);
      g.fillStyle = i % 3 === 0 ? '#5aa98a' : '#86e0bd';
      g.fillRect(fx + 1 + i, fy - 26 + yo, 1, 7);
    }
  });
}

/* ======================================================================
 * Church: a white clapboard chapel with a gray shingle roof, a belfry and spire,
 * arched windows and a red front door, a short walk north of town.
 * ==================================================================== */
export function church(): Building {
  const [u0, v0, u1, v1] = FOOT.church; // [11, -15, 15, -8.2]
  const p = pixFor([u0 - 0.4, v0 - 0.4, u1 + 0.4, v1 + 0.9], 140);
  const white = col('#f6f4ee'), whiteR = col('#dcd9d2'), line = col('#d7d3ca'), lineR = col('#c3bfb6');
  const shingle = col('#8b8f99'), shingleD = col('#737782'), shingleL = col('#a2a6b0');
  const glass = col('#5a6f98'), glassL = col('#9cb4dc'), trim = col('#ffffff');
  const red = col('#a8322d'), redD = col('#7e221f');
  const HW = 40, RIDGE = 24, cu = (u0 + u1) / 2;
  const LF = (u1 - u0) * 16;

  const winGlow = (on: boolean) => (on ? col('#ffcf7a') : 0);
  const sideWins = [16, 48, 80];
  const side = (x: number, y: number) => {
    if (y < 3) return lineR;
    for (const wx of sideWins) {
      if (arch(x, y, wx - 1, 11, 9, 26)) return arch(x, y, wx, 9, 10, 26) ? (Math.floor(y) === 17 || x === wx + 4 ? trim : (x - wx < 3 && y > 13 ? glassL : glass)) : trim;
    }
    return siding(y, 3, whiteR, lineR);
  };
  const frontWins = [9, LF - 18];
  const front = (x: number, y: number) => {
    if (y < 3) return line;
    const dx = LF / 2;
    if (arch(x, y, dx - 6, 12, 3, 20)) return arch(x, y, dx - 5, 10, 3, 20) ? (Math.floor(x) === Math.floor(dx) ? redD : red) : trim;
    for (const wx of frontWins) if (arch(x, y, wx - 1, 10, 11, 24)) return arch(x, y, wx, 8, 12, 24) ? (x - wx < 2 ? glassL : glass) : trim;
    return siding(y, 3, white, line);
  };
  p.box([u0, v0, u1, v1], 0, HW, { left: front, right: side }, {
    left: (x, y) => { for (const wx of frontWins) if (arch(x, y, wx, 8, 12, 24)) return winGlow(true); return 0; },
    right: (x, y) => { for (const wx of sideWins) if (arch(x, y, wx, 9, 10, 26)) return winGlow(true); return 0; },
  });

  // front gable: white triangle with a round window
  p.quad([u0, v1, HW], [u1 - u0, 0, 0], [0, 0, RIDGE], (f: Frag) => {
    const lim = 1 - Math.abs(2 * f.s - 1);
    if (f.t > lim) return 0;
    const dx = (f.s - 0.5) * LF, dy = (f.t - 0.38) * RIDGE;
    if (dx * dx + dy * dy < 12) return dx * dx + dy * dy < 6 ? glass : trim;
    return siding(f.t * RIDGE, 3, white, line);
  });
  // roof planes, with a little overhang at the eaves and over the gable
  const e = 0.3;
  const shingles = (base: Col) => (f: Frag) => {
    const row = Math.floor(f.et0 / 3.5);
    if (f.et0 % 3.5 < 1) return shingleD;
    return Math.floor(f.es0 / 6 + row * 0.5) % 2 ? base : shade(base, 0.95);
  };
  p.quad([u0 - e, v0 - 0.2, HW - 3], [0, v1 - v0 + 0.45, 0], [cu - u0 + e, 0, RIDGE + 3], shingles(shingleL));
  p.quad([u1 + e, v0 - 0.2, HW - 3], [0, v1 - v0 + 0.45, 0], [-(u1 - cu + e), 0, RIDGE + 3], shingles(shingle));

  // belfry tower on the front of the ridge, then the spire and cross
  const T: Rect = [cu - 0.75, v1 - 1.5, cu + 0.75, v1 + 0.2];
  const TB = 54, TH = 30;
  const belfry = (x: number, y: number, base: Col, ln: Col) => {
    if (y >= TH - 3) return y >= TH - 1 ? trim : ln;
    if (arch(x, y, 6, 12, 10, 21)) return arch(x, y, 7, 10, 10, 21) ? (Math.floor(y) % 3 === 0 ? col('#c9c5bb') : col('#3a3442')) : trim;
    return siding(y, 3, base, ln);
  };
  p.box(T, TB, TH, { left: (x, y) => belfry(x, y, white, line), right: (x, y) => belfry(x, y, whiteR, lineR), top: () => shingleD });
  const sb: Rect = [T[0] - 0.12, T[1] - 0.12, T[2] + 0.12, T[3] + 0.12];
  const apex: [number, number, number] = [(sb[0] + sb[2]) / 2, (sb[1] + sb[3]) / 2, TB + TH + 44];
  const tri = (a: [number, number, number], b: [number, number, number], c: Col) =>
    p.quad(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], [apex[0] - a[0], apex[1] - a[1], apex[2] - a[2]], (f) => (f.s + f.t <= 1 ? (Math.floor(f.et0 / 4) % 2 ? c : shade(c, 0.93)) : 0));
  tri([sb[0], sb[3], TB + TH], [sb[2], sb[3], TB + TH], shingleL);
  tri([sb[2], sb[3], TB + TH], [sb[2], sb[1], TB + TH], shingle);
  const [ax, ay] = proj(apex[0], apex[1], apex[2]);
  p.rect(Math.round(ax) - 1, Math.round(ay) - 12, 2, 12, col('#e8c25a'));
  p.rect(Math.round(ax) - 4, Math.round(ay) - 9, 8, 2, col('#e8c25a'));

  // front steps
  p.box([cu - 0.9, v1, cu + 0.9, v1 + 0.35], 0, 4, { left: (x, y) => (y >= 3 ? trim : line), right: () => lineR, top: () => trim });
  p.box([cu - 1.1, v1 + 0.35, cu + 1.1, v1 + 0.7], 0, 2, { left: (x, y) => (y >= 1 ? trim : line), right: () => lineR, top: () => trim });

  // where the bell hangs, inside the front belfry arch
  const [bx, by] = proj(T[0], T[3], TB);
  return new Building('church', p, [u0, v0, u1, v1 + 0.2], (b, t, ringing) => {
    const g = b.ctx;
    const sw = ringing && !reduce ? Math.round(Math.sin(t * 6) * 2) : 0;
    // bell: drawn on the skewed front face, so shift with the 2:1 slope
    const cx = bx + 12, cy = by + (12 * 0.5) - 18;
    g.fillStyle = '#c9a03f';
    for (let i = -3; i <= 3; i++) {
      const h = 5 - Math.abs(i) * 0.6;
      g.fillRect(Math.round(cx + i + sw), Math.round(cy + i * 0.5 + 7 - h), 1, Math.round(h) + 1);
    }
    g.fillStyle = '#7a5a1c'; g.fillRect(Math.round(cx + sw * 1.5), Math.round(cy + 8), 1, 1);
  });
}


/* ======================================================================
 * Refuge Properties: a modern loft office over a garage. Black steel and
 * dark wood, a wall of loft glass upstairs, and the cars parked in the bays.
 * ==================================================================== */
const BAY_INSIDE = col('#120f17');
export function refuge(): Building {
  const [u0, v0, u1, v1] = FOOT.refuge; // [12.4, 2.8, 18, 7.2]
  const p = pixFor([u0, v0, u1, v1 + 0.4], 90);
  const steel = col('#2b2e38'), steelL = col('#3c404d'), steelR = col('#23262e');
  const wood = col('#8b5a34'), woodD = col('#6e4426'), woodL = col('#a26d42'), woodR = col('#74492a');
  const glass = col('#3a4660'), glassW = col('#ffd890'), glassL = col('#6f86ad');
  const gold = col('#f6c560'), concrete = col('#c9c9c4'), roofC = col('#7d828e'), roofD = col('#6b707b');
  const LF = (u1 - u0) * 16, LS = (v1 - v0) * 16;
  const GF = 30, TOP = 60;
  const bays = [3, 26, 49];
  const BW = 19;
  const sign = wallText('REFUGE PROPERTIES', 6, (bays[0] + bays[2] + BW) / 2, GF - 1.5);
  const doorX = 74;

  // upstairs loft glass: dark tint with warm pendant lights and plants inside
  const loft = (x: number, y: number) => {
    const ly = y - GF;
    if (ly < 2 || ly > TOP - GF - 4) return steel;
    if (Math.floor(x) % 11 === 0) return steel; // mullions
    if (Math.floor(ly) === 14) return steel; // transom
    const cx = Math.floor(x) % 11;
    if (ly > 21 && ly < 24 && cx === 5) return glassW; // pendant lamp
    if (ly > 24 && cx === 5) return col('#1a1820');
    if (ly < 7 && (cx === 3 || cx === 4) && Math.floor(x / 11) % 2 === 0) return col('#3f8f3a'); // plants
    return cx < 2 ? glassL : glass;
  };
  const front = (x: number, y: number, f: Frag) => {
    if (y >= TOP - 2) return steelL; // parapet cap
    if (y >= GF) return x < 3 || x > LF - 3 ? woodD : loft(x, y);
    if (y >= GF - 7) {
      if (sign.on(x, y)) return gold;
      return steel;
    }
    for (const bx of bays) {
      if (x >= bx && x < bx + BW) {
        if (x < bx + 1 || x >= bx + BW - 1) return steelL; // frame
        if (y > GF - 11) return Math.floor(y) % 2 ? glassL : glass; // glass roll-up door, mostly open
        return BAY_INSIDE;
      }
    }
    if (x >= doorX && x < doorX + 12 && y < GF - 8) return x === doorX || x === doorX + 11 ? steelL : y > 18 ? glassW : x - doorX < 4 ? glassL : col('#e8d29a');
    void f;
    return Math.floor(x) % 3 === 0 ? woodD : wood; // wood cladding between bays
  };
  const side = (x: number, y: number) => {
    if (y >= TOP - 2) return steel;
    if (y < 2) return steelR;
    if (inBox(x, y, 8, GF + 3, 28, 22)) return Math.floor(x) % 9 === 8 ? steelR : x < 12 ? glassL : glass; // loft corner glass
    if (inBox(x, y, 48, 6, 7, TOP - 14)) return Math.floor(y) % 10 === 0 ? steelR : x === 48 ? glassL : glass; // tall slot window
    return Math.floor(x) % 3 === 0 ? woodR : shade(wood, 0.82);
  };
  p.box([u0, v0, u1, v1], 0, TOP, {
    left: front, right: side,
    top: (a, b) => (Math.floor(a * 2) % 3 === 0 && b > 0.6 && b < LS / 16 - 0.6 ? glassL : (Math.floor((a + b) * 4) % 2 ? roofC : roofD)),
  }, {
    left: (x, y) => (y >= GF + 2 && y < TOP - 4 && Math.floor(x) % 11 !== 0 && Math.floor(y - GF) !== 14 ? glassW : 0),
    right: (x, y) => (inBox(x, y, 8, GF + 3, 28, 22) || inBox(x, y, 48, 6, 7, TOP - 14) ? glassW : 0),
  });
  void woodL;
  // rooftop: two AC units
  for (const [au, av] of [[13.4, 3.6], [14.6, 3.6]]) {
    p.box([au, av, au + 0.7, av + 0.6], TOP, 7, { left: (x, y) => (Math.floor(y) % 2 ? concrete : shade(concrete, 0.9)), right: () => shade(concrete, 0.8), top: () => col('#e2e2dc') });
  }
  // cars in the bays, nose out
  const looks: CarLook[] = [{ body: '#d7263d', style: 'sport' }, { body: '#1c1c24', style: 'sedan' }, { body: '#f4f4f4', style: 'van' }];
  bays.forEach((bx, i) => {
    const cu = u0 + (bx + BW / 2) / 16;
    drawCarInto(p, cu, v1 - 0.9, 'v+', looks[i], (_x, _y, under) => under === BAY_INSIDE);
  });
  // a dark concrete driveway lip in front of the bays
  p.box([u0 + 0.1, v1, u1 - 0.1, v1 + 0.12], 0, 1, { left: () => concrete, top: () => concrete });

  const mail = proj(u0 + (doorX + 14) / 16, v1 + 0.2, 12);
  const hz = bays.map((bx) => proj(u0 + (bx + 4) / 16, v1, 6));
  return new Building('refuge', p, [u0, v0, u1, v1], (b, t, busy) => {
    const g = b.ctx;
    // mailbox by the door, with its flag up while someone is working
    const [mx, my] = mail;
    g.fillStyle = '#2b2533'; g.fillRect(mx - 1, my - 1, 7, 6);
    g.fillStyle = '#3c5a9a'; g.fillRect(mx, my, 5, 4); g.fillStyle = '#5b7fd1'; g.fillRect(mx, my, 5, 1);
    g.fillStyle = '#2b2533'; g.fillRect(mx + 2, my + 4, 1, 6);
    if (busy) { g.fillStyle = '#e04a4a'; g.fillRect(mx + 5, my - 2, 1, 3); }
    // hazard lights blink on the cars while someone is working
    if (busy && !reduce && Math.sin(t * 6) > 0) for (const [x, y] of hz) { g.fillStyle = '#ffb020'; g.fillRect(Math.round(x) + 2, Math.round(y) + 1, 2, 1); }
  });
}

/* ======================================================================
 * Goose Pop Shop: a cream clapboard soda shop with a yellow striped awning,
 * honey-wood windows, a mint door, a pink neon sign, a giant soda cup
 * and the goose mascot on the roof, and balloons by the patio gate.
 * ==================================================================== */
export function goose(): Building {
  const [u0, v0, u1, v1] = FOOT.goose; // [3, 13, 6.4, 17]
  const p = pixFor([u0, v0, 8.2, v1], 96, 6);
  const cream = col('#f7ecd4'), creamL = col('#fff6e3'), creamR = col('#e6d8bc'), line = col('#e3d4b6'), lineR = col('#d0c09f');
  const honey = col('#c98a3a'), honeyD = col('#9c6524'), glass = col('#a9d6ea'), glassD = col('#7fb7d0'), glassW = col('#ffe3a6');
  const mint = col('#7fd8c0'), mintD = col('#4fb39b'), pink = col('#ff86b0'), pinkD = col('#d9608c'), yellow = col('#f7c934'), white = col('#ffffff');
  const HW = 34, FASCIA = 44;
  const LF = (v1 - v0) * 16, LS = (u1 - u0) * 16; // front runs along v, side along u
  const neonPix: [number, number][] = [];
  const neon = wallText('GOOSE POP', 7, LF / 2, FASCIA - 2);
  const pick = wallText('PICK UP', 5, 52, 31);
  const paneWin = (x: number, y: number, x0: number, w: number, y0: number, h: number) => {
    if (!inBox(x, y, x0, y0, w, h)) return 0;
    const lx = Math.floor(x - x0), ly = Math.floor(y - y0);
    if (lx === 0 || lx === w - 1 || ly === 0 || ly === h - 1) return honeyD;
    if (lx % 5 === 0 || ly % 6 === 0) return honey;
    return lx % 5 < 2 ? glass : ly < 3 ? glassW : glassD;
  };
  const front = (x: number, y: number, f: Frag) => {
    if (y >= HW) {
      if (neon.on(x, y)) { neonPix.push([f.x, f.y]); return col('#6a3a56'); }
      return y >= FASCIA - 1 ? pinkD : pink;
    }
    if (y < 2) return mintD;
    const w = paneWin(x, y, 4, 17, 5, 22) || paneWin(x, y, 44, 17, 5, 18);
    if (w) return w;
    if (pick.on(x, y)) return col('#3a2a1a');
    if (inBox(x, y, 43, 4, 19, 2)) return honey; // pickup counter sill
    if (inBox(x, y, 25, 0, 14, 26)) {
      // mint door with a round-top window
      const lx = x - 25;
      if (lx < 1 || lx >= 13 || y >= 25) return mintD;
      if (inBox(lx, y, 4, 12, 6, 9)) return glass;
      if (Math.floor(lx) === 10 && Math.floor(y) === 10) return yellow; // handle
      return mint;
    }
    return siding(y, 3, cream, line);
  };
  const side = (x: number, y: number) => {
    if (y >= HW) return y >= FASCIA - 1 ? shade(pinkD, 0.9) : pinkD;
    if (y < 2) return shade(mintD, 0.85);
    if (inBox(x, y, 6, 24, LS - 12, 4)) return Math.floor(x / 4) % 2 ? pink : mint; // painted stripe
    const w = paneWin(x, y, 14, 15, 8, 13);
    if (w) return w;
    if (inBox(x, y, 13, 5, 17, 3)) return Math.floor(x) % 3 === 0 ? pink : col('#3f8f3a'); // flower box
    return siding(y, 3, creamR, lineR);
  };
  p.box([u0, v0, u1, v1], 0, FASCIA, { left: side, right: front, top: (a, b) => (a < 0.15 || b < 0.15 ? creamL : col('#d9d4cc')) }, {
    right: (x, y) => (inBox(x, y, 5, 6, 15, 20) || inBox(x, y, 45, 6, 15, 16) || inBox(x, y, 29, 12, 6, 9) ? glassW : 0),
    left: (x, y) => (inBox(x, y, 15, 9, 13, 11) ? glassW : 0),
  });
  // striped awning over the front windows, with a scalloped edge
  const aw = 0.8;
  p.quad([u1, v1 - 0.2, HW - 2], [0, -(v1 - v0 - 0.4), 0], [aw, 0, -8], (f) => (Math.floor(f.es0 / 4) % 2 ? yellow : white));
  p.quad([u1 + aw, v1 - 0.2, HW - 10], [0, -(v1 - v0 - 0.4), 0], [0, 0, 3], (f) => {
    const k = f.es0 % 4;
    if (f.t < 0.34 && (k < 1 || k > 3)) return 0;
    return Math.floor(f.es0 / 4) % 2 ? yellow : white;
  });
  // rooftop: giant soda cup at the back, the goose on the front corner
  const cu = 3.9, cv = 14.1;
  for (let z = FASCIA; z < FASCIA + 30; z++) {
    const k = (z - FASCIA) / 30, r = 0.32 + k * 0.14;
    const band = z > FASCIA + 9 && z < FASCIA + 15;
    p.top([cu - r, cv - r, cu + r, cv + r], z, (a, b) => {
      const d = Math.hypot(a - r, b - r);
      if (d > r) return 0;
      const ang = Math.atan2(b - r, a - r);
      const lit = Math.cos(ang - 2.4);
      const base = band ? white : pink;
      return lit > 0.4 ? shade(base, 1.08) : lit < -0.4 ? shade(base, 0.82) : base;
    });
  }
  p.top([cu - 0.5, cv - 0.5, cu + 0.5, cv + 0.5], FASCIA + 30, (a, b) => (Math.hypot(a - 0.5, b - 0.5) < 0.5 ? (Math.hypot(a - 0.5, b - 0.5) < 0.42 ? white : col('#e8e0ec')) : 0));
  const [sx, sy] = proj(cu + 0.1, cv, FASCIA + 30);
  for (let i = 0; i < 14; i++) p.put(Math.round(sx) + Math.floor(i / 3), Math.round(sy) - i, i % 4 < 2 ? pink : white); // straw
  const [gx0, gy0] = proj(5.6, 16.3, FASCIA);
  const gx = Math.round(gx0) - 6, gy = Math.round(gy0) - 15;
  const G = (dx: number, dy: number, w: number, h: number, c: Col) => p.rect(gx + dx, gy + dy, w, h, c);
  G(-1, 6, 2, 2, white); G(0, 6, 12, 5, white); G(1, 5, 10, 1, white); G(1, 11, 10, 1, col('#e3dfe8'));
  G(3, 7, 6, 2, col('#e3dfe8')); G(9, 1, 2, 5, white); G(9, -1, 4, 3, white);
  G(13, 0, 3, 1, col('#ff9a2a')); G(13, 1, 2, 1, col('#e07a14')); G(11, 0, 1, 1, col('#241b2e'));
  G(4, 12, 1, 3, col('#ff9a2a')); G(7, 12, 1, 3, col('#ff9a2a'));
  void mix;

  const balloon = proj(7.9, 14.35, 0);
  const straw = [Math.round(sx) + 4, Math.round(sy) - 14];
  gooseEmit = straw as [number, number];
  return new Building('goose', p, [u0, v0, u1 + 0.3, v1], (b, t, busy) => {
    const g = b.ctx;
    const on = busy ? Math.sin(t * 7) > -0.7 : Math.sin(t * 1.3) > -0.97;
    g.fillStyle = on ? '#ffd2e4' : '#6a3a56';
    for (const [x, y] of neonPix) g.fillRect(x, y, 1, 1);
    // balloons on strings, swaying
    const [bx, by] = balloon;
    const cols = ['#ff86b0', '#7fd8c0', '#ffffff'];
    for (let i = 0; i < 3; i++) {
      const sw = reduce ? 0 : Math.round(Math.sin(t * 1.4 + i * 1.7) * 1.5);
      const x = Math.round(bx) + (i - 1) * 4 + sw, y = Math.round(by) - 30 - (i % 2) * 4;
      g.fillStyle = 'rgba(80,70,90,.8)'; g.fillRect(Math.round(bx), y + 5, 1, Math.round(by) - y - 13);
      g.fillStyle = '#2b2533'; g.fillRect(x - 3, y - 3, 7, 8); g.fillRect(x - 2, y - 4, 5, 10);
      g.fillStyle = cols[i]; g.fillRect(x - 2, y - 3, 5, 7); g.fillRect(x - 1, y - 4, 3, 9);
      g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x - 1, y - 2, 1, 2);
    }
  });
}
let gooseEmit: [number, number] = [0, 0];

/* ======================================================================
 * AI Enterprizes: a tower of stacked, offset glass volumes with glowing
 * cyan edges and floor lines, a bright lobby, and a beacon on top.
 * ==================================================================== */
export function aiTower(): Building {
  const [u0, v0, u1, v1] = FOOT.ai; // [2.7, 22.7, 7.3, 27.3]
  const vols: { r: Rect; z0: number; h: number }[] = [
    { r: [2.5, 23.2, 6.9, 27.6], z0: 30, h: 78 },
    { r: [3.1, 22.5, 7.6, 26.9], z0: 108, h: 76 },
    { r: [2.7, 23.0, 7.1, 27.4], z0: 184, h: 70 },
  ];
  const p = pixFor([2.4, 22.4, 7.7, 27.7], 320);
  const glass = col('#14203a'), glassR = col('#0f1830'), pane = col('#2a4670'), paneR = col('#203a5e'), paneL = col('#5c86bd');
  const cyan = col('#59e3ff'), cyanD = col('#2ea6c8'), slab = col('#9aa4b8'), slabR = col('#7d879b'), roof = col('#3a4152');
  const lobbyGlass = col('#e9f4ff'), lobbyD = col('#9cc6e6'), warm = col('#ffe3a6');
  const LF = (v1 - v0) * 16;
  const sign = wallText('AI ENTERPRIZES', 6, LF / 2, 28);
  const signPix: [number, number][] = [];
  // lobby: double-height glass with a canopy over the doors
  const lobby = (front: boolean) => (x: number, y: number, f: Frag) => {
    if (y >= 22) {
      if (front && sign.on(x, y)) { signPix.push([f.x, f.y]); return cyan; }
      return y >= 29 ? cyan : glass;
    }
    if (y < 1) return cyanD;
    if (Math.floor(x) % 8 === 0 || Math.floor(y) === 11) return slab;
    if (front && inBox(x, y, LF / 2 - 7, 1, 14, 12)) return Math.floor(x) === Math.floor(LF / 2) ? slab : lobbyD;
    return y > 15 ? lobbyD : lobbyGlass;
  };
  p.box([u0, v0, u1, v1], 0, 30, { left: lobby(false), right: lobby(true), top: () => roof }, {
    left: (x, y) => (y < 22 ? warm : 0), right: (x, y) => (y < 22 ? warm : 0),
  });
  // stacked volumes: staggered panes, slab lines lit cyan, glowing corners
  const facade = (dark: boolean) => (x: number, y: number, f: Frag) => {
    if (f.es0 < 1.2 || f.es1 < 1.2) return cyan;
    if (f.et1 < 1.2) return cyan;
    const fl = Math.floor(y / 9), ly = y - fl * 9;
    if (ly < 1) return cyanD;
    if (ly < 2) return dark ? slabR : slab;
    const off = (fl % 2) * 5;
    const col10 = Math.floor((x + off) / 10), lx = (x + off) % 10;
    if (lx < 1) return dark ? slabR : slab;
    const bright = (col10 * 7 + fl * 3) % 5 === 0;
    if (bright) return lx < 3 ? paneL : (dark ? paneR : pane);
    return dark ? glassR : glass;
  };
  const glowF = (x: number, y: number, f: Frag) => {
    if (f.es0 < 1.2 || f.es1 < 1.2 || f.et1 < 1.2) return cyan;
    const fl = Math.floor(y / 9), ly = y - fl * 9;
    if (ly < 1) return cyan;
    const off = (fl % 2) * 5, col10 = Math.floor((x + off) / 10), lx = (x + off) % 10;
    if (lx >= 1 && ly >= 2 && (col10 * 7 + fl * 3) % 5 === 0) return warm;
    return 0;
  };
  for (const v of vols) {
    p.box(v.r, v.z0, v.h, { left: facade(false), right: facade(true), top: (a, b, f) => (f.es0 < 1 || f.et0 < 1 || f.es1 < 1 || f.et1 < 1 ? cyan : Math.floor((a + b) * 3) % 2 ? roof : shade(roof, 1.1)) }, { left: glowF, right: glowF });
  }
  // crown, antenna and beacon
  const crown: Rect = [3.6, 23.8, 6.4, 26.6];
  p.box(crown, 254, 12, { left: (x, y) => (y < 1 || y > 10 ? cyan : glass), right: (x, y) => (y < 1 || y > 10 ? cyan : glassR), top: () => roof });
  const [ax, ay] = proj(5, 25.2, 266);
  p.rect(Math.round(ax), Math.round(ay) - 26, 2, 26, col('#8a93a8'));
  p.rect(Math.round(ax) - 3, Math.round(ay) - 14, 8, 1, col('#8a93a8'));
  aiEmit = [Math.round(ax), Math.round(ay) - 28];

  const corners = vols.flatMap((v) => {
    const [a0, b0, a1, b1] = v.r;
    return [[a1, b1], [a1, b0], [a0, b1]].map(([cu, cv]) => ({ x: Math.round(proj(cu, cv)[0]), top: proj(cu, cv, v.z0 + v.h)[1], bot: proj(cu, cv, v.z0)[1] }));
  });
  const beacon = [Math.round(ax), Math.round(ay) - 28];
  return new Building('ai', p, [u0, v0, u1, v1], (b, t, busy) => {
    const g = b.ctx;
    // light pulses racing up the glowing corners
    const sp = reduce ? 0 : busy ? 70 : 28;
    for (const c of corners) {
      const len = c.bot - c.top;
      for (let k = 0; k < (busy ? 2 : 1); k++) {
        const y = c.bot - ((t * sp + k * len / 2 + c.x) % len);
        g.fillStyle = '#e6fbff'; g.fillRect(c.x - 1, Math.round(y) - 3, 1, 6);
      }
    }
    // the sign shimmers through colors while someone is working
    g.fillStyle = busy ? `hsl(${(t * 80) % 360} 90% 72%)` : '#59e3ff';
    for (const [x, y] of signPix) g.fillRect(x, y, 1, 1);
    const on = Math.sin(t * 3) > 0.3;
    g.fillStyle = on ? '#ff4a5a' : '#5a2a33'; g.fillRect(beacon[0] - 1, beacon[1] - 1, 3, 2);
  });
}
let aiEmit: [number, number] = [0, 0];

/** Where particles come from: soda bubbles, mailers, antenna sparks and church bell notes. */
export function emitters(): Record<string, [number, number]> {
  const refugeMail = proj(FOOT.refuge[0] + 88 / 16, FOOT.refuge[3] + 0.2, 16);
  const [cu0, , cu1, cv1] = FOOT.church;
  const bell = proj((cu0 + cu1) / 2, cv1 - 0.4, 78);
  return { goose: gooseEmit, ai: aiEmit, refuge: [Math.round(refugeMail[0]), Math.round(refugeMail[1])], church: [Math.round(bell[0]), Math.round(bell[1])] };
}
