/**
 * A finished game as it can be watched again.
 *
 * A record holds what HAPPENED, not what to re-run: the state right after the
 * opening hands were dealt, and every event the engine emitted after it.
 * Playback folds those events with `applyEvent` and never asks the rules
 * engine anything, so a card effect fixed later cannot change or break an
 * older replay. The players' moves are kept next to the events (tools, the
 * bot's learning), not used to play the replay back.
 *
 * A "play" is one move by a player with everything that followed from it:
 * the unit "Next Play" advances by.
 */
import { applyEvent, type GameEvent } from "../../autosim/engine/events";
import type { PlayerIntent } from "../../autosim/engine/intents";
import type { AutoGameState, ChoiceRequest, PID } from "../../autosim/engine/state";

export const RECORD_VERSION = 1;

export interface ReplaySeat {
  pid: PID;
  name: string;
  /** Who played the seat. A friend in another browser is a person too. */
  controller: "human" | "ai";
  deckName: string;
  leaderId: string;
}

/** A chat line; `at` = how many events the log had when it was said. */
export interface ReplayChatLine { seat: PID; text: string; at: number }

/** A game being recorded: grows by one play per move (never changed in place). */
export interface Recording {
  /** The game as `createGame` returned it. */
  initial: AutoGameState;
  /** `cuts[0]` = the events of the setup; `cuts[n]` = the log's length after play n. */
  cuts: number[];
  /** The prompt left open after the setup and after each play (not event-derived). */
  pending: (ChoiceRequest | null)[];
  moves: PlayerIntent[];
}

export interface ReplayRecord extends Recording {
  v: typeof RECORD_VERSION;
  seats: [ReplaySeat, ReplaySeat];
  /** The whole log, setup included. */
  events: GameEvent[];
  chat: ReplayChatLine[];
}

export function startRecording(initial: AutoGameState, setupEvents: number): Recording {
  return { initial, cuts: [setupEvents], pending: [initial.pendingChoice], moves: [] };
}

/** One more play: `after` is the game it led to, `eventsLen` the log's length by then. */
export function recordPlay(rec: Recording, intent: PlayerIntent, after: AutoGameState, eventsLen: number): Recording {
  return { initial: rec.initial, cuts: [...rec.cuts, eventsLen], pending: [...rec.pending, after.pendingChoice], moves: [...rec.moves, intent] };
}

export const playsIn = (rec: Recording): number => rec.cuts.length - 1;

/** A take-back: the recording as it was after its first `plays` plays. */
export function rewindRecording(rec: Recording, plays: number): Recording {
  if (plays >= playsIn(rec)) return rec;
  return { initial: rec.initial, cuts: rec.cuts.slice(0, plays + 1), pending: rec.pending.slice(0, plays + 1), moves: rec.moves.slice(0, plays) };
}

export function finishRecording(rec: Recording, seats: [ReplaySeat, ReplaySeat], events: GameEvent[], chat: ReplayChatLine[]): ReplayRecord {
  return { v: RECORD_VERSION, seats, ...rec, events: events.slice(0, rec.cuts[rec.cuts.length - 1]), chat };
}

/** Why a record cannot be played back, or null when it can. */
export function recordProblem(r: ReplayRecord): string | null {
  if (r.v !== RECORD_VERSION) return `Unknown replay format (version ${String(r.v)})`;
  if (!r.initial?.players || r.seats?.length !== 2) return "The replay has no game in it";
  if (r.cuts.length === 0 || r.pending.length !== r.cuts.length || r.moves.length !== r.cuts.length - 1) return "The replay's plays do not line up";
  for (let i = 1; i < r.cuts.length; i++) if (r.cuts[i] < r.cuts[i - 1]) return "The replay's plays are out of order";
  if (r.cuts[r.cuts.length - 1] !== r.events.length) return "The replay's log is incomplete";
  return null;
}

/** The game as it stood after `plays` plays (0 = the opening hands). */
export function stateAfter(r: ReplayRecord, plays: number): AutoGameState {
  const state = structuredClone(r.initial);
  for (let i = r.cuts[0]; i < r.cuts[plays]; i++) applyEvent(state, r.events[i]);
  state.pendingChoice = r.pending[plays];
  return state;
}

/** One play forward from `state`, which stands after `plays` plays. `state` is not changed. */
export function nextPlay(r: ReplayRecord, state: AutoGameState, plays: number): AutoGameState {
  const next = structuredClone(state);
  for (let i = r.cuts[plays]; i < r.cuts[plays + 1]; i++) applyEvent(next, r.events[i]);
  next.pendingChoice = r.pending[plays + 1];
  return next;
}
