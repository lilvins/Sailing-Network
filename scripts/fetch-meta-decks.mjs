// fetch-meta-decks.mjs — current-meta decklists from egmanevents → public/data/meta-decks.json
//
// Reads egman's deckbuilder API (/api/tournaments/optcg), keeps the events of the
// newest set group (e.g. OP17: ENG OP17, OP17, OP17.5, EB05), and picks one list
// per meta Leader:
//   - Leaders with ≥ MIN_RESULTS results in the set group, plus the ones with
//     ≥ MIN_NEWEST results in the newest format (what's rising right now);
//   - the list: a top-4 finish first, then the most recent, then the best
//     placement, then the bigger event.
// Every list is checked against public/data/cards.json (50 cards, ≤4 copies,
// all ids known); a list that fails is replaced by the next candidate.
//
// Run:  npm run fetch:meta   (then `npm run seed:meta` to give them to the test account)
// Be polite: one request, run it when the meta moves, not in a loop.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "data", "meta-decks.json");
const API = "https://deckbuilder.egmanevents.com/api/tournaments/optcg";
const MIN_RESULTS = 5;
const MIN_NEWEST = 3;

const cards = new Map(JSON.parse(readFileSync(join(ROOT, "public", "data", "cards.json"), "utf8")).map((c) => [c.id, c]));

const res = await fetch(API, { headers: { "User-Agent": "Mozilla/5.0 (Sailing Network meta seed)" } });
if (!res.ok) throw new Error(`egman API: HTTP ${res.status}`);
const events = await res.json();

// Newest set group = the one of the most recent event.
const byDate = [...events].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
const setGroup = byDate[0].set_group;
const newestFormat = byDate[0].format;
const current = events.filter((e) => e.set_group === setGroup);

function parseList(url) {
  const m = url && url.match(/[?&]deck=([^&]+)/);
  if (!m) return null;
  return decodeURIComponent(m[1]).split(",").map((s) => {
    const [id, c] = s.split(":");
    return { id: id.trim().replace(/_.*$/, ""), count: parseInt(c, 10) || 1 };
  });
}

function validate(leaderId, list) {
  const leader = cards.get(leaderId);
  if (!leader || leader.category !== "Leader") return "unknown leader";
  const main = list.filter((c) => c.id !== leaderId);
  const total = main.reduce((s, c) => s + c.count, 0);
  if (total !== 50) return `${total} cards`;
  for (const c of main) {
    if (!cards.has(c.id)) return `unknown card ${c.id}`;
    if (c.count > 4) return `${c.count}x ${c.id}`;
  }
  return null;
}

const results = {};
const newest = {};
for (const ev of current) {
  for (const r of ev.tournament_results ?? []) {
    const leaderId = r.deck_type;
    if (!leaderId || leaderId === "Other") continue;
    (results[leaderId] ??= []).push({ ev, r });
    if (ev.format === newestFormat) newest[leaderId] = (newest[leaderId] ?? 0) + 1;
  }
}

const decks = [];
const skipped = [];
for (const [leaderId, rows] of Object.entries(results)) {
  if (rows.length < MIN_RESULTS && (newest[leaderId] ?? 0) < MIN_NEWEST) continue;
  const candidates = rows
    .map(({ ev, r }) => ({ ev, r, list: parseList((r.deck_list_url ?? []).find((u) => u && u.includes("deck="))) }))
    .filter((x) => x.list)
    .sort((a, b) => {
      const ta = a.r.placement <= 4 ? 0 : 1, tb = b.r.placement <= 4 ? 0 : 1;
      if (ta !== tb) return ta - tb;
      if (a.ev.start_date !== b.ev.start_date) return a.ev.start_date < b.ev.start_date ? 1 : -1;
      if (a.r.placement !== b.r.placement) return a.r.placement - b.r.placement;
      return (b.ev.player_count ?? 0) - (a.ev.player_count ?? 0);
    });
  const pick = candidates.find((x) => !validate(leaderId, x.list));
  if (!pick) {
    skipped.push({ leaderId, reason: candidates.length ? validate(leaderId, candidates[0].list) : "no list" });
    continue;
  }
  decks.push({
    leaderId,
    leaderName: cards.get(leaderId).name.replace(/&amp;/g, "&"),
    colors: cards.get(leaderId).colors,
    results: rows.length,
    resultsNewestFormat: newest[leaderId] ?? 0,
    cards: pick.list.filter((c) => c.id !== leaderId),
    event: pick.ev.tournament_name,
    format: pick.ev.format,
    date: pick.ev.start_date,
    players: pick.ev.player_count,
    eventType: pick.ev.event_type,
    placement: pick.r.placement,
    player: pick.r.player_name,
  });
}
decks.sort((a, b) => b.results - a.results);

writeFileSync(OUT, JSON.stringify({ source: "egmanevents.com", fetchedAt: new Date().toISOString(), setGroup, newestFormat, events: current.length, decks, skipped }, null, 2) + "\n");
console.log(`${setGroup} (newest ${newestFormat}, ${current.length} events): ${decks.length} decks → ${OUT}`);
for (const d of decks) console.log(`  ${d.leaderId} ${d.leaderName.padEnd(26)} ${String(d.results).padStart(3)} results · ${d.placement}° ${d.event} (${d.format}, ${d.date})`);
for (const s of skipped) console.log(`  skipped ${s.leaderId}: ${s.reason}`);
