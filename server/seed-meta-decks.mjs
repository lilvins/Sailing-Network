// seed-meta-decks.mjs — give the test account ("captain") one deck per current
// meta Leader, from public/data/meta-decks.json (`npm run fetch:meta`).
//
//   npm run seed:meta
//
// Idempotent: a deck is matched by its source tag "meta:<LeaderId>"; when the
// meta file has a newer list for that Leader the deck is updated in place
// (same id, so games and records keep pointing at it). Other decks are untouched.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initDb } from "./db.mjs";
import { getUserByUsername } from "./auth.mjs";
import { createDeck, listDecks, updateDeck } from "./store.mjs";

await initDb();

const __dirname = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(__dirname, "..", "public", "data", "meta-decks.json"), "utf8"));
const user = await getUserByUsername("captain");
if (!user) {
  console.error('No "captain" account: run `npm run seed:demo` first.');
  process.exit(1);
}

const existing = new Map((await listDecks(user.id)).filter((d) => d.source?.startsWith("meta:")).map((d) => [d.source.split(" ")[0], d]));
let created = 0, updated = 0;
for (const d of meta.decks) {
  const tag = `meta:${d.leaderId}`;
  const name = `${d.leaderName} ${d.leaderId} — ${d.placement}° ${d.event}`;
  const source = `${tag} ${d.event} (${d.format}, ${d.date}, ${d.player})`;
  const prev = existing.get(tag);
  if (!prev) {
    await createDeck(user.id, { name, leaderId: d.leaderId, leaderName: d.leaderName, cards: d.cards, format: meta.setGroup, source });
    created++;
  } else if (prev.source !== source || prev.name !== name) {
    await updateDeck(prev.id, { name, cards: d.cards, format: meta.setGroup, source });
    updated++;
  }
}
console.log(`captain: ${created} meta decks created, ${updated} updated, ${meta.decks.length - created - updated} already current.`);
