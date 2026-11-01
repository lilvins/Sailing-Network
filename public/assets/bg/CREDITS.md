# Background asset credits

## night-sea/ (base, moon, clouds, reflections, full)
"Moon and Sea Pixel Art Background" by **CraftPix.net 2D Game Assets**
Source: https://opengameart.org/content/moon-and-sea-pixel-art-background
License: **OGA-BY 3.0** (attribution required — keep this file).
Layers renamed: 1→base, 2→moon, 3→clouds, 4→reflections, 5→full (2304x1296 composite).
Used on the Home banner, login, Play Auto and the profile/social pages (PixelScene).

## sunset-sea/ (sky, cloud, reflection)
"Sunset Clouds Over The Sea Pixel Background" by **CraftPix.net 2D Game Assets**
Source: https://opengameart.org/node/158492 (also https://craftpix.net)
License: **OGA-BY 3.0** (attribution required — keep this file). CraftPix's own
freebie terms allow commercial use; no reselling of the files, no AI training.
Layers renamed: 1→sky, 2→cloud, 3→reflection. Used behind the Duel Room and the
competitive pages (Leaderboard, Records, Statistics, Meta, Popular) via PixelScene.

## ../ui/ (board, board-fill, paper, button-*, prop-*, captain-idle, crabby-idle)
"Treasure Hunters" by **Pixel Frog** — https://pixelfrog-assets.itch.io/treasure-hunters
License: **CC0** (attribution not required, given anyway). Wood board and paper 9-slices
assembled from the "Wood and Paper UI" tiles, idle strips from Captain Clown Nose and
Crabby, by `node scripts/build-pixel-ui.mjs "<extracted Treasure Hunters folder>"`.
Buttons from the 3x3 "Green/Yellow Button" tiles (button-red = the green recoloured);
props (chest, flag, helm, candle) from Palm Tree Island and Pirate Ship.
Used by `src/styles/pixel-ui.css` (windows, buttons, notices, page props, empty states).

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
Back/Clouds/Middle renamed back/clouds/waves. Used behind the Play Auto deck pick
and the deck, admin and credits pages (PixelScene).

## public/cards/BACK.webp, BACK-leader.webp, BACK-don.webp
Official ONE PIECE CARD GAME card back (© Bandai/Shueisha/Eiichiro Oda —
personal/fan use, same caveat as the card images). Source scan: Wikipedia
"One Piece Card Game" article, File:One_Piece_Card_Game_back.webp (200×280),
upscaled to 600×840. BACK-leader.webp = the same scan with the blue hues
recoloured to the red back of real Leader cards. BACK-don.webp = the same
scan recoloured to the white back of the DON!! cards (blue field → white,
white logo → navy, gold kept), rebuilt by `node scripts/build-don-back.mjs`.

## card-collage-*.png
Generated locally by `scripts/build-backgrounds.mjs` from the self-hosted card
art in `public/cards/` (© Bandai/Shueisha/Eiichiro Oda — personal/fan use, same
caveat as the card images themselves; see CLAUDE.md data architecture note).
Regenerate with: `node scripts/build-backgrounds.mjs`


## home-pattern/ (tile, boat)
The Home backdrop: a 24x24 wave tile repeated on one night-blue colour, and a
little sailboat, drawn pixel by pixel in `scripts/build-home-pattern.mjs`
(project-original). Rebuild: `node scripts/build-home-pattern.mjs`

