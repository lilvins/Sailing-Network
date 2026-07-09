// download-art.mjs — self-host every card image.
//
// Downloads each card's art from dotgg.gg
// (https://static.dotgg.gg/onepiece/card/<id>.webp) and writes it to
// public/cards/<id>.webp. Vite serves that statically at /cards/<id>.webp, so at
// runtime the app depends on NObody else's CDN — the art is ours.
//
// Why dotgg: it serves clean .webp (no "SAMPLE" watermark, unlike the official
// Bandai cardlist images), with the correct image/webp content-type (so no
// ERR_BLOCKED_BY_ORB). egmanevents' old hotlinks are Cloudflare-blocked now.
// Source is already webp → we save the bytes as-is (no re-encode).
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CARDS_JSON = join(ROOT, "public", "data", "cards.json");
const OUT_DIR = join(ROOT, "public", "cards");

const SOURCE = (id) => `https://static.dotgg.gg/onepiece/card/${id}.webp`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148 Safari/537.36";
const CONCURRENCY = 10;

const exists = (p) => access(p).then(() => true).catch(() => false);
// RIFF....WEBP magic: 'RIFF' at 0-3, 'WEBP' at 8-11.
const isWebp = (b) =>
  b.length > 12 &&
  b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
  b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;

async function fetchOne(id) {
  const out = join(OUT_DIR, `${id}.webp`);
  if (await exists(out)) return "skip";
  const res = await fetch(SOURCE(id), {
    headers: { "User-Agent": UA, Referer: "https://onepiece.dotgg.gg/" },
  });
  if (!res.ok) return `miss(${res.status})`;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isWebp(buf)) return "miss(notwebp)";
  await writeFile(out, buf);
  return "ok";
}

async function main() {
  const cards = JSON.parse(await readFile(CARDS_JSON, "utf8"));
  const ids = cards.map((c) => c.id);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Downloading art for ${ids.length} cards → public/cards/ (dotgg webp)…`);
  let ok = 0, skip = 0, done = 0;
  const failed = [];

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
