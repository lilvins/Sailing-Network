// ladder.mjs — replays the whole match history and builds the ranked ladder.
//
// Pure: match rows + tuning in, a Ladder out (no DB, no HTTP). Each `matches`
// row is one player's view of one game, so a row moves only its owner's rating;
// the opponent's rating at that moment is the "opponent" input. Rows without a
// known opponent account still count for the record but don't move the rating.
//
// Seasons are calendar months (UTC). When a player's first game of a new
// season comes in, their previous season is archived and the rating is pulled
// back toward the start (tuning.season).

import { glicko2Update } from "./glicko2.mjs";

export const seasonOf = (ms) => new Date(ms).toISOString().slice(0, 7); // "2026-10"

const emptyRecord = () => ({ games: 0, wins: 0, games1: 0, wins1: 0, games2: 0, wins2: 0 });
function addResult(rec, win, onPlay) {
  rec.games++;
  if (win) rec.wins++;
  if (onPlay) { rec.games1++; if (win) rec.wins1++; } else { rec.games2++; if (win) rec.wins2++; }
}

function newPlayer(userId, season, cfg) {
  return {
    userId,
    rating: cfg.glicko.startRating,
    rd: cfg.glicko.startRd,
    vol: cfg.glicko.startVol,
    season,
    seasonPeak: cfg.glicko.startRating,
    seasonRecord: emptyRecord(),
    seasonLeaders: new Map(), // leaderId -> record
    history: [], // [{t, r}] this season
    allTimePeak: cfg.glicko.startRating,
    allTimePeakAt: null,
    pastSeasons: [], // [{season, rating, peak, games, wins, history, rank, tier}]
    lastMatchAt: null,
    streak: 0, // +n = n wins in a row, -n = n losses in a row
    bestStreak: 0,
  };
}

/** Archive the season the player is in and start `season` with a soft reset. */
function rollTo(p, season, cfg) {
  if (p.season === season) return;
  if (p.seasonRecord.games > 0) {
    p.pastSeasons.push({
      season: p.season,
      rating: p.rating,
      peak: p.seasonPeak,
      games: p.seasonRecord.games,
      wins: p.seasonRecord.wins,
      history: p.history,
      rank: null,
      tier: null,
    });
  }
  const start = cfg.glicko.startRating;
  p.rating = start + (p.rating - start) * cfg.season.softResetKeep;
  p.rd = Math.max(p.rd, cfg.season.resetRd);
  p.season = season;
  p.seasonPeak = p.rating;
  p.seasonRecord = emptyRecord();
  p.seasonLeaders = new Map();
  p.history = [];
}

export function tierFor(rating, rank, cfg) {
  if (rank != null && rank <= cfg.topTier.topN) return { id: cfg.topTier.id, name: cfg.topTier.name };
  let t = cfg.tiers[0];
  for (const x of cfg.tiers) if (rating >= x.min) t = x;
  return { id: t.id, name: t.name };
}

/**
 * @param {Array<{id:string,user_id:string,opp_user_id:string|null,my_leader_id:string|null,result:string,on_play:number,created_at:number}>} rows
 * @param {object} cfg tuning.json
 * @param {number} now
 */
export function buildLadder(rows, cfg, now) {
  const sorted = [...rows].sort((a, b) => Number(a.created_at) - Number(b.created_at) || String(a.id).localeCompare(String(b.id)));
  const players = new Map();
  const matchDelta = new Map(); // match id -> {before, after}
  const currentSeason = seasonOf(now);

  const playerOf = (uid, season) => {
    let p = players.get(uid);
    if (!p) { p = newPlayer(uid, season, cfg); players.set(uid, p); }
    rollTo(p, season, cfg);
    return p;
  };

  for (const m of sorted) {
    const t = Number(m.created_at);
    const season = seasonOf(t);
    const me = playerOf(m.user_id, season);
    const win = m.result === "win";
    const onPlay = !!Number(m.on_play);

    addResult(me.seasonRecord, win, onPlay);
    if (m.my_leader_id) {
      const rec = me.seasonLeaders.get(m.my_leader_id) || emptyRecord();
      addResult(rec, win, onPlay);
      me.seasonLeaders.set(m.my_leader_id, rec);
    }
    me.streak = win ? Math.max(1, me.streak + 1) : Math.min(-1, me.streak - 1);
    me.bestStreak = Math.max(me.bestStreak, me.streak);
    me.lastMatchAt = t;

    if (m.opp_user_id) {
      const opp = playerOf(m.opp_user_id, season);
      const before = me.rating;
      const next = glicko2Update(me, opp, win ? 1 : 0, cfg.glicko);
      me.rating = next.rating; me.rd = next.rd; me.vol = next.vol;
      matchDelta.set(m.id, { before, after: me.rating });
      me.history.push({ t, r: Math.round(me.rating) });
      if (me.rating > me.seasonPeak) me.seasonPeak = me.rating;
      if (me.rating > me.allTimePeak) { me.allTimePeak = me.rating; me.allTimePeakAt = t; }
    }
  }

  // everyone lands in the current season (archives a season that has ended)
  for (const p of players.values()) rollTo(p, currentSeason, cfg);

  // ranks for past seasons (only players who met the minimum that season)
  const bySeason = new Map();
  for (const p of players.values()) for (const s of p.pastSeasons) {
    if (s.games < cfg.leaderboard.minGames) continue;
    if (!bySeason.has(s.season)) bySeason.set(s.season, []);
    bySeason.get(s.season).push(s);
  }
  for (const list of bySeason.values()) {
    list.sort((a, b) => b.rating - a.rating);
    list.forEach((s, i) => { s.rank = i + 1; s.tier = tierFor(s.rating, s.rank, cfg); });
  }

  // current ranks: non-provisional players with enough games this season
  const ranked = [...players.values()]
    .filter((p) => p.seasonRecord.games >= cfg.leaderboard.minGames && p.rd <= cfg.provisionalRd)
    .sort((a, b) => b.rating - a.rating);
  const rankOf = new Map(ranked.map((p, i) => [p.userId, i + 1]));
  for (const p of players.values()) {
    p.rank = rankOf.get(p.userId) ?? null;
    p.provisional = p.rd > cfg.provisionalRd;
    p.tier = tierFor(p.rating, p.rank, cfg);
  }

  return { season: currentSeason, players, ranked, matchDelta };
}
