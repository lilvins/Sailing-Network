// bot-games.mjs — games played against the optcg-ai bot ("Play vs Bot").
//
// Every finished game is stored as its full record (decks, seed, who went
// first, every action) so it can be replayed and so the bot can learn from it:
// optcg-ai's `scripts/learn.ts` reads this table, re-tunes the bot and writes
// public/data/optcg/learned.json, which the board loads on the next game.

import { randomUUID } from "node:crypto";
import db, { all, get, run } from "./db.mjs";

const MAX_RECORD_BYTES = 2_000_000;

let ready = null;
function init() {
  ready ??= db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS bot_games (
      id            TEXT PRIMARY KEY,
      user_id       TEXT,                       -- the human, if logged in
      created_at    INTEGER NOT NULL,
      mode          TEXT NOT NULL,              -- "human-vs-bot" | "bot-vs-bot"
      level         TEXT NOT NULL,              -- bot level: casual | pro-fast | pro
      bot_seat      INTEGER,                    -- 0 / 1, NULL for bot-vs-bot
      leader0       TEXT NOT NULL,
      leader1       TEXT NOT NULL,
      winner        INTEGER,                    -- 0 / 1 / NULL (abandoned)
      turns         INTEGER NOT NULL DEFAULT 0,
      record        TEXT NOT NULL               -- GameRecord JSON (optcg-ai src/record.ts)
    );
    CREATE INDEX IF NOT EXISTS idx_bot_games_created ON bot_games(created_at);
    CREATE TABLE IF NOT EXISTS bot_feedback (
      id            TEXT PRIMARY KEY,
      game_id       TEXT,
      user_id       TEXT,
      created_at    INTEGER NOT NULL,
      action_index  INTEGER NOT NULL,           -- index in record.actions of the flagged bot move
      note          TEXT NOT NULL DEFAULT ''
    );
  `);
  return ready;
}

function summary(r) {
  return {
    id: r.id,
    createdAt: Number(r.created_at),
    mode: r.mode,
    level: r.level,
    botSeat: r.bot_seat === null ? null : Number(r.bot_seat),
    leaders: [r.leader0, r.leader1],
    winner: r.winner === null ? null : Number(r.winner),
    turns: Number(r.turns),
  };
}

/** Registers /api/bot-games routes. `currentUser(req)` resolves the session (may be null). */
export function registerBotGames(app, currentUser) {
  app.post("/api/bot-games", async (req, reply) => {
    await init();
    const body = req.body ?? {};
    const rec = body.record;
    const ok =
      rec && Array.isArray(rec.decks) && rec.decks.length === 2 && Array.isArray(rec.actions) &&
      typeof rec.seed === "number" && (rec.first === 0 || rec.first === 1);
    if (!ok) return reply.code(400).send({ error: "Invalid game record" });
    const json = JSON.stringify(rec);
    if (json.length > MAX_RECORD_BYTES) return reply.code(413).send({ error: "Record too large" });
    const mode = body.mode === "bot-vs-bot" ? "bot-vs-bot" : "human-vs-bot";
    const level = ["casual", "pro-fast", "pro"].includes(body.level) ? body.level : "pro";
    const botSeat = body.botSeat === 0 || body.botSeat === 1 ? body.botSeat : null;
    const user = await currentUser(req);
    const id = randomUUID();
    await run(
      `INSERT INTO bot_games (id, user_id, created_at, mode, level, bot_seat, leader0, leader1, winner, turns, record)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, user?.id ?? null, Date.now(), mode, level, botSeat, String(rec.decks[0].leader), String(rec.decks[1].leader),
        rec.winner === 0 || rec.winner === 1 ? rec.winner : null, Number(rec.turns) || 0, json],
    );
    return reply.code(201).send({ id });
  });

  app.get("/api/bot-games", async (req, reply) => {
    await init();
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
    const rows = await all(
      `SELECT id, created_at, mode, level, bot_seat, leader0, leader1, winner, turns FROM bot_games ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return reply.send({ games: rows.map(summary) });
  });

  // aggregate: how the bot does with each leader against each opposing leader (human games only)
  app.get("/api/bot-games/stats", async (_req, reply) => {
    await init();
    const rows = await all(
      `SELECT bot_seat, leader0, leader1, winner FROM bot_games WHERE mode = 'human-vs-bot' AND winner IS NOT NULL AND bot_seat IS NOT NULL`,
    );
    const stats = {};
    for (const r of rows) {
      const seat = Number(r.bot_seat);
      const bot = seat === 0 ? r.leader0 : r.leader1;
      const human = seat === 0 ? r.leader1 : r.leader0;
      const s = ((stats[bot] ??= {})[human] ??= { games: 0, botWins: 0 });
      s.games++;
      if (Number(r.winner) === seat) s.botWins++;
    }
    return reply.send({ stats });
  });

  app.get("/api/bot-games/:id", async (req, reply) => {
    await init();
    const r = await get(`SELECT * FROM bot_games WHERE id = ?`, [req.params.id]);
    if (!r) return reply.code(404).send({ error: "Not found" });
    return reply.send({ game: { ...summary(r), record: JSON.parse(r.record) } });
  });

  app.post("/api/bot-games/:id/feedback", async (req, reply) => {
    await init();
    const game = await get(`SELECT id FROM bot_games WHERE id = ?`, [req.params.id]);
    if (!game) return reply.code(404).send({ error: "Not found" });
    const idx = Number(req.body?.actionIndex);
    if (!Number.isInteger(idx) || idx < 0) return reply.code(400).send({ error: "actionIndex required" });
    const user = await currentUser(req);
    await run(`INSERT INTO bot_feedback (id, game_id, user_id, created_at, action_index, note) VALUES (?, ?, ?, ?, ?, ?)`, [
      randomUUID(), game.id, user?.id ?? null, Date.now(), idx, String(req.body?.note ?? "").slice(0, 500),
    ]);
    return reply.code(201).send({ ok: true });
  });
}
