// seed-bots.mjs — creates the AI accounts of the bot ladder (scripts/bot-ladder),
// each with real meta decklists. They start with no games: their stats come only
// from games they really play. Idempotent: an existing account is left alone.
//
//   npm run bots:seed
//
// Marked users.is_bot=1, so `npm run bots:purge` can remove them all. The password
// is random and thrown away: nobody can log in as a bot. Emails are on
// sailing.local, which reaches nobody.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { initDb, run } from "./db.mjs";
import { createUser, getUserByUsername, hashPassword } from "./auth.mjs";
import { createDeck, listDecks, updateProfile } from "./store.mjs";

await initDb();

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const accounts = read("../scripts/bot-ladder/accounts.json");
const cfg = read("../scripts/bot-ladder/tuning.json");
const metaDecks = read("../public/data/meta-decks.json").decks;
const cards = read("../public/data/cards.json");
const colorOf = new Map(cards.map((c) => [c.id, c.colors?.[0]]));
const COLOR = { Red: "#c0392b", Green: "#1f8a5b", Blue: "#2a6fdb", Purple: "#7a3fa0", Black: "#2c3138", Yellow: "#caa023" };

const rnd = (n) => Math.floor(Math.random() * n);
const [minDecks, maxDecks] = cfg.decksPerBot;

let created = 0;
for (const a of accounts) {
  let u = await getUserByUsername(a.username);
  if (u && !u.is_bot) { console.log(`skip ${a.username}: taken by a real account`); continue; }
  if (!u) {
    u = await createUser({
      email: `${a.username}@bots.sailing.local`, username: a.username,
      password_hash: await hashPassword(randomBytes(32).toString("hex")), display_name: a.displayName,
    });
    await run(`UPDATE users SET is_bot=1 WHERE id=?`, [u.id]);
    created++;
  }
  if ((await listDecks(u.id)).length) continue;

  const pool = [...metaDecks];
  const n = minDecks + rnd(maxDecks - minDecks + 1);
  let favorite = null;
  for (let k = 0; k < n; k++) {
    const d = pool.splice(rnd(pool.length), 1)[0];
    favorite ??= d.leaderId;
    await createDeck(u.id, {
      name: d.leaderName, leaderId: d.leaderId, leaderName: d.leaderName, cards: d.cards,
      format: d.format || "", source: d.event || "", fav: k === 0, wins: 0, losses: 0,
    });
  }
  await updateProfile(u.id, { country: a.country, favorite_leader: favorite, avatar_color: COLOR[colorOf.get(favorite)] || "#7a3030" });
}
console.log(`${created} new bot account(s), ${accounts.length} in the list.`);
process.exit(0);
