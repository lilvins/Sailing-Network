// Friend games (src/features/board-auto/room.ts). Lockstep: the engine is
// deterministic, so a room only keeps the two decks, the seed, who goes first
// and the ordered list of moves. Each browser replays them with AUTOSIM.
// The server does not run the engine: it checks who sends a move and its
// order, not whether it is legal. Rooms live in memory: a restart ends them.
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { createMatch, getDeck } from "./store.mjs";

const SEATS = ["seatA", "seatB"];
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I/L
const CODE_LENGTH = 6;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MOVES = 20000;
const MAX_CHAT = 500;
/** A host who stopped polling this long ago has gone: their duel leaves the list. */
const HOST_GONE_MS = 15000;

const deckSchema = z.object({
  name: z.string().min(1).max(80),
  leaderId: z.string().min(1).max(20),
  main: z.array(z.string().min(1).max(20)).min(1).max(60),
  /** The saved deck it came from (none for a ready-made list): its record counts the game. */
  deckId: z.string().min(1).max(60).optional(),
});
const moveSchema = z.object({ seq: z.number().int().min(0), intent: z.object({ type: z.string(), player: z.enum(SEATS) }).passthrough() });
const hostSchema = z.object({
  deck: deckSchema,
  format: z.string().min(1).max(40),
  type: z.string().min(1).max(20),
  note: z.string().trim().max(80).default(""),
  password: z.string().max(60).default(""),
});
const undoSchema = z.object({ action: z.enum(["request", "accept", "decline"]), toLength: z.number().int().min(0).optional() });
const chatSchema = z.object({ text: z.string().trim().min(1).max(200), at: z.number().int().min(0) });
const rematchSchema = z.object({ action: z.enum(["request", "leave"]) });
const resultSchema = z.object({ winner: z.enum(SEATS) });

const rooms = new Map();

function newCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

function dropExpired(now) {
  for (const [code, room] of rooms) if (now - room.touchedAt > ROOM_TTL_MS) rooms.delete(code);
}

const seatOf = (room, userId) => room.seats.findIndex((s) => s?.userId === userId);
const publicSeat = (s) => (s ? { name: s.name, deck: s.deck } : null);

function toClient(room, seat, after, chatAfter) {
  return {
    code: room.code,
    mySeat: SEATS[seat],
    status: room.seats[1] ? "playing" : "waiting",
    seed: room.seed,
    firstPlayer: room.firstPlayer,
    seats: room.seats.map(publicSeat),
    total: room.moves.length,
    /** Goes up when moves are taken back: every browser rebuilds the game. */
    epoch: room.epoch,
    undoBy: room.undoBy === null ? null : SEATS[room.undoBy],
    rematchVotes: SEATS.filter((_, i) => room.rematch[i]),
    leftSeats: SEATS.filter((_, i) => room.left[i]),
    nextCode: room.next,
    moves: room.moves.slice(after),
    chat: room.chat.slice(chatAfter),
  };
}

const openDuel = (room, userId) => ({
  id: room.code,
  host: room.seats[0].name,
  mine: room.seats[0].userId === userId,
  format: room.format,
  type: room.type,
  note: room.note,
  locked: room.password !== "",
  leaderId: room.seats[0].deck.leaderId,
});

const roomCode = (req) => String(req.params.code).toUpperCase();
const seatName = (user) => user.display_name || user.username;

/** A new room object: moves, votes and results all start empty. */
function newRoom(now, fields) {
  return {
    code: newCode(), touchedAt: now, hostSeenAt: now,
    seed: `room-${randomBytes(9).toString("hex")}`,
    firstPlayer: SEATS[randomInt(2)],
    moves: [], chat: [], epoch: 0, undoBy: null,
    rematch: [false, false], left: [false, false], next: null,
    results: [null, null], recorded: false,
    ...fields,
  };
}

/** The saved deck behind a seat, only if it really is that player's. */
async function ownDeckId(seat) {
  if (!seat.deck.deckId) return null;
  const deck = await getDeck(seat.deck.deckId);
  return deck?.user_id === seat.userId ? deck.id : null;
}

/** Both players said who won and agree: one row each in their records. Marked
 *  "friend", so it stays out of the ladder and the meta (server/stats). */
async function recordFriendGame(room) {
  const winner = room.results[0];
  await Promise.all(room.seats.map(async (seat, i) => {
    const other = room.seats[1 - i];
    await createMatch({
      userId: seat.userId, oppUserId: other.userId, myDeckId: await ownDeckId(seat),
      myLeaderId: seat.deck.leaderId, oppLeaderId: other.deck.leaderId,
      result: winner === SEATS[i] ? "win" : "loss", onPlay: room.firstPlayer === SEATS[i],
      format: room.format, source: "friend",
    });
  }));
}

