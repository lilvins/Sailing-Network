/**
 * board-auto store — the UI side of the AUTOSIM engine (AUTOSIM_PLAN.md §7).
 *
 * NO rules logic here: every move is a PlayerIntent handed to applyIntent;
 * the engine validates, resolves and returns GameEvents that we append to the
 * log. Illegal intents throw EngineError → we turn the message into an
 * explained banner (never a silent no). The game state and the event log stay
 * JSON-serializable at all times.
 *
 * Hotseat: both seats live on this page; whoever `legalMoves().actor` names
 * answers the current prompt. A seat can be played by an AI agent
 * (src/autosim/ai): the page calls aiStep() on a timer while it is that
 * seat's move — two AI seats make a game to watch.
 */
import { create } from "zustand";
import type { Card } from "../cards/cardsDb";
import { loadCardsById } from "../cards/cardsDb";
import { applyIntent, createGame } from "../../autosim/engine/engine";
import { EngineError, type PlayerIntent } from "../../autosim/engine/intents";
import type { GameEvent } from "../../autosim/engine/events";
import type { AutoGameState, CardDb, PID } from "../../autosim/engine/state";
import { agentStep, actorOf, type Agent } from "../../autosim/ai/agent";
import { createProAgent, type ProAgent } from "../../autosim/ai/pro";
import { makePlan, type AiPlan } from "./aiPlan";
import { clearGame, loadGame, saveGame } from "./savedGame";
import {
  finishRecording, nextPlay, playsIn, recordPlay, rewindRecording, startRecording, stateAfter,
  type Recording, type ReplayRecord, type ReplaySeat,
} from "../replay/record";
import { sendReplay } from "../replay/replayApi";
import { makeCardDb } from "./compile";
import type { DeckChoice } from "./decks";

export type Stage = "pick" | "roll" | "play";

export interface SeatSetup {
  pid: PID;
  name: string;
  deck: DeckChoice;
  /** Who plays this seat: a person at this screen, the Pro bot, or a friend in another browser. */
  controller?: "human" | "ai" | "remote";
}

export const isAiSeat = (seats: SeatSetup[] | null, pid: PID): boolean =>
  !!seats?.some((s) => s.pid === pid && s.controller === "ai");

/** Nobody at this screen plays this seat: the AI or a friend does. */
export const notHere = (seats: SeatSetup[] | null, pid: PID): boolean =>
  !!seats?.some((s) => s.pid === pid && (s.controller === "ai" || s.controller === "remote"));

export interface RoomChatLine { seat: PID; text: string; at: number }

/** The friend game this browser is in (room.ts keeps it in step with the server). */
export interface OnlineState {
  code: string;
  mySeat: PID;
  status: "waiting" | "playing";
  /** How many of the room's moves are already in `game`. */
  applied: number;
  chat: RoomChatLine[];
  /** Goes up on the server when moves are taken back. */
  epoch: number;
  /** After the game: who asked to play again, who has left the table. */
  rematchVotes?: PID[];
  leftSeats?: PID[];
  /** A ranked table: the server plays the game, and `game` is this player's view of it (src/autosim/view.ts),
   *  with stand-ins for the cards they may not see. No take-back, no rematch, and the result is the server's word. */
  ranked?: boolean;
  /** A ranked table: moves of this player on their way to the server, not answered yet. */
  waiting?: number;
}

/** A finished game being watched again on the table (src/features/replay). */
export interface ReplayView {
  id: string;
  record: ReplayRecord;
  /** Plays shown so far (0 = the opening hands). */
  step: number;
  /** Playing by itself, one play after the other. */
  playing: boolean;
  /** Fast Forward is on. */
  fast: boolean;
  /** Hide Hands, Show Hand (the bottom seat's), Show Both. */
  hands: ReplayHands;
  /** The seat drawn at the bottom of the screen. */
  bottom: PID;
}
export type ReplayHands = "hide" | "one" | "both";

/** Set by room.ts: the store only knows that moves have to go somewhere. */
let onlineHooks: {
  send: (code: string, seq: number, intent: PlayerIntent) => void;
  leave: () => void;
  undo: (code: string, action: "request" | "accept" | "decline") => void;
} | null = null;
export function setOnlineHooks(hooks: NonNullable<typeof onlineHooks>): void {
  onlineHooks = hooks;
}

