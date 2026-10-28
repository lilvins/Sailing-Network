# Background asset credits

## night-sea/ (base, moon, clouds, reflections, full)
"Moon and Sea Pixel Art Background" by **CraftPix.net 2D Game Assets**
Source: https://opengameart.org/content/moon-and-sea-pixel-art-background
License: **OGA-BY 3.0** (attribution required — keep this file).
Layers renamed: 1→base, 2→moon, 3→clouds, 4→reflections, 5→full (2304x1296 composite).

## fx/water-sheet.png
"Animated water texture 128px" by **YCbCr**
Source: https://opengameart.org/content/animated-water-texture-128px
License: **CC0**. Every 2nd of the 40 frames, shrunk to 32px, posterized and
stacked vertically by `scripts/build-pixel-fx.mjs <extracted frames dir>`.

## fx/gull.png, fx/ship.png
Drawn pixel by pixel in `scripts/build-pixel-fx.mjs` (project-original).

## ocean-view/ (back, clouds, waves)
"Ocean View" by **Luis Zuno (@ansimuz)** — https://opengameart.org/node/133444
License: **CC0** (credit not required, given anyway). Night set, layers
Back/Clouds/Middle renamed back/clouds/waves. Used behind the Play Auto deck pick.

## public/cards/BACK.webp, BACK-leader.webp
Official ONE PIECE CARD GAME card back (© Bandai/Shueisha/Eiichiro Oda —
personal/fan use, same caveat as the card images). Source scan: Wikipedia
"One Piece Card Game" article, File:One_Piece_Card_Game_back.webp (200×280),
upscaled to 600×840. BACK-leader.webp = the same scan with the blue hues
recoloured to the red back of real Leader cards.

## card-collage-*.png
Generated locally by `scripts/build-backgrounds.mjs` from the self-hosted card
art in `public/cards/` (© Bandai/Shueisha/Eiichiro Oda — personal/fan use, same
caveat as the card images themselves; see CLAUDE.md data architecture note).
Regenerate with: `node scripts/build-backgrounds.mjs`
