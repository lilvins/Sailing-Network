import { describe, expect, it } from "vitest";
import { applyIntent, createGame } from "../../autosim/engine/engine";
import type { GameEvent } from "../../autosim/engine/events";
import { legalMoves } from "../../autosim/engine/legality";
import type { AutoGameState } from "../../autosim/engine/state";
import { randomIntent } from "../../autosim/ai/random";
import { metaGameConfig, realDb } from "../../autosim/__bench__/metaGames";
import { seededRng } from "../../lib/rng";
import {
  finishRecording, nextPlay, playsIn, recordPlay, recordProblem, rewindRecording, startRecording, stateAfter,
  type Recording, type ReplayRecord, type ReplaySeat,
} from "./record";

/**
 * A recorded game played back must be the game that was played: the same
 * state after every play, down to the last one. Real meta decks, moves by the
 * seeded random player (it reaches every kind of prompt).
 */

const SEATS: [ReplaySeat, ReplaySeat] = [
  { pid: "p1", name: "Ann", controller: "human", deckName: "Deck A", leaderId: "x" },
  { pid: "p2", name: "Bo", controller: "ai", deckName: "Deck B", leaderId: "y" },
];

interface Played { record: ReplayRecord; states: AutoGameState[] }

/** One whole game, recorded the way the table records it; `states[n]` = the live game after play n. */
function playAndRecord(game: number, maxPlays = Infinity): Played {
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
  return { record: finishRecording(rec, SEATS, events, []), states };
}

/** What a replay shows of a live state. `exec`, `rngUses` and two notes the damage step keeps on the
 *  battle are the engine's own bookkeeping: no event carries them, and nothing on the table reads them. */
const shown = (live: AutoGameState, replayed: AutoGameState): AutoGameState => ({
  ...live, exec: replayed.exec, rngUses: replayed.rngUses,
  battle: live.battle && { ...live.battle, damageReacted: replayed.battle?.damageReacted, damageDeclined: replayed.battle?.damageDeclined },
});

describe("a recorded game played back", () => {
  const { record, states } = playAndRecord(0);

  it("the game was played to its end", () => {
    expect(states[states.length - 1].phase).toBe("over");
    expect(playsIn(record)).toBe(states.length - 1);
    expect(recordProblem(record)).toBeNull();
  });

  it("Next Play after Next Play, every state is the live one", () => {
    let state = stateAfter(record, 0);
    expect(state).toEqual(shown(states[0], state));
    for (let n = 0; n < playsIn(record); n++) {
      const before = JSON.stringify(state);
      const next = nextPlay(record, state, n);
      expect(JSON.stringify(state)).toBe(before); // the state on screen is never changed in place
      state = next;
      expect(state).toEqual(shown(states[n + 1], state));
    }
    expect(state.phase).toBe("over");
    expect(state.winner).toBe(states[states.length - 1].winner);
  }, 120_000);

  it("jumping to a play gives the same state as stepping there", () => {
    const last = playsIn(record);
    for (const n of [0, 1, Math.floor(last / 2), last]) {
      const state = stateAfter(record, n);
      expect(state).toEqual(shown(states[n], state));
    }
  });

  it("survives the trip to the server and back (JSON)", () => {
    const back = JSON.parse(JSON.stringify(record)) as ReplayRecord;
    expect(recordProblem(back)).toBeNull();
    const last = playsIn(back);
    const state = stateAfter(back, last);
    expect(state).toEqual(shown(states[last], state));
  });

  it("the table can draw every state (who must act, what is legal)", () => {
    let state = stateAfter(record, 0);
    for (let n = 0; n < playsIn(record); n++) {
      state = nextPlay(record, state, n);
      expect(legalMoves(realDb, state).actor).toBe(legalMoves(realDb, states[n + 1]).actor);
    }
  }, 120_000);

  it("fits in what the server accepts", () => {
    expect(JSON.stringify(record).length).toBeLessThan(3_000_000);
  });
});

describe("a take-back while recording", () => {
  it("the record forgets the plays taken back, and the game goes on from there", () => {
    const config = metaGameConfig(1);
    const made = createGame(realDb, config);
    const rngA = seededRng("first-try");
    let state = made.state;
    let events: GameEvent[] = made.events;
    let rec = startRecording(state, events.length);
    const history: { state: AutoGameState; eventsLen: number }[] = [];
    const play = (rng: ReturnType<typeof seededRng>) => {
      history.push({ state, eventsLen: events.length });
      const intent = randomIntent(realDb, state, rng);
      const r = applyIntent(realDb, state, intent);
      state = r.state;
      events = [...events, ...r.events];
      rec = recordPlay(rec, intent, state, events.length);
    };
    for (let i = 0; i < 12; i++) play(rngA);
    // back to before play 8 (the table does this with its own history)
    const keep = 7;
    state = history[keep].state;
    events = events.slice(0, history[keep].eventsLen);
    rec = rewindRecording(rec, keep);
    history.length = keep;
    expect(playsIn(rec)).toBe(keep);
    const rngB = seededRng("second-try");
    for (let i = 0; i < 10; i++) play(rngB);

    const record = finishRecording(rec, SEATS, events, []);
    expect(recordProblem(record)).toBeNull();
    expect(playsIn(record)).toBe(keep + 10);
    const replayed = stateAfter(record, playsIn(record));
    expect(replayed).toEqual(shown(state, replayed));
  });
});

describe("a record that cannot be played back says why", () => {
  const { record } = playAndRecord(2, 6);

  it("an unfinished game is still a valid record", () => {
    expect(recordProblem(record)).toBeNull();
  });
  it("a log shorter than its plays", () => {
    expect(recordProblem({ ...record, events: record.events.slice(0, -1) })).toMatch(/incomplete/);
  });
  it("plays and prompts that do not line up", () => {
    expect(recordProblem({ ...record, pending: record.pending.slice(1) })).toMatch(/line up/);
  });
  it("a format from another version", () => {
    expect(recordProblem({ ...record, v: 2 as unknown as 1 })).toMatch(/version/);
  });
});
