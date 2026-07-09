// download-art.mjs — self-host every card image.
//
// Downloads each card's art from the official source
// (en.onepiece-cardgame.com/images/cardlist/card/<id>.png), transcodes it to a
// light webp with sharp, and writes it to public/cards/<id>.webp. Vite serves
// that statically at /cards/<id>.webp, so at runtime the app depends on NObody
// else's CDN — the art is ours. (egmanevents' hotlinks are Cloudflare-blocked;
// this is what replaces them.)
//
// Run:  npm run art
//
// Idempotent: existing files are skipped, so re-running only fetches new/missing
// cards (e.g. after `npm run cards` adds a set). public/cards/ is gitignored —
// it's a rebuildable asset cache, like node_modules.
//
// Note: card art is © Bandai/Shueisha/Oda — fine for a personal/fan tool; revisit
// before any public or commercial release.

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CARDS_JSON = join(ROOT, "public", "data", "cards.json");
const OUT_DIR = join(ROOT, "public", "cards");

const SOURCE = (id) => `https://en.onepiece-cardgame.com/images/cardlist/card/${id}.png`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148 Safari/537.36";
const CONCURRENCY = 10;
const WEBP_QUALITY = 82;

const exists = (p) => access(p).then(() => true).catch(() => false);
const isPng = (buf) =>
  buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

async function fetchOne(id) {
  const out = join(OUT_DIR, `${id}.webp`);
  if (await exists(out)) return "skip";
  const res = await fetch(SOURCE(id), {
    headers: { "User-Agent": UA, Referer: "https://en.onepiece-cardgame.com/cardlist/" },
  });
  if (!res.ok) return `miss(${res.status})`;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isPng(buf)) return "miss(notpng)";
  const webp = await sharp(buf).webp({ quality: WEBP_QUALITY }).toBuffer();
  await writeFile(out, webp);
  return "ok";
}

async function main() {
  const cards = JSON.parse(await readFile(CARDS_JSON, "utf8"));
  const ids = cards.map((c) => c.id);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Downloading art for ${ids.length} cards → public/cards/ (webp q${WEBP_QUALITY})…`);
  let ok = 0, skip = 0, done = 0;
  const failed = [];

  // simple fixed-size worker pool over the id list
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const r = await fetchOne(id);
        if (r === "ok") ok++;
        else if (r === "skip") skip++;
        else failed.push(`${id} ${r}`);
      } catch (e) {
        failed.push(`${id} ERR ${String(e).slice(0, 80)}`);
      }
      if (++done % 200 === 0 || done === ids.length) {
        console.log(`  ${done}/${ids.length}  (ok ${ok}, skipped ${skip}, failed ${failed.length})`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n✅ Done. downloaded ${ok}, skipped ${skip}, failed ${failed.length}`);
  if (failed.length) {
    console.log("   failures (first 40):");
    failed.slice(0, 40).forEach((f) => console.log("   - " + f));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
