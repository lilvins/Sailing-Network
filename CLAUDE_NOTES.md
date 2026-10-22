# Notes for Claude — session handoff

Context that the project brief (`CLAUDE.md`) doesn't capture yet, plus the most
recent work. Read this alongside `CLAUDE.md`. Last updated 2026-10-22.

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

## Direction (stated 2026-07-24)
The sim will become **automatic** (rules-engine-assisted) eventually — the
"manual only" scope in CLAUDE.md is superseded as a long-term goal. For NOW the
board stays manual/semi-automatic (auto turn phases + event animation only);
don't start building a rules engine until asked.
**2026-07-30: the full plan for the automatic board exists — `AUTOSIM_PLAN.md`**
(architecture, effect IR taxonomy, AI card-compilation pipeline, milestones
M0-M6, execution prompt in §10). Official comprehensive rules v1.2.0 extracted
to `docs/rules/op_comprehensive_rules_v1.2.0.txt`.
**2026-07-31: M0 DONE** — `src/autosim/`: Effect IR (ir/types.ts + schema.json
+ validate.ts + synthetic golden), pure event-sourced engine (engine/state.ts,
events.ts reducer, intents.ts, engine.ts, legality.ts): setup/mulligan/turn
phases/DON costs/structure limits/defeat + full 5-step battle with counter
values, deterministic seeded shuffles (lib/rng seededRng/shuffleWith), replay
via applyEvent fold. 17 tests incl. a full scripted vanilla game to GameOver
and replay determinism (57/57 green overall). Every rule cites its section
number. See AUTOSIM_PLAN.md "Decisioni prese in corso d'opera".
**2026-10-22: M1 DONE** — keyword effects (Rush / Rush: Character / Double
Attack / Banish / Blocker / Unblockable, from `CompiledCard.keywords` via the
new `EngineCard.compiled` field), full Counter Step (counter values + [Counter]
Events with paid costs), [Trigger] flow with damage suspension + triggerDecision
(8-6-2-1, decline→hand / activate→execute then trash unless moved), auto-effect
queue with 8-6 ordering (generations, turn-player-first; [On K.O.] resolves
post-damage per 8-6-2), and the tier-1 action executor (powerMod / draw /
koTarget / restTarget / standTarget / discard / grantKeyword / restriction)
over a unified `state.modifiers` list with rule-exact duration expiry in the
reducer. New modules: `engine/battle.ts` (battle machine + effect pump),
`engine/effects.ts` (executor, selectors, conditions, costs), `engine/
triggers.ts` (8-6 queue). New ChoiceRequests: blockWindow / triggerDecision /
selectTargets / mayActivate / manualResolve (graceful degradation for
non-tier-1 actions). [Main] Events now execute too; [Counter]-only Events are
not playable in Main (10-2-3/4). Golden set grew to 16 synthetic TEST cards
(every keyword + [Counter]/[Trigger] samples). Tests 62→90 in src/autosim
(130/130 overall): m1.test.ts covers every keyword, both trigger decisions,
counter stacking, 8-6 ordering, durations, each tier-1 action, replay with M1
events, and the M1 exit scenario (scripted starter-vs-starter hotseat game
exercising Rush/Blocker/DA/counter value/[Counter] event/[Trigger]
activated+declined to a leaderDamageAtZeroLife win); fuzz extended with the
new windows + invariants (one blocker per battle, step↔choice↔exec coherence,
modifier hygiene, [Trigger]-limbo card conservation). Decisions #12-22 + M2
debts in AUTOSIM_PLAN.md. Next: M2 (AI compile pipeline ST01+OP01,
[Activate: Main] intent, ChoiceRequest UI) — launch with the §10 prompt.
**2026-10-22: BoardAutoPage DONE (plan §7)** — see "Board Auto" section below.
**2026-10-22: M2 DONE (data/engine side)** — real-card compilation batch for
ST01+OP01 (all 138 cards) in `src/autosim/data/compiled/st01-op01.json` +
`coverage-report.json` (test-asserted against a recomputation) + lookup API
`getCompiledCard`/`allCompiledCards`/`coverage` in
`src/autosim/data/compiled/index.ts` (board-auto still runs its heuristic
compile.ts — swapping it to this API is a separate follow-up step). Coverage:
113/138 = **81.9%** vanilla+keyword-only+compiled (ST01 100%, OP01 79.3%);
90 strictly `compiled` (37 fully tier-1-executable today, 53 use tier-2/3 IR
actions that degrade to manualResolve until M3); 8 partial + 17 unsupported
with per-card reasons in the report (never-invent-semantics rule: scaling
amounts, DON standing, missing timings, opponent-hand reveal, unmodeled costs,
attack permissions, name-treatment, deck-rule override). Minimal IR extensions
(types+schema+validate in sync): `nameExcludes`, `Selector.prev` ("that
card"), `returnToDeck`, `lifeToHand` cost, `topOrBottomAnyOrder` peek
disposition; conventions: count 99 = "all", whole-deck search = peek 50 +
shuffle, trigger-duplicates for "Activate this card's [Main]/[Counter]
effect". Golden set +22 REAL hand-verified cards, structurally diffed against
the batch (100%). §6 validation: schema+lint (validateCompiledSet), engine
dry-run of EVERY non-static effect (auto-answered choices, triggers via the
real 10-1-5-3 path), plus seeded full games with real ST01/OP01 decks to a
result. `legalMoves` fix: [Main] Events with unpayable costs are no longer
offered (8-3-1-3). Tests 142→249 green (+107 in m2-compiled.test.ts).
Decisions #31-36 + M3 debts in AUTOSIM_PLAN.md. Next: M3 (tier-2 executor) or
the board-auto compile.ts swap.

## Board Auto — "Play Auto · Full Rules" (view `board-auto`)
`src/features/board-auto/` (+ the `board-auto` case in `src/app/App.tsx`).
Hotseat UI over the AUTOSIM engine: every move is a PlayerIntent through
`autoStore.dispatch` → `applyIntent`; affordances come ONLY from
`legality.ts` / the pending ChoiceRequest; illegal intents become an
explained red banner (EngineError message + actionable hint), never a flat no.
- **Files**: `BoardAutoPage.tsx` (pick → roll → game screens; tap-first
  oplay-style grammar: 1-tap play with auto-paid costs, DON quantity dial,
  attacker→target with dashed leader-colored SVG arrow, ONE contextual
  bottom button, prompts for mulligan/block/counter/triggerDecision/
  selectTargets/mayActivate/manualResolve, live power chips "8000 (+3000)",
  keyword chips, per-seat count-up clocks, human-readable event log,
  per-seat concede, game-over overlay with rematch) · `autoStore.ts`
  (zustand: serializable game state + GameEvent log + banner; catalog/CardDb
  kept module-level) · `compile.ts` (pre-M2 heuristic text→CompiledCard:
  line-start innate keywords; [Trigger]/[Main]/[Counter] → `manual` actions;
  rest vanilla) · `decks.ts` (demo decks generated from the catalog with
  blockers+triggers+[Counter] events guaranteed, plus My Decks) · `log.ts`
  (GameEvent → referee-style lines) · `boardauto.css` (ba-* — "plancia di
  notte": night/brass/signal tokens, radius 0, flat 1-2px borders, ≤150ms
  transitions, no glow; reuses `gb-card`/CardArt/DonArt from BoardPage,
  re-squared). Seat A bottom / seat B top, NOT rotated (hotseat readability).
- **Engine untouched** (`src/autosim/**` import-only), no store sharing with
  the manual boards. 12 new vitest in `compile.test.ts` (142 total green).
- **Verification**: `scripts/boardauto-shots.mjs` (dev server up + logged-out
  flow via "Enter as Test Captain") plays REAL games by driving the UI with
  Playwright, reading state through the DEV-only `window.__auto` hook; it
  exercised mulligan, plays, DON dial, attacks, block, counter value +
  [Counter] event (manual resolve), [Trigger] activate AND decline
  (BA_DECLINE=1), down to leaderDamageAtZeroLife wins for either seat, zero
  console errors. Screenshots: `scripts/.shots/boardauto-*.png`.
- **Known limits (M2 debts)**: non-compiled effects (On Play, Activate: Main,
  …) silently do nothing (text readable in the preview panel); manualResolve
  is an acknowledged no-op (no free-move intents in M1); a real [Trigger]
  "play this card" degrades to manual+trash; no undo (replayable event log
  makes it feasible later). Decisions #23-30 in AUTOSIM_PLAN.md.

## The non-negotiable rule (still holds)
All game-state changes go through **named, JSON-serializable actions** appended to
`actionLog` in `src/state/gameStore.ts`. Every store action mirrors a `GameAction`
entry in `src/state/types.ts`. No functions/Maps/class instances in state.

## Board layouts — there are TWO, sharing one gameStore
- **Layout 1 · "Play — Board"** → `src/features/board/BoardPage.tsx` + `board.css`
  (shared `gb-*` chrome) + **`boarddb.css`** (`db-*` structure). The main layout is
  now a **DuelingBook-faithful duel screen** — geometry measured from
  duelingbook.com's replay viewer (canvas 1152×720): left rail = card preview
  (art + white effect box) over Turn pill + flat light-gray utility buttons
  (End Turn = the one emphasized yellow button; **no Coin Flip**); center = the
  field (NO phase bar — removed so the halves get the vertical room and the hand
  never covers the DON row) + flat hands top/bottom; right rail = LIFE bar →
  opponent avatar → **white duel log+chat box** → my avatar → LIFE bar;
  near-black circuit-board background. OP zones per half: LIFE over DON deck in
  the left corner, char row → leader/stage center, TRASH over DECK in the right
  corner; opponent half rotated 180°. Field cards scale via
  `--dbcw: clamp(44px, min(6.2vw, 11vh), 120px)` (≈79px @720p, +41% vs the
  first DB cut). CSS-cascade gotcha fixed once already: `.db-root .db-field
  .gb-card { width: var(--dbcw) }` is equal-specificity with row-specific
  width rules — any cell-sized card rule (DON cells, life stack) must come
  AFTER it in boarddb.css or it loses the cascade (this was the oversized-DON
  glitch). No overflow:hidden on .db-donrow (it clips the .gb-quick hover
  menu). In test mode the revealed opponent hand strip is hover-previewable
  (left panel). **No Play Area on this layout**: the
  "Event" quick action resolves via `playEventCard` — the card moves hand→trash
  immediately (one undoable logged action) while a big centered copy plays a
  ~1.3s glow animation + synthesized chime (`playEventSound`, WebAudio, no
  assets), then flies toward the trash corner. CtxMenu got `hidePlayArea` (L1
  passes it; L2 keeps its play strip). The pre-DB components
  (`MyHalf`, `OppHalf`, `MyHand`, `OppHand`, `OppHandLive`, `OppHalfLive`) are
  kept **exported but unused** (legacy) — safe to delete later.
  Exports shared components (`CardArt`, `DonArt`, `DCard`, `DropZone`, `Pile`,
  `LogsModal`, `CtxMenu`, `fmtAction`, …) reused by layout 2. NOTE: `GameChat`
  now takes `{ log: GameAction[] }`; `Pile` takes optional `onView`.
- **Layout 2 · "Play 2 — Layout Lab"** → `src/features/board/BoardPage2.tsx` +
  `board2.css` (`b2-*` classes). OPTCGSim table arrangement with a **minimal
  editorial** identity: flat ivory canvas, white central mat (opponent half
  warm-gray, rotated 180°), hairline borders, ink text, ONE red accent
  (hover ring / drag-over / End Turn), leader-color top edge on my mat.
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
