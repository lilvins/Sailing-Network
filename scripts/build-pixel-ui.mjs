/* Build the site's pixel UI pieces from Pixel Frog's "Treasure Hunters"
   (CC0, https://pixelfrog-assets.itch.io/treasure-hunters):
   - 9-slice frames (wood board, paper) assembled
     from the pack's numbered tiles (1..9 = top-left .. bottom-right);
   - horizontal sprite sheets for the idle animations used in empty states.
   Usage: node scripts/build-pixel-ui.mjs "<path to the extracted Treasure Hunters folder>"
   Outputs PNGs into public/assets/ui/. */
import sharp from "sharp";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2];
if (!SRC) throw new Error("pass the extracted 'Treasure Hunters' folder");
const OUT = "public/assets/ui";
mkdirSync(OUT, { recursive: true });

const UI = join(SRC, "Wood and Paper UI", "Sprites");

/** 3x3 tiles (files 1..9) of one UI piece → one 9-slice image. */
async function nineSlice(folder, out) {
  const first = await sharp(join(UI, folder, "1.png")).metadata();
  const t = first.width;
  const tiles = [];
  for (let i = 0; i < 9; i++) {
    tiles.push({ input: join(UI, folder, `${i + 1}.png`), left: (i % 3) * t, top: Math.floor(i / 3) * t });
  }
  const assembled = await sharp({ create: { width: t * 3, height: t * 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).png().toBuffer();
  // the tiles carry a transparent margin: trim it so the frame meets the element's edge
  const info = await sharp(assembled).trim().png().toFile(join(OUT, out));
  console.log(`${out} <- ${folder} (${t}px tiles, ${info.width}x${info.height} trimmed)`);
}

/** Frames of an animation folder, sorted by name → one horizontal strip.
 *  Read by Node, not by libvips: the pack's nested paths pass Windows' 260-char limit. */
async function strip(folder, out) {
  const files = readdirSync(folder).filter((f) => f.endsWith(".png")).sort();
  const frames = files.map((f) => readFileSync(join(folder, f)));
  const meta = await sharp(frames[0]).metadata();
  await sharp({ create: { width: meta.width * files.length, height: meta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((input, i) => ({ input, left: i * meta.width, top: 0 })))
    .png().toFile(join(OUT, out));
  console.log(`${out} <- ${files.length} frames of ${meta.width}x${meta.height}`);
}

await nineSlice("Yellow Board", "board.png");
await nineSlice("Yellow Paper", "paper.png");
await strip(join(SRC, "Captain Clown Nose", "Sprites", "Captain Clown Nose", "Captain Clown Nose without Sword", "01-Idle"), "captain-idle.png");
await strip(join(SRC, "The Crusty Crew", "Sprites", "Crabby", "01-Idle"), "crabby-idle.png");
