/* The Home backdrop: one calm night-blue colour with a pixel wave pattern.
     node scripts/build-home-pattern.mjs
   Drawn here pixel by pixel (project-original). Outputs into
   public/assets/bg/home-pattern/:
     tile.png   24×24 repeating tile — two small waves and two specks on a
                transparent ground (the colour comes from CSS), scaled ×3
     boat.png   9×8 little sailboat that drifts across the page
   The twinkling stars (star-a/b.png) and the gulls (fx/gull.png) are reused. */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = "public/assets/bg/home-pattern";
mkdirSync(OUT, { recursive: true });

async function sprite(file, art, palette) {
  const w = art[0].length, h = art.length;
  const buf = Buffer.alloc(w * h * 4);
  art.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = palette[ch];
    if (!c) return;
    const i = (y * w + x) * 4;
    [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]] = c;
  }));
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`${OUT}/${file}`);
}

// waves a shade lighter than the page colour (#101b36), specks fainter still
const TILE = { w: [36, 56, 104, 255], d: [28, 42, 80, 255] };
await sprite("tile.png", [
  "........................",
  "........................",
  "........................",
  "...##...................",
  "..#..##.................",
  "........................",
  "........................",
  "........................",
  "...............d........",
  "........................",
  "........................",
  "........................",
  "........................",
  "........................",
  "........................",
  "...............##.......",
  "..............#..##.....",
  "........................",
  "........................",
  "........................",
  "...d....................",
  "........................",
  "........................",
  "........................",
].map((r) => r.replaceAll("#", "w")), TILE);

const BOAT = {
  s: [232, 224, 200, 255], S: [180, 172, 150, 255], m: [70, 46, 30, 255],
  h: [120, 74, 40, 255], H: [86, 52, 28, 255], f: [208, 48, 42, 255],
};
await sprite("boat.png", [
  "....f....",
  "....ms...",
  "...Sms...",
  "..SSmss..",
  ".SSSmsss.",
  "....m....",
  "hhhhhhhhh",
  ".HHHHHHH.",
], BOAT);
console.log(`home pattern -> ${OUT}/ (tile, boat)`);
