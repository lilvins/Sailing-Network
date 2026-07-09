// seed-cards.mjs — import the static card catalog into the SQLite `cards` table.
//
// Source: public/data/cards.json (built from the punk-records community dataset
// by `npm run cards`). This is our own DB of record at runtime; the JSON is the
// versioned seed input. Re-run after `npm run cards` to refresh.
//
// Run:  npm run seed:cards
//
// Idempotent: upserts by id, so re-running updates existing rows and adds new
// sets without duplicating. The art path is stored as our self-hosted webp
// (/cards/<id>.webp); the official url is kept in image_official for reference.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import db, { initDb } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_JSON = join(__dirname, "..", "public", "data", "cards.json");

const j = (v) => JSON.stringify(Array.isArray(v) ? v : []);
const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

async function main() {
  await initDb();

  const cards = JSON.parse(readFileSync(CARDS_JSON, "utf8"));
  if (!Array.isArray(cards) || !cards.length) {
    throw new Error(`No cards found in ${CARDS_JSON} — run \`npm run cards\` first.`);
  }

  const stmts = cards.map((c) => ({
    sql: `INSERT INTO cards
            (id, name, category, colors, cost, power, counter, types, attributes,
             effect, trigger, rarity, set_code, image, image_official)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, category=excluded.category, colors=excluded.colors,
            cost=excluded.cost, power=excluded.power, counter=excluded.counter,
            types=excluded.types, attributes=excluded.attributes, effect=excluded.effect,
            trigger=excluded.trigger, rarity=excluded.rarity, set_code=excluded.set_code,
            image=excluded.image, image_official=excluded.image_official`,
    args: [
      c.id,
      c.name ?? "",
      c.category ?? "",
      j(c.colors),
      numOrNull(c.cost),
      numOrNull(c.power),
      numOrNull(c.counter),
      j(c.types),
      j(c.attributes),
      c.effect ?? "",
      c.trigger ?? null,
      c.rarity ?? "",
      c.set ?? "",
      `/cards/${c.id}.webp`,
      c.imageOfficial ?? "",
    ],
  }));

  // One transactional batch — fast and all-or-nothing.
  await db.batch(stmts, "write");

  const { rows } = await db.execute(`SELECT COUNT(*) AS c FROM cards`);
  const sets = (await db.execute(`SELECT DISTINCT set_code FROM cards ORDER BY set_code`)).rows.map(
    (r) => r.set_code
  );
  console.log(`✅ Seeded ${cards.length} cards → cards table (${rows[0].c} rows total)`);
  console.log(`   ${sets.length} sets: ${sets.join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
