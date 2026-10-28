// Game records: a game is fully described by its decks, seed, who went first and
// the list of actions. Replaying them through the deterministic engine rebuilds
// every intermediate state (replays, spectating, learning from played games).

import { applyAction, newGame } from './engine/game.js';
import type { Action, Db, DeckList, GameState, Seat } from './engine/types.js';

export const RECORD_VERSION = 1;

export interface GameRecord {
  version: number;
  seed: number;
  first: Seat;
  decks: [DeckList, DeckList];
  actions: Action[];
  /** Who played each seat, e.g. "human:<user>", "bot:pro", "bot:casual". */
  players: [string, string];
  winner: Seat | null;
  turns: number;
  startedAt: string;
  endedAt?: string;
  /** Engine / data version the game was played with. */
  engine?: string;
}

export function startRecord(decks: [DeckList, DeckList], seed: number, first: Seat, players: [string, string], engine?: string): GameRecord {
  return { version: RECORD_VERSION, seed, first, decks, actions: [], players, winner: null, turns: 0, startedAt: new Date().toISOString(), engine };
}

/** Rebuild the final state (and optionally every state) of a record. */
export function replay(db: Db, rec: GameRecord, onState?: (s: GameState, i: number) => void): GameState {
  let s = newGame(db, rec.decks, { seed: rec.seed, first: rec.first });
  onState?.(s, -1);
  rec.actions.forEach((a, i) => {
    s = applyAction(db, s, a);
    onState?.(s, i);
  });
  return s;
}
