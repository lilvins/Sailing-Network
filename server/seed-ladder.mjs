// seed-ladder.mjs — fill the ladder with demo data so the leaderboard, profiles
// and meta pages have something to show: ~40 extra demo captains (each with
// real decklists from popular.json) and ~60 days of games between everyone.
//
//   npm run seed:ladder        (run seed:demo first)
//
// Games are made up: every captain has a hidden skill, every leader a small
// hidden strength, and the result is drawn from those. Each game is stored as
// two `matches` rows (one per player), like a real game would be.
// Idempotent: does nothing if the last 60 days already hold 1000+ rows.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initDb, all, run } from "./db.mjs";
import { hashPassword, createUser, getUserByUsername } from "./auth.mjs";
import { updateProfile, createDeck, listDecks, createMatchesBatch } from "./store.mjs";

await initDb();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PASSWORD = "captain123";
const DAY = 24 * 60 * 60 * 1000;
const DAYS = 60;
const GAMES = 3200;

// small seeded RNG so two runs on two PCs make the same ladder
let seed = 20261030;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const rnd = (n) => Math.floor(rand() * n);
const pick = (arr) => arr[rnd(arr.length)];
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

const recent = (await all(`SELECT COUNT(*) AS c FROM matches WHERE created_at >= ?`, [Date.now() - DAYS * DAY]))[0];
if (Number(recent.c) >= 1000) {
  console.log(`Ladder already seeded (${recent.c} rows in the last ${DAYS} days). Nothing to do.`);
  process.exit(0);
}

// --- decklists (same source as seed:demo) ---
const popular = JSON.parse(readFileSync(join(__dirname, "..", "public", "data", "popular.json"), "utf8"));
const lists = [];
for (const reg of popular.regionals || []) {
  const fmt = (reg.name.match(/\[([^\]]+)\]/) || [])[1] || "";
  for (const d of reg.decks || []) {
    if (!d.leaderId) continue;
    lists.push({ leaderId: d.leaderId, leaderName: d.leaderName || "", cards: (d.cards || []).map((c) => ({ id: c.id, count: c.count })), format: fmt, source: reg.name });
  }
}
// keep the ~12 most common leaders so the meta has real sample sizes
const freq = new Map();
for (const l of lists) freq.set(l.leaderId, (freq.get(l.leaderId) || 0) + 1);
const metaLeaders = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id);
const pool = lists.filter((l) => metaLeaders.includes(l.leaderId));
console.log(`Using ${pool.length} decklists over ${metaLeaders.length} leaders.`);

const COUNTRIES = ["IT", "IT", "IT", "FR", "ES", "DE", "GB", "US", "US", "BR", "JP", "MX", "NL", "PT", "PL", "CA", "AU"];
const HANDLES = [
  "gomu_gear5", "pirate_hunter", "black_leg", "sniper_king", "cyborg_fr", "soul_king", "knight_sea", "devil_child",
  "fire_fist", "dragon_rev", "red_force", "dark_king", "hawkeye", "pirate_empress", "sand_croc", "heavenly_yaksha",
  "ice_pheasant", "red_dog", "kizaru_light", "fleet_admiral", "eustass_cap", "massacre", "surgeon_death", "jewelry_b",
  "big_news", "pink_bonney", "basil_luck", "magician_x", "scratchmen", "drake_x", "bege_castle", "urouge_monk",
  "smoker_white", "tashigi_blade", "coby_hero", "helmeppo", "vivi_alabasta", "carrot_moon", "yamato_oden", "kinemon_fox",
];
const COLORS = ["#c0392b", "#2a6fdb", "#1f8a5b", "#caa023", "#7a3fa0", "#2c3138"];

// --- extra captains ---
const hash = await hashPassword(PASSWORD);
let created = 0;
for (const h of HANDLES) {
  let u = await getUserByUsername(h);
  if (!u) {
    u = await createUser({ email: `${h}@sailing.local`, username: h, password_hash: hash, display_name: h.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) });
    created++;
  }
  if ((await listDecks(u.id)).length === 0) {
    const n = 1 + rnd(2);
    for (let k = 0; k < n; k++) {
      const src = pick(pool);
      await createDeck(u.id, { name: `${src.leaderName} (${src.format})`, leaderId: src.leaderId, leaderName: src.leaderName, cards: src.cards, format: src.format, source: src.source, fav: k === 0, wins: 0, losses: 0 });
    }
  }
}
console.log(`${created} new demo captain(s).`);

