# Notes for Claude — session handoff

Context that the project brief (`CLAUDE.md`) doesn't capture yet, plus the most
recent work. Read this alongside `CLAUDE.md`. Last updated 2026-06-18.

> Why this file exists: Claude's per-machine memory does **not** sync via git, so
> this doc carries the cross-machine context. Keep it updated when state changes.

## Reality vs the original brief
- `CLAUDE.md` says "no backend / browser only" — **outdated**. There IS a backend:
  `server/` (Fastify + libsql/SQLite) with **real auth** (argon2 password hashing,
  opaque SHA-256-stored session tokens, httpOnly cookies) and a **ban system**
  (`server/auth.mjs` `getActiveBan`/`checkBanned`, `server/store.mjs`).
  **Do not weaken or revert auth/bans.**
- Run everything with **`npm run dev`** — `concurrently` starts `node server/index.mjs`
  + `vite`. Dev UI = http://localhost:5173, API = http://localhost:8787.
- **Card data + art (REWORKED 2026-06 — own DB + self-hosted images):**
  - **Why:** egmanevents' CDN (`deckbuilder.egmanevents.com/card_images/optcg/`)
    stopped serving art — it now Cloudflare-returns the deckbuilder SPA HTML
    (`text/html`+nosniff → browser kills every image with `ERR_BLOCKED_BY_ORB`,
    blank cards everywhere). Note: card *data* was never from egman; only images were.
  - **Card data → our SQLite DB.** New `cards` table (`server/db.mjs`), seeded from
    `public/data/cards.json` by `server/seed-cards.mjs` (`npm run seed:cards`). Served
    by `GET /api/cards` (+ `/api/cards/:id`) in `server/index.mjs`. The frontend
    (`cardsDb.ts` `loadCards`) fetches `/api/cards`, not the JSON file anymore.
    Pipeline: `npm run cards` (build cards.json from punk-records) → `npm run seed:cards`.
  - **Card images → self-hosted webp, sourced from dotgg.** `scripts/download-art.mjs`
    (`npm run art`) downloads every card from **dotgg.gg**
    (`https://static.dotgg.gg/onepiece/card/<ID>.webp` — clean, hotlink-friendly, no
    "SAMPLE" watermark, unlike the official Bandai art), into `public/cards/<id>.webp`
    (gitignored, ~2634 files). Served statically by Vite at `/cards/<id>.webp`.
    `cardArtUrl(id)` in `cardsDb.ts` is the single source of truth; `loadCards` rewrites
    every `card.image` to it → fixes board/deckbuilder/profiles/etc. `PopularDecklistsPage`
    uses the same path (not the egman `artBase` still recorded in popular.json).
  - **Fallback proxy exists:** `server/card-art.mjs` (`GET /api/card-art/:id`, on-demand
    fetch from dotgg + `server/.art-cache/`) — for ids not yet downloaded; the app uses
    local `/cards/` by default. Don't point `<img>` at egman again.

## The non-negotiable rule (still holds)
All game-state changes go through **named, JSON-serializable actions** appended to
`actionLog` in `src/state/gameStore.ts`. Every store action mirrors a `GameAction`
entry in `src/state/types.ts`. No functions/Maps/class instances in state.

## Board layouts — there are TWO, sharing one gameStore
- **Layout 1 · "Play — Board"** → `src/features/board/BoardPage.tsx` + `board.css`
  (`gb-*` classes). The main/working layout. Exports shared components
  (`CardArt`, `DonArt`, `DCard`, `DropZone`, `Pile`, `LogsModal`, `CtxMenu`,
  `fmtAction`, …) reused by layout 2.
- **Layout 2 · "Play 2 — Layout Lab"** → `src/features/board/BoardPage2.tsx` +
  `board2.css` (`b2-*` classes). Faithful **OPTCGSim** table: warm wood bg,
  vertical central mat, opponent half rotated 180°, hands in the left corners,
  parchment side buttons, giant Mulligan / End Turn, name + clock top-center.
- Both chosen from `src/features/home/HomePage.tsx`, routed in `src/app/App.tsx`
  (uiStore view `"board"` / `"board2"`).

## Popular Decklists — refresh + import
- Data lives in `public/data/popular.json`, refreshed by **`npm run scrape`**
  (`scripts/scrape-egman.mjs`, OP15 regionals). The scraper uses **Playwright**;
  on a fresh clone you must first run **`npx playwright install chromium`** (the
  browser binaries are not in `node_modules`). Current data: 6 regionals × 12
  lists = 72 decks.
