// replays.mjs — finished games kept to be watched again (src/features/replay).
//
// A record is what happened on the table: the state after the opening hands,
// every event after it, and where each play ends. The server does not run the
// engine, so it stores the record as the browser sent it, after checking that
// its parts line up. Anyone signed in who has the link can watch.

import { randomInt } from "node:crypto";
import { z } from "zod";
import { all, get, run } from "./db.mjs";

const SEATS = ["seatA", "seatB"];
const MAX_RECORD_BYTES = 2_000_000;
/** The request itself is a little bigger than the record inside it. */
export const RECORD_BODY_LIMIT = MAX_RECORD_BYTES + 200_000;
const MAX_EVENTS = 60_000;
const MAX_PLAYS = 20_000;
/** Games against the AI or at one screen that a player keeps: the oldest go first. */
const MAX_OWN_REPLAYS = 200;
const ID_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o or 1/i/l
const ID_LENGTH = 10;

const seatSchema = z.object({
  pid: z.enum(SEATS),
  name: z.string().min(1).max(80),
  controller: z.enum(["human", "ai"]),
  deckName: z.string().max(80),
  leaderId: z.string().min(1).max(20),
});
const recordSchema = z.object({
  v: z.literal(1),
  seats: z.tuple([seatSchema, seatSchema]),
  initial: z.object({ players: z.object({}).passthrough(), order: z.array(z.enum(SEATS)).length(2) }).passthrough(),
  events: z.array(z.object({ type: z.string().min(1).max(40) }).passthrough()).max(MAX_EVENTS),
  cuts: z.array(z.number().int().min(0)).min(1).max(MAX_PLAYS + 1),
  pending: z.array(z.object({ kind: z.string() }).passthrough().nullable()).max(MAX_PLAYS + 1),
  moves: z.array(z.object({ type: z.string(), player: z.enum(SEATS) }).passthrough()).max(MAX_PLAYS),
  chat: z.array(z.object({ seat: z.enum(SEATS), text: z.string().max(200), at: z.number().int().min(0) })).max(500),
});

/** The same checks as recordProblem in src/features/replay/record.ts. */
function linesUp(r) {
  if (r.seats[0].pid === r.seats[1].pid) return false;
  if (r.pending.length !== r.cuts.length || r.moves.length !== r.cuts.length - 1) return false;
  for (let i = 1; i < r.cuts.length; i++) if (r.cuts[i] < r.cuts[i - 1]) return false;
  return r.cuts[r.cuts.length - 1] === r.events.length;
}

/** A record a browser sent, checked; null when it cannot be played back. */
export function parseRecord(body) {
  const parsed = recordSchema.safeParse(body);
  return parsed.success && linesUp(parsed.data) ? parsed.data : null;
}

function newId() {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) id += ID_LETTERS[randomInt(ID_LETTERS.length)];
  return id;
}

/** Stores a record; `users` = the accounts in seat A and seat B (null: the AI, or nobody's own seat).
 *  Returns the replay's id, or null when the record is too big to keep. */
export async function saveReplay({ source, format = "", savedBy = null, users = [null, null], record }) {
  const json = JSON.stringify(record);
  if (json.length > MAX_RECORD_BYTES) return null;
  const ended = record.events.findLast((e) => e.type === "gameEnded");
  const winner = SEATS.includes(ended?.winner) ? ended.winner : null;
  const turns = record.events.reduce((max, e) => (e.type === "turnStarted" && Number.isInteger(e.turn) ? Math.max(max, e.turn) : max), 0);
  const seat = (pid) => record.seats.find((s) => s.pid === pid);
  const id = newId();
  await run(
    `INSERT INTO replays (id, created_at, source, format, saved_by, user_a, user_b, name_a, name_b, leader_a, leader_b, winner, first_player, turns, plays, record)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, Date.now(), source, format, savedBy, users[0], users[1], seat("seatA").name, seat("seatB").name, seat("seatA").leaderId, seat("seatB").leaderId,
      winner, record.initial.order[0], turns, record.moves.length, json],
  );
  return id;
}

const summary = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  source: r.source,
  format: r.format,
  seats: [
    { pid: "seatA", name: r.name_a, leaderId: r.leader_a, userId: r.user_a },
    { pid: "seatB", name: r.name_b, leaderId: r.leader_b, userId: r.user_b },
  ],
  winner: r.winner,
  firstPlayer: r.first_player,
  turns: r.turns,
  plays: r.plays,
});
const SUMMARY_COLUMNS = "id, created_at, source, format, user_a, user_b, name_a, name_b, leader_a, leader_b, winner, first_player, turns, plays";

export function registerReplays(app, requireUser) {
  // a game against the AI or at one screen: the browser that played it sends it in
  app.post("/api/replays", { bodyLimit: RECORD_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const record = parseRecord(req.body?.record);
    if (!record) return reply.code(400).send({ error: "Invalid replay" });
    if (!record.events.some((e) => e.type === "gameEnded")) return reply.code(400).send({ error: "The game is not over" });
    const ai = record.seats.some((s) => s.controller === "ai");
    // against the AI the person's seat is theirs; at one screen both seats are whoever sat there
    const users = record.seats.map((s) => (ai && s.controller === "human" ? user.id : null));
    const bySeat = SEATS.map((pid) => users[record.seats.findIndex((s) => s.pid === pid)]);
    const id = await saveReplay({ source: ai ? "ai" : "local", savedBy: user.id, users: bySeat, record });
    if (!id) return reply.code(413).send({ error: "This game is too long to keep" });
    await run(
      `DELETE FROM replays WHERE saved_by = ? AND id NOT IN (SELECT id FROM replays WHERE saved_by = ? ORDER BY created_at DESC LIMIT ?)`,
      [user.id, user.id, MAX_OWN_REPLAYS],
    );
    return reply.code(201).send({ id });
  });

  // the games this player was in, or sent in: newest first
  app.get("/api/me/replays", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 60));
    const rows = await all(
      `SELECT ${SUMMARY_COLUMNS} FROM replays WHERE saved_by = ? OR user_a = ? OR user_b = ? ORDER BY created_at DESC LIMIT ?`,
      [user.id, user.id, user.id, limit],
    );
    return reply.send({ replays: rows.map(summary) });
  });

  app.get("/api/replays/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const row = await get(`SELECT * FROM replays WHERE id = ?`, [String(req.params.id).toLowerCase()]);
    if (!row) return reply.code(404).send({ error: "This replay does not exist" });
    return reply.send({ replay: { ...summary(row), record: JSON.parse(row.record) } });
  });
}
