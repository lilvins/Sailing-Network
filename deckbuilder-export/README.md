# Sailing Network — Deck Constructor (export)

Low-fi interactive prototype of a One Piece TCG deck builder, in the
"Sailing Network" visual system (dark glass, red/gold accents, Sora + Manrope).
Plain React 18 + Babel-in-browser — **no build step, no npm install.**

## Run it
Open `Deck Constructor.html` in a browser. That's it.
Because it loads `.jsx` via Babel and `fetch`es sibling files, serve the folder
over a tiny static server rather than `file://`:

```bash
cd deckbuilder-export
python3 -m http.server 8000
# open http://localhost:8000/Deck%20Constructor.html
```

## Files
| File | Role |
|------|------|
| `Deck Constructor.html` | Entry point. Loads React/Babel + the CSS + `deckbuilder.jsx`, mounts `window.DeckBuilder`. |
| `deckbuilder.jsx` | **All builder logic + the card pool (`POOL`).** Self-contained (defines its own `I` icons, `Select`, color maps). |
| `deckbuilder_styles.css` | Builder-specific styles. |
| `home_styles.css` | Design-system tokens (`--glass`, `--acc`, `--acc2`, `--edge`, `--muted`, `--display`, …). Loaded first — required. |
| `profiles_styles.css` | Provides shared `.snp`, `.snp-head`, `.snp-back`, `.snp-dock`, `.snp-select`, `.snp-iconbtn` used by the builder shell. |
| `image-slot.js` | `<image-slot>` web component — the drop-zone for real card art in the left detail panel. |
| `My Decks.html` + `mydecks.jsx` + `mydecks_styles.css` | Saved-decks gallery (select / rename / duplicate / delete, persisted to `localStorage` key `sn-decks`). The builder's "My Decks" tab links here. |

## Architecture notes
- **No bundler / modules.** Each `<script type="text/babel">` is its own scope, so
  shared helpers are re-declared per file rather than imported. If you migrate to a
  real toolchain, factor `I`, `Select`, `HUE`/`hueColor`, `HUE_NAME` into a shared module.
- `window.DeckBuilder` / `window.MyDecks` are the export handoff between files.

## Data model (`deckbuilder.jsx`)
Card factory `C(name, t, col, cost, pow, cnt, tags, fx, set)`:
- `t`: `"L"` leader · `"C"` character · `"E"` event · `"S"` stage
- `col`: color identity — `R G B P K Y` (Red/Green/Blue/Purple/Black/Yellow)
- `cost`, `pow` (power), `cnt` (counter value, e.g. 1000)
- `tags`: subtypes (e.g. "Straw Hat Crew"), `fx`: effect text, `set`: set code (OP01…)
- `max`: copies allowed (4, or 1 for leaders)

## Implemented rules / behavior
- 1 Leader + **50-card** Main Deck, **max 4 copies** per card, DON!! deck fixed at 10.
- **Color restriction:** Main Deck only accepts cards matching the Leader's color.
  Off-color cards render locked in the list; changing the Leader prunes mismatched cards.
- Left = card detail (hover any card to preview; `+/−` to add/remove; "Use as Leader").
- Center = current deck (editable name, leader row, live cost curve + color breakdown).
- Right = card list: search, color pills, type/sort dropdowns, **Advanced filters** modal
  (filter by Counter and by Keyword, AND logic).
- Deck legality badge ("Deck legal" when Leader + exactly 50 cards).

## Not included / stubbed
- "Favorites" tab, "Save Deck", messages/friends dock icons are visual only.
- Card art is placeholder (gradient + emblem letter); drop real art via the `<image-slot>`.
- The pool in `POOL` is a representative sample, not a full set.
