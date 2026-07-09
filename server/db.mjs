// db.mjs — SQLite via libsql (prebuilt binaries, no native compiler needed).
// File-backed local database. Call initDb() once at startup before queries.

import { createClient } from "@libsql/client";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SN_DB_PATH || join(__dirname, "sailing.db");

const db = createClient({
  url: pathToFileURL(DB_PATH).href, // file:///C:/.../sailing.db
  intMode: "number", // INTEGER columns (timestamps, counts) come back as JS numbers
});

let initialized = false;
export async function initDb() {
  if (initialized) return;
  await db.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
      display_name  TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS profiles (
      user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      bio             TEXT NOT NULL DEFAULT '',
      avatar_color    TEXT NOT NULL DEFAULT '#7a3030',
      favorite_leader TEXT,              -- a leader card id, e.g. "OP01-001"
      supporter       INTEGER NOT NULL DEFAULT 0,
      wins            INTEGER NOT NULL DEFAULT 0,
      losses          INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decks (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      leader_id   TEXT,                  -- leader card id
      leader_name TEXT NOT NULL DEFAULT '',
      cards       TEXT NOT NULL DEFAULT '[]',  -- JSON: [{id, count}]
      format      TEXT NOT NULL DEFAULT '',
      source      TEXT NOT NULL DEFAULT '',     -- e.g. tournament name (for scraped lists)
      fav         INTEGER NOT NULL DEFAULT 0,
      wins        INTEGER NOT NULL DEFAULT 0,
      losses      INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);

    CREATE TABLE IF NOT EXISTS matches (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      opp_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      my_deck_id    TEXT,
      my_leader_id  TEXT,
      opp_leader_id TEXT,
      result        TEXT NOT NULL CHECK (result IN ('win','loss')),
      on_play       INTEGER NOT NULL DEFAULT 1,  -- 1 = went first, 0 = went second
      points        INTEGER NOT NULL DEFAULT 0,
      format        TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id);

    -- Friendships are directional rows from requester -> addressee. When accepted
    -- both users see the link. Unique pair so duplicate requests can't pile up.
    CREATE TABLE IF NOT EXISTS friendships (
      id           TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status       TEXT NOT NULL CHECK (status IN ('pending','accepted')),
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      UNIQUE(requester_id, addressee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_fr_req ON friendships(requester_id);
    CREATE INDEX IF NOT EXISTS idx_fr_addr ON friendships(addressee_id);

    -- Direct messages between two users. read_at lets the receiver mark a
    -- conversation seen (drives the unread badge).
    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body         TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      read_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(from_user_id, to_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_msg_inbox ON messages(to_user_id, read_at);

    CREATE TABLE IF NOT EXISTS user_presence (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('offline','online','in_duel')) DEFAULT 'offline',
      session_id TEXT,
      last_seen INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presence_status ON user_presence(status);

    -- Match sessions: active matches or matches waiting for players
    CREATE TABLE IF NOT EXISTS match_sessions (
      id              TEXT PRIMARY KEY,
      host_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      opponent_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      host_deck_id    TEXT REFERENCES decks(id) ON DELETE SET NULL,
      opponent_deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
      status          TEXT NOT NULL CHECK (status IN ('waiting','active','completed')) DEFAULT 'waiting',
      host_on_play    INTEGER,                -- 1 if host goes first (decided when opponent joins)
      winner_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at      INTEGER NOT NULL,
      started_at      INTEGER,
      completed_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ms_host ON match_sessions(host_user_id);
    CREATE INDEX IF NOT EXISTS idx_ms_opp ON match_sessions(opponent_id);
    CREATE INDEX IF NOT EXISTS idx_ms_status ON match_sessions(status);

    -- Match queue: users looking for games
    CREATE TABLE IF NOT EXISTS match_queue (
      user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      deck_id      TEXT REFERENCES decks(id) ON DELETE SET NULL,
      rating       INTEGER NOT NULL DEFAULT 1000,
      joined_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_rating ON match_queue(rating);

    -- User ratings (for ranked)
    CREATE TABLE IF NOT EXISTS user_ratings (
      user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      rating       INTEGER NOT NULL DEFAULT 1000,
      rd           REAL NOT NULL DEFAULT 350,        -- rating deviation (Glicko-2)
      vol          REAL NOT NULL DEFAULT 0.06,       -- volatility (Glicko-2)
      updated_at   INTEGER NOT NULL
    );

    -- Global chat (one shared room)
    CREATE TABLE IF NOT EXISTS global_messages (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_global_created ON global_messages(created_at);

    -- Notifications: unified feed (friend requests/accepts, DMs, system)
    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- recipient
      type       TEXT NOT NULL,                                         -- friend_request | friend_accept | message | system
      actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,          -- who triggered it
      body       TEXT NOT NULL DEFAULT '',
      ref        TEXT,                                                  -- optional target (e.g. username)
      read_at    INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

    -- Bans: an admin bans a user, optionally with an expiry (NULL = permanent).
    -- A user is "actively banned" when a row exists with expires_at NULL or in
    -- the future. Login is refused while a ban is active. One active ban per user
    -- is enforced by the unbanUser() delete on re-ban; history isn't kept.
    CREATE TABLE IF NOT EXISTS bans (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      banned_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,  -- the admin
      reason       TEXT NOT NULL DEFAULT '',
      banned_at    INTEGER NOT NULL,
      expires_at   INTEGER          -- NULL = permanent ban
    );
    CREATE INDEX IF NOT EXISTS idx_bans_user ON bans(user_id);
    CREATE INDEX IF NOT EXISTS idx_bans_exp  ON bans(expires_at);

    -- Static card catalog (the One Piece TCG card database). Read-only at runtime;
    -- populated by server/seed-cards.mjs from public/data/cards.json (which is built
    -- from the punk-records community dataset via scripts/build-cards.mjs). This is
    -- NOT game state — matches reference cards by id. JSON-array columns are stored
    -- as TEXT and parsed on read. 'set' is a SQL keyword, hence set_code.
    CREATE TABLE IF NOT EXISTS cards (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL DEFAULT '',
      category       TEXT NOT NULL DEFAULT '',     -- Leader | Character | Event | Stage
      colors         TEXT NOT NULL DEFAULT '[]',   -- JSON array of color names
      cost           INTEGER,                      -- Life for Leaders (source quirk)
      power          INTEGER,
      counter        INTEGER,
      types          TEXT NOT NULL DEFAULT '[]',   -- JSON array of tribes/subtypes
      attributes     TEXT NOT NULL DEFAULT '[]',   -- JSON array
      effect         TEXT NOT NULL DEFAULT '',
      trigger        TEXT,
      rarity         TEXT NOT NULL DEFAULT '',
      set_code       TEXT NOT NULL DEFAULT '',     -- e.g. OP01, ST23, EB04, PRB02, P
      image          TEXT NOT NULL DEFAULT '',     -- app art path (self-hosted webp)
      image_official TEXT NOT NULL DEFAULT ''      -- official onepiece-cardgame.com url
    );
    CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_code);
    CREATE INDEX IF NOT EXISTS idx_cards_cat ON cards(category);
  `);

  await runMigrations();
  initialized = true;
}

// ---------------------------------------------------------------------------
// Migrations — additive, idempotent. SQLite can't ALTER a CHECK constraint, so
// schema-altering migrations rebuild the affected table inside a transaction.
// ---------------------------------------------------------------------------
async function runMigrations() {
  // M1: matchmaking flow on match_sessions.
  //   - widen status enum to include 'pending' (both players matched, awaiting
  //     presence confirmation) and 'cancelled' (no-show / left queue).
  //   - add ready flags + matched_at so the 60s no-show timeout can be enforced.
  const ms = await get(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='match_sessions'`
  );
  const needsMatchmakingCols = ms && !/host_ready/.test(ms.sql);
  if (needsMatchmakingCols) {
    await db.executeMultiple(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE match_sessions__new (
        id              TEXT PRIMARY KEY,
        host_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opponent_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
        host_deck_id    TEXT REFERENCES decks(id) ON DELETE SET NULL,
        opponent_deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
        status          TEXT NOT NULL
                          CHECK (status IN ('pending','waiting','active','completed','cancelled'))
                          DEFAULT 'waiting',
        host_on_play    INTEGER,
        host_ready      INTEGER NOT NULL DEFAULT 0,
        opponent_ready  INTEGER NOT NULL DEFAULT 0,
        winner_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at      INTEGER NOT NULL,
        matched_at      INTEGER,
        started_at      INTEGER,
        completed_at    INTEGER
      );
      INSERT INTO match_sessions__new
        (id, host_user_id, opponent_id, host_deck_id, opponent_deck_id, status,
         host_on_play, winner_id, created_at, started_at, completed_at)
        SELECT id, host_user_id, opponent_id, host_deck_id, opponent_deck_id, status,
               host_on_play, winner_id, created_at, started_at, completed_at
        FROM match_sessions;
      DROP TABLE match_sessions;
      ALTER TABLE match_sessions__new RENAME TO match_sessions;
      CREATE INDEX IF NOT EXISTS idx_ms_host ON match_sessions(host_user_id);
      CREATE INDEX IF NOT EXISTS idx_ms_opp ON match_sessions(opponent_id);
      CREATE INDEX IF NOT EXISTS idx_ms_status ON match_sessions(status);
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // M2: ban system. Create the `bans` table on existing databases that predate
  // it. Idempotent — IF NOT EXISTS makes re-runs a no-op. (Fresh DBs already get
  // this table from initDb's CREATE block above; this covers upgrades in place.)
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS bans (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      banned_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason       TEXT NOT NULL DEFAULT '',
      banned_at    INTEGER NOT NULL,
      expires_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bans_user ON bans(user_id);
    CREATE INDEX IF NOT EXISTS idx_bans_exp  ON bans(expires_at);
  `);
}

// thin query helpers
export const get = async (sql, args = []) => (await db.execute({ sql, args })).rows[0] || null;
export const all = async (sql, args = []) => (await db.execute({ sql, args })).rows;
export const run = async (sql, args = []) => db.execute({ sql, args });

export default db;
export { DB_PATH };