export function registerRooms(app, requireUser) {
  app.get("/api/rooms", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const now = Date.now();
    const open = [...rooms.values()].filter((r) => !r.seats[1] && now - r.hostSeenAt < HOST_GONE_MS);
    return reply.send({ duels: open.map((r) => openDuel(r, user.id)) });
  });

  app.post("/api/rooms", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = hostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid duel" });
    const now = Date.now();
    dropExpired(now);
    for (const [code, r] of rooms) if (r.seats[0].userId === user.id && !r.seats[1]) rooms.delete(code);
    const room = newRoom(now, {
      format: parsed.data.format, type: parsed.data.type, note: parsed.data.note, password: parsed.data.password,
      seats: [{ userId: user.id, name: seatName(user), deck: parsed.data.deck }, null],
    });
    rooms.set(room.code, room);
    return reply.code(201).send({ room: toClient(room, 0, 0, 0) });
  });

  app.post("/api/rooms/:code/join", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This duel no longer exists" });
    const already = seatOf(room, user.id);
    if (already === 0 && !room.seats[1]) return reply.code(400).send({ error: "This is your own duel" });
    if (already >= 0) return reply.send({ room: toClient(room, already, 0, 0) });
    if (room.seats[1]) return reply.code(409).send({ error: "This duel already has two players" });
    if (room.password && req.body?.password !== room.password) return reply.code(403).send({ error: "Wrong duel password" });
    const parsed = deckSchema.safeParse(req.body?.deck);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid deck" });
    room.seats[1] = { userId: user.id, name: seatName(user), deck: parsed.data };
    room.touchedAt = Date.now();
    return reply.send({ room: toClient(room, 1, 0, 0) });
  });

  app.get("/api/rooms/:code", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (seat === 0) room.hostSeenAt = Date.now();
    const after = Math.max(0, Number(req.query.after) || 0);
    const chatAfter = Math.max(0, Number(req.query.chatAfter) || 0);
    return reply.send({ room: toClient(room, seat, after, chatAfter) });
  });

  app.post("/api/rooms/:code/moves", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (!room.seats[1]) return reply.code(409).send({ error: "The game has not started" });
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid move" });
    if (parsed.data.intent.player !== SEATS[seat]) return reply.code(403).send({ error: "That move is not yours" });
    if (parsed.data.seq !== room.moves.length) return reply.code(409).send({ error: "Out of sync" });
    if (room.moves.length >= MAX_MOVES) return reply.code(409).send({ error: "This game is too long" });
    room.moves.push(parsed.data.intent);
    room.undoBy = null;
    room.touchedAt = Date.now();
    return reply.send({ total: room.moves.length });
  });

  // a take-back: one player asks, the other accepts and says how far back the
  // moves go (src/autosim/engine/takeBack.ts decides, so the whole action goes);
  // without that, the requester's last move and everything after it
  app.post("/api/rooms/:code/undo", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    const parsed = undoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    const { action } = parsed.data;
    if (action === "request") {
      if (!room.moves.some((m) => m.player === SEATS[seat])) return reply.code(409).send({ error: "You have no move to take back" });
      room.undoBy = seat;
    } else if (action === "decline") {
      room.undoBy = null;
    } else {
      if (room.undoBy === null || room.undoBy === seat) return reply.code(409).send({ error: "Only your opponent can accept" });
      const last = room.moves.findLastIndex((m) => m.player === SEATS[room.undoBy]);
      const { toLength } = parsed.data;
      room.moves.length = toLength !== undefined && toLength <= last ? toLength : last;
      room.undoBy = null;
      room.epoch += 1;
    }
    room.touchedAt = Date.now();
    return reply.send({ ok: true });
  });

  app.post("/api/rooms/:code/chat", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid message" });
    if (room.chat.length >= MAX_CHAT) return reply.code(409).send({ error: "The chat is full" });
    room.chat.push({ seat: SEATS[seat], text: parsed.data.text, at: parsed.data.at });
    return reply.send({ ok: true });
  });

  // "Rematch": when both players asked, a new room with the same seats and decks
  // (new seed, new first player); both browsers follow `nextCode` there.
  // "leave": the other player is told, and no rematch can happen any more.
  app.post("/api/rooms/:code/rematch", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (!room.seats[1]) return reply.code(409).send({ error: "The game has not started" });
    const parsed = rematchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    if (parsed.data.action === "leave") {
      if (!room.next) { room.left[seat] = true; room.rematch[seat] = false; }
      return reply.send({ ok: true });
    }
    if (room.left[1 - seat]) return reply.code(409).send({ error: "Your opponent has left" });
    room.rematch[seat] = true;
    room.touchedAt = Date.now();
    if (room.rematch[0] && room.rematch[1] && !room.next) {
      const next = newRoom(Date.now(), { format: room.format, type: room.type, note: "", password: "", seats: [...room.seats] });
      rooms.set(next.code, next);
      room.next = next.code;
    }
    return reply.send({ ok: true });
  });

  // the end of a game, reported by each browser. The server does not run the
  // engine, so a game counts only if both say the same winner, and only once.
  app.post("/api/rooms/:code/result", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (!room.seats[1]) return reply.code(409).send({ error: "The game has not started" });
    const parsed = resultSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid result" });
    room.results[seat] ??= parsed.data.winner;
    const agreed = room.results[0] !== null && room.results[0] === room.results[1];
    if (agreed && !room.recorded) {
      room.recorded = true;
      await recordFriendGame(room);
    }
    return reply.send({ recorded: room.recorded });
  });

  // only the host, and only before anyone joined: a started game stays for both
  app.delete("/api/rooms/:code", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (room && seatOf(room, user.id) === 0 && !room.seats[1]) rooms.delete(room.code);
    return reply.send({ ok: true });
  });
}
