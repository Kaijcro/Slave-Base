import Phaser from 'phaser';
import './styles.css';
import { W, H, S } from './config';
import { AGENTS } from './world/agents';
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

const game = new Phaser.Game({
  // Canvas renderer: the town repaints its scenery every frame, and Canvas does that at 60 fps
  // where WebGL stalls re-uploading textures. Switch to Phaser.AUTO once the art is image tiles.
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

// Handy for debugging in the browser console: window.game
(window as unknown as { game: Phaser.Game }).game = game;

// Wait for the pixel font so signs render correctly, then start the agents.
const go = () => Promise.resolve(source.start((e, o) => town.apply(e, o))).catch((err) => console.error(err));
let started = false;
const once = () => { if (!started) { started = true; go(); } };
document.fonts?.load('600 10px "Pixelify Sans"').then(once, once);
setTimeout(once, 1500);
