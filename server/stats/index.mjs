// stats/index.mjs — the DB-facing side of the stats module.
//
// Reads `matches`, builds the ladder (ladder.mjs) and shapes the JSON the
// leaderboard, profile and meta pages show. The ladder is rebuilt only when
// the match table or the season changes, so pages stay cheap to load.

import { readFileSync } from "node:fs";
import { all } from "../db.mjs";
import { buildLadder, seasonOf } from "./ladder.mjs";
import { wilson } from "./wilson.mjs";
import { buildMetaReport } from "./metaReport.mjs";

export const TUNING = JSON.parse(readFileSync(new URL("./tuning.json", import.meta.url), "utf8"));

const DAY = 24 * 60 * 60 * 1000;
const round1 = (x) => Math.round(x * 10) / 10;
const pct = (w, g) => (g ? round1((w / g) * 100) : null);
const ciPct = (w, g) => { const c = wilson(w, g); return g ? [round1(c.lo * 100), round1(c.hi * 100)] : null; };

export const bountyOf = (rating) => Math.round(rating) * TUNING.bounty.berriesPerPoint;

// A result logged by hand is the player's own word: it stays in their records,
// never in the ladder or the meta.
const COUNTS = `source <> 'manual'`;

// ---------- cached ladder ----------
let cache = { key: "", ladder: null };
async function getLadder() {
  const now = Date.now();
  const sig = (await all(`SELECT COUNT(*) AS c, MAX(created_at) AS t FROM matches WHERE ${COUNTS}`))[0];
  const key = `${sig.c}|${sig.t}|${seasonOf(now)}`;
  if (cache.key !== key) {
    const rows = await all(`SELECT id, user_id, opp_user_id, my_leader_id, result, on_play, created_at FROM matches WHERE ${COUNTS}`);
    cache = { key, ladder: buildLadder(rows, TUNING, now) };
  }
  return cache.ladder;
}

/** The rating the queue pairs on: the player's ladder rating, the start value if they have no games. */
export async function ladderRating(userId) {
  const ladder = await getLadder();
  return Math.round(ladder.players.get(userId)?.rating ?? TUNING.glicko.startRating);
}

