# Background asset credits

## night-sea/ (base, moon, clouds, reflections, full)
"Moon and Sea Pixel Art Background" by **CraftPix.net 2D Game Assets**
Source: https://opengameart.org/content/moon-and-sea-pixel-art-background
License: **OGA-BY 3.0** (attribution required — keep this file).
Layers renamed: 1→base, 2→moon, 3→clouds, 4→reflections, 5→full (2304x1296 composite).

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
