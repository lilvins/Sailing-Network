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
- Card art is loaded from external **dotgg `.webp` URLs**
  (`https://static.dotgg.gg/onepiece/card/<ID>.webp`), not `public/cards/`.
  (Was egmanevents, but its `deckbuilder.egmanevents.com/card_images/optcg/`
  path stopped serving art — it now returns the deckbuilder SPA HTML, so every
  image 404'd-as-HTML. Base lives in `scripts/build-cards.mjs` → `cards.json`
  `image` field, and `scripts/scrape-egman.mjs` `ART_BASE` → `popular.json`
  `artBase`. Both regenerated data files were also patched in place.)

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
`node_modules` and the SQLite DBs (`server/*.db`) are **gitignored** — a fresh
clone has an empty DB. Reseed with `npm run seed:demo` / `npm run seed:admin`
(see `server/README.md`). Run `npm install` after cloning.
