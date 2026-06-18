# V1 Task — Local, single-player, no server

> Read `CLAUDE.md` first. Build in the order below. Stop and show me the result
> after each step before moving on — do not implement all steps in one shot.

## Goal of V1

A single player can load a deck from JSON, set up the board, draw the opening
hand, draw cards, and freely drag cards between zones. Everything is manual; no
rules are enforced. No backend.

## Build order (one step at a time)

**Step 0 — Scaffold**
Vite + React + TypeScript + Tailwind + Zustand + dnd-kit. Set up the folder
structure from `CLAUDE.md`. Add `styles/tokens.css` with a dark theme palette
(background, zone outline, card back, accent). Confirm dev server runs.

**Step 1 — Types + store skeleton**
Create `state/types.ts` (GameState, CardInstance, ZoneId, GameAction) and
`state/gameStore.ts` (Zustand) with empty state and stub action signatures:
`loadDeck`, `shuffleDeck`, `setup`, `drawCard`, `moveCard`, `restCard`.
No UI yet.

**Step 2 — Vertical slice (the riskiest part — do this before anything pretty)**
Render TWO zones side by side and a Draw button. Cards live as instances in the
store. Implement `drawCard` (deck → hand) and `moveCard` (between the two
zones) via dnd-kit. Prove drag works on desktop AND with touch/devtools mobile
emulation. This validates the architecture before investing in layout.

**Step 3 — Card + data resolver**
Build the `<Card>` component (receives `cardId`, resolves image + data via
`data/cardResolver.ts`). Use a few placeholder card JSONs and placeholder images
named `<CardId>.webp` until real data is wired. Card shows art, falls back to a
text stub if the image is missing.

**Step 4 — Full board layout**
Lay out all One Piece zones for one player: Leader, Character area (up to 5),
Stage, Life, DON!! deck + active DON area, Deck, Trash, Hand. Responsive:
usable on a phone (portrait) and desktop with the same components. Use
`clamp()` / container queries, not hardcoded breakpoints.

**Step 5 — Deck loading + setup**
`deck-loader` reads a decklist JSON (IDs only). `setup()` builds instances,
shuffles via `lib/rng.ts`, places the Leader, builds the 10-card DON!! deck,
draws a 5-card opening hand, and places Life cards equal to the Leader's life
value. Add a "New Game" button.

**Step 6 — Card context menu**
Long-press (mobile) / right-click (desktop) on a card → menu: Rest/Active,
Send to Trash, Reveal/Flip, Move to top/bottom of deck. All manual.

## Acceptance criteria

- Loads a deck from a JSON file with card IDs only.
- Displays a correct opening hand of 5.
- Draw button moves a card deck → hand.
- Any card can be dragged between any zones (no validation), on desktop and
  mobile browser, with smooth movement.
- All state changes go through store actions; `GameState` stays
  JSON-serializable (verify: `JSON.stringify(getState())` round-trips).
- No backend, no networking.

## Out of scope for V1 (do not build)

Networking, second player, opponent view, deck builder, accounts, replays,
animations beyond drag/layout transitions, any rules enforcement.
