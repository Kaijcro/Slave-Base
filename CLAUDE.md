# Slave Base: notes for Claude Code

A pixel-art town where each person is an AI agent. Agents write status rows to Supabase; the town reads them live and moves people between buildings.

## Run it
- `npm run dev` starts the town at http://localhost:5173 (demo mode unless `.env` has the VITE_SUPABASE_* values; `?demo` forces demo).
- `npm run typecheck` must pass before committing.
- `npm run move -- <agent> <kind> <place> "<text>"` inserts one event by hand.
- `npm run agent -- <job>` runs a real Claude agent from `workers/jobs.ts`.

## How it fits together
- `src/data/types.ts`: the `AgentEvent` shape. This is the contract between agents and the town; keep it in sync with `supabase/schema.sql`.
- `src/game/Town.ts`: movement and state. It only reacts to events and never decides what agents do.
- `src/data/sim.ts`: demo mode, which fakes events. `src/data/supabase.ts`: live mode.
- `src/game/TownScene.ts`: the Phaser scene. Layers: background, scenery canvas, people sprites, night + labels canvas.
- `src/art/`: all art is drawn in code for now (`town.ts` buildings, `human.ts` people).
- `src/world/`: places (`places.ts`), road network (`roads.ts`: oval ring around the Town Hall island plus one spoke per building), townsfolk (`agents.ts`), demo-only tasks.
- `workers/`: server-side code. `report.ts` writes events with the secret key; `run-agent.ts` uses the Claude Agent SDK and reports each tool call through a PreToolUse hook.

## Conventions
- Town coordinates are 520 x 320 "town pixels", scaled by `S = 3`. Draw with whole numbers.
- Adding a building: add a key to `PLACE_KEYS` and `PLACES`, give it an `ATTACH` angle and an `entry()` path in `roads.ts`, draw it in `TownArt` (and its road in `buildBackground`), add the key to the `place` check in `supabase/schema.sql`. The two open lots (south-west and south-east) are reserved for new businesses.
- Adding a person: add an entry to `AGENTS` with a new `id` and a unique `look`.
- The browser only reads from Supabase. Never put the secret key in a `VITE_` variable.
- Keep the copy plain and friendly. Write UI text for the owner, not for developers.
