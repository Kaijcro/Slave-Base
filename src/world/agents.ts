import type { Look } from '../art/human';
import type { SpriteSheet } from '../art/sprites';
import type { PlaceKey } from './places';

/**
 * The townsfolk. Each `id` is what a real agent sends as `agent_id` when it reports status.
 * To add a new agent: copy one entry, give it a new id, and change its look.
 */
export interface AgentDef {
  id: string;
  name: string;
  role: string;
  home: PlaceKey | null;
  /** Roamers have no home and help whichever building is busiest. */
  roamer?: boolean;
  speed: number;
  tag: string;
  bio: string;
  /** How they are drawn in code; also the fallback if their sprite image is missing. */
  look: Look;
  /** Optional sprite sheet image that replaces the drawn look (see src/art/sprites.ts). */
  sprite?: SpriteSheet;
}

export const AGENTS: AgentDef[] = [
  {
    id: 'dex', name: 'Dex Okafor', role: 'Outreach writer', home: 'refuge', speed: 0.95, tag: '#ff9b83',
    bio: 'Finds new foreclosure filings and writes the letters that go out to owners.',
    look: { skin: '#6b3f26', hair: '#1a1210', style: 'bald', beard: '#1a1210', glasses: '#f6c560', shirt: '#7a2e3b', pattern: 'jacket', accent: '#e9e2d0', pants: '#2b2a3a', legs: 'pants', shoes: '#1a1210' },
  },
  {
    id: 'hank', name: 'Hank Rourke', role: 'Land scout', home: 'refuge', speed: 0.85, tag: '#ffb067',
    bio: 'Combs Southwest Florida for vacant lots that fit the builder’s buy box.',
    look: { skin: '#e0a985', hair: '#c9c4bb', style: 'short', mustache: '#c9c4bb', shirt: '#b0392f', pattern: 'plaid', accent: '#2b2540', pants: '#3b5a8a', legs: 'pants', shoes: '#5b3a24', hat: { type: 'cowboy', color: '#8a5a36' }, tall: true },
  },
  {
    id: 'theo', name: 'Theo Albright', role: 'Deal underwriter', home: 'refuge', speed: 0.95, tag: '#f0b26a',
    bio: 'Underwrites apartment deals and keeps the acquisition pipeline current.',
    look: { skin: '#f0c29e', hair: '#c8572a', style: 'swoop', shirt: '#e8e2d0', pattern: 'vest', accent: '#3f6b4e', bow: '#b0392f', pants: '#5a4636', legs: 'pants', shoes: '#2b1d14', freckles: true, tall: true },
  },
  {
    id: 'june', name: 'June Lake', role: 'Shop marketer', home: 'goose', speed: 1.15, tag: '#ff86b0',
    bio: 'Writes the posts, prices new flavors and plans the weekend promos.',
    look: { skin: '#f1c6a6', hair: '#ff86b0', style: 'buns', headphones: '#86e0bd', shirt: '#fff2c4', pattern: 'overalls', accent: '#5b7fd1', pants: '#5b7fd1', legs: 'shorts', shoes: '#ff86b0' },
  },
  {
    id: 'marisol', name: 'Marisol Vega', role: 'Shop analyst', home: 'goose', speed: 1.05, tag: '#5fd3c2',
    bio: 'Tracks sales, inventory and margins for every drink on the menu.',
    look: { skin: '#c98e62', hair: '#2a1a14', style: 'curly', shirt: '#f4f4f4', pattern: 'collar', accent: '#2aa198', pants: '#2aa198', legs: 'skirt', shoes: '#ffffff', hat: { type: 'visor', color: '#2aa198' }, earrings: '#f6c560' },
  },
  {
    id: 'priya', name: 'Priya Nair', role: 'Launch manager', home: 'ai', speed: 1, tag: '#b9b0ff',
    bio: 'Turns AI business ideas into launched products with a landing page and pricing.',
    look: { skin: '#a8714c', hair: '#120c0c', style: 'braid', glasses: '#2b2540', shirt: '#8a7fd1', pattern: 'cardigan', accent: '#f1ead8', pants: '#2b2540', legs: 'pants', shoes: '#2b2540' },
  },
  {
    id: 'kofi', name: 'Kofi Mensah', role: 'Idea researcher', home: 'ai', speed: 1.1, tag: '#9ad77a',
    bio: 'Hunts for problems people would pay an AI tool to solve.',
    look: { skin: '#4a2c1c', hair: '#1a1210', style: 'afro', shirt: '#4f8a5b', pattern: 'hoodie', accent: '#3d7049', pants: '#3a3a48', legs: 'pants', shoes: '#f1ead8', backpack: '#d98c3a' },
  },
  {
    id: 'ines', name: 'Inês Duarte', role: 'Chief of staff', home: 'hall', speed: 1, tag: '#86e0bd',
    bio: 'Reviews what every agent produces and writes the daily brief.',
    look: { skin: '#d9a27a', hair: '#dcd9e6', style: 'bob', shirt: '#c23b4a', pattern: 'coat', accent: '#8c2532', pants: '#2b2540', legs: 'pants', shoes: '#1a1210', earrings: '#f6c560' },
  },
  {
    id: 'governor', name: 'Governor Hale', role: 'Governor', home: 'hall', speed: 0.9, tag: '#f6c560',
    bio: 'Runs the town: sets the priorities each morning and signs off on the big decisions.',
    look: { skin: '#e8b48a', hair: '#c9934f', style: 'swoop', shirt: '#26355e', pattern: 'jacket', accent: '#9fb4dc', bow: '#a8322d', pants: '#26355e', legs: 'pants', shoes: '#5a2e1c', tall: true },
    sprite: { src: '/sprites/governor.png', cell: 48, frames: 6, idle: 1, feetY: 44, headY: 2 },
  },
];
