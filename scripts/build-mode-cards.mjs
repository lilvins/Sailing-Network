/* Build the Home "Play" mode-card backgrounds from REAL card art
   (public/cards/<id>.webp, 600x838) + the avatar fallback from the real
   night-sea moon. Deterministic; rerun with: node scripts/build-mode-cards.mjs
   Outputs PNGs into public/assets/bg/. */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = "public/assets/bg";
mkdirSync(OUT, { recursive: true });

/* Wide, bold crops of the illustration band (skips frame + text box),
   darkened for white text on top. */
const MODES = [
  // mode key, card id, crop (x,y,w,h on the 600x838 scan)
  ["board", "ST01-001", { left: 38, top: 78, width: 524, height: 310 }],
  ["lab", "OP11-041", { left: 38, top: 110, width: 524, height: 310 }],
  ["auto", "OP01-061", { left: 38, top: 72, width: 524, height: 310 }],
  ["duel", "OP09-001", { left: 38, top: 64, width: 524, height: 310 }],
];

for (const [key, id, region] of MODES) {
  await sharp(`public/cards/${id}.webp`)
    .extract(region)
    .resize(640, 380, { fit: "cover" })
    .modulate({ brightness: 0.52, saturation: 0.92 })
    .png()
    .toFile(`${OUT}/mode-${key}.png`);
  console.log(`mode-${key}.png <- ${id}`);
}

/* Section heroes: one REAL card art per section, cropped wide + darkened.
   The Home mode-cards recipe, applied to the page headers. */
const SECTIONS = [
  // key, card id, top of the crop window (x is fixed, art band is 524 wide)
  ["directory", "OP04-001", 52], // Vivi — the one who knows every captain
  ["popular", "OP03-001", 84], // Ace — fan-favorite, fiery top lists
  ["rankings", "ST02-001", 44], // Kid — bounty-hunter climb
  ["meta", "OP01-060", 42], // Doflamingo — the strings of the meta
  ["records", "OP02-001", 36], // Whitebeard — history, the old era
  ["statistics", "ST01-007", 96], // Nami — charts and navigation
  ["messages", "ST01-006", 170], // Chopper — friendly chatter
  ["friends", "ST09-001", 88], // Yamato — wants to sail with everyone
  ["decks", "ST10-001", 80], // Law — the deck strategist
  ["profile", "OP06-001", 150], // Uta — identity on stage (fallback banner)
];

for (const [key, id, top] of SECTIONS) {
  await sharp(`public/cards/${id}.webp`)
    .extract({ left: 38, top, width: 524, height: 230 })
    .resize(1200, 260, { fit: "cover" })
    .modulate({ brightness: 0.5, saturation: 0.9 })
    .png()
    .toFile(`${OUT}/sec-${key}.png`);
  console.log(`sec-${key}.png <- ${id}`);
}

/* Pixel sprites for the living night scene (drawn at native pixel size,
   upscaled by CSS with image-rendering: pixelated). */
function rawSprite(w, h, paint) {
  const buf = Buffer.alloc(w * h * 4, 0);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  paint(set);
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png();
}

// 5x5 cross star (bright ice-white)
await rawSprite(5, 5, (px) => {
  for (let i = 0; i < 5; i++) { px(2, i, 232, 246, 250); px(i, 2, 232, 246, 250); }
  px(2, 2, 255, 255, 255);
}).toFile(`${OUT}/star-a.png`);
// 3x3 diamond star (dimmer)
await rawSprite(3, 3, (px) => {
  px(1, 0, 191, 227, 232, 220); px(0, 1, 191, 227, 232, 220);
  px(2, 1, 191, 227, 232, 220); px(1, 2, 191, 227, 232, 220);
  px(1, 1, 226, 243, 246);
}).toFile(`${OUT}/star-b.png`);
// 18x3 shooting-star streak (bright head, fading tail)
await rawSprite(18, 3, (px) => {
  for (let x = 0; x < 18; x++) {
    const a = Math.round(30 + (x / 17) * 225);
    px(x, 1, 236, 248, 252, a);
  }
  px(17, 1, 255, 255, 255); px(16, 0, 220, 240, 248, 160); px(16, 2, 220, 240, 248, 160);
}).toFile(`${OUT}/star-shoot.png`);
// 2x2 sea spark / firefly
await rawSprite(2, 2, (px) => {
  px(0, 0, 159, 232, 216, 230); px(1, 0, 159, 232, 216, 150);
  px(0, 1, 159, 232, 216, 150); px(1, 1, 159, 232, 216, 90);
}).toFile(`${OUT}/spark.png`);
console.log("sprites: star-a, star-b, star-shoot, spark");

/* Avatar fallback: the real pixel-art moon (night-sea pack, 576x324 layer),
   square crop around the moon. */
await sharp("public/assets/bg/night-sea/moon.png")
  .extract({ left: 254, top: 30, width: 88, height: 88 })
  .flatten({ background: "#0b0c0e" }) // solid night behind the transparent layer
  .resize(176, 176, { kernel: "nearest" }) // keep the pixel look
  .png()
  .toFile(`${OUT}/avatar-moon.png`);
console.log("avatar-moon.png <- night-sea/moon.png");
