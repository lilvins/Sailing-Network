/**
 * Friend games, the browser's side of server/rooms.mjs. Lockstep: both
 * browsers build the same game from the room's seed and decks, then apply the
 * same moves in the same order. The engine is deterministic, so they stay equal.
 * The whole game state is in both browsers: fine between friends, not for ranked.
 */
import { useUiStore } from "../../app/uiStore";
import { applyIntent, createGame } from "../../autosim/engine/engine";
import type { PlayerIntent } from "../../autosim/engine/intents";
import type { GameEvent } from "../../autosim/engine/events";
import type { AutoGameState, PID } from "../../autosim/engine/state";
import { getCardDb, setOnlineHooks, useAutoStore, type RoomChatLine, type SeatSetup } from "./autoStore";
import type { DeckChoice } from "./decks";

interface RoomSeat { name: string; deck: { name: string; leaderId: string; main: string[] } }
interface RoomInfo {
  code: string;
  mySeat: PID;
  status: "waiting" | "playing";
  seed: string;
  firstPlayer: PID;
  seats: [RoomSeat, RoomSeat | null];
  total: number;
  epoch: number;
  undoBy: PID | null;
  moves: PlayerIntent[];
  chat: RoomChatLine[];
}

const POLL_MS = 700;
const SAVED_KEY = "sn-friend-game";

let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;
/** Moves go out one at a time, in the order they were played. */
let sending: Promise<void> = Promise.resolve();

async function call(path: string, init?: { method: string; body?: unknown }): Promise<{ room?: RoomInfo; status: number; error?: string }> {
  const r = await fetch(path, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as { room?: RoomInfo; error?: string };
  return { ...data, status: r.status };
}

function remember(code: string | null): void {
  try {
    if (code) localStorage.setItem(SAVED_KEY, code);
    else localStorage.removeItem(SAVED_KEY);
  } catch { /* storage off: a reload leaves the game */ }
}
function savedCode(): string | null {
  try { return localStorage.getItem(SAVED_KEY); } catch { return null; }
}

/** The game from its first move: same result in both browsers. */
function buildGame(room: RoomInfo): { game: AutoGameState; events: GameEvent[]; seats: [SeatSetup, SeatSetup] } {
  const db = getCardDb()!;
  const [a, b] = [room.seats[0], room.seats[1]!];
  const seat = (pid: PID, s: RoomSeat): SeatSetup => ({
    pid, name: s.name, controller: "remote",
    deck: { key: `room:${pid}`, name: s.deck.name, sub: "", leaderId: s.deck.leaderId, main: s.deck.main, source: "mine" },
  });
  const seats: [SeatSetup, SeatSetup] = [seat("seatA", a), seat("seatB", b)];
  for (const s of seats) if (s.pid === room.mySeat) s.controller = "human";
  const made = createGame(db, {
    seed: room.seed,
    firstPlayer: room.firstPlayer,
    players: [{ id: "seatA", leader: a.deck.leaderId, deck: a.deck.main }, { id: "seatB", leader: b.deck.leaderId, deck: b.deck.main }],
  });
  let game = made.state;
  let events = made.events;
  for (const move of room.moves) {
    const r = applyIntent(db, game, move);
    game = r.state;
    events = [...events, ...r.events];
  }
  return { game, events, seats };
}

function startPlaying(room: RoomInfo): void {
  const { game, events, seats } = buildGame(room);
  useAutoStore.getState().loadOnlineGame({ seats, game, events, online: {
    code: room.code, mySeat: room.mySeat, status: "playing", applied: room.total, chat: room.chat, epoch: room.epoch,
  } });
  useAutoStore.setState({ undoRequest: room.undoBy ? { by: room.undoBy } : null });
  remember(game.phase === "over" ? null : room.code);
}

/** Back to what the server holds: used whenever this browser may have drifted. */
async function resync(code: string, message = "Game re-synced with the server."): Promise<void> {
  const r = await call(`/api/rooms/${code}`);
  if (r.room?.status === "playing") {
    startPlaying(r.room);
    useAutoStore.getState().explain(message, undefined, "info");
  }
}

function applyRemote(room: RoomInfo): void {
  const store = useAutoStore.getState();
  const { online, game, events, undoRequest } = store;
  if (!online || !game) return;
  if ((undoRequest?.by ?? null) !== room.undoBy) useAutoStore.setState({ undoRequest: room.undoBy ? { by: room.undoBy } : null });
  const db = getCardDb()!;
  let g = game;
  let ev = events;
  try {
    for (const move of room.moves) {
      const r = applyIntent(db, g, move);
      g = r.state;
      ev = [...ev, ...r.events];
    }
  } catch {
    void resync(online.code);
    return;
  }
  const chat = room.chat.length > 0 ? [...online.chat, ...room.chat] : online.chat;
  if (room.moves.length === 0 && chat === online.chat) return;
  useAutoStore.setState({ game: g, events: ev, online: { ...online, applied: online.applied + room.moves.length, chat } });
  if (g.phase === "over") remember(null);
}

async function pollOnce(code: string): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const { online, game } = useAutoStore.getState();
    if (online?.code !== code) return;
    const after = game ? online.applied : 0;
    const r = await call(`/api/rooms/${code}?after=${after}&chatAfter=${game ? online.chat.length : 0}`);
    const now = useAutoStore.getState();
    if (now.online?.code !== code) return;
    if (r.status === 401) {
      // logged out: stop asking, but keep the game saved for the next login
      if (timer) clearInterval(timer);
      timer = null;
      useAutoStore.setState({ online: null });
      return;
    }
    if (r.status === 404 || r.status === 403) {
      leaveRoom();
      useAutoStore.getState().explain(r.error ?? "This game no longer exists.");
      return;
    }
    if (!r.room) return; // a network hiccup: the next tick tries again
    if (r.room.status === "playing" && !now.game) {
      startPlaying(r.room); // someone took the seat: to the table, from wherever the host is
      useUiStore.getState().setView("board-auto");
    }
    else if (now.game && r.room.epoch !== now.online.epoch) await resync(code, "Move taken back.");
    else if (now.game && now.online.applied === after) applyRemote(r.room);
  } catch { /* offline for a moment: the next tick tries again */ } finally {
    polling = false;
  }
}

