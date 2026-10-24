# Slave Base: notes for Claude Code

A pixel-art town where each person is an AI agent. Agents write status rows to Supabase; the town reads them live and moves people between buildings.

## Run it
- `npm run dev` starts the town at http://localhost:5173 (demo mode unless `.env` has the VITE_SUPABASE_* values; `?demo` forces demo).
- `npm run typecheck` must pass before committing.
- `npm run move -- <agent> <kind> <place> "<text>"` inserts one event by hand.
- `npm run agent -- <job>` runs a real Claude agent from `workers/jobs.ts`.

## How it fits together
- `src/data/types.ts`: the `AgentEvent` shape. This is the contract between agents and the town; keep it in sync with `supabase/schema.sql`.
- `src/game/Town.ts`: movement and state. It reacts to events, plus one rule of its own: every Sunday at 9:30 (see `CHURCH` in `config.ts`) everyone walks to church, then goes back to what they were doing after 11:00.
- `src/data/sim.ts`: demo mode, which fakes events. `src/data/supabase.ts`: live mode.
- `src/game/TownScene.ts`: the Phaser scene. A 1040 x 640 world canvas (ground, then buildings, trees, cars and people sorted by depth, then night lighting) scaled 2x, plus a full-resolution label canvas.
- `src/iso/`: the isometric engine. `iso.ts` projects world (u, v, z) to screen; `raster.ts` draws flat surfaces pixel by pixel through "shader" functions; `ground.ts` paints streets, sidewalks and parks.
- `src/art/`: all art is drawn in code for now: `buildings.ts` (one function per building), `props.ts` (trees, cars, lamps...), `world.ts` (places everything, cars, particles, night), `human.ts` (people).
- `src/world/`: places (`places.ts`), the street grid, building footprints and walking network (`streets.ts`), townsfolk (`agents.ts`), demo-only tasks.
- `workers/`: server-side code. `report.ts` writes events with the secret key; `run-agent.ts` uses the Claude Agent SDK and reports each tool call through a PreToolUse hook.

## Conventions
- World positions are (u, v) units on a street grid: streets at u, v = 0, 10, 20, 30; one unit is one sidewalk tile. People's positions (`f.u`, `f.v`) are in these units.
- Adding a building: pick a block in `BLOCKS` (businesses sit on corner blocks with parks between them; swap out a park block to make room), add its footprint to `FOOT`, add a key to `PLACE_KEYS` and `PLACES` with a `door` and a `gate` on the block's sidewalk loop (1.5 units in from the street), write its drawing function in `buildings.ts` and add it in `TownArt`, and add the key to the `place` check in `supabase/schema.sql`.
- `church` is a place agents never report; the town handles it.
- Adding a person: add an entry to `AGENTS` with a new `id` and a unique `look`.
- The browser only reads from Supabase. Never put the secret key in a `VITE_` variable.
- Keep the copy plain and friendly. Write UI text for the owner, not for developers.
