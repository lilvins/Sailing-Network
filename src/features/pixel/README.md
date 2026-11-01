# Pixel UI

The one look of Sailing Network: ship's-timber windows, parchment notices,
chunky pixel buttons, walnut wells, pixel icons. Art: Pixel Frog
"Treasure Hunters" (CC0), CraftPix seas (OGA-BY 3.0), ansimuz "Ocean View"
(CC0) — credited in `public/assets/bg/CREDITS.md` and the Credits page.

## Files (one job each)

| file | job |
|---|---|
| `tokens.css` | palette, sizes, shadows, art URLs, fonts. Change numbers **here**. Also re-points the old `--night-*`, `--glass`, `--elev`, `--edge` tokens at walnut. |
| `components.css` | reusable classes for new markup: `px-window`, `px-plank`, `px-paper`, `px-btn` (`--red` `--green`), `px-input`, `px-tabs`/`px-tab`, `px-table`, `px-badge` (`--gold` `--wood` `--red` `--green`), `px-icon`, `px-logo-mark` |
| `skin-core.css` | older page markup → windows, buttons, titles, page props (Home, Duel Room, records…) |
| `skin-controls.css` | every button's pixel font; fields, tabs, pills, badges, flat buttons → pixel pieces |
| `skin-pages.css` | profile / social / stats / popular / admin cards, tiles, table heads, modals |
| `skin-play.css` | Play Auto, Play vs Bot and the matchmaking board's chrome (not the playmat) |
| `index.css` | load order; imported last by `src/main.tsx` |
| `pixel.css` + `PixelScene.tsx` | the pixel-art scene behind `.snp.px` pages and its credit |
| `icons.ts` + `PixelIcon.tsx` | our own 12×12 icon set and the component that draws it |
| `PixelLogo.tsx` | the site mark (Pixel Frog's helm on a plank) |

## Rules

- **New UI**: use the `px-*` classes and `<PixelIcon/>`; no new hex colours,
  no line/emoji icons. Need a colour? Add a token.
- **Buttons**: label font is `--px-btn-font` (VT323), sized by
  `font-size-adjust: ex-height var(--px-btn-ex)`. Gold = secondary, red =
  primary/danger, green = watch/go. Rows that are buttons keep the sans
  (list in `skin-controls.css`).
- **Pixel type** only where it reads: Silkscreen (`--px-hud`) for titles and
  labels, VT323 (`--px-flavor`) for buttons and big numbers; body text and
  inputs stay sans.
- **Icons**: add a 12×12 grid to `icons.ts` (`#` solid, `+` faded fill).
  `PixelIcon` snaps the size to 12/24/36 so every art pixel is whole.
  `icons.test.ts` checks every grid.
- **Art**: only clearly licensed art with a named author (CC0, CC-BY,
  OGA-BY, CraftPix freebie), credited in CREDITS.md and the Credits page.
  Prefer drawing it here. UI pieces are rebuilt with
  `node scripts/build-pixel-ui.mjs "<Treasure Hunters folder>"`.
