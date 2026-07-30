/**
 * Core game-state types. These describe the SERIALIZABLE shape of a match —
 * no class instances, no functions, no Maps. Action functions live in the
 * store, never inside state (see CLAUDE.md "the non-negotiable rule").
 */

/** A card definition ID from the static DB, e.g. "OP01-001". */
export type CardId = string;

/** Unique per physical card within a single match. */
export type InstanceId = string;

export interface CardInstance {
  instanceId: InstanceId;
  cardId: CardId;
  faceUp: boolean;
  rested: boolean; // tapped/rested
  /**
   * DON!! only: instanceId of the Leader/Character this DON is given to.
   * The DON stays in the `donActive` zone array; rendering filters on this.
   */
  attachedTo?: InstanceId;
  /** Manual power modifier badge (e.g. +2000). Absent/0 = no marker. */
  marker?: number;
}

export type ZoneId =
  | "deck"
  | "hand"
  | "trash"
  | "life"
  | "leader"
  | "characterArea"
  | "stage"
  | "playArea" // face-up reveal zone for Events / counters / searches
  | "donDeck" // DON!! deck
  | "donActive"; // DON!! cost area

/** All zones, in a stable order — handy for building/iterating empty zones. */
export const ZONE_IDS: readonly ZoneId[] = [
  "deck",
  "hand",
  "trash",
  "life",
  "leader",
  "characterArea",
  "stage",
  "playArea",
  "donDeck",
  "donActive",
] as const;

export interface PlayerState {
  id: string;
  /** Ordered instance IDs per zone. */
  zones: Record<ZoneId, InstanceId[]>;
  /** Flat lookup of every card instance this player owns. */
  instances: Record<InstanceId, CardInstance>;
}

export interface GameState {
  players: Record<string, PlayerState>;
  /** Seating order — turn passing rotates through this. 1 entry = solo practice. */
  playerOrder: string[];
  turnPlayerId: string;
  turn: number;
  /** Log of applied actions — the seed for replays / multiplayer later. */
  actionLog: GameAction[];
}

/**
 * A decklist references card IDs only (no metadata, no image paths) — matches
 * the data architecture in CLAUDE.md. Resolved against the static DB at load.
 */
export interface Decklist {
  leader: CardId;
  main: { cardId: CardId; count: number }[];
  don: number; // size of the DON!! deck (typically 10)
}

/**
 * GameAction: a discriminated union of every applied action. Stored in
 * `actionLog`, so each one must stay JSON-serializable — these are the future
 * network messages / replay events. Mirror this 1:1 with the store actions.
 */
export type GameAction =
  | { type: "shuffleDeck"; playerId: string; seed?: string }
  | {
      /** Coin flip (sides=2) or die roll. The RESULT is logged so replays and
       *  the other player see the exact same outcome. */
      type: "dieRoll";
      playerId: string;
      sides: number;
      result: number;
    }
  | { type: "setup"; playerId: string; deck: Decklist }
  | { type: "drawCard"; playerId: string; count: number }
  | {
      type: "moveCard";
      playerId: string;
      instanceId: InstanceId;
      from: ZoneId;
      to: ZoneId;
      toIndex?: number;
    }
  | {
      type: "restCard";
      playerId: string;
      instanceId: InstanceId;
      rested: boolean;
    }
  | {
      /** Declare an attack: the attacker rests; the log carries the intent. */
      type: "attack";
      playerId: string;
      instanceId: InstanceId;
    }
  | { type: "drawDon"; playerId: string; count: number }
  | {
      type: "flipCard";
      playerId: string;
      instanceId: InstanceId;
      faceUp: boolean;
    }
  | {
      /** Give a DON!! to a Leader/Character (targetId) or return it (null). */
      type: "attachDon";
      playerId: string;
      instanceId: InstanceId;
      targetId: InstanceId | null;
    }
  | {
      /** Official refresh phase: return all given DON!!, stand all cards. */
      type: "refresh";
      playerId: string;
    }
  | {
      type: "setMarker";
      playerId: string;
      instanceId: InstanceId;
      delta: number;
    }
  | { type: "nextTurn"; turn: number; turnPlayerId?: string }
  | { type: "mulligan"; playerId: string };
