// Build real PNG background assets from the self-hosted card art.
//
// Outputs (public/assets/bg/):
//   card-collage-wide.png  — 1920x640 darkened wall of real card arts (hero/login)
//   card-collage-tile.png  — 1024x1024 tileable darker wall (page backgrounds)
//
// Usage: node scripts/build-backgrounds.mjs
// Deterministic: samples evenly across the sorted card list, so reruns are stable.

import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const CARDS = path.join(ROOT, "public", "cards");
const OUT = path.join(ROOT, "public", "assets", "bg");

/** Evenly sample n items across a sorted list (stable across runs). */
function sample(list, n) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor((i * list.length) / n)]);
  return out;
}

async function collage({ file, cols, rows, cellW, aspect = 1.395, darken, offsetAlt = true, pool }) {
  const cellH = Math.round(cellW * aspect);
  const width = cols * cellW;
  const height = Math.round(rows * cellH * 0.86); // rows overlap slightly, crop bottom
  const picks = sample(pool, cols * rows);
  const composites = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = picks[r * cols + c];
      if (!id) continue;
      const img = await sharp(path.join(CARDS, id))
        .resize(cellW, cellH, { fit: "cover" })
        .toBuffer();
      // brick-lay: odd rows shift half a cell for a less grid-perfect, homemade look
      const shift = offsetAlt && r % 2 === 1 ? -Math.round(cellW / 2) : 0;
      composites.push({ input: img, left: c * cellW + shift, top: Math.round(r * cellH * 0.86) });
    }
  }
  // darken overlay so UI text stays readable on top
  const overlay = {
    input: {
      create: { width, height, channels: 4, background: { r: 4, g: 7, b: 14, alpha: darken } },
    },
    left: 0,
    top: 0,
  };
  await sharp({ create: { width, height, channels: 3, background: { r: 6, g: 10, b: 18 } } })
    .composite([...composites, overlay])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, file));
  console.log("built", file, `${width}x${height}`, `${picks.length} cards`);
}

const all = (await readdir(CARDS)).filter((f) => f.endsWith(".webp")).sort();
if (all.length === 0) throw new Error("public/cards is empty — run `npm run art` first");
await mkdir(OUT, { recursive: true });

await collage({ file: "card-collage-wide.png", cols: 12, rows: 3, cellW: 160, darken: 0.62, pool: all });
await collage({ file: "card-collage-tile.png", cols: 8, rows: 6, cellW: 128, darken: 0.8, pool: all.slice().reverse() });
console.log("done");
