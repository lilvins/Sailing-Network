// card-art.mjs — same-origin card art proxy with on-disk cache (fallback).
//
// The app normally serves art from self-hosted files (public/cards/<id>.webp,
// populated by `npm run art`). This route is the on-demand fallback for ids that
// haven't been downloaded yet (e.g. a brand-new set before `npm run art` re-runs).
//
// It fetches from dotgg.gg (clean webp, correct image/webp content-type, no
// "SAMPLE" watermark), caches to server/.art-cache/<id>.webp, and streams it back.
// Same-origin (/api/card-art/<id>, proxied to the backend by Vite in dev) → no
// ORB, no CORS, no hotlink issue. (egmanevents' old CDN is Cloudflare-blocked.)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".art-cache");

// Base-print ids only: OP01-001, ST23-001, EB04-007, PRB02-008, P-001.
const ID_RE = /^[A-Z0-9]+-\d+$/;
const SOURCE = (id) => `https://static.dotgg.gg/onepiece/card/${id}.webp`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148 Safari/537.36";

// Dedupe concurrent misses for the same id so a deck-builder grid (100+ cards)
// doesn't fire 100 identical upstream fetches before the cache warms.
const inflight = new Map();

// RIFF....WEBP magic.
const isWebp = (b) =>
  b.length > 12 &&
  b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
  b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;

async function fetchAndCache(id) {
  const res = await fetch(SOURCE(id), {
    headers: { "User-Agent": UA, Referer: "https://onepiece.dotgg.gg/" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isWebp(buf)) throw new Error("upstream not a webp");
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${id}.webp`), buf);
  return buf;
}

async function getArt(id) {
  try {
    return await readFile(join(CACHE_DIR, `${id}.webp`)); // disk cache hit
  } catch {
    /* miss → fetch below */
  }
  if (inflight.has(id)) return inflight.get(id);
  const p = fetchAndCache(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Register GET /api/card-art/:id (with or without a .webp/.png extension). */
export function registerCardArt(app) {
  app.get("/api/card-art/:id", async (req, reply) => {
    const id = String(req.params.id || "").replace(/\.(png|webp|jpe?g)$/i, "");
    if (!ID_RE.test(id)) return reply.code(400).send({ error: "bad card id" });
    try {
      const buf = await getArt(id);
      reply.header("Content-Type", "image/webp");
      reply.header("Cache-Control", "public, max-age=2592000, immutable");
      return reply.send(buf);
    } catch {
      // Unknown / not-yet-released id: 404 so the <img> onError can hide it.
      return reply.code(404).send({ error: "art unavailable" });
    }
  });
}
