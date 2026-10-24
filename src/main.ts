import Phaser from 'phaser';
import './styles.css';
import { W, H, S } from './config';
import { AGENTS } from './world/agents';
import { loadSprites } from './art/sprites';
import { Town } from './game/Town';
import { TownScene } from './game/TownScene';
import { pickSource } from './data/source';
import { mountSidebar } from './ui/sidebar';
import { store } from './ui/store';

const source = pickSource(AGENTS);
const town = new Town(AGENTS, source.mode);

// Wire the event source into the town, and tell the source when people arrive.
town.onArrive = (id, place) => source.onArrive?.(id, place);

// Header: speed buttons in demo mode, connection status in live mode.
document.body.dataset.mode = source.mode;
document.querySelectorAll<HTMLButtonElement>('.speed button').forEach((b) =>
  b.addEventListener('click', () => {
    store.speed = Number(b.dataset.s);
    document.querySelectorAll('.speed button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }),
);

// The town's signs are drawn with the pixel font, so wait for it (briefly) before building the art.
const fontReady = Promise.race([
  document.fonts?.load('600 10px "Pixelify Sans"') ?? Promise.resolve(),
  new Promise((r) => setTimeout(r, 1500)),
]).catch(() => undefined);
await fontReady;
// Load any sprite sheet images before the town is drawn.
await loadSprites(AGENTS);

const game = new Phaser.Game({
  // Canvas renderer: the town repaints every frame from canvases, which Canvas does at 60 fps
  // where WebGL would re-upload textures each frame.
  type: Phaser.CANVAS,
  parent: 'stage-canvas',
  width: W * S,
  height: H * S,
  pixelArt: true,
  backgroundColor: '#0f0e1e',
  scale: { mode: Phaser.Scale.WIDTH_CONTROLS_HEIGHT, width: W * S, height: H * S },
  scene: [new TownScene(town, source)],
});

mountSidebar(town, () => game.canvas, () => source.status);

// Map zoom buttons
document.querySelectorAll<HTMLButtonElement>('.zoombar button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.z === 'in') store.cam.zoomBy(1.4);
    else if (b.dataset.z === 'out') store.cam.zoomBy(1 / 1.4);
    else store.cam.reset();
  }),
);
document.querySelector('#followchip button')?.addEventListener('click', () => store.setFollow(null));

// Handy for debugging in the browser console: window.game
(window as unknown as { game: Phaser.Game }).game = game;

// Start the agents.
Promise.resolve(source.start((e, o) => town.apply(e, o))).catch((err) => console.error(err));
