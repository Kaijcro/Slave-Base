# Slave Base

A pixel-art town where your AI agents live and work. Every person in town is an agent. When an agent starts a task, uses a tool or finishes, it writes one row to Supabase, and the town moves that person to the right building.

```
 Claude agent (workers/)  ──writes──▶  Supabase: agent_events  ──live──▶  Town (Phaser, in the browser)
```

The town is isometric pixel art on a grid of streets, sidewalks and parks. Town Hall sits on Town Square in the middle, with three businesses on the corners and parks in between (a playground, basketball and tennis courts, a duck pond and more): **Refuge Properties** (a loft office over a garage, cars in the bays), **Goose Pop Shop** and **AI Enterprizes** (a stacked glass tower). A church sits a short walk north of town, and everyone goes there on Sunday mornings.

It runs in **demo mode** out of the box, with made-up work, so you can see it before connecting anything.

---

## 1. See it running (5 minutes)

You need [Node.js 20+](https://nodejs.org) and [Claude Code](https://claude.com/claude-code).

```bash
npm install
npm run dev
```

Open http://localhost:5173. Click anyone in town or in the sidebar to follow them.

## 2. Put it on GitHub

1. Create an empty repo at https://github.com/new and name it `slave-base`. Leave "Add a README" unchecked.
2. In this folder:
   ```bash
   git init
   git add .
   git commit -m "Slave Base: first town"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/slave-base.git
   git push -u origin main
   ```

From now on, open this folder in Claude Code and ask for changes in plain English. For example: "build a bakery on the south-west open lot", or "give Kofi a red beanie".

## 3. Connect Supabase (the live link)

1. Create a free project at https://supabase.com.
2. Open **SQL Editor > New query**, paste in all of `supabase/schema.sql`, and click **Run**.
3. Open **Project Settings > API Keys** and copy the URL, the **publishable** key and the **secret** key.
4. Copy `.env.example` to `.env` and fill in those values.
5. Restart `npm run dev`. The header now says **Live**.
6. Move someone by hand to test it:
   ```bash
   npm run move -- hank started hall "Filing the lot list"
   ```
   Hank walks to Town Hall. Then try:
   ```bash
   npm run move -- hank finished hall "Lot list filed"
   ```
   He finishes and heads to Town Square to wait for his next job.

## 4. Run a real agent

Agents can run on your **Claude subscription** (Pro or Max), so there's nothing extra to pay. Their usage counts toward your plan's limits, which are shared with the Claude app.

1. Install Claude Code once: `npm install -g @anthropic-ai/claude-code`
2. Sign in once: run `claude`, choose your Claude account, finish the login in your browser, then type `/exit`.
3. In `.env`, leave `ANTHROPIC_API_KEY=` **blank**. A key there would override your subscription.
4. Run one of the jobs in `workers/jobs.ts`:
   ```bash
   npm run agent -- captions   # June writes a week of captions (Goose Pop Shop)
   npm run agent -- ideas      # Kofi researches new AI business ideas (AI Enterprizes)
   npm run agent -- lots       # Hank searches for vacant lots (Refuge Properties)
   npm run agent -- rents      # Theo pulls rent comps (Refuge Properties)
   npm run agent -- foreclosures
   ```
   Watch the town: the agent walks to its building, and each web search or page it reads pops up as a speech bubble. When it's done, it carries the result to Town Hall. The full results are saved in `output/`.

Prefer pay-per-use instead? Put an API key from console.anthropic.com in `ANTHROPIC_API_KEY`. Each run then stops at `MAX_USD_PER_RUN` (default $1).

**Add your own job:** copy an entry in `workers/jobs.ts`, then change the agent, the building and the prompt.

## 4b. Prompt your agents from the website

1. In Supabase, open **SQL Editor → New query**, paste `supabase/prompts.sql`, change `you@example.com` at the bottom to your email, and click **Run**.
2. In Supabase, open **Authentication → URL Configuration** and add `http://localhost:5173` (and later your Vercel address) under **Redirect URLs**.
3. Start the town runner in its own Terminal tab and leave it open:
   ```bash
   cd ~/Documents/Slave-Base
   npm run town
   ```
4. Open the town, scroll to the **Agent monitor**, click **Sign in to send prompts**, and use the link emailed to you.
5. Type a prompt in anyone's card and click **Send**. They walk to work, their steps appear live, and the full answer shows up in their card. Files they make are saved in `output/<agent>/`.

Each agent remembers their previous prompts. Tick **New conversation** to start fresh.

**Hand-offs:** agents can pass work to each other. Ask for it in your prompt, for example *"Research best-selling printables, then hand the top 3 ideas to Priya."* The teammate's task appears in their card as *From Kofi* and starts as soon as Kofi finishes, with his files attached. To turn this on, run `supabase/handoff.sql` once in the Supabase SQL Editor. The runner runs up to `MAX_PARALLEL` agents at once (2 by default, which suits a Pro plan) and uses your Claude subscription unless you put an API key in `.env`.

## 4c. AI Enterprizes Etsy shop

AI Enterprizes runs an Etsy shop by itself. **Kofi** researches young shops (opened in the last 18 months) with 1,000+ sales using Etsy's official data. **Priya** turns what sells into original designs and publishes them. Kofi's routine runs Monday and Thursday at 9 AM, and Priya's Monday to Saturday at 11 AM, while `npm run town` is on. Edit the times in `workers/schedule.ts`, or prompt them any time from the Agent monitor.

- **Digital downloads** (wall art, printables, SVG cut files, stickers) include a **Canva-editable PDF**. Buyers import it into Canva (free) and can change every word and color. Each download also has print-ready PNGs and, for cut files and stickers, an SVG.
- **T-shirts and mugs** go through Printify, which prints and ships them.
- **Listings** automatically say AI helped make the design, and that Printify makes physical items, as Etsy requires.
- **Shop profile:** the agents can update the shop's headline, announcement and buyer messages, and design a banner and shop icon. Etsy doesn't let apps upload banners or icons, so you upload those yourself in *Shop Manager → Settings → Info & Appearance*. Only you can change the shop name.
- **Safety rules:** brands, characters and celebrities are blocked, and at most `SHOP_DAILY_LIMIT` listings go live a day. The rest are saved as drafts.

**One-time setup:**
1. **Open your Etsy shop** at etsy.com/sell.
2. **Create an Etsy app** at etsy.com/developers: choose *Create a new app*, and set the callback URL to `http://localhost:3003/oauth/redirect`. Copy the **keystring** and **shared secret** into `.env` as `ETSY_API_KEY` and `ETSY_SHARED_SECRET`. Etsy may take a few days to approve a new app.
3. **Connect your shop:** run `npm run etsy-login` and click *Grant access*. Run it again if the agents say your Etsy sign-in expired.
4. **Set up Printify:** open a free Printify account, connect your Etsy shop (*My stores → Add new store → Etsy*), then create a token (*My account → Connections*) and add it to `.env` as `PRINTIFY_API_TOKEN`.
5. **Name Printify as your production partner:** in Etsy, go to *Shop Manager → Settings → Production partners* and add Printify.
6. **Restart the runner** with `npm run town`.

Everything the agents make is saved in `output/shop/`: research reports in `research/`, and each design's files and photos in `designs/`.

## 4d. AI receptionist business (Retell AI)
Agents can build a demo phone receptionist named after a prospect, from the prospect's website, in one step.
1. Make an account at retellai.com (it comes with free credit) and add billing.
2. Settings > API Keys > create a key. Put it in `.env` as `RETELL_API_KEY=`.
3. Phone Numbers > buy 1 to 3 numbers (about $2 a month each). Give each a nickname starting with **Demo** ("Demo 1"). Agents reuse these for demos; they can't buy numbers.
4. Restart the runner (`npm run town`). Priya, Kofi and Dex now have the voice tools (change with `VOICE_AGENTS`).

What they can do: build a demo from a website and point a Demo number at it, read call logs and transcripts, and **propose** script changes. A change goes live only when you send a prompt that says `approve <id>` (hand-offs and routines can't approve). Agents can't place calls or buy anything. Demos and proposals are saved in `.town-voice/`.

## 5. Put it online and run agents on a schedule

**Website (Vercel):**
1. Go to https://vercel.com/new and import the GitHub repo.
2. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Only these two, never the secret key.
3. Click **Deploy**. Every push to GitHub redeploys automatically.

**Scheduled agents (GitHub Actions, free):**
1. In your repo, open **Settings > Secrets and variables > Actions** and add `ANTHROPIC_API_KEY`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Scheduled runs happen on GitHub's computers, not yours, so they need an API key (paid per use). To stay on your subscription, run agents from your Mac instead.
2. `.github/workflows/agents.yml` then runs the ideas, lots, rents and captions jobs every weekday morning. To run one now, open the **Actions** tab, pick **Run agents**, and click **Run workflow**.

**Ask Claude from GitHub (optional):** inside Claude Code, run `/install-github-app`. After that you can comment `@claude ...` on any issue and Claude opens a pull request.

## 6. Upgrade the art

Right now everything is drawn in code (`src/art/`). For hand-made pixel art:
- **Buildings and town:** LimeZu's *Modern Exteriors* pack on itch.io. Lay out the map in [Tiled](https://www.mapeditor.org) and load it with Phaser's tilemap loader.
- **People:** LimeZu's *Modern Interiors* character generator exports walk animations. Swap them in where `TownScene.create()` builds each person's textures.
- Keep the place keys in `src/world/places.ts`, so agents keep working.

## Adding a business

Ask Claude Code: *"Add a new building called X in place of one of the parks."* It needs to touch four files: `src/world/streets.ts` (its block and footprint), `src/world/places.ts` (the place and its door), `src/art/buildings.ts` (its drawing) and `supabase/schema.sql` (the allowed place names).

---

## What's where

| Path | What it does |
| --- | --- |
| `src/world/places.ts` | Every building: name, door, click area |
| `src/world/streets.ts` | The street grid, what is on each block, building footprints and the walking network |
| `src/world/agents.ts` | The townsfolk and their looks |
| `src/game/Town.ts` | Moves people around in response to events |
| `src/game/TownScene.ts` | Draws the town every frame (Phaser) |
| `src/art/` | Buildings, people and lighting, drawn in code |
| `src/data/` | Where events come from: the demo or Supabase |
| `workers/` | Real agents (Claude Agent SDK) and the `report()` helper |
| `supabase/schema.sql` | The database table |

## The event format

Any program can show up in town by inserting a row into `agent_events`:

| column | example | meaning |
| --- | --- | --- |
| `agent_id` | `hank` | who (an `id` from `src/world/agents.ts`) |
| `kind` | `started` | `started`, `progress`, `finished` or `break` |
| `place` | `refuge` | where: `refuge`, `goose`, `ai`, `hall`, or `plaza` (Town Square) |
| `text` | `Scanning vacant lots` | the task, the step, or the result |

That means Zapier, Make, n8n, a Python script or a Claude Code hook can all drive the town too.
