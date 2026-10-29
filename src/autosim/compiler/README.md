# optcg-ai → AUTOSIM compiler

Translates the card effects that optcg-ai knows (the optcgwebsim "actionV3"
step language, ~2900 cards) into AUTOSIM's IR (`src/autosim/ir/types.ts`), so
board-auto plays every card with AUTOSIM's own rules engine.

Pure and deterministic: data in, IR out. No Node APIs, no I/O, no dependency
on board-auto or the UI — the app uses the compiler's output, never the
other way round.

## How it plugs in

```
public/data/optcg/bundle.json   (optcg-ai effects, synced by optcg-ai `npm run sync-sn`)
public/data/cards.json          (the catalog: printed text, types, names)
        │
        ▼  npm run compile:optcg   (= UPDATE_OPTCG=1 vitest run m5-optcg, then the checks)
src/autosim/data/compiled/generated/optcg.json + report.json
        │
        ▼  getGeneratedCard(id)    (src/autosim/data/compiled/index.ts)
board-auto compiledFor(card):  hand batch (ST01+OP01) → generated → text heuristic
```

Entry point: `compileAllOptcg(optcgDb, catalog, categoryEnum)` in
`fromOptcg.ts` (one card: `compileOptcgCard`).

## Files (one responsibility each)

| File | Does |
|---|---|
| `fromOptcg.ts` | Entry: card → `CompiledCard` (abilities, disclosure of what the IR can't say, classification, notes) |
| `abilities.ts` | One ability → one `Effect`: passives (keywords / statics) and triggered or activated abilities, with the text cross-checks |
| `sequence.ts` | A run of steps → actions: gates, ForceOpponent, Choices, views, "continue by hand" tails |
| `actions.ts` | One step → actions, one small builder per actionV3 effect key |
| `views.ts` | "Look at / reveal / search" views → `peekDeck`, trash picks |
| `costs.ts` | Steps before the ":" → `CostItem`s |
| `choiceLabels.ts` | Labels for "Choose one" options and "X or Y:" cost alternatives (printed bullets matched to branches) |
| `costActions.ts` | Costs that are ordinary actions done in full (`{ kind: "action" }`), trash-view and "in any order" costs |
| `conditions.ts` | proc / step `details` keys → `Condition`s; the timing table |
| `extraConditions.ts` | The comparison / Leader / "there is a Character …" keys → `compare`, `anyOf`, `selfMatches`, `ownTurnAtLeast` |
| `selectors.ts` | Target specs → `Selector` (zone, owner, count, filter) |
| `text.ts` | Reading the printed text: one segment per ability, the cost colon |
| `catalogMaps.ts` | optcgwebsim ids → catalog spelling (colors, card types, type names, card names) |
| `dsl.ts` | Tiny readers for the actionV3 JSON and shared key sets |
| `types.ts` | Input shapes, compile context, per-ability state |
| `optcg-categories.json` | optcgwebsim's CardCategory enum (id → name) |

## Rules it follows

- **Never invent semantics.** What the IR can't say becomes a `manual`
  action with the card's own text. If the first part of an ability is
  translatable it runs, then "Continue by hand …" carries the rest.
- **Abilities with no IR timing** (replacements `Pre*`, MyDonIsReturned,
  OnRest, QueuedEndOfTurn, …) become an inert `static` manual effect, so
  board-auto shows they are not automatic.
- **The printed text wins over the data.** A Leader condition, opponent
  targets, "Leader or Character" or a [Trigger] that the text and the data
  disagree on → manual. [Once Per Turn] follows the text.
- **Approximations are written per card** in `notes` (`approx: …`).

## Checks (`src/autosim/__tests__/m5-optcg.test.ts`)

- committed JSON = a fresh compilation (drift guard);
- schema + semantic lint on every card;
- every non-static effect of every catalog card dry-run in the engine;
- agreement with the hand-made ST01/OP01 batch (120/138 identical);
- full games with the real meta decks.

## Reuse

Any project that has AUTOSIM's IR and optcg-ai's bundle can call
`compileAllOptcg`; nothing here imports board-auto, the stores or React.
To support a new actionV3 key: add a builder in `actions.ts` (or a case in
`conditions.ts` / `costs.ts`), run `npm run compile:optcg`, read the diff of
`generated/report.json`.
