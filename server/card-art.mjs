// card-art.mjs — same-origin card art proxy with on-disk cache.
//
// Why this exists: the app used to hotlink card art straight from
// deckbuilder.egmanevents.com. That CDN now sits behind Cloudflare and returns
// an HTML block page (Content-Type: text/html + nosniff) instead of the .webp,
// so the browser refuses every image with net::ERR_BLOCKED_BY_ORB and the whole
// app shows blank cards.
//
// The fix: serve art from OUR origin. This route fetches the official art from
// en.onepiece-cardgame.com (which does serve real image/png, even cross-origin),
// caches it to server/.art-cache/<id>.png, and streams it back as image/png.
// Because the <img src> is now same-origin (/api/card-art/<id>.png, proxied to
// the backend by Vite in dev), there is no ORB, no CORS, and no hotlink issue.
// After the first view a card is served from disk — fast and offline-friendly.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".art-cache");

// Official base-print ids only: OP01-001, ST23-001, EB04-007, PRB02-008, P-001.
const ID_RE = /^[A-Z0-9]+-\d+$/;
const SOURCE = (id) => `https://en.onepiece-cardgame.com/images/cardlist/card/${id}.png`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148 Safari/537.36";

// Dedupe concurrent misses for the same id so a deck-builder grid (100+ cards)
// doesn't fire 100 identical upstream fetches before the cache warms.
const inflight = new Map();

const isPng = (buf) =>
  buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

async function fetchAndCache(id) {
  const res = await fetch(SOURCE(id), {
    headers: { "User-Agent": UA, Referer: "https://en.onepiece-cardgame.com/cardlist/" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/") || !isPng(buf)) throw new Error("upstream not an image");
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${id}.png`), buf);
  return buf;
}

async function getArt(id) {
  try {
    return await readFile(join(CACHE_DIR, `${id}.png`)); // disk cache hit
  } catch {
    /* miss → fetch below */
  }
  if (inflight.has(id)) return inflight.get(id);
  const p = fetchAndCache(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Register GET /api/card-art/:id (with or without a .png/.webp extension). */
export function registerCardArt(app) {
  app.get("/api/card-art/:id", async (req, reply) => {
    const id = String(req.params.id || "").replace(/\.(png|webp|jpe?g)$/i, "");
    if (!ID_RE.test(id)) return reply.code(400).send({ error: "bad card id" });
    try {
      const buf = await getArt(id);
      reply.header("Content-Type", "image/png");
      reply.header("Cache-Control", "public, max-age=2592000, immutable");
      return reply.send(buf);
    } catch {
      // Unknown / not-yet-released id: 404 so the <img> onError can hide it.
      return reply.code(404).send({ error: "art unavailable" });
    }
  });
}
