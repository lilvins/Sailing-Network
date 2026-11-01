/* Build the site's pixel UI pieces from Pixel Frog's "Treasure Hunters"
   (CC0, https://pixelfrog-assets.itch.io/treasure-hunters):
   - 9-slice frames assembled from the pack's numbered tiles: the wood board
     and the paper (tiles 1..9), the green and gold buttons (tiles 8..16,
     the full-size button; 1..7 are the small ones);
   - the board's inside texture (its centre tile) to repeat inside windows;
   - horizontal sprite sheets for the idle animations used in empty states,
     and the props that mark each kind of page (chest, flag, helm, candle).
   Usage: node scripts/build-pixel-ui.mjs "<path to the extracted Treasure Hunters folder>"
   Outputs PNGs into public/assets/ui/. */
import sharp from "sharp";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2];
if (!SRC) throw new Error("pass the extracted 'Treasure Hunters' folder");
const OUT = "public/assets/ui";
mkdirSync(OUT, { recursive: true });

const UI = join(SRC, "Wood and Paper UI", "Sprites");
const NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 3x3 tiles (top-left .. bottom-right) of one UI piece → one 9-slice image. */
async function nineSlice(folder, out, numbers = NINE) {
  const first = await sharp(join(UI, folder, `${numbers[0]}.png`)).metadata();
  const t = first.width;
  const tiles = numbers.map((n, i) => ({ input: join(UI, folder, `${n}.png`), left: (i % 3) * t, top: Math.floor(i / 3) * t }));
  const assembled = await sharp({ create: { width: t * 3, height: t * 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).png().toBuffer();
  // the tiles carry a transparent margin: trim it so the frame meets the element's edge
  const info = await sharp(assembled).trim().png().toFile(join(OUT, out));
  console.log(`${out} <- ${folder} (${t}px tiles, ${info.width}x${info.height} trimmed)`);
}

/** Frames of an animation folder, sorted by name → one horizontal strip.
 *  Read by Node, not by libvips: the pack's nested paths pass Windows' 260-char limit. */
async function strip(folder, out, prefix = "") {
  const files = readdirSync(folder).filter((f) => f.endsWith(".png") && f.startsWith(prefix)).sort();
  const frames = files.map((f) => readFileSync(join(folder, f)));
  const meta = await sharp(frames[0]).metadata();
  await sharp({ create: { width: meta.width * files.length, height: meta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((input, i) => ({ input, left: i * meta.width, top: 0 })))
    .png().toFile(join(OUT, out));
  console.log(`${out} <- ${files.length} frames of ${meta.width}x${meta.height}`);
}

await nineSlice("Yellow Board", "board.png");
await nineSlice("Yellow Paper", "paper.png");
await nineSlice("Green Button", "button-green.png", [8, 9, 10, 11, 12, 13, 14, 15, 16]);
await nineSlice("Yellow Button", "button-gold.png", [8, 9, 10, 11, 12, 13, 14, 15, 16]);
copyFileSync(join(UI, "Yellow Board", "5.png"), join(OUT, "board-fill.png"));
console.log("board-fill.png <- Yellow Board/5 (inside texture)");
await strip(join(SRC, "Captain Clown Nose", "Sprites", "Captain Clown Nose", "Captain Clown Nose without Sword", "01-Idle"), "captain-idle.png");
await strip(join(SRC, "The Crusty Crew", "Sprites", "Crabby", "01-Idle"), "crabby-idle.png");
// one prop per kind of page, next to its title: the art says what the page is for
await strip(join(SRC, "Palm Tree Island", "Sprites", "Objects", "Chest"), "prop-chest.png", "Chest Close");      // your decks: the treasure
await strip(join(SRC, "Palm Tree Island", "Sprites", "Objects", "Flag"), "prop-flag.png", "Flag");               // competition: the colours
await strip(join(SRC, "Palm Tree Island", "Sprites", "Objects", "Ship Helm"), "prop-helm.png", "Ship Helm Idle"); // the voyage: play
await strip(join(SRC, "Pirate Ship", "Sprites", "Decorations", "Candle", "Candle"), "prop-candle.png");    // the crew: the tavern light

/* The pack has no red button and red is the site's colour for the primary
   action: the green one recoloured shade for shade (outline kept). */
const GREEN_TO_RED = new Map([
  ["99,157,109", [214, 58, 44]],   // face
  ["122,177,122", [238, 104, 80]], // highlight
  ["64,119,105", [158, 36, 34]],   // shade
  ["49,91,93", [108, 26, 32]],     // deep shade
]);
{
  const { data, info } = await sharp(join(OUT, "button-green.png")).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const to = GREEN_TO_RED.get(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    if (to) [data[i], data[i + 1], data[i + 2]] = to;
  }
  await sharp(data, { raw: info }).png().toFile(join(OUT, "button-red.png"));
  console.log("button-red.png <- button-green.png recoloured");
}
