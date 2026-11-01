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
import { makeCardDb } from "./compile";
import type { DeckChoice } from "./decks";

export type Stage = "pick" | "roll" | "play";

export interface SeatSetup {
  pid: PID;
  name: string;
  deck: DeckChoice;
  /** Who plays this seat: a person at this screen, or the Pro bot. */
  controller?: "human" | "ai";
}

export const isAiSeat = (seats: SeatSetup[] | null, pid: PID): boolean =>
  !!seats?.some((s) => s.pid === pid && s.controller === "ai");

/** One move as it was before it was played — what a take-back restores. */
export interface HistoryEntry {
  /** The state before the move (applyIntent never changes it: kept as is). */
  game: AutoGameState;
  /** How many events the log had before the move. */
  eventsLen: number;
  /** Who made the move. */
  actor: PID;
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
  /** A player asked to take back their last move; the opponent must answer. */
  undoRequest: { by: PID } | null;
  /** Coach mode: while paused, Step first shows the move the AI is about to make (and why), the next Step plays it. */
  aiPlan: AiPlan | null;

  init: () => Promise<void>;
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
  undoRequest: null,
  aiPlan: null,

  init: async () => {
    if (cardsById) {
      set({ catalogReady: true });
      return;
    }
    try {
      cardsById = await loadCardsById();
      cardDb = makeCardDb(cardsById);
      set({ catalogReady: true, catalogError: null });
      // a reload in the middle of a game resumes it (AI seats paused, so nothing moves by surprise)
      const saved = loadGame();
      if (saved && saved.game.phase !== "over") {
        agents = makeAgents(saved.seats, `${saved.game.seed}:resumed`);
        set({ stage: "play", seats: saved.seats, game: saved.game, events: saved.events, aiDelay: saved.aiDelay, aiPaused: true, aiPlan: null });
      }
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
      set({ game: state, events, stage: "play", banner: null, aiPaused: false, history: [], undoRequest: null, aiPlan: null });
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
    const { game, events, seats } = get();
    if (!game || !cardDb) return false;
    if (intent.type !== "concede" && game.phase !== "over" && isAiSeat(seats, actorOf(cardDb, game))) {
      set({ banner: { id: bannerSeq++, text: "The AI is playing this move.", hint: "Wait for it — or concede for that seat.", tone: "info" } });
      return false;
    }
    try {
      const r = applyIntent(cardDb, game, intent);
      const actor = actorOf(cardDb, game);
      set({ game: r.state, events: [...events, ...r.events], undoRequest: null, aiPlan: null, history: remember(get().history, { game, eventsLen: events.length, actor }) });
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
    const { game, events, aiPaused, aiPlan } = get();
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
      set({ game: r.state, events: [...events, ...r.events], aiPlan: null, history: remember(get().history, { game, eventsLen: events.length, actor }) });
    } catch (e) {
      // the agent and every fallback were refused: stop and say so
      set({ aiPaused: true, banner: { id: bannerSeq++, text: `AI stuck: ${e instanceof Error ? e.message : String(e)}`, hint: "The AI is paused. Concede for that seat, or change decks." } });
    }
  },
  requestUndo: () => {
    const { history, seats } = get();
    const last = [...history].reverse().find((h) => !isAiSeat(seats, h.actor));
    if (!last) return;
    const opponent = seats?.find((s) => s.pid !== last.actor);
    set({ undoRequest: { by: last.actor } });
    if (opponent?.controller === "ai") get().answerUndo(true); // the AI never says no
  },

  answerUndo: (accept) => {
    const { history, seats, undoRequest, events } = get();
    if (!undoRequest) return;
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
      banner: { id: bannerSeq++, text: "Move taken back.", tone: "info" },
    });
  },

  newGame: (aiOpponent) => set({ aiOpponent, stage: "pick", seats: null, roll: null, game: null, events: [], banner: null }),
  setAiPaused: (aiPaused) => set({ aiPaused }),
  setAiDelay: (aiDelay) => set({ aiDelay }),
  setConfirmPicks: (confirmPicks) => {
    try { localStorage.setItem(CONFIRM_KEY, confirmPicks ? "1" : "0"); } catch { /* storage off: this session only */ }
    set({ confirmPicks });
  },

  explain: (text, hint, tone) => set({ banner: { id: bannerSeq++, text, hint, tone } }),
  dismissBanner: () => set({ banner: null }),

  rematch: () => set({ stage: "roll", roll: null, game: null, events: [], banner: null, history: [], undoRequest: null, aiPlan: null }),
  reset: () => set({ stage: "pick", seats: null, roll: null, game: null, events: [], banner: null, history: [], undoRequest: null, aiPlan: null }),
}));

const remember = (history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] =>
  [...history, entry].slice(-HISTORY_LIMIT);

/** The move shown in coach mode; if the engine refuses it, the agent's usual step (with its fallback). */
function playPlanned(db: CardDb, game: AutoGameState, plan: AiPlan, agent: Agent) {
  try {
    return applyIntent(db, game, plan.intent);
  } catch {
    return agentStep(db, game, agent);
  }
}

// DEV: coaching tools read the live game (seed, state) from the console
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __autoStore?: typeof useAutoStore }).__autoStore = useAutoStore;

/** One Pro agent per AI seat, seeded from the game. */
function makeAgents(seats: SeatSetup[], seed: string): Record<PID, ProAgent> {
  return Object.fromEntries(seats.filter((s) => s.controller === "ai").map((s) => [s.pid, createProAgent(`${seed}:${s.pid}`)]));
}

// keep the game in progress across a page reload (savedGame.ts); a finished or abandoned one is dropped
useAutoStore.subscribe((s, prev) => {
  if (s.game === prev.game && s.stage === prev.stage) return;
  if (s.stage === "play" && s.game && s.seats && s.game.phase !== "over") saveGame({ seats: s.seats, game: s.game, events: s.events, aiDelay: s.aiDelay });
  else clearGame();
});

