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
 * answers the current prompt.
 */
import { create } from "zustand";
import type { Card } from "../cards/cardsDb";
import { loadCardsById } from "../cards/cardsDb";
import { applyIntent, createGame } from "../../autosim/engine/engine";
import { EngineError, type PlayerIntent } from "../../autosim/engine/intents";
import type { GameEvent } from "../../autosim/engine/events";
import type { AutoGameState, CardDb, PID } from "../../autosim/engine/state";
import { makeCardDb } from "./compile";
import type { DeckChoice } from "./decks";

export type Stage = "pick" | "roll" | "play";

export interface SeatSetup {
  pid: PID;
  name: string;
  deck: DeckChoice;
}

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

export function getCardsById(): Map<string, Card> | null {
  return cardsById;
}
export function getCardDb(): CardDb | null {
  return cardDb;
}

let bannerSeq = 1;

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

  init: () => Promise<void>;
  /** pick → roll */
  confirmSeats: (seats: [SeatSetup, SeatSetup]) => void;
  doRoll: () => void;
  /** roll → play. `firstIdx` = seat index that plays first (winner's choice). */
  chooseFirst: (firstIdx: 0 | 1) => void;
  /** The single gate every UI move goes through. Returns true when applied. */
  dispatch: (intent: PlayerIntent) => boolean;
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

  init: async () => {
    if (cardsById) {
      set({ catalogReady: true });
      return;
    }
    try {
      cardsById = await loadCardsById();
      cardDb = makeCardDb(cardsById);
      set({ catalogReady: true, catalogError: null });
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
      set({ game: state, events, stage: "play", banner: null });
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
    const { game, events } = get();
    if (!game || !cardDb) return false;
    try {
      const r = applyIntent(cardDb, game, intent);
      set({ game: r.state, events: [...events, ...r.events] });
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

  explain: (text, hint, tone) => set({ banner: { id: bannerSeq++, text, hint, tone } }),
  dismissBanner: () => set({ banner: null }),

  rematch: () => set({ stage: "roll", roll: null, game: null, events: [], banner: null }),
  reset: () => set({ stage: "pick", seats: null, roll: null, game: null, events: [], banner: null }),
}));
