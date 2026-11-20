// engine.mjs — the rules engine, loaded by the server (see engineBuild.mjs).
//
// The server plays ranked games itself: every move goes through the same
// engine the browsers run, so an illegal move is refused and the winner is
// the server's word, not a player's.
//
// In production the bundle made by `npm run build` is loaded. Anywhere else it
// is built now, from the sources of this checkout, so the server and the page
// Vite serves always run the same rules.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { all } from "./db.mjs";
import { BUILT_ENGINE, buildEngine } from "./engineBuild.mjs";

let loading = null;

async function load() {
  const isProd = process.env.NODE_ENV === "production";
  let file = isProd && existsSync(BUILT_ENGINE) ? BUILT_ENGINE : null;
  if (!file) {
    try {
      file = await buildEngine(join(mkdtempSync(join(tmpdir(), "sn-engine-")), "engine.mjs"));
    } catch (err) {
      if (!existsSync(BUILT_ENGINE)) throw new Error(`The rules engine is not built (run "npm run build"): ${err.message}`);
      file = BUILT_ENGINE; // no esbuild here, but a build is at hand
    }
  }
  return import(pathToFileURL(file).href);
}

/** The engine: everything src/autosim/serverEngine.ts exports (createGame, applyIntent, makeCardDb, and a
 *  player's view of a game). Loaded once; a failed load is tried again. */
export function loadEngine() {
  loading ??= load().catch((err) => { loading = null; throw err; });
  return loading;
}

const rowToCard = (r) => ({
  id: r.id, name: r.name, category: r.category,
  colors: JSON.parse(r.colors || "[]"), cost: r.cost, power: r.power, counter: r.counter,
  types: JSON.parse(r.types || "[]"), attributes: JSON.parse(r.attributes || "[]"),
  effect: r.effect, trigger: r.trigger, rarity: r.rarity, set: r.set_code,
});

let catalog = null; // { count, db }

/** The engine's card database over the catalog in the `cards` table (the one /api/cards sends). */
export async function cardDb() {
  const { makeCardDb } = await loadEngine();
  const rows = await all(`SELECT * FROM cards`);
  if (!catalog || catalog.count !== rows.length) {
    catalog = { count: rows.length, db: makeCardDb(new Map(rows.map((r) => [r.id, rowToCard(r)]))) };
  }
  return catalog.db;
}

/** The main deck of a saved deck row, one id per copy. */
export const mainOf = (deck) => JSON.parse(deck.cards || "[]").flatMap((c) => Array(Number(c.count) || 0).fill(c.id));

/** Why a saved deck cannot be played, by the engine's own deck rules; null when it can. */
export async function deckProblem(deck) {
  const { createGame } = await loadEngine();
  const db = await cardDb();
  if (!deck?.leader_id) return "The deck has no Leader";
  try {
    const player = (id) => ({ id, leader: deck.leader_id, deck: mainOf(deck) });
    createGame(db, { seed: "check", firstPlayer: "seatA", players: [player("seatA"), player("seatB")] });
    return null;
  } catch (err) {
    return String(err.message ?? err).replace(/^seat[AB]: /, "");
  }
}
