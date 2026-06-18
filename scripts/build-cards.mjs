// build-cards.mjs — Build the Sailing Network card database.
//
// Source: buhbbl/punk-records (static, versioned JSON dump of the One Piece TCG,
// generated from the official onepiece-cardgame.com card list via "vegapull").
// Public domain-ish community dataset, no API key. We clone it ONCE (shallow),
// read every per-card JSON (which carries full stats + effect + official image),
// normalize to our own schema, dedupe alt-art variants down to the base print,
// and emit a single public/data/cards.json that the app fetches at runtime.
//
// Run:  npm run cards
//
// Note: this is a build-time tool, not shipped to the client. It hits the network
// exactly once (the git clone). Re-run it to refresh when new sets drop.

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/buhbbl/punk-records.git";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, "..");
const OUT = join(PROJECT, "public", "data", "cards.json");
const CLONE = join(tmpdir(), "sn-punk-records");

// --- 1. shallow clone the dataset (one network request) ----------------------
function clone() {
  if (existsSync(CLONE)) rmSync(CLONE, { recursive: true, force: true });
  console.log("Cloning card dataset (shallow)…");
  execSync(`git clone --depth 1 --filter=blob:none --no-checkout "${REPO}" "${CLONE}"`, {
    stdio: "inherit",
  });
  // sparse-checkout only the english card files (skip other languages / images dirs)
  execSync(`git -C "${CLONE}" sparse-checkout set english/cards`, { stdio: "inherit" });
  execSync(`git -C "${CLONE}" checkout`, { stdio: "inherit" });
}

// --- 2. walk every per-card JSON ---------------------------------------------
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile() && entry.name.endsWith(".json")) yield p;
  }
}

// --- helpers -----------------------------------------------------------------
// keep only base prints: ids like "OP01-001", "ST23-001", "EB01-001", "PRB02-008".
// drop alt-art / parallel variants ("OP01-001_p1", "..._r1") — same gameplay card.
const BASE_ID = /^[A-Z0-9]+-\d+$/;

// effect text carries <br> and a few inline tags + {Type} braces (kept, they're
// meaningful). Convert breaks to newlines, strip any other tags, tidy whitespace.
function cleanEffect(s) {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// --- 3. normalize ------------------------------------------------------------
function build() {
  const cardsDir = join(CLONE, "english", "cards");
  const byId = new Map();

  for (const file of walk(cardsDir)) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const id = raw.id || raw.card_id;
    if (!id || !BASE_ID.test(id)) continue; // skip variants & malformed
    if (byId.has(id)) continue; // first base print wins

    const set = id.split("-")[0]; // "OP01", "ST23", "EB01", "PRB02"
    byId.set(id, {
      id,
      name: raw.name ?? "",
      category: raw.category ?? "", // Leader | Character | Event | Stage | Don
      colors: Array.isArray(raw.colors) ? raw.colors : [],
      cost: numOrNull(raw.cost),
      power: numOrNull(raw.power),
      counter: numOrNull(raw.counter),
      types: Array.isArray(raw.types) ? raw.types : [],
      attributes: Array.isArray(raw.attributes) ? raw.attributes : [],
      effect: cleanEffect(raw.effect),
      trigger: cleanEffect(raw.trigger) || null,
      rarity: raw.rarity ?? "",
      set,
      // egmanevents serves hotlink-friendly card art (same source used in Popular
      // Decklists). The official onepiece-cardgame.com URL blocks hotlinking, so we
      // keep it only as a reference fallback.
      image: `https://deckbuilder.egmanevents.com/card_images/optcg/${id}.webp`,
      imageOfficial: raw.img_full_url ?? "",
    });
  }

  // stable sort: by set, then by the numeric part of the id
  const cards = [...byId.values()].sort((a, b) => {
    if (a.set !== b.set) return a.set < b.set ? -1 : 1;
    const na = Number(a.id.split("-")[1]);
    const nb = Number(b.id.split("-")[1]);
    return na - nb;
  });

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(cards));

  // --- report ---
  const sets = [...new Set(cards.map((c) => c.set))].sort();
  const byCat = cards.reduce((m, c) => ((m[c.category] = (m[c.category] || 0) + 1), m), {});
  console.log(`\n✅ Wrote ${cards.length} cards → ${OUT}`);
  console.log(`   ${sets.length} sets: ${sets.join(", ")}`);
  console.log(`   categories:`, byCat);
}

clone();
build();
rmSync(CLONE, { recursive: true, force: true });
