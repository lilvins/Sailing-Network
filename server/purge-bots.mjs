// purge-bots.mjs — removes every bot account and all it did (decks, sessions,
// match rows, presence, chat), and takes the bots' games out of the ladder.
// Rows of real accounts stay. Stop bots:run first.
//
//   npm run bots:purge           (shows what would go)
//   npm run bots:purge -- --yes  (does it)

import { all, get, initDb, run } from "./db.mjs";

await initDb();

const count = async (sql) => Number((await get(sql)).c);
const BOTS = `(SELECT id FROM users WHERE is_bot=1)`;
const n = {
  accounts: await count(`SELECT COUNT(*) AS c FROM users WHERE is_bot=1`),
  decks: await count(`SELECT COUNT(*) AS c FROM decks WHERE user_id IN ${BOTS}`),
  matchRows: await count(`SELECT COUNT(*) AS c FROM matches WHERE user_id IN ${BOTS}`),
};
console.log(n);
for (const u of await all(`SELECT username FROM users WHERE is_bot=1 ORDER BY username`)) console.log(`  ${u.username}`);

if (!process.argv.includes("--yes")) {
  console.log("Nothing deleted. Add --yes to delete.");
  process.exit(0);
}
await run(`DELETE FROM users WHERE is_bot=1`); // the foreign keys cascade to the rest
console.log(`Deleted. Bot accounts left: ${await count(`SELECT COUNT(*) AS c FROM users WHERE is_bot=1`)}`);
process.exit(0);