async function userRows() {
  const rows = await all(
    `SELECT u.id, u.username, u.display_name, p.country, p.favorite_leader, p.avatar_color
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

const recordToClient = (r) => ({
  games: r.games, wins: r.wins, losses: r.games - r.wins, winRate: pct(r.wins, r.games), ci: ciPct(r.wins, r.games),
  games1: r.games1, wins1: r.wins1, winRate1: pct(r.wins1, r.games1),
  games2: r.games2, wins2: r.wins2, winRate2: pct(r.wins2, r.games2),
});

function topLeaders(p, n) {
  return [...p.seasonLeaders.entries()]
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, n)
    .map(([leaderId, r]) => ({ leaderId, games: r.games, winRate: pct(r.wins, r.games) }));
}

function rankedEntry(p, u) {
  return {
    userId: p.userId,
    username: u?.username ?? "?",
    displayName: u?.display_name ?? "Unknown",
    country: u?.country || "",
    favoriteLeader: u?.favorite_leader ?? null,
    rank: p.rank,
    rating: Math.round(p.rating),
    rd: Math.round(p.rd),
    provisional: p.provisional,
    bounty: bountyOf(p.rating),
    peakBounty: bountyOf(p.seasonPeak),
    tier: p.tier,
    wins: p.seasonRecord.wins,
    losses: p.seasonRecord.games - p.seasonRecord.wins,
    games: p.seasonRecord.games,
    winRate: pct(p.seasonRecord.wins, p.seasonRecord.games),
    topLeaders: topLeaders(p, TUNING.leaderboard.topLeaders),
    streak: p.streak,
    lastMatchAt: p.lastMatchAt,
  };
}

function tierDistribution(ranked) {
  const ids = [...TUNING.tiers.map((t) => t.id), TUNING.topTier.id];
  const names = Object.fromEntries([...TUNING.tiers, TUNING.topTier].map((t) => [t.id, t.name]));
  const counts = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const p of ranked) counts[p.tier.id]++;
  const total = ranked.length || 1;
  return ids.map((id) => ({ id, name: names[id], players: counts[id], share: round1((counts[id] / total) * 100) }));
}

// ---------- leaderboard ----------
export async function leaderboard({ leader = "", country = "", limit = 100 } = {}) {
  const [ladder, users] = await Promise.all([getLadder(), userRows()]);
  let rows = ladder.ranked.map((p) => rankedEntry(p, users.get(p.userId)));
  if (country) rows = rows.filter((r) => r.country === country);
  if (leader) {
    rows = rows
      .map((r) => {
        const rec = ladder.players.get(r.userId).seasonLeaders.get(leader);
        return rec && rec.games >= TUNING.leaderboard.minGamesWithLeader ? { ...r, withLeader: recordToClient(rec) } : null;
      })
      .filter(Boolean);
  }
  const countries = [...new Set(ladder.ranked.map((p) => users.get(p.userId)?.country).filter(Boolean))].sort();
  return {
    season: ladder.season,
    totalRanked: ladder.ranked.length,
    tiers: tierDistribution(ladder.ranked),
    tierRules: { tiers: TUNING.tiers, topTier: TUNING.topTier, provisionalRd: TUNING.provisionalRd, minGames: TUNING.leaderboard.minGames, berriesPerPoint: TUNING.bounty.berriesPerPoint },
    countries,
    leaders: rows.slice(0, limit),
  };
}

// ---------- profile ----------
export async function profileStats(userId) {
  const [ladder, users] = await Promise.all([getLadder(), userRows()]);
  const p = ladder.players.get(userId);
  const rows = await all(
    `SELECT m.*, ou.username AS opp_username, ou.display_name AS opp_display, d.name AS my_deck_name
     FROM matches m LEFT JOIN users ou ON ou.id = m.opp_user_id LEFT JOIN decks d ON d.id = m.my_deck_id
     WHERE m.user_id=? ORDER BY m.created_at DESC`,
    [userId],
  );

  // all-time record, per leader, per matchup
  const total = { games: 0, wins: 0, games1: 0, wins1: 0, games2: 0, wins2: 0 };
  const byLeader = new Map();
  const add = (rec, win, onPlay) => {
    rec.games++; if (win) rec.wins++;
    if (onPlay) { rec.games1++; if (win) rec.wins1++; } else { rec.games2++; if (win) rec.wins2++; }
  };
  const blank = () => ({ games: 0, wins: 0, games1: 0, wins1: 0, games2: 0, wins2: 0 });
  const since30 = Date.now() - 30 * DAY;
  let last30 = 0;
  for (const m of rows) {
    const win = m.result === "win";
    const onPlay = !!m.on_play;
    add(total, win, onPlay);
    if (Number(m.created_at) >= since30) last30++;
    const lid = m.my_leader_id || "?";
    if (!byLeader.has(lid)) byLeader.set(lid, { rec: blank(), mu: new Map() });
    const L = byLeader.get(lid);
    add(L.rec, win, onPlay);
    const oid = m.opp_leader_id || "?";
    if (!L.mu.has(oid)) L.mu.set(oid, blank());
    add(L.mu.get(oid), win, onPlay);
  }

  const leaders = [...byLeader.entries()]
    .map(([leaderId, L]) => ({
      leaderId,
      ...recordToClient(L.rec),
      matchups: [...L.mu.entries()].map(([oppLeaderId, r]) => ({ oppLeaderId, ...recordToClient(r) })).sort((a, b) => b.games - a.games),
    }))
    .sort((a, b) => b.games - a.games);

  const recent = rows.slice(0, TUNING.recentMatches).map((m) => {
    const d = ladder.matchDelta.get(m.id);
    return {
      id: m.id,
      opponent: { username: m.opp_username || null, displayName: m.opp_display || "Unknown" },
      myLeaderId: m.my_leader_id,
      oppLeaderId: m.opp_leader_id,
      myDeckName: m.my_deck_name || "",
      result: m.result,
      onPlay: !!m.on_play,
      format: m.format,
      bountyDelta: d ? bountyOf(d.after) - bountyOf(d.before) : null,
      createdAt: Number(m.created_at),
    };
  });

  const u = users.get(userId);
  const ranked = p ? rankedEntry(p, u) : null;
  return {
    season: ladder.season,
    ladder: ranked && {
      ...ranked,
      allTimePeakBounty: bountyOf(p.allTimePeak),
      allTimePeakAt: p.allTimePeakAt,
      bestStreak: p.bestStreak,
      history: p.history.map((h) => ({ t: h.t, bounty: h.r * TUNING.bounty.berriesPerPoint })),
      pastSeasons: p.pastSeasons
        .map((s) => ({
          season: s.season, bounty: bountyOf(s.rating), peakBounty: bountyOf(s.peak), games: s.games, wins: s.wins,
          rank: s.rank, tier: s.tier, history: s.history.map((h) => ({ t: h.t, bounty: h.r * TUNING.bounty.berriesPerPoint })),
        }))
        .reverse(),
    },
    summary: { ...recordToClient(total), last30Days: last30, firstMatchAt: rows.length ? Number(rows[rows.length - 1].created_at) : null },
    leaders,
    recent,
  };
}

// ---------- meta ----------
export async function meta({ days = 0, minGames = TUNING.meta.minGames } = {}) {
  const now = Date.now();
  const since = days > 0 ? now - days * DAY : 0;
  const rows = await all(
    `SELECT my_leader_id AS l, opp_leader_id AS o, result, on_play, user_id, created_at FROM matches
     WHERE ${COUNTS} AND my_leader_id IS NOT NULL AND created_at >= ?`,
    [since],
  );
  const blank = () => ({ games: 0, wins: 0, games1: 0, wins1: 0, games2: 0, wins2: 0, players: new Set() });
  const per = new Map();
  const pair = new Map(); // "L|O" -> {games, wins}
  for (const r of rows) {
    const win = r.result === "win";
    if (!per.has(r.l)) per.set(r.l, blank());
    const rec = per.get(r.l);
    rec.games++; if (win) rec.wins++;
    if (r.on_play) { rec.games1++; if (win) rec.wins1++; } else { rec.games2++; if (win) rec.wins2++; }
    rec.players.add(r.user_id);
    if (r.o) {
      const k = `${r.l}|${r.o}`;
      const c = pair.get(k) || { games: 0, wins: 0 };
      c.games++; if (win) c.wins++;
      pair.set(k, c);
    }
  }
  const totalGames = rows.length || 1;
  const share = (id) => (per.get(id)?.games || 0) / totalGames;

  // movers: share and WR now (last N days) vs the N days before
  const N = TUNING.meta.moversDays * DAY;
  const window = await all(
    `SELECT my_leader_id AS l, result, created_at FROM matches WHERE ${COUNTS} AND my_leader_id IS NOT NULL AND created_at >= ?`,
    [now - 2 * N],
  );
  const half = (from, to) => {
    const m = new Map(); let tot = 0;
    for (const r of window) if (r.created_at >= from && r.created_at < to) {
      tot++; const c = m.get(r.l) || { games: 0, wins: 0 }; c.games++; if (r.result === "win") c.wins++; m.set(r.l, c);
    }
    return { m, tot: tot || 1 };
  };
  const cur = half(now - N, now + 1);
  const prev = half(now - 2 * N, now - N);

  const leaders = [...per.entries()]
    .map(([leaderId, r]) => {
      // opponent-adjusted WR: average WR vs each opponent, weighted by how often that opponent is played
      let wsum = 0, acc = 0;
      for (const [k, c] of pair) {
        const [l, o] = k.split("|");
        if (l !== leaderId || !c.games) continue;
        const w = share(o);
        wsum += w; acc += w * (c.wins / c.games);
      }
      const c1 = cur.m.get(leaderId), p1 = prev.m.get(leaderId);
      return {
        leaderId,
        ...recordToClient(r),
        players: r.players.size,
        share: round1((r.games / totalGames) * 100),
        adjustedWinRate: wsum ? round1((acc / wsum) * 100) : null,
        shareDelta: round1(((c1?.games || 0) / cur.tot - (p1?.games || 0) / prev.tot) * 100),
        winRateDelta: c1?.games && p1?.games ? round1((c1.wins / c1.games - p1.wins / p1.games) * 100) : null,
        enough: r.games >= minGames,
      };
    })
    .sort((a, b) => b.games - a.games);

  const top = leaders.filter((l) => l.enough).slice(0, TUNING.meta.matrixLeaders).map((l) => l.leaderId);
  const matrix = top.map((l) =>
    top.map((o) => {
      const c = pair.get(`${l}|${o}`);
      return c ? { games: c.games, wins: c.wins, winRate: pct(c.wins, c.games), ci: ciPct(c.wins, c.games) } : null;
    }),
  );

  return { days, minGames, totalGames: rows.length, leaders, matrix: { leaders: top, cells: matrix } };
}

// ---------- Meta Analytics page: matchup grid + best lists ----------
/**
 * Filters: format ("" = every format), from/to (ms, inclusive), minBounty /
 * maxBounty (Berries; the player's Bounty going into the game).
 */
export async function metaReport({ format = "", from = null, to = null, minBounty = null, maxBounty = null } = {}) {
  const ladder = await getLadder();
  const rows = await all(
    `SELECT id, user_id, my_deck_id, my_leader_id, opp_leader_id, result, format, created_at FROM matches WHERE ${COUNTS} AND my_leader_id IS NOT NULL`,
  );
  const deckRows = await all(`SELECT id, name, cards FROM decks WHERE id IN (SELECT DISTINCT my_deck_id FROM matches)`);
  const decks = new Map(
    deckRows.map((d) => {
      let cards = [];
      try { cards = JSON.parse(d.cards || "[]"); } catch { /* a broken list just isn't shown */ }
      return [d.id, { name: d.name, cards }];
    }),
  );
  const start = TUNING.glicko.startRating;
  const withRating = rows.map((r) => ({ ...r, created_at: Number(r.created_at), rating: ladder.ratingAt.get(r.id) ?? start }));

  const perPoint = TUNING.bounty.berriesPerPoint;
  const report = buildMetaReport(withRating, decks, TUNING, {
    format: format || undefined,
    from: from ?? undefined,
    to: to ?? undefined,
    minRating: minBounty != null ? minBounty / perPoint : undefined,
    maxRating: maxBounty != null ? maxBounty / perPoint : undefined,
  });

  // what the filters can offer
  const fmt = new Map();
  for (const r of withRating) {
    const f = fmt.get(r.format) || { format: r.format, games: 0, lastAt: 0 };
    f.games++; f.lastAt = Math.max(f.lastAt, r.created_at);
    fmt.set(r.format, f);
  }
  const ratings = withRating.map((r) => r.rating);
  return {
    ...report,
    options: {
      formats: [...fmt.values()].filter((f) => f.format).sort((a, b) => b.lastAt - a.lastAt),
      bountyRange: ratings.length ? [bountyOf(Math.min(...ratings)), bountyOf(Math.max(...ratings))] : [0, 0],
      tiers: TUNING.tiers.map((t) => ({ id: t.id, name: t.name, minBounty: t.min * perPoint })),
      firstAt: withRating.length ? Math.min(...withRating.map((r) => r.created_at)) : null,
      bestListMoreThanGames: TUNING.metaReport.bestListMoreThanGames,
      gridMinGames: TUNING.metaReport.gridMinGames,
    },
  };
}
