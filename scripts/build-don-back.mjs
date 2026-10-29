// build-don-back.mjs — public/cards/BACK-don.webp, the white back of the DON!! cards.
//
// The real game uses one back design in three colours: blue (main deck), red
// (Leader, BACK-leader.webp) and white (DON!!). There is no clean official scan
// of the white one, so it is derived from the official blue scan (BACK.webp)
// pixel by pixel: the blue field becomes white, the white logo becomes navy so
// it stays readable on white, the gold compass and lines stay gold.
//   node scripts/build-don-back.mjs
import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CARDS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "cards");
const PAPER = [246, 245, 241];   // the white of the card
const EDGE = [214, 214, 210];    // the darker border around the field
const INK = [28, 36, 70];        // the logo, printed dark on the white back

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// The scan is small and upscaled, so the colours are soft: each pixel is split
// into "how gold" (warm and bright) and "how logo" (bright, neutral or bluish);
// whatever is left is the dark blue field, which becomes paper.
function recolour(r, g, b, onBorder) {
  const lum = (r + g + b) / 3;
  const gold = clamp01((r - b - 10) / 35) * clamp01((lum - 50) / 50);
  const logo = clamp01((lum - 110) / 90) * (1 - gold);
  const field = onBorder ? EDGE : PAPER;
  const out = mix(mix(field, [r, g, b], gold), INK, logo);
  return out.map((v) => Math.round(v));
}

// the dark frame of the scan, in pixels of the 600×840 image
const FRAME = 24;

const { data, info } = await sharp(join(CARDS, "BACK.webp")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 3) {
  const x = (i / 3) % info.width, y = Math.floor(i / 3 / info.width);
  const onBorder = x < FRAME || y < FRAME || x >= info.width - FRAME || y >= info.height - FRAME;
  const [r, g, b] = recolour(data[i], data[i + 1], data[i + 2], onBorder);
  data[i] = r; data[i + 1] = g; data[i + 2] = b;
}
await sharp(data, { raw: info }).webp({ quality: 90 }).toFile(join(CARDS, "BACK-don.webp"));
console.log(`BACK-don.webp ${info.width}×${info.height} written to ${CARDS}`);