/** One move as it was before it was played — what a take-back restores. */
export interface HistoryEntry {
  /** The state before the move (applyIntent never changes it: kept as is). */
  game: AutoGameState;
  /** How many events the log had before the move. */
  eventsLen: number;
  /** Who made the move. */
  actor: PID;
  /** How many plays the recording had before the move. */
  plays: number;
}

/** Moves kept for take-backs. */
const HISTORY_LIMIT = 60;

export interface Banner {
  id: number;
  text: string;
  hint?: string;
  /** "error" = explained refusal (red); "info" = neutral hint (brass). */
  tone?: "error" | "info";
}

/** Module-level (non-serializable) lookups — deliberately outside the store
 *  state: the store holds plain data only. */
let cardsById: Map<string, Card> | null = null;
let cardDb: CardDb | null = null;
/** One agent per AI seat, made when the game starts (they keep their own RNG). */
let agents: Record<PID, ProAgent> = {};

export function getCardsById(): Map<string, Card> | null {
  return cardsById;
}
export function getCardDb(): CardDb | null {
  return cardDb;
}

let bannerSeq = 1;
/** The last move sent to a ranked table, as text: a second click on the same button is not a second move. */
let lastRankedMove = "";

/** The "confirm every choice" table setting, remembered per browser. */
const CONFIRM_KEY = "sn-auto-confirm-picks";
function readConfirmPicks(): boolean {
  try { return localStorage.getItem(CONFIRM_KEY) === "1"; } catch { return false; }
}

/** Turn an EngineError message into "why + what to do" (grammar rule #7:
 *  refusals are explained, never a flat no). */
function hintFor(message: string): string | undefined {
  if (/not enough active DON/i.test(message)) return "Rest more DON!! first — or pick a cheaper card.";
  if (/3-7-4/.test(message)) return "Characters can't attack the turn they enter play (no [Rush]).";
  if (/6-5-6-1/.test(message)) return "No battles on either player's first turn.";
  if (/RESTED characters/i.test(message)) return "Only the Leader or RESTED characters can be attacked.";
  if (/attacker is rested/i.test(message)) return "A rested card has already acted this turn.";
  if (/10-2-3/.test(message)) return "This Event only works in another window (e.g. [Counter] during the Counter Step).";
  if (/replaceIid required/i.test(message)) return "Your character area is full (5): tap a character to replace it.";
  if (/not your turn/i.test(message)) return "Wait for your turn — or answer the open prompt.";
  if (/pending choice/i.test(message)) return "Answer the open prompt first.";
  if (/cannot attack/i.test(message)) return "An effect restriction is stopping this card from attacking.";
  return undefined;
}

interface AutoStoreState {
  stage: Stage;
  catalogReady: boolean;
  catalogError: string | null;
  seats: [SeatSetup, SeatSetup] | null;
  roll: { a: number; b: number; winnerIdx: 0 | 1 } | null;
  game: AutoGameState | null;
  events: GameEvent[];
  banner: Banner | null;
  /** The next deck pick starts with seat B played by the AI (Home → Play vs Bot). */
  aiOpponent: boolean;
  /** AI seats: paused, and the pause between their moves (ms). */
  aiPaused: boolean;
  aiDelay: number;
  /** Table setting: false (default) = a choice that is complete resolves at
   *  once and windows with nothing to do are skipped; true = every choice
   *  waits for a Confirm / button press. Remembered in this browser. */
  confirmPicks: boolean;
  /** Every move of this game, oldest first (take-backs). */
  history: HistoryEntry[];
  /** The game as it will be watched again (src/features/replay): one play per move.
   *  null = this game cannot be recorded whole (a reload cut its log). */
  recording: Recording | null;
  /** The finished game's replay on the server, once it is saved there. */
  replayId: string | null;
  /** A player asked to take back their last move; the opponent must answer. */
  /** `eventsLen`: friend games, where the move being taken back starts in `events`. */
  undoRequest: { by: PID; eventsLen?: number } | null;
  /** Coach mode: while paused, Step first shows the move the AI is about to make (and why), the next Step plays it. */
  aiPlan: AiPlan | null;
  online: OnlineState | null;
  /** Set while the table shows a replay: nothing on it can be played. */
  replay: ReplayView | null;

