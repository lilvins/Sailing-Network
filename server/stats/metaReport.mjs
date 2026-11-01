// metaReport.mjs — what the Meta Analytics page shows: a leader × leader
// matchup grid and, per leader, the best decklists by win rate.
//
// Pure: match rows + decks + tuning + filters in, a report out. Each row is
// one player's view of one game; `rating` is that player's rating going into
// the game (ladder.mjs `ratingAt`), which the Bounty filter reads.

import { wilson } from "./wilson.mjs";

const round1 = (x) => Math.round(x * 10) / 10;
const pct = (w, g) => (g ? round1((w / g) * 100) : null);
const ciPct = (w, g) => { if (!g) return null; const c = wilson(w, g); return [round1(c.lo * 100), round1(c.hi * 100)]; };

/** Same cards in the same counts = the same list, whoever built it. */
export function deckSignature(cards) {
  return [...cards].map((c) => `${c.id}x${c.count}`).sort().join("|");
}

/**
 * @param {Array<{id:string,user_id:string,my_deck_id:string|null,my_leader_id:string|null,opp_leader_id:string|null,result:string,format:string,created_at:number,rating:number}>} rows
 * @param {Map<string,{name:string,cards:{id:string,count:number}[]}>} decks
 * @param {object} cfg tuning.json
 * @param {{format?:string, from?:number, to?:number, minRating?:number, maxRating?:number}} f
 */
export function buildMetaReport(rows, decks, cfg, f = {}) {
  const t = cfg.metaReport;
  const kept = rows.filter((r) =>
    r.my_leader_id &&
    (!f.format || r.format === f.format) &&
    (f.from == null || r.created_at >= f.from) &&
    (f.to == null || r.created_at <= f.to) &&
    (f.minRating == null || r.rating >= f.minRating) &&
    (f.maxRating == null || r.rating <= f.maxRating),
  );

  // ---- per leader + per pair ----
  const leaders = new Map(); // id -> {games, wins}
  const pairs = new Map(); // "L|O" -> {games, wins}
  for (const r of kept) {
    const win = r.result === "win";
    const L = leaders.get(r.my_leader_id) || { games: 0, wins: 0 };
    L.games++; if (win) L.wins++;
    leaders.set(r.my_leader_id, L);
    if (r.opp_leader_id) {
      const k = `${r.my_leader_id}|${r.opp_leader_id}`;
      const P = pairs.get(k) || { games: 0, wins: 0 };
      P.games++; if (win) P.wins++;
      pairs.set(k, P);
    }
  }
  const gridIds = [...leaders.entries()]
    .filter(([, v]) => v.games >= t.gridMinGames)
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, t.gridMaxLeaders)
    .map(([id]) => id);
  const grid = {
    leaders: gridIds.map((id) => { const v = leaders.get(id); return { leaderId: id, games: v.games, wins: v.wins, winRate: pct(v.wins, v.games) }; }),
    cells: gridIds.map((row) =>
      gridIds.map((col) => {
        const c = pairs.get(`${row}|${col}`);
        return c ? { games: c.games, wins: c.wins, winRate: pct(c.wins, c.games), ci: ciPct(c.wins, c.games) } : null;
      }),
    ),
  };

  // ---- best lists: same leader + same cards, more than N games ----
  const lists = new Map(); // "leader|signature" -> agg
  for (const r of kept) {
    const deck = r.my_deck_id ? decks.get(r.my_deck_id) : null;
    if (!deck || !deck.cards.length) continue;
    const sig = deckSignature(deck.cards);
    const k = `${r.my_leader_id}|${sig}`;
    let a = lists.get(k);
    if (!a) {
      a = { leaderId: r.my_leader_id, signature: sig, name: deck.name, cards: deck.cards, games: 0, wins: 0, players: new Set() };
      lists.set(k, a);
    }
    a.games++;
    if (r.result === "win") a.wins++;
    a.players.add(r.user_id);
  }
  const byLeader = new Map();
  for (const a of lists.values()) {
    if (a.games <= t.bestListMoreThanGames) continue;
    if (!byLeader.has(a.leaderId)) byLeader.set(a.leaderId, []);
    byLeader.get(a.leaderId).push({
      key: a.signature,
      name: a.name,
      games: a.games,
      wins: a.wins,
      losses: a.games - a.wins,
      winRate: pct(a.wins, a.games),
      ci: ciPct(a.wins, a.games),
      players: a.players.size,
      cards: a.cards,
    });
  }
  const bestLists = [...byLeader.entries()]
    .map(([leaderId, ls]) => {
      const v = leaders.get(leaderId);
      return {
        leaderId,
        games: v.games,
        winRate: pct(v.wins, v.games),
        lists: ls.sort((x, y) => (y.winRate ?? 0) - (x.winRate ?? 0) || y.games - x.games).slice(0, t.bestListsPerLeader),
      };
    })
    .sort((a, b) => b.games - a.games);

  return { totalGames: kept.length, grid, bestLists };
}