- **Import to My Decks**: the decklist popup in `PopularDecklistsPage.tsx` has an
  "Import to My Decks" button → `api.createDeck` (leader + main deck map 1:1 onto
  the createDeck payload). Gated on login (routes to `"login"` if signed out);
  after success the button becomes "View in My Decks" (→ `"my-decks"`).

## Recent work (2026-06 — own DB + self-hosted art; merged with dotgg fix)
- **Card data → own DB, images → self-hosted (from dotgg).** New files:
  `server/card-art.mjs` (fallback proxy), `server/seed-cards.mjs`,
  `scripts/download-art.mjs`. Edits: `server/db.mjs` (+cards table), `server/index.mjs`
  (+`/api/cards`, art proxy), `cardsDb.ts` (fetch `/api/cards`, art → `/cards/`),
  `PopularDecklistsPage.tsx`, `package.json` (+`art`,`seed:cards`, +`sharp` dep),
  `.gitignore`. See the "Card data + art" note above.
- **Merged the other PC's `ad45dac`**: it fixed art via a dotgg **hotlink** + added the
  Popular "Import to My Decks" feature + refreshed popular. We kept the import feature and
  adopted **dotgg as the download source** (clean art), but self-host rather than hotlink.
- Dev tooling (gitignored): `scripts/tour-shots.mjs`, `scripts/probe-art.mjs`, `scripts/showcase.mjs`.

## Recent work (earlier session)
- **DON!! card art**: faithful SVG recreation — `DonArt` in `BoardPage.tsx`
  (manga focus-line burst, "ドン!!", "Your Turn +1000"). The SVG has
  `pointer-events:none` so the solid `.gb-card` div owns hit-testing.
- **Layout 2 DON cost area**: cards are card-sized, uniform, left-aligned at a
  fixed stride (~50% overlap) so all 10 fit and fill in left→right.
- **Hover behaviour (layout 2)**: a hovered card lifts on Y but must **never paint
  over its neighbours**. KEY fix: band cards have `z-index:1`; the hovered card
  must KEEP `z-index:1` (not drop to `auto`) or it sinks below its z-indexed
  neighbours, the cursor lands on the neighbour, and the two flip hover every
  frame → flicker. See `.b2-band .gb-card:hover { z-index:1 }` in `board2.css`.
- **Layout 1 — hand vs DON**: the fixed hand fan used to cover the player's
  bottom row (cost area / DON). Fixed with a large `.gb-mat` bottom padding +
  a smaller hand, then bumped the field scale (`--cwbase`) because board cards
  were too small.
- **Layout 1 — DON click-to-select flow (NEW)**: click a DON in the cost area to
  select it (gold ring, stays selected; multi-select; click again to toggle off).
  A floating action bar (`.gb-donbar`) shows "N DON!! selected" + **Rest** +
  **Cancel**. While DON are selected, clicking a **Leader/Character assigns** them
  (via the `attachDon` store action). Selection is local React state (not game
  state); only the assignment/rest are serializable actions. Drag-to-give still
  works in parallel.

## Build / test / typecheck
- Typecheck: **`npx tsc -b`** (strict; `noUnusedLocals`/`noUnusedParameters` on —
  unused vars break the build).
- Tests: **`npm test`** = vitest unit (`src/state/*.test.ts`) + node API
  integration (`tests/api-test.mjs`, boots an isolated temp-DB server).
  Also `npm run test:unit`, `npm run test:api`.
- **Pinned to Vite 6** (Node is 20.15; Vite ≥7 needs Node ≥20.19). Don't bump.

## Git workflow (two PCs)
Private repo: `github.com/lilvins/Sailing-Network` (branch `main`).
`git pull` before working, `git add -A && git commit && git push` after.
`node_modules`, the SQLite DBs (`server/*.db`), and the card images
(`public/cards/`) are **gitignored** — a fresh clone has none of them. After
cloning:
1. `npm install`
2. `npm run seed:cards` — load the card catalog into the DB (cards.json is committed)
3. `npm run art` — download all card images to `public/cards/` (~310MB, one-time)
4. `npm run seed:demo` / `npm run seed:admin` — demo accounts + matches
(see `server/README.md`). Refresh the catalog later with `npm run cards` →
`npm run seed:cards`, and `npm run art` to pull any new images.