  /** Puts a finished game on the table, at its opening hands, playing. */
  openReplay: (id: string, record: ReplayRecord, bottom: PID) => void;
  /** Next Play: one play forward (stops the playback at the last one). */
  replayNext: () => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplayFast: (fast: boolean) => void;
  setReplayHands: (hands: ReplayHands) => void;
  /** Back to the opening hands, playing. */
  restartReplay: () => void;
  /** Leaves the replay: the game that was in progress at this screen comes back, if there was one. */
  closeReplay: () => void;

  init: () => Promise<void>;
  /** `recording`: null at a ranked table, where the server keeps the record. */
  loadOnlineGame: (g: { seats: [SeatSetup, SeatSetup]; game: AutoGameState; events: GameEvent[]; recording: Recording | null; online: OnlineState }) => void;
  /** A ranked table answered a move of this player: one fewer on its way. `refusal`: why the server
   *  would not play it, shown like any refused move. */
  rankedAnswered: (refusal?: string) => void;
  /** pick → roll */
  confirmSeats: (seats: [SeatSetup, SeatSetup]) => void;
  doRoll: () => void;
  /** roll → play. `firstIdx` = seat index that plays first (winner's choice). */
  chooseFirst: (firstIdx: 0 | 1) => void;
  /** The single gate every UI move goes through. Returns true when applied. */
  dispatch: (intent: PlayerIntent) => boolean;
  /** One move by the AI whose turn it is to act (no-op when a human must act). */
  aiStep: () => void;
  /** Open the deck pick fresh, seat B to the AI or both seats human. */
  newGame: (aiOpponent: boolean) => void;
  /** Ask to take back the last move a person made (an AI opponent accepts at once). */
  requestUndo: () => void;
  answerUndo: (accept: boolean) => void;
  setAiPaused: (paused: boolean) => void;
  setAiDelay: (ms: number) => void;
  setConfirmPicks: (on: boolean) => void;
  explain: (text: string, hint?: string, tone?: Banner["tone"]) => void;
  dismissBanner: () => void;
  /** Back to the roll with the same decks (rematch) or to the deck pick. */
  rematch: () => void;
  reset: () => void;
}

