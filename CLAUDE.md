# One Piece TCG — Sailing Network · Project Brief

> This file is the permanent context for the project. Claude Code reads it
> automatically each session. Keep it short, factual, and current. Detailed
> task specs live in separate files (e.g. `V1_TASK.md`).
>
> **Read `CLAUDE_NOTES.md` too** — it holds the current state + recent work and
> corrects places where this brief has drifted (e.g. there IS now a backend).

## Vision

A simulator + social platform for the One Piece Card Game. Two ways to play:
**manual boards** in the spirit of DuelingBook (players perform every action by
hand — the original scope, still true for `board`/`board2`), and since 2026-10
the **automatic board** `board-auto`, driven by the event-sourced AUTOSIM rules
engine in `src/autosim/` (see `AUTOSIM_PLAN.md`). The 2026-10 drift corrections:
there IS a backend (`server/`), there IS a rules engine (AUTOSIM — but the
manual boards stay engine-free), and the visual identity is the "plancia di
notte" described in CLAUDE_NOTES (real-image backgrounds, flat/angular, no AI
slop; see the user's taste rules there).

**Explicitly NOT (on the MANUAL boards only):**
- no rules engine
- no move/attack validation
- no automatic chain/effect resolution
- no flashy animations (this one holds everywhere)

**One-line goal:** "DuelingBook for One Piece, but cleaner, modern, responsive,
and cross-platform from a single codebase (desktop + mobile browser)."

**Priorities, in order:**
1. Input latency / responsiveness
2. Low visual clutter & competitive readability
3. Smooth, predictable card movement
4. Mobile usability (touch) with the same code as desktop

Animations are minimal and functional only (drag transforms, layout
transitions). Never chase visual effects over input latency.

## Stack (decided — do not swap without a stated reason)

| Concern        | Choice            | Why |
|----------------|-------------------|-----|
| Build/dev      | Vite              | Instant start, zero config |
| Framework      | React + TypeScript| Biggest ecosystem; state is everything in a card game, so types pay off |
| State          | Zustand           | Single serializable store; no Context for board state (re-render hell) |
| Drag & drop    | dnd-kit           | Pointer + touch + mouse with one API; HTML5 native DnD breaks on mobile |
| Styling        | Tailwind CSS + CSS custom properties | Fast iteration + theme tokens |

No native apps; browser only. (Outdated: "no backend, no networking" — there
is now a Fastify+SQLite backend in `server/` with real auth; see CLAUDE_NOTES.)

## THE non-negotiable rule (read this twice)

All game-state changes go through **named action functions** in the store
(`drawCard`, `moveCard`, `restCard`, `setRest`, `addDon`, `shuffleDeck`, …).
Components never mutate state directly. The state object stays
**JSON-serializable** at all times (no class instances, no functions, no Maps
inside state).

This single rule is what makes future multiplayer, replays, and spectating
possible *without a rewrite*: actions become network messages, a replay log,
and a spectator stream. Treat every action like an event that could one day be
sent over the wire.

## Game state shape (target)

```ts
type CardId = string;       // e.g. "OP01-001" — references the static card DB
type InstanceId = string;   // unique per physical card in this match

interface CardInstance {
  instanceId: InstanceId;
  cardId: CardId;
  faceUp: boolean;
  rested: boolean;          // tapped/rested
}

type ZoneId =
  | "deck" | "hand" | "trash" | "life"
  | "leader" | "characterArea" | "stage"
  | "donDeck" | "donActive";        // DON!! deck + cost area

interface PlayerState {
  id: string;
  zones: Record<ZoneId, InstanceId[]>;
  instances: Record<InstanceId, CardInstance>;
}

interface GameState {
  players: Record<string, PlayerState>;
  turnPlayerId: string;
  turn: number;
  // log of applied actions — the seed for replays/multiplayer later
  actionLog: GameAction[];
}
```

Keep `instances` as a flat lookup; zones hold ordered `InstanceId[]`. This makes
move/reorder cheap and serialization trivial.

## Data architecture

- **Images by ID:** `public/cards/<CardId>.webp` (flat). Alt arts later:
  `public/cards/<CardId>/<variant>.webp`. The renderer only knows the ID.
- **Card database (static, read-only):** `src/data/cards/` split per set
  (`OP01.json`, `OP02.json`, …) merged into a single `Record<CardId, CardData>`
  index at load. Source: community DBs (numbering like `OP01-001`).
- **Decklists:** `src/data/decks/*.json` contain **card IDs only**
  (`{ leader: CardId, main: [{ cardId, count }], don: number }`). No metadata,
  no image paths.
- **Resolver:** `getCard(cardId)` → metadata, `getCardImage(cardId)` → path.
  Nothing else in the app reads the DB directly. This decouples game logic from
  data source and from copyrighted art.

> Note: card art is © Bandai/Shueisha/Oda. Fine for a personal/fan tool; revisit
> before any public or commercial release. The data/image separation above keeps
> that switchable.

## Folder structure

```
src/
  app/                 # App shell, providers, routing (later)
  features/
    board/             # the playmat: zones + layout (BUILD THIS FIRST)
    card/              # Card component + drag wrapper
    hand/              # hand rendering
    deck-loader/       # load decklist JSON -> instances
    context-menu/      # long-press / right-click card actions
  state/
    gameStore.ts       # Zustand store + ALL action functions
    types.ts           # GameState, CardInstance, ZoneId, GameAction
  data/
    cards/             # OP01.json, OP02.json, ... (static DB)
    decks/             # sample decklists (IDs only)
    cardResolver.ts    # getCard / getCardImage
  lib/
    rng.ts             # seedable shuffle (seam for server-side RNG later)
    id.ts              # instanceId generation
  styles/
    tokens.css         # theme custom properties (zone colors, spacing)
  main.tsx
public/
  cards/               # <CardId>.webp images
```

## Conventions

- One feature = one folder under `features/`, colocate its components/styles.
- Components are dumb where possible; gameplay logic lives in store actions.
- Responsive via `clamp()` + container queries / relative units, not a pile of
  hardcoded breakpoints.
- Mobile input: tap = select, long-press = context menu, drag = move.
- RNG goes through `lib/rng.ts` (seedable) so the server can own it later.

## DO NOT (scope discipline)

- Do not add rules logic, move validation, or auto-resolution to the MANUAL
  boards (the AUTOSIM engine lives apart in `src/autosim` + `board-auto` only).
- Do not start networking, lobby, or accounts yet.
- Do not build the deck builder before the board works.
- Do not add a heavy animation library.
- Do not put board state in React Context.
- Do not hardcode card data or image paths inside components.
- Do not over-abstract (no "effect system", no plugin architecture) early.

## Current milestone

**V1 — local, single-player, no server.** See `V1_TASK.md`.
