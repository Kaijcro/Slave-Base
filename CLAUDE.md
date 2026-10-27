# Slave Base: notes for Claude Code

A pixel-art town where each person is an AI agent. Agents write status rows to Supabase; the town reads them live and moves people between buildings.

## Run it
- `npm run dev` starts the town at http://localhost:5173 (demo mode unless `.env` has the VITE_SUPABASE_* values; `?demo` forces demo).
- `npm run typecheck` must pass before committing.
- `npm run move -- <agent> <kind> <place> "<text>"` inserts one event by hand.
- `npm run agent -- <job>` runs a real Claude agent from `workers/jobs.ts`.
- `npm run town` starts the town runner: it runs prompts sent from the website (the `agent_tasks` table), up to `MAX_PARALLEL` agents at once, on the owner's Claude subscription.

## How it fits together
- `src/data/types.ts`: the `AgentEvent` shape. This is the contract between agents and the town; keep it in sync with `supabase/schema.sql`.
- `src/game/Town.ts`: movement and state. It reacts to events, plus one rule of its own: every Sunday at 9:30 (see `CHURCH` in `config.ts`) everyone walks to church, then goes back to what they were doing after 11:00.
- `src/data/sim.ts`: demo mode, which fakes events. `src/data/supabase.ts`: live mode.
- `src/game/TownScene.ts`: the Phaser scene. A 1040 x 640 world canvas (ground, then buildings, trees, cars and people sorted by depth, then night lighting) scaled 2x, plus a full-resolution label canvas. A camera (`cam`: scroll/pinch to zoom 1x to 3.5x, drag to pan, `store.follow` to track a person) moves the world image; picking converts view coordinates back to town pixels.
- `src/iso/`: the isometric engine. `iso.ts` projects world (u, v, z) to screen; `raster.ts` draws flat surfaces pixel by pixel through "shader" functions; `ground.ts` paints streets, sidewalks and parks.
- `src/art/`: all art is drawn in code for now: `buildings.ts` (one function per building), `props.ts` (trees, cars, lamps...), `world.ts` (places everything, cars, particles, night), `human.ts` (people).
- `src/world/`: places (`places.ts`), the street grid, building footprints and walking network (`streets.ts`), townsfolk (`agents.ts`), demo-only tasks.
- Interiors: clicking a building sets `store.inside`; `TownScene.drawInside` draws the room from `src/art/interiors.ts` (top-down, 520 x 320 at 2x) and seats everyone inside (owners at their own `Seat`, others in free seats).
- `src/ui/monitor.ts`: the agent monitor under the map (status, recent steps from `Figure.log`, latest result, prompt box). `src/data/tasks.ts` is its data: `LiveTasks` (Supabase `agent_tasks`, email sign-in, owner check via `is_town_owner()`) or `DemoTasks`.
- `workers/handoff.ts`: the `hand_off` tool (in-process MCP server `town`, given to every agent). It inserts an `agent_tasks` row with `from_agent` and `parent_id`; the runner won't start it while the parent is still running. Limits: 3 per task, 3 deep.
- `workers/shop/`: the AI Enterprizes Etsy business. `tools.ts` is an in-process MCP server (`shop_*` tools) given only to agents whose home is `ai`; `design.ts` renders agent-written SVG into print PNGs, a Canva-editable PDF (pdfkit + svg-to-pdfkit, fonts in `workers/assets/fonts`, all OFL and in Canva) and listing photos; `etsy.ts` / `printify.ts` are the API clients; `guard.ts` blocks brands; `ledger.ts` enforces `SHOP_DAILY_LIMIT`. Routines in `workers/schedule.ts` are queued by the runner.
- `workers/voice/`: the AI receptionist business. `retell.ts` is the Retell API client; `tools.ts` is an in-process MCP server (`voice_*` tools) given to agents in `VOICE_AGENTS` when `RETELL_API_KEY` is set. Demos use owner-bought numbers nicknamed "Demo…". Script changes are proposals in `.town-voice/proposals/`; `voice_apply_update` only works when the task came from the owner (`from_agent` is null) and its prompt says `approve <id>`. No tool buys numbers or places calls.
- `workers/`: server-side code. `town.ts` is the runner (claims queued tasks, runs each with a persona from `personas.ts`, resumes each agent's last conversation from `.town-sessions.json`, writes results back, heartbeats to `runner_status`). `report.ts` writes events with the secret key; `run-agent.ts` uses the Claude Agent SDK and reports each tool call through a PreToolUse hook.

## Conventions
- World positions are (u, v) units on a street grid: streets at u, v = 0, 10, 20, 30; one unit is one sidewalk tile. People's positions (`f.u`, `f.v`) are in these units.
- Adding a building: pick a block in `BLOCKS` (businesses sit on corner blocks with parks between them; swap out a park block to make room), add its footprint to `FOOT`, add a key to `PLACE_KEYS` and `PLACES` with a `door` and a `gate` on the block's sidewalk loop (1.5 units in from the street), write its drawing function in `buildings.ts` and add it in `TownArt`, and add the key to the `place` check in `supabase/schema.sql`.
- `church` is a place agents never report; the town handles it.
- Adding a person: add an entry to `AGENTS` with a new `id` and a unique `look`. To use a sprite image instead (e.g. from Sprite AI), put the sheet in `public/sprites/` at its original pixel size (square cells, facing right, transparent background) and give the agent a `sprite` (see `src/art/sprites.ts`; `governor` is the example).
- The browser only reads from Supabase, except signed-in owners inserting or cancelling `agent_tasks` (enforced by RLS in `supabase/prompts.sql`). Never put the secret key in a `VITE_` variable.
- Keep the copy plain and friendly. Write UI text for the owner, not for developers.