export const useAutoStore = create<AutoStoreState>((set, get) => ({
  stage: "pick",
  catalogReady: false,
  catalogError: null,
  seats: null,
  roll: null,
  game: null,
  events: [],
  banner: null,
  aiOpponent: false,
  aiPaused: false,
  aiDelay: 700,
  confirmPicks: readConfirmPicks(),
  history: [],
  recording: null,
  replayId: null,
  undoRequest: null,
  aiPlan: null,
  online: null,
  replay: null,

  openReplay: (id, record, bottom) => {
    if (get().online) onlineHooks?.leave(); // watching it means leaving the table it was played at
    agents = {};
    const seat = (s: ReplaySeat): SeatSetup => ({
      pid: s.pid, name: s.name, controller: "remote",
      deck: { key: `replay:${s.pid}`, name: s.deckName, sub: "", leaderId: s.leaderId, main: [], source: "mine" },
    });
    // a line said after the last event that was kept (a take-back removed the rest) still belongs to the game
    const chat = record.chat.map((line) => (line.at > record.events.length ? { ...line, at: record.events.length } : line));
    set({
      stage: "play", seats: [seat(record.seats[0]), seat(record.seats[1])], roll: null,
      game: stateAfter(record, 0), events: record.events.slice(0, record.cuts[0]),
      recording: null, replayId: null, history: [], undoRequest: null, aiPlan: null, banner: null, online: null,
      replay: { id, record: { ...record, chat }, step: 0, playing: playsIn(record) > 0, fast: false, hands: "both", bottom },
    });
  },

  replayNext: () => {
    const { replay, game } = get();
    if (!replay || !game) return;
    const last = playsIn(replay.record);
    if (replay.step >= last) { set({ replay: { ...replay, playing: false } }); return; }
    const step = replay.step + 1;
    set({
      game: nextPlay(replay.record, game, replay.step),
      events: replay.record.events.slice(0, replay.record.cuts[step]),
      replay: { ...replay, step, playing: replay.playing && step < last },
    });
  },

  setReplayPlaying: (playing) => {
    const { replay } = get();
    if (replay) set({ replay: { ...replay, playing: playing && replay.step < playsIn(replay.record) } });
  },
  setReplayFast: (fast) => { const { replay } = get(); if (replay) set({ replay: { ...replay, fast } }); },
  setReplayHands: (hands) => { const { replay } = get(); if (replay) set({ replay: { ...replay, hands } }); },

  restartReplay: () => {
    const { replay } = get();
    if (!replay) return;
    set({
      game: stateAfter(replay.record, 0), events: replay.record.events.slice(0, replay.record.cuts[0]),
      replay: { ...replay, step: 0, playing: playsIn(replay.record) > 0 },
    });
  },

  closeReplay: () => {
    if (!get().replay) return;
    set({ replay: null, stage: "pick", seats: null, roll: null, game: null, events: [], banner: null });
    resumeSavedGame();
  },

  loadOnlineGame: ({ seats, game, events, recording, online }) => {
    agents = {};
    set({ stage: "play", seats, game, events, recording, online, replay: null, banner: null, aiPaused: false, history: [], undoRequest: null, aiPlan: null });
  },

  rankedAnswered: (refusal) => {
    const { online } = get();
    if (online) set({ online: { ...online, waiting: Math.max(0, (online.waiting ?? 0) - 1) } });
    if (refusal) set({ banner: { id: bannerSeq++, text: refusal, hint: hintFor(refusal) } });
  },

  init: async () => {
    if (cardsById) {
      set({ catalogReady: true });
      return;
    }
    try {
      cardsById = await loadCardsById();
      cardDb = makeCardDb(cardsById);
      set({ catalogReady: true, catalogError: null });
      if (!get().replay) resumeSavedGame();
    } catch (e) {
      set({ catalogError: e instanceof Error ? e.message : "failed to load the card catalog" });
    }
  },

  confirmSeats: (seats) => set({ seats, stage: "roll", roll: null }),

  doRoll: () => {
    let a = 0;
    let b = 0;
    while (a === b) {
      a = 1 + Math.floor(Math.random() * 6);
      b = 1 + Math.floor(Math.random() * 6);
    }
    set({ roll: { a, b, winnerIdx: a > b ? 0 : 1 } });
  },

  chooseFirst: (firstIdx) => {
    const { seats } = get();
    if (!seats || !cardDb) return;
    try {
      // DEV: the verification driver may pin the seed (window.__autoSeed) to
      // reproduce a specific opening hand; production ignores it
      const pinned = import.meta.env.DEV && typeof window !== "undefined"
        ? (window as unknown as { __autoSeed?: string }).__autoSeed
        : undefined;
      const { state, events } = createGame(cardDb, {
        seed: pinned || `boardauto-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
        players: [
          { id: seats[0].pid, leader: seats[0].deck.leaderId, deck: seats[0].deck.main },
          { id: seats[1].pid, leader: seats[1].deck.leaderId, deck: seats[1].deck.main },
        ],
        firstPlayer: seats[firstIdx].pid,
      });
      agents = makeAgents(seats, state.seed);
      set({ game: state, events, recording: startRecording(state, events.length), stage: "play", banner: null, aiPaused: false, history: [], undoRequest: null, aiPlan: null });
    } catch (e) {
      // deck construction failed (user decks can be illegal) → back to pick
      const msg = e instanceof Error ? e.message : String(e);
      set({
        stage: "pick",
        banner: { id: bannerSeq++, text: `Deck not legal: ${msg}`, hint: "Fix the deck in the Deck Builder (50 cards, max 4 copies, leader colors only) or pick a Demo deck." },
      });
    }
  },

  dispatch: (intent) => {
    const { game, events, seats, online, recording } = get();
    if (!game || !cardDb || get().replay) return false; // a replay is watched, not played
    if (online && intent.player !== online.mySeat) {
      set({ banner: { id: bannerSeq++, text: online.ranked ? "It's your opponent's move." : "It's your friend's move.", hint: "Wait for them to answer.", tone: "info" } });
      return false;
    }
    if (online?.ranked) {
      // the server plays a ranked game, and this browser holds only its own player's view of it:
      // the move goes there and the table shows what comes back (room.ts). Moves made while one
      // is on its way follow it in order; the same click twice is one move.
      if (game.phase === "over") return false;
      const sent = JSON.stringify(intent);
      if (online.waiting && sent === lastRankedMove && intent.type !== "giveDon") return false;
      lastRankedMove = sent;
      set({ online: { ...online, waiting: (online.waiting ?? 0) + 1 }, undoRequest: null, aiPlan: null });
      onlineHooks?.send(online.code, online.applied, intent);
      return true;
    }
    if (intent.type !== "concede" && game.phase !== "over" && isAiSeat(seats, actorOf(cardDb, game))) {
      set({ banner: { id: bannerSeq++, text: "The AI is playing this move.", hint: "Wait for it — or concede for that seat.", tone: "info" } });
      return false;
    }
    try {
      const r = applyIntent(cardDb, game, intent);
      const actor = actorOf(cardDb, game);
      set({
        game: r.state, events: [...events, ...r.events], undoRequest: null, aiPlan: null,
        recording: recording && recordPlay(recording, intent, r.state, events.length + r.events.length),
        history: remember(get().history, { game, eventsLen: events.length, actor, plays: recording ? playsIn(recording) : 0 }),
      });
      if (online) {
        set({ online: { ...online, applied: online.applied + 1 } });
        onlineHooks?.send(online.code, online.applied, intent);
      }
      return true;
    } catch (e) {
      if (e instanceof EngineError) {
        set({ banner: { id: bannerSeq++, text: e.message, hint: hintFor(e.message) } });
      } else {
        set({ banner: { id: bannerSeq++, text: e instanceof Error ? e.message : String(e) } });
      }
      return false;
    }
  },

  aiStep: () => {
    const { game, events, aiPaused, aiPlan, recording } = get();
    if (!game || !cardDb || game.phase === "over") return;
    if (get().undoRequest) return; // a take-back is being decided
    const actor = actorOf(cardDb, game);
    const agent = agents[actor];
    if (!agent) return;
    try {
      // coach mode: a paused Step first SHOWS the move and its candidates
      if (aiPaused && !aiPlan) {
        const intent = agent.decide(cardDb, game, actor);
        set({ aiPlan: makePlan(game, cardsById, actor, intent, agent.lastThoughts()) });
        return;
      }
      const r = aiPlan ? playPlanned(cardDb, game, aiPlan, agent) : agentStep(cardDb, game, agent);
      set({
        game: r.state, events: [...events, ...r.events], aiPlan: null,
        recording: recording && recordPlay(recording, r.intent, r.state, events.length + r.events.length),
        history: remember(get().history, { game, eventsLen: events.length, actor, plays: recording ? playsIn(recording) : 0 }),
      });
    } catch (e) {
      // the agent and every fallback were refused: stop and say so
      set({ aiPaused: true, banner: { id: bannerSeq++, text: `AI stuck: ${e instanceof Error ? e.message : String(e)}`, hint: "The AI is paused. Concede for that seat, or change decks." } });
    }
  },
  requestUndo: () => {
    const { history, seats, online } = get();
    if (online) {
      set({ undoRequest: { by: online.mySeat } });
      onlineHooks?.undo(online.code, "request");
      return;
    }
    const last = [...history].reverse().find((h) => !isAiSeat(seats, h.actor));
    if (!last) return;
    const opponent = seats?.find((s) => s.pid !== last.actor);
    set({ undoRequest: { by: last.actor } });
    if (opponent?.controller === "ai") get().answerUndo(true); // the AI never says no
  },

  answerUndo: (accept) => {
    const { history, seats, undoRequest, events, online, recording } = get();
    if (!undoRequest) return;
    if (online) {
      set({ undoRequest: null });
      onlineHooks?.undo(online.code, accept ? "accept" : "decline");
      return;
    }
    if (!accept) {
      set({ undoRequest: null, banner: { id: bannerSeq++, text: "Take-back declined.", tone: "info" } });
      return;
    }
    // back to before the requester's last move (and whatever came after it)
    let at = -1;
    for (let i = history.length - 1; i >= 0; i--) if (history[i].actor === undoRequest.by && !isAiSeat(seats, history[i].actor)) { at = i; break; }
    if (at < 0) { set({ undoRequest: null }); return; }
    const h = history[at];
    set({
      game: h.game, events: events.slice(0, h.eventsLen), history: history.slice(0, at), undoRequest: null, aiPlan: null,
      recording: recording && rewindRecording(recording, h.plays),
      banner: { id: bannerSeq++, text: "Move taken back.", tone: "info" },
    });
  },

  newGame: (aiOpponent) => { onlineHooks?.leave(); set({ aiOpponent, stage: "pick", seats: null, roll: null, game: null, events: [], recording: null, banner: null }); },
  setAiPaused: (aiPaused) => set({ aiPaused }),
  setAiDelay: (aiDelay) => set({ aiDelay }),
  setConfirmPicks: (confirmPicks) => {
    try { localStorage.setItem(CONFIRM_KEY, confirmPicks ? "1" : "0"); } catch { /* storage off: this session only */ }
    set({ confirmPicks });
  },

  explain: (text, hint, tone) => set({ banner: { id: bannerSeq++, text, hint, tone } }),
  dismissBanner: () => set({ banner: null }),

  rematch: () => set({ stage: "roll", roll: null, game: null, events: [], recording: null, banner: null, history: [], undoRequest: null, aiPlan: null }),
  reset: () => { onlineHooks?.leave(); set({ stage: "pick", seats: null, roll: null, game: null, events: [], recording: null, banner: null, history: [], undoRequest: null, aiPlan: null }); },
}));

const remember = (history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] =>
  [...history, entry].slice(-HISTORY_LIMIT);

/** The move shown in coach mode; if the engine refuses it, the agent's usual step (with its fallback). */
function playPlanned(db: CardDb, game: AutoGameState, plan: AiPlan, agent: Agent) {
  try {
    return { ...applyIntent(db, game, plan.intent), intent: plan.intent };
  } catch {
    return agentStep(db, game, agent);
  }
}

// DEV: coaching tools read the live game (seed, state) from the console
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __autoStore?: typeof useAutoStore }).__autoStore = useAutoStore;

/** A reload in the middle of a game resumes it (AI seats paused, so nothing moves by surprise). */
function resumeSavedGame(): void {
  const saved = loadGame();
  if (!saved || saved.game.phase === "over") return;
  agents = makeAgents(saved.seats, `${saved.game.seed}:resumed`);
  useAutoStore.setState({
    stage: "play", seats: saved.seats, game: saved.game, events: saved.events, recording: saved.recording ?? null,
    aiDelay: saved.aiDelay, aiPaused: true, aiPlan: null,
  });
}

/** One Pro agent per AI seat, seeded from the game. */
function makeAgents(seats: SeatSetup[], seed: string): Record<PID, ProAgent> {
  return Object.fromEntries(seats.filter((s) => s.controller === "ai").map((s) => [s.pid, createProAgent(`${seed}:${s.pid}`)]));
}

/** The game on the table as a replay record; null when it was not recorded whole. */
export function currentRecord(): ReplayRecord | null {
  const { recording, seats, events, online } = useAutoStore.getState();
  if (!recording || !seats) return null;
  const seat = (s: SeatSetup): ReplaySeat => ({
    pid: s.pid, name: s.name, controller: s.controller === "ai" ? "ai" : "human", deckName: s.deck.name, leaderId: s.deck.leaderId,
  });
  return finishRecording(recording, [seat(seats[0]), seat(seats[1])], events, online?.chat ?? []);
}

// a game that ends is kept as a replay. A friend game is saved by its room
// (room.ts sends the record with the result); any other is sent in from here.
useAutoStore.subscribe((s, prev) => {
  if (s.game === prev.game) return;
  if (s.game?.phase !== "over") {
    if (s.replayId) useAutoStore.setState({ replayId: null }); // another game, or a take-back
    return;
  }
  if (prev.game?.phase === "over" || s.online || s.replay) return;
  const record = currentRecord();
  const game = s.game;
  if (record && playsIn(record) > 0) void sendReplay(record).then((id) => { if (id && useAutoStore.getState().game === game) useAutoStore.setState({ replayId: id }); });
});

// keep the game in progress across a page reload (savedGame.ts); a finished or abandoned one is dropped
useAutoStore.subscribe((s, prev) => {
  if (s.game === prev.game && s.stage === prev.stage) return;
  if (s.online) return; // a friend game comes back from the server (room.ts)
  if (s.replay || prev.replay) return; // a replay on the table is not the game in progress: that one stays saved
  if (s.stage === "play" && s.game && s.seats && s.game.phase !== "over") saveGame({ seats: s.seats, game: s.game, events: s.events, recording: s.recording ?? undefined, aiDelay: s.aiDelay });
  else clearGame();
});

