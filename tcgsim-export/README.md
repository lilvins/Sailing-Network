# One Piece TCG Sim — game board (export)

Low-fi interactive One Piece TCG **play area** prototype (board, hand, field zones,
DON!!, chat, controls) in the "Sailing Network" visual system (dark glass, red/gold,
Sora + Manrope). Plain React 18 + Babel-in-browser — **no build step, no npm install.**

## Run it
Open `One Piece TCG Sim.html`. Serve over a tiny static server (the page loads `.jsx`
via Babel and fetches sibling files, so `file://` won't work):

```bash
cd tcgsim-export
python3 -m http.server 8000
# open http://localhost:8000/One%20Piece%20TCG%20Sim.html
```

## Files
| File | Role |
|------|------|
| `One Piece TCG Sim.html` | Entry point. CSS design tokens live in its `<style>`. Loads React/Babel + the scripts below, mounts the app. |
| `app.jsx` | **All board logic + layout.** Self-contained (no other project deps). Renders into `#root`. |
| `tweaks-panel.jsx` | Tweaks panel shell + `useTweaks()` + control components (`TweakSlider`, `TweakToggle`, `TweakRadio`, `TweakColor`, …). Toggled by the host toolbar. |
| `image-slot.js` | `<image-slot>` web component — drop-zone placeholders for real card art. |

React, ReactDOM and Babel load from unpkg CDN (pinned + SRI) — needs network on first load.

## Layout / behavior
- Mirrored vertical play mat: opponent half (static) up top, your half (interactive) below.
- Zones: Leader, Character Area (5 slots), Stage, Cost Area (DON!!), Deck, DON deck, Trash, Life.
- **Drag** cards from hand onto field zones; **tap** empty slots to place; **tap Deck** to draw;
  **tap DON deck** to add DON!! to the cost area; **tap DON** to rest/active (rotate);
  **click** a card to select/highlight.
- Hand cards fan/overlap horizontally; the mat is a fixed design size scaled to fit the viewport.
- Left = opponent hand + chat (type/send) + your hand. Right = controls (Concede, etc.) + Mulligan/Keep.

## Tweaks (toolbar "Tweaks" toggle → `tweaks-panel.jsx`)
Defaults live in `TWEAK_DEFAULTS` at the top of `app.jsx` (between the `EDITMODE` markers):
arrangement (side panels / hands centered), zone labels, board size, mat tint theme, card-back color.

## Architecture note
No bundler/modules — each `<script type="text/babel">` is its own scope. `app.jsx` is fully
self-contained; if you move to a real toolchain, split it into modules and import `useTweaks`
from the panel rather than relying on global scope.

## Stubbed / visual-only
- Opponent side is static (single-player sandbox).
- Concede / menu / chat-send produce local toasts; no networking or real game rules engine.
- Card faces are placeholders; drop real art via `<image-slot>` where present.
