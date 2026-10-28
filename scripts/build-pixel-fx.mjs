/* Pixel FX for the living night sea (board, home hero, login).
     node scripts/build-pixel-fx.mjs [<water frames dir>]
   - water-sheet.png: the CC0 "Animated water texture 128px" by YCbCr
     (opengameart.org/content/animated-water-texture-128px), every 2nd of its
     40 frames, shrunk to the night-sea pixel grid (32px) and posterized, stacked
     VERTICALLY (32 × 640) so a repeat-x row always shows one frame at a time.
     Only rebuilt when the extracted frames dir is passed.
   - gull.png (2 flap frames side by side) and ship.png: drawn here pixel by
     pixel, upscaled by CSS with image-rendering: pixelated.
   Outputs into public/assets/bg/fx/. */
import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/assets/bg/fx";
mkdirSync(OUT, { recursive: true });

function rawSprite(w, h, paint) {
  const buf = Buffer.alloc(w * h * 4, 0);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  paint(set);
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png();
}
const rows = (px, art, palette, dx = 0) =>
  art.forEach((line, y) => [...line].forEach((ch, x) => palette[ch] && px(x + dx, y, palette[ch])));

/* ── water sheet ── */
const src = process.argv[2];
if (src) {
  const TILE = 32, FRAMES = 20;
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    const file = join(src, String(f * 2).padStart(4, "0") + ".png");
    if (!existsSync(file)) throw new Error("missing frame " + file);
    // luminance only: the CSS layer tints it with the sea colour (screen blend)
    const { data } = await sharp(file).resize(TILE, TILE, { kernel: "lanczos3" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    frames.push(data);
  }
  const sheet = Buffer.alloc(TILE * TILE * FRAMES * 4, 0);
  frames.forEach((g, f) => {
    for (let i = 0; i < TILE * TILE; i++) {
      // 4 hard steps, darkest = fully transparent → only the light ridges show
      const v = g[i];
      const step = v < 150 ? 0 : v < 180 ? 1 : v < 205 ? 2 : 3;
      const o = (f * TILE * TILE + i) * 4;
      sheet[o] = 150 + step * 30; sheet[o + 1] = 205 + step * 15; sheet[o + 2] = 235 + step * 6;
      sheet[o + 3] = [0, 70, 140, 220][step];
    }
  });
  await sharp(sheet, { raw: { width: TILE, height: TILE * FRAMES, channels: 4 } }).png({ palette: true }).toFile(`${OUT}/water-sheet.png`);
  console.log(`water-sheet.png <- ${FRAMES} frames of ${src}`);
}

/* ── gull: 9×5, two frames (wings up / wings down) → 18×5 ── */
const GULL = { w: [214, 232, 240], g: [150, 172, 186] };
await rawSprite(18, 5, (px) => {
  rows(px, [
    "w.......w",
    ".w.....w.",
    "..wgwgw..",
    "....g....",
    ".........",
  ], GULL);
  rows(px, [
    ".........",
    ".........",
    "wwwgwgwww",
    "w...g...w",
    ".........",
  ], GULL, 9);
}).toFile(`${OUT}/gull.png`);

/* ── ship: a far-off brig, 28×22 silhouette with a lit stern lantern ── */
const SHIP = {
  h: [10, 16, 38],   // hull
  s: [30, 46, 92],   // sails (catch a little moonlight)
  S: [46, 68, 128],  // sail edge facing the moon
  m: [14, 22, 50],   // masts / rigging
  f: [120, 26, 30],  // flag
  l: [255, 204, 102] // lantern
};
await rawSprite(28, 22, (px) => {
  rows(px, [
    "..........ff......ff........",
    "..........m.......mff.......",
    "..........m.......m.........",
    "......ssssmsss....m.........",
    "......sssssssS..sssssS......",
    ".....ssssssssS..sssssS......",
    ".....ssssssssS.ssssssS......",
    ".....ssssssssS.ssssssS......",
    "......sssssssS.ssssssSm.....",
    "......ssssmsss..sssssSm.....",
    ".....ssssssssS..ssmssS.m....",
    ".....ssssssssS.ssssssS..m...",
    ".....ssssssssS.ssssssS...m..",
    "......sssssssS..sssssS....m.",
    "..........m.......m........m",
    "..........m.......m.........",
    "lhh.......m.......m.......hh",
    ".hhhhhhhhhhhhhhhhhhhhhhhhhh.",
    "..hhhhhhhhhhhhhhhhhhhhhhhh..",
    "...hhhhhhhhhhhhhhhhhhhhhh...",
    "....hhhhhhhhhhhhhhhhhhhh....",
    "......hhhhhhhhhhhhhhhh......",
  ], SHIP);
}).toFile(`${OUT}/ship.png`);
console.log("sprites: gull, ship");
