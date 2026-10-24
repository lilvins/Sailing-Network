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

/* Avatar fallback: the real pixel-art moon (night-sea pack, 576x324 layer),
   square crop around the moon. */
await sharp("public/assets/bg/night-sea/moon.png")
  .extract({ left: 254, top: 30, width: 88, height: 88 })
  .flatten({ background: "#0b0c0e" }) // solid night behind the transparent layer
  .resize(176, 176, { kernel: "nearest" }) // keep the pixel look
  .png()
  .toFile(`${OUT}/avatar-moon.png`);
console.log("avatar-moon.png <- night-sea/moon.png");
