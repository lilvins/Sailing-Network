# server/stats — ladder, Bounty, profile stats, meta

Turns the `matches` table into what the Leaderboard, Profile and Meta pages show.
No UI code here, no HTTP: `server/index.mjs` calls these functions.

| File | Job |
|---|---|
| `tuning.json` | Every number you might want to tune: Glicko-2 start values, season reset, Bounty scale, tier thresholds, minimum games, meta window. Change numbers here, not in code. |
| `glicko2.mjs` | One Glicko-2 update for one player after one game (pure). |
| `wilson.mjs` | 95% Wilson interval for a win rate (pure). |
| `ladder.mjs` | Replays all match rows in time order → rating, RD, peak, history, streaks, seasons, ranks, tiers (pure). |
| `metaReport.mjs` | Matchup grid + best lists for the Meta Analytics page, under format / date / Bounty filters (pure). |
| `index.mjs` | Reads the DB, caches the ladder, and shapes `leaderboard()`, `profileStats()`, `meta()`, `metaReport()`. |

## How the Bounty works

- Rating is **Glicko-2** (start 1500, RD 350). Every game is its own rating
  period. A row moves only its owner's rating; the opponent's rating at that
  moment is the input. Rows with no opponent account count for the record only.
- **Bounty** = rating × 1,000,000 Berries (1500 → ฿1.5B).
- **Provisional** while RD > 110: shown with "?", not ranked.
- **Seasons** are calendar months (UTC). On a player's first game of a new
  season the old one is archived (final Bounty, peak, record, rank) and the
  rating is pulled halfway back to 1500, with RD raised to 160.
- **Ranked** = not provisional and ≥ 5 games this season.
- **Tiers** by rating: East Blue, Grand Line (1400), New World (1500),
  Supernova (1600), Warlord (1700), Emperor (1800). #1 is **Pirate King**.

The ladder is derived, not stored: it is rebuilt when the match count, the
latest match time or the season changes. `user_ratings` (used by the queue)
is not touched by this module.

## Meta

`meta({days, minGames})` counts rows (one per player per game) by leader:
record with Wilson CI, first/second split, distinct players, play share,
**opponent-adjusted WR** (WR vs each opponent weighted by that opponent's
share), share and WR change vs the previous 7 days, and a leader × leader
matrix of the top leaders that meet `minGames`.

## Meta Analytics page (`metaReport`)

Filters: format, a date range, and the Bounty the player had going into the
game (the ladder records it for every row). Output: a leader × leader grid
(row leader's record vs the column leader; leaders with `gridMinGames`+
games, at most `gridMaxLeaders`) and, per leader, the lists with more than
`bestListMoreThanGames` games, best win rate first. Two decks with the same
cards in the same counts are one list, whoever built them.

## Demo data

`npm run seed:ladder` (after `seed:demo`) adds ~40 demo captains and ~60 days
of made-up games so every page has data.