// --- everyone who takes part: demo captains from seed:demo + the ones above ---
const DEMO = ["redhaired_saki", "navigator_mika", "wano_ren", "bigmom_tomo", "shadow_kai", "baroque_lia", "captain", ...HANDLES];
const players = [];
for (const name of DEMO) {
  const u = await getUserByUsername(name);
  if (!u) continue;
  const decks = (await listDecks(u.id)).filter((d) => d.leader_id);
  if (!decks.length) continue;
  const prof = (await all(`SELECT country, favorite_leader FROM profiles WHERE user_id=?`, [u.id]))[0];
  const fields = {};
  if (!prof?.country) fields.country = name === "captain" ? "IT" : pick(COUNTRIES);
  if (!prof?.favorite_leader) fields.favorite_leader = decks[0].leader_id;
  if (!prof) fields.avatar_color = pick(COLORS);
  if (Object.keys(fields).length) await updateProfile(u.id, fields);
  players.push({ id: u.id, decks, skill: gauss() * 0.55, activity: 0.3 + rand() * 1.7 });
}
console.log(`${players.length} captains on the ladder.`);

// hidden leader strength + a few matchups that are clearly lopsided
const strength = new Map(metaLeaders.map((id) => [id, gauss() * 0.18]));
const lopsided = new Map();
for (let i = 0; i < 10; i++) lopsided.set(`${pick(metaLeaders)}|${pick(metaLeaders)}`, (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.3));
const edge = (a, b) => (strength.get(a) ?? 0) - (strength.get(b) ?? 0) + (lopsided.get(`${a}|${b}`) ?? 0) - (lopsided.get(`${b}|${a}`) ?? 0);

const weighted = [];
for (const p of players) for (let k = 0; k < Math.round(p.activity * 10); k++) weighted.push(p);

const now = Date.now();
const rows = [];
for (let i = 0; i < GAMES; i++) {
  const a = pick(weighted);
  let b = pick(weighted);
  while (b.id === a.id) b = pick(weighted);
  const da = pick(a.decks);
  const db = pick(b.decks);
  const aFirst = rand() < 0.5;
  const x = a.skill - b.skill + edge(da.leader_id, db.leader_id) + (aFirst ? 0.08 : -0.08);
  const aWins = rand() < 1 / (1 + Math.exp(-x));
  const createdAt = now - Math.floor(rand() ** 0.8 * DAYS * DAY); // a bit busier lately
  const base = { format: da.format || "", createdAt };
  rows.push({ ...base, userId: a.id, oppUserId: b.id, myDeckId: da.id, myLeaderId: da.leader_id, oppLeaderId: db.leader_id, result: aWins ? "win" : "loss", onPlay: aFirst, points: aWins ? 10 : -5 });
  rows.push({ ...base, userId: b.id, oppUserId: a.id, myDeckId: db.id, myLeaderId: db.leader_id, oppLeaderId: da.leader_id, result: aWins ? "loss" : "win", onPlay: !aFirst, points: aWins ? -5 : 10 });
}
await createMatchesBatch(rows);

// keep deck + profile W/L counters in line with the match table
await run(`UPDATE decks SET wins=(SELECT COUNT(*) FROM matches m WHERE m.my_deck_id=decks.id AND m.result='win'),
                           losses=(SELECT COUNT(*) FROM matches m WHERE m.my_deck_id=decks.id AND m.result='loss')`);
await run(`UPDATE profiles SET wins=(SELECT COUNT(*) FROM matches m WHERE m.user_id=profiles.user_id AND m.result='win'),
                              losses=(SELECT COUNT(*) FROM matches m WHERE m.user_id=profiles.user_id AND m.result='loss')`);

console.log(`Done. ${GAMES} games (${rows.length} rows) over the last ${DAYS} days.`);
process.exit(0);
