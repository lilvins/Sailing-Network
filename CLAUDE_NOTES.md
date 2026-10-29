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
Decisions #31-36 + M3 debts in AUTOSIM_PLAN.md.
**2026-10-24: M3 DONE (tier-2 executor + [Activate: Main])** — the playtest
pains are closed engine-side: Nami OP01-016-style searches run through a real
`peekSelect` ChoiceRequest (cards seen, filtered take, rest ordered
top/bottom/mixed or shuffled/trashed, `playRested` supported) and leader
abilities run through the new `activateMain` intent (10-2-2; oncePerTurn
10-2-13-3; affordance = `legalMoves.activatable`). Executor now covers
playFromZone (hand/trash, free, [On Play] chains), returnToHand/returnToDeck,
mill, lifeToHand/trashLife (top of Life), placeDonInCostArea,
giveRestedDon, standDon, costMod (effectiveCost), ifThen inline, real `prev`
("that card") binding, and `draw up to N` via `chooseNumber`. Costs are paid
item-by-item inside the pump (8-3-1-1) with payment choices: card picks via
selectTargets, DON!!−X via `payDon` composition from leader/characters/cost
area (8-3-1-6; auto rested-first when nothing is attached); lifeToHand &
trashFromHand & handToDeckBottom & returnToHand & restFromField cost kinds.
End Phase ([End of Your (Opponent's) Turn], 6-6-1) and end-of-battle
(7-1-5-2) effects now enqueue into the 8-6 queue; new reaction timings
onYouActivateEvent/onOpponentActivatesEvent/onOpponentCharacterKOd; new
conditions donOnField/selfRested; cannotBeKOdInBattle enforced in the damage
step; canAttackActiveCharacters permission (attack active characters).
New intents: activateMain, respondPeek, respondPayDon, respondNumber; new
ChoiceRequests: peekSelect, payDon, chooseNumber (board-auto UI wiring is the
board agent's next step — its if-chains ignore unknown kinds safely).
Batch RECOMPILED: 130/138 = **94.2% IR-complete** (ST01 100%, OP01 93.4%),
95/107 compiled fully auto-executable, 12 degrade only for static (M4), 8
not compiled with reasons; report regenerated (fullyAutoExecutable metric),
golden +5 real activate/search cards (ST01-001, OP01-030/041/055/112) → 43
entries at 100%. ST02-ST06 batch deferred to a dedicated step (decision #44).
Tests 249→276 green (m3.test.ts: ST01-001 & Nami end-to-end exits, payDon,
chooseNumber, prev, End Phase ordering, end-of-battle, tier-2 zone moves;
fuzz extended with the new windows + probes; m2 dry-run now pays costs).
Decisions #37-44 + M4 debts in AUTOSIM_PLAN.md. Next: M4 (static fixpoint,
replacement/negate) or the board-auto wiring of the new ChoiceRequests.

## Play vs Bot — optcg-ai engine + bot (view `board-bot`, THIS COPY ONLY, 2026-10-28)
This checkout is a **copy** of Sailing-Network (branch `bot-integration`, push
disabled, ports 5183 / API 8797 via `SN_API_PORT`) used to integrate the
optcg-ai project (`C:/Users/Admin/Desktop/optcg-ai`).
- `src/optcg/` is GENERATED by optcg-ai `npm run sync-sn -- <this folder>`:
  rules engine that interprets optcgwebsim's per-card effect DSL (all 2935
  cards), the Monte Carlo bot, game records/replay. Never edit it here.
- Data: `public/data/optcg/bundle.json` (cards+effects, playbooks, 29 meta
  decks) and `learned.json` (parameters learned from played games).
- `src/features/board-bot/`: BoardBotPage (setup -> game -> game over),
  botStore (zustand, GameState + GameRecord), bot.worker.ts (the bot in a Web
  Worker), boardbot.css ("plancia di notte" register). Card art: /cards/<id>.webp,
  then the /api/card-art proxy.
- `server/bot-games.mjs`: tables bot_games + bot_feedback, routes
  POST/GET /api/bot-games, /api/bot-games/stats, /:id, /:id/feedback.
  Every finished game is stored as a full record (seed, decks, actions).
- Learning: optcg-ai `npm run learn -- --sn <this folder>` reads the DB,
  re-tunes the bot per leader and writes public/data/optcg/learned.json.
- AUTOSIM's engine and rules are untouched; since the M5 compiler (below)
  AUTOSIM reads optcg-ai's card EFFECTS as IR data.

## AUTOSIM M5 — card IR generated from optcg-ai (THIS COPY ONLY, 2026-10-28)
Session reports for Vins live in `_Reports/` (gitignored, never committed).
User decision: keep AUTOSIM as the engine and bring optcg-ai's effect data
into it through a compiler (option 2 of docs/INTEGRATION in optcg-ai), not
swap engines.
- `src/autosim/compiler/` (entry `fromOptcg.ts`, one module per concern, see
  its README.md): pure compiler optcgwebsim actionV3
  (`proc`+`steps`) → `CompiledCard`. Never invents semantics: what the IR
  can't say becomes `manual` with the card's own text (a translatable first
  part still runs, then "Continue by hand …"); abilities with no IR timing
  (Pre* replacements, MyDonIsReturned, OnRest, …) become an inert `static`
  manual so board-auto still flags them. Text cross-checks degrade to manual
  when the data contradicts the printed text (Leader condition missing,
  opponent targets the text doesn't name, "Leader or Character" lost,
  [Trigger] not on the card). [Once Per Turn] follows the printed text.
- Output: `src/autosim/data/compiled/generated/optcg.json` + `report.json`,
  read through `getGeneratedCard()` (kept OUT of `BATCHES`, so M2/M3 suites
  still measure the hand batch). board-auto `compiledFor`: hand batch →
  generated → text heuristic.
- Regenerate after optcg-ai `npm run sync-sn`: `npm run compile:optcg`
  (= `UPDATE_OPTCG=1 vitest run m5-optcg`, then the checks again).
- Tests `src/autosim/__tests__/m5-optcg.test.ts`: drift (committed JSON =
  fresh compile), schema+lint, dry-run of every non-static effect of every
  catalog card in the engine, agreement with the hand ST01/OP01 batch
  (120/138 identical; the rest equivalent or IR-limited), full games with
  the real meta decks that the catalog contains.
- Numbers (old catalog, 2634 cards): board-auto cards with no automation
  disclaimer 421 → 1554; cards whose text silently did nothing 1803 → 430.
  Two independent text-vs-IR reviews of 70 random cards each drove the
  fixes (13 → 9 WRONG, all patterns fixed after the second).
- Catalog refreshed 2026-10-28 (`npm run cards`): 2634 → 2850 cards (OP17,
  EB05, ST31-36, more promos). punk-records changed format upstream (no more
  <br> between abilities, attributes as raw "<Slash>"): `build-cards.mjs`
  now keeps the five attribute names and restores one ability per line
  (breaks before ability tags after a sentence end / a keyword tag, before
  "•" options and before a reminder after a full sentence). 2615/2634 old
  texts come out identical; the 19 left are untagged statics now on one line.
  After it: `npm run seed:cards` (the app reads cards from SQLite) and
  `npm run art` (images of the new sets; the /api/card-art proxy covers the
  gap meanwhile). 28/29 meta decks are now legal board-auto decks (the 29th
  has 9 copies of OP16-042 in optcg-ai's list) and all play to a result.
- Known limits: OP18 (36 cards) and 49 promos are not in punk-records yet;
  continuous effects: M4 first step done (`engine/continuous.ts`, statics
  recomputed per query to a fixpoint: power/cost/keyword/restriction; board-auto
  clean cards 1667 → 1797) — immunities, hand-cost, "+X per …" still manual; "If X, do A.
  Then, B" follows optcg-ai's data (B also gated).

## Board Auto — "Play Auto · Full Rules" (view `board-auto`)
`src/features/board-auto/` (+ the `board-auto` case in `src/app/App.tsx`).
Hotseat UI over the AUTOSIM engine: every move is a PlayerIntent through
`autoStore.dispatch` → `applyIntent`; affordances come ONLY from
`legality.ts` / the pending ChoiceRequest; illegal intents become an
explained red banner (EngineError message + actionable hint), never a flat no.
- **Files**: `BoardAutoPage.tsx` (pick → roll → game screens; tap-first
  oplay-style grammar: 1-tap play with auto-paid costs, DON given by
  selecting individual DON!! (tap = toggle that one, "All", then tap the
  target — the user rejected oplay's quantity dial), attacker→target with a
  solid leader-colored SVG arrow (points mapped through the overlay's
  screen CTM, so it is right inside the rotated phone table too), ONE contextual
  bottom button, prompts for mulligan/block/counter/triggerDecision/
  selectTargets/mayActivate/manualResolve, live power chips "8000 (+3000)",
  keyword chips, per-seat count-up clocks, human-readable event log,
  per-seat concede, game-over overlay with rematch) · `autoStore.ts`
  (zustand: serializable game state + GameEvent log + banner; catalog/CardDb
  kept module-level) · `compile.ts` (card IR source: the OFFICIAL M2 batch
  first — `src/autosim/data/compiled` getCompiledCard, ST01+OP01 — then a
  heuristic text→CompiledCard FALLBACK for uncompiled sets only: line-start
  innate keywords; [Trigger]/[Main]/[Counter] → `manual` actions; rest
  vanilla) · `decks.ts` (demo decks generated from the catalog with
  blockers+triggers+[Counter] events guaranteed — ST01/OP01 leaders first
  since their effects run for real — plus My Decks) · `log.ts`
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
- **Automation transparency (UX round 2026-10-24)**: nothing un-automated is
  silent — `automationInfo` (compile.ts) drives on-field chips ("MANUAL" /
  "NO-AUTO"), a detailed note in the preview rail, and per-deck warnings in
  the picker for uncompiled sets; `ENGINE_RUNNABLE_TIMINGS` lists what the
  engine fires today (update it as M3+ lands). Same round: preview art never
  crops (object-fit contain), rested leaders/stages get rotation clearance
  (no more spilling over the LIFE/DON piles), the contextual action bar lives
  in flow between field and hand (never covers DON cells or counter cards),
  and right-click on an active DON toggles a purely-visual "HOLD" placeholder
  (no intent, resets each turn, info-tone hint on first use).
- **Turn feedback + damage micro-animations (2026-10-25)**: the turn
  player's half is lit in the leader color (2px border, stronger tint) and
  the other dimmed; turn pills tinted; End turn carries the turn color
  stripe. Life taken → card-back ghost slides Life pile → hand (250ms) +
  red flash of the hit half + life counter tick; K.O. → card ghost slides to
  the trash (200ms). Transform/opacity only, disabled under
  prefers-reduced-motion, no audio.
- **THE BOARD IS A FIXED STAGE, NOT RESPONSIVE — by design (2026-10-26,
  user decision: "a game, like OPTCGSim / Master Duel")**: GameScreen draws
  ONE desktop layout at 1920×1080 virtual px (`.ba-stage`, `--bacw: 80px`,
  every table card — leader, characters, stage, piles, DON, hands — the same size)
  and `useStageFit` scales it to the viewport (`scale = min(vw/W, vh/H)`,
  letterboxed, centered) and rotates it 90° when the viewport is portrait
  (`rotate(90deg) translateY(-1080px)` in the same matrix). No media queries
  and no vw/vh inside the stage; all fixed overlays (banner, prompts,
  modals) are children of the transformed stage so they scale with it. The
  previous compact/responsive chrome (strips, sheets, forced-landscape CSS)
  was removed. The app's ThemeToggle is not rendered on the board
  views (App.tsx). Hand play is 2-tap everywhere: tap = select + in-place
  PLAY button, tap again = deselect; the preview lives in the left rail.
  Small targets on a phone (~0.46 scale) are the accepted trade-off.
  Follow-ups (2026-10-26): prompts render inside a permanently reserved
  58px slot between field and hand (overlay, no reflow — the QA bot's STRUCT
  REFLOW check compares the piles/rails/field/hand boxes before and after a
  prompt); a local hotseat chat (DuelingBook white box, seat switch + input)
  sits under the duel log.
- **ZERO OVERLAP + DECLARED ORDERED STACKS (2026-10-26, user: "ci sono
  tutte robe sovrapposte" → then "i DON sono troppo separati, in OPTCGSim si
  sovrappongono in modo sensato e ordinato")**: the old "stride" escape
  hatch is gone. Contract: no two card/pile/slot rectangles intersect
  anywhere (field, piles, hands while they fit) and every chip (power, cost,
  keywords, DON given, ACTIVATE, PLAY, pile label/count) lies inside its own
  card. The ONLY allowed overlaps are inside a declared ordered stack
  (`[data-stack]`): the cost area's two groups (active DON!! upright, rested
  DON!! rotated, OPTCGSim-style cascade with a constant 32px step, the last
  card on top, 16px between the groups) and a hand beyond capacity (15 cards
  side by side at 88+6px; beyond that a constant step ≥ 25% of a card). A
  stack = same card size, constant step (±1px) on one axis, last on top, ≥25%
  of each card uncovered, every card inside the stack box, the stack box
  inside its zone and never touching anything else. Layout: stage 1920×1080,
  rails 212px, card 88×123 (`--bacw`/`--bach`, mirrored by CARD_W/CARD_H in
  BoardAutoPage), two rows per half (characters = 5 slots; leader + stage +
  COST AREA row), every table slot (`.ba-tslot`) as WIDE as the card is TALL
  (`--baslot`) so a rested card rotated 90° stays inside its slot; the field
  is exactly two halves tall and the hands share the rest (equal flex, so
  their boxes never move). Table cards get no hover/picked lift (outline
  only; a picked stacked DON!! also gets an inner red tint so the ring reads
  on its uncovered strip); chips on rested cards are counter-rotated at the
  card's centre. Tapping a stacked DON!! = tapping its uncovered strip (the
  bot/driver hit-test a grid of points, `clickVisible` / `clickDon`).
  QA bot: STRUCT OVERLAP treats each stack as one box (no other exception;
  slots, label and chat are pieces), STRUCT STACK validates the stack rules,
  STRUCT CHIP flags a chip outside its card; once per game a CROWDED-TABLE
  PROBE pushes the worst case into the store (5 chars/2 rested, DON 6/4, an
  18-card hand vs 8, rested leader), runs the checks and restores the game.
  `BA_FULL=1 [BA_FULL_HAND=18] node scripts/boardauto-shots.mjs` does the
  same for screenshots (`boardauto-stage-full*.png`). Rested cards (DON!!,
  leader, characters) change ONLY their rotation — never their opacity.
  `DonArt` (BoardPage.tsx, shared by all three boards) now renders the real
  scan `public/cards/DON.webp` (600×840, same path pattern as every card)
  and falls back to the SVG recreation only if the image fails to load.
- **SEAT PANEL PROFILE PICTURES (2026-10-27, user: "includi la foto profilo
  nei giocatori a dx come su duelingbook.com"; then "deve essere proprio come
  su duelingbook")**: each right-rail `.ba-seatpanel` copies DuelingBook's
  avatar box, mirrored around the log. The top seat reads LIFE bar → avatar →
  counters, the bottom seat reads counters → avatar → LIFE bar.
  - `.ba-lifebar`: a gradient pill (blue side top, warm side bottom) whose
    fill is Life / leader Life, with the number on the right, then the clock
    and a small `.ba-concede` (click twice).
  - `.ba-pfpbox` (`data-avatar`): 200px tall, with the name written
    vertically on a side-coloured strip (`--side`: blue top, pink bottom) and
    the art cropped to the illustration.
  A seat whose name matches a captain in
  `api.directory()` (username or display name) shows that captain's favourite
  leader + avatar colour; otherwise the seat's deck Leader art. qa-bot's
  "last on top" hit probe now sits mid-strip (`min(3, step/2)`): on the phone a
  Life step is ~3.6 screen px and the fixed 3px probe snapped onto the next card.
- **BIGGER CARDS, ADAPTIVE STAGE WIDTH (2026-10-27, user: "tutte le carte
  sono ancora troppo piccole, c'è ancora moooolto spazio vuoto")**: the
  stage is 1080 tall and `STAGE_W_MIN…MAX` (1728…2400) wide following the
  viewport aspect (no letterbox from 16:10 to 20:9); rails = max(280,
  (W−32−1400)/2), field ≤1400, columns set inline. The HEIGHT bounds card
  size, so three size classes: table + bottom hand `--bacw` 116×162, top hand
  `--bahw` 88×123 (the other seat; a back row online), DON!! (cost-area cells
  + DON!! deck pile, under the Life cascade) `--badw` 80×112, DON_STEP 28.
  Prompts moved into the band between the halves (reserved `.ba-promptslot`,
  overlay, no reflow); the 58px slot above the hand is gone. Inspector shows
  the turn player's Leader when nothing is hovered. Stage + wrap are
  `overflow: clip` (a focus scrolled the edge-to-edge stage). QA bot: STRUCT
  SIZE per class (table / DON!! / each hand), stacked-hand cards exempt from
  the centre-occlusion check, Life pile exempt from STRUCT REFLOW.
- **(superseded) Phone chrome (2026-10-24)**: `boardauto-compact.css` + `COMPACT_QUERY`
  (phone landscape ≤1024×560, or portrait ≤820px) switch GameScreen to a
  compact chrome — same table geometry scaled from viewport height, hands as
  top/bottom overlay strips (horizontal scroll), minimal seat pills,
  bottom-right action bar (End turn / Log / Card), preview + log as toggled
  sheets, step prompt bottom-right over the pile corner, 2-tap play from hand
  on touch (select → "Play this card"), long-press DON placeholder, ≥44px
  targets, safe-area. **Auto-landscape**: on a touch device the table tries
  fullscreen + `screen.orientation.lock("landscape")` at the entry gesture
  (silent when unsupported) and, whenever the viewport stays portrait, the
  whole root is CSS-rotated 90° (`.ba-forced`: fixed 100dvh×100dvw box,
  `rotate(90deg) translateY(-100%)`; fixed children stay inside; dvw/dvh
  sizes; notch = table's left edge). No "rotate" overlay anymore; the stacked
  portrait DOM survives only as the unexposed `.ba-stack` fallback. Verified
  with the Playwright driver in touch emulation: `BA_MOBILE=1 BA_W=390
  BA_H=844 BA_PREFIX=forced-landscape-` plays a whole game on the rotated
  table → `scripts/.shots/boardauto-forced-landscape-*.png`; native landscape
  `BA_W=844 BA_H=390 BA_PREFIX=mobile-` → `boardauto-mobile-*.png`.
- **M3 wiring (2026-10-24)**: ACTIVATE chip from `legalMoves.activatable`
  (+ Activate button in the compact card sheet; illegal activations are
  explained on tap), `peekSelect` panel (take ≤ N, tap-sequence ordering,
  Top/Bottom split), `payDon` steppers with "Auto", `chooseNumber` buttons,
  cost-phase target picker titled "Pay the cost: …", 12 tier-2 events in the
  log, `automationInfo` on the M3 metric (static-only cards → "continuous
  effect not yet automatic (M4)"). Driver: `BA_DECK_B=demo:OP01-091` picks the
  purple demo (DON!!−X cards → payDon), `BA_SEED=<seed> BA_FIRST=A|B` pins the
  engine seed (DEV hook `window.__autoSeed` read by autoStore.chooseFirst) to
  reproduce a hand, e.g. `BA_SEED=nami-0 BA_FIRST=A BA_DECK_B=demo:OP01-001`
  opens with Nami OP01-016 → peekSelect. NOTE: no ST01/OP01 card has a real
  `draw upTo`, so the chooseNumber window is wired + typechecked but only
  exercisable with synthetic cards (engine tests cover it).
- **Known limits (engine debts)**: static/continuous effects and
  start-of-turn timings don't run yet (DISCLOSED via chips/notes);
  manualResolve is an acknowledged no-op (no free-move intents in M1); a
  [Trigger] "play this card" from an uncompiled set degrades to manual+trash;
  no undo (replayable event log makes it feasible later). Decisions #23-32
  in AUTOSIM_PLAN.md. NOTE for verification scripts: the login route is
  rate-limited (10/10min) — boardauto-shots.mjs reuses its session via
  storageState and mutes the HMR websocket so live edits by other agents
  can't reload the page mid-game.

## QA bot — automatic, repeatable bug hunter (`npm run qa:bot`)
`scripts/qa-bot.mjs` (Playwright; dev server must be up). Two parts:
- **Player**: plays complete board-auto games with seeded random LEGAL moves
  (play / give DON / attack / activate / every ChoiceRequest incl. peek,
  payDon, chooseNumber, trigger, counter, block) over 4 deck configs
  (ST01 vs OP01, purple OP01-091, uncompiled ST02 vs ST04 = manual path,
  OP01-002 vs ST03) × 3 viewports (desktop 1440×900, phone landscape
  844×390, phone portrait 412×915 = forced landscape), `QA_GAMES` per config
  (default 3). After EVERY move it checks: console/page errors + unhandled
  rejections + Vite overlay, 4xx/5xx + broken images, affordance ↔
  `legalMoves` (AFFORDANCE MISSING / ILLEGAL AFFORDANCE = red banner after a
  legal move), layout (off-viewport, occluded tappables, field-card overlap,
  prompt over a tappable card, clipped text, touch targets < 44, document
  h-scroll), engine ↔ UI (seat counters, power chips = effective power, every
  field/hand card rendered), invariants (50 cards per seat, 10 DON, one
  blocker per battle), STUCK (no state change / timeout).
- **Crawler**: every app view at 1440 / 768 / 390 with the generic checks +
  a screenshot per page (uses the DEV hook `window.__auto.setView`).
- Output: `scripts/.qa/report.md` + `report.json` + `scripts/.qa/shots/`;
  findings are deduplicated, exit code 1 when a HIGH finding exists.
- Reproduce a finding: the report's last column, e.g.
  `QA_SEED=qa-st01-vs-op01-1 QA_CONFIG=st01-vs-op01 QA_VIEWPORT=portrait
  QA_SKIP_CRAWL=1 npm run qa:bot` (same seed + same engine = same game).
  Knobs: `QA_QUICK=1` (desktop only), `QA_GAMES`, `QA_SKIP_GAMES`,
  `QA_SKIP_CRAWL`, `QA_GAME_TIMEOUT` (ms), `QA_MAX_MOVES`, `QA_TRACE=1`
  (log pending state around attack clicks). The full matrix is long (~36
  games): run the viewports in PARALLEL, one output dir each, then merge:
  `QA_OUT=scripts/.qa/desktop QA_VIEWPORT=desktop QA_SKIP_CRAWL=1 npm run qa:bot`
  (same for landscape / portrait), `QA_OUT=scripts/.qa/crawl QA_SKIP_GAMES=1
  npm run qa:bot`, then `QA_MERGE=scripts/.qa/desktop,scripts/.qa/landscape,
  scripts/.qa/portrait,scripts/.qa/crawl npm run qa:bot` → `scripts/.qa/
  report.md`. Refusal banners are traced to their UI call site via the DEV
  store hook (`window.__auto.store`), so an ILLEGAL AFFORDANCE finding names
  the handler that raised it.
- Bugs it has found so far (fixed): the ACTIVATE chip sat on the card's
  center and stole the "select attacker" tap; the refusal banner blocked taps
  on the top hand (now `pointer-events: none`); the phase pill clipped
  "BATTLE · COUNTER" (now "COUNTER STEP" + ellipsis); a rotated rested DON
  covered the last active DON's center (dial taps failed on every viewport);
  the step prompt covered tappable cards on compact (label is now
  pointer-events none); target candidates living in a pile (e.g. "return
  from trash") had no card to tap → dedicated picker panel.
- Accepted / documented: compact DON cells are 20×46px (10 must share the
  cost area) → the bot reports them as low "SMALL TAP TARGET" only if the
  height rounds under 44; hand cards in the phone strips are 38×53.
- Hardening shared with `boardauto-shots.mjs`: session reused via
  storageState (login is rate-limited), Vite HMR socket muted in the bot's
  browser, seed pinned through `window.__autoSeed`.

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
