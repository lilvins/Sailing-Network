/**
 * Whole games for the replay tests: real meta decks, moves by the seeded
 * random player (it reaches every kind of prompt), recorded the way the table
 * records them.
 */
import { applyIntent, createGame } from "../../autosim/engine/engine";
import type { GameEvent } from "../../autosim/engine/events";
import type { AutoGameState } from "../../autosim/engine/state";
import { randomIntent } from "../../autosim/ai/random";
import { metaGameConfig, realDb } from "../../autosim/__bench__/metaGames";
import { seededRng } from "../../lib/rng";
import { finishRecording, playsIn, recordPlay, startRecording, type Recording, type ReplayRecord, type ReplaySeat } from "./record";

export const TEST_SEATS: [ReplaySeat, ReplaySeat] = [
  { pid: "p1", name: "Ann", controller: "human", deckName: "Deck A", leaderId: "x" },
  { pid: "p2", name: "Bo", controller: "ai", deckName: "Deck B", leaderId: "y" },
];

export interface PlayedGame { record: ReplayRecord; states: AutoGameState[] }

/** Game `game` of the meta decks, to its end or to `maxPlays`; `states[n]` = the live game after play n. */
export function playAndRecord(game: number, maxPlays = Infinity): PlayedGame {
  const config = metaGameConfig(game);
  const rng = seededRng(`replay-test:${config.seed}`);
  const made = createGame(realDb, config);
  let state = made.state;
  let events: GameEvent[] = made.events;
  let rec: Recording = startRecording(state, events.length);
  const states = [state];
  while (state.phase !== "over" && playsIn(rec) < maxPlays) {
    const intent = randomIntent(realDb, state, rng);
    const r = applyIntent(realDb, state, intent);
    state = r.state;
    events = [...events, ...r.events];
    rec = recordPlay(rec, intent, state, events.length);
    states.push(state);
  }
  return { record: finishRecording(rec, TEST_SEATS, events, []), states };
}

/** What a replay shows of a live state. `exec`, `rngUses` and two notes the damage step keeps on the
 *  battle are the engine's own bookkeeping: no event carries them, and nothing on the table reads them. */
export const shown = (live: AutoGameState, replayed: AutoGameState): AutoGameState => ({
  ...live, exec: replayed.exec, rngUses: replayed.rngUses,
  battle: live.battle && { ...live.battle, damageReacted: replayed.battle?.damageReacted, damageDeclined: replayed.battle?.damageDeclined },
});