function startPolling(code: string): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void pollOnce(code), POLL_MS);
}

function enterRoom(room: RoomInfo): void {
  useAutoStore.setState({ game: null, events: [], online: { code: room.code, mySeat: room.mySeat, status: room.status, applied: 0, chat: [], epoch: room.epoch } });
  remember(room.code);
  if (room.status === "playing") startPlaying(room);
  startPolling(room.code);
}

const deckBody = (deck: DeckChoice) => ({ name: deck.name, leaderId: deck.leaderId, main: deck.main });

/** The engine's own deck rules (50 cards, 4 copies, colours), before anyone waits on a bad list. */
async function deckProblem(deck: DeckChoice): Promise<string | null> {
  await useAutoStore.getState().init();
  const db = getCardDb();
  if (!db) return "The card catalog is not available";
  try {
    const player = (id: string) => ({ id, leader: deck.leaderId, deck: deck.main });
    createGame(db, { seed: "check", firstPlayer: "seatA", players: [player("seatA"), player("seatB")] });
    return null;
  } catch (e) {
    return `Deck not legal: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export interface OpenDuel {
  id: string;
  host: string;
  mine: boolean;
  format: string;
  type: string;
  note: string;
  locked: boolean;
  leaderId: string;
}

export async function listOpenDuels(): Promise<OpenDuel[]> {
  const r = await fetch("/api/rooms", { credentials: "include" });
  return r.ok ? ((await r.json()) as { duels: OpenDuel[] }).duels : [];
}

export async function hostDuel(deck: DeckChoice, duel: { format: string; type: string; note: string; password: string }): Promise<string | null> {
  const problem = await deckProblem(deck);
  if (problem) return problem;
  const r = await call("/api/rooms", { method: "POST", body: { ...duel, deck: deckBody(deck) } });
  if (!r.room) return r.error ?? "Could not host the duel";
  enterRoom(r.room);
  return null;
}

export async function joinDuel(id: string, deck: DeckChoice, password: string): Promise<string | null> {
  const problem = await deckProblem(deck);
  if (problem) return problem;
  const r = await call(`/api/rooms/${encodeURIComponent(id)}/join`, { method: "POST", body: { deck: deckBody(deck), password } });
  if (!r.room) return r.error ?? "Could not join the duel";
  enterRoom(r.room);
  useUiStore.getState().setView("board-auto");
  return null;
}

/** Stop following the room. A started game stays on the server for the other player. */
export function leaveRoom(): void {
  const { online } = useAutoStore.getState();
  if (!online) return; // a game saved for after a reload is not left by opening another screen
  if (timer) clearInterval(timer);
  timer = null;
  remember(null);
  if (online.status === "waiting") void call(`/api/rooms/${online.code}`, { method: "DELETE" }).catch(() => {});
  useAutoStore.setState({ online: null });
}

/** A reload during a friend game comes back to it. */
export async function resumeRoom(): Promise<void> {
  const code = savedCode();
  if (!code || useAutoStore.getState().online) return;
  const r = await call(`/api/rooms/${code}`).catch(() => null);
  if (!r?.room) { remember(null); return; }
  enterRoom(r.room);
  if (r.room.status === "waiting") useUiStore.getState().setView("duel-room");
  else if (useAutoStore.getState().game?.phase === "over") leaveRoom();
}

export const hasSavedRoom = (): boolean => savedCode() !== null;

export async function sendRoomChat(text: string, at: number): Promise<void> {
  const { online } = useAutoStore.getState();
  if (online) await call(`/api/rooms/${online.code}/chat`, { method: "POST", body: { text, at } }).catch(() => {});
}

setOnlineHooks({
  send: (code, seq, intent) => {
    sending = sending.then(async () => {
      const r = await call(`/api/rooms/${code}/moves`, { method: "POST", body: { seq, intent } }).catch(() => null);
      if (!r || r.status >= 400) await resync(code);
      else if (useAutoStore.getState().game?.phase === "over") remember(null);
    });
  },
  leave: leaveRoom,
  undo: (code, action) => {
    void call(`/api/rooms/${code}/undo`, { method: "POST", body: { action } }).then((r) => {
      if (r.status >= 400) {
        useAutoStore.setState({ undoRequest: null });
        useAutoStore.getState().explain(r.error ?? "Could not take the move back.");
      }
    });
  },
});
