import { beforeAll, describe, expect, it } from "vitest";
import { useAutoStore } from "../board-auto/autoStore";
import { playsIn, stateAfter } from "./record";
import { playAndRecord, shown } from "./testGames";

/**
 * The replay on the table (autoStore): what Play, Pause, Next Play and the
 * rest do to the game the table draws. No engine here: the store only folds
 * the record's events.
 */

const { record, states } = playAndRecord(3);
const last = playsIn(record);
const store = () => useAutoStore.getState();
const open = () => store().openReplay("test-replay", record, "p1");

describe("a replay opened on the table", () => {
  beforeAll(open);

  it("starts at the opening hands, playing, both hands shown", () => {
    const { replay, game, events, seats, stage } = store();
    expect(stage).toBe("play");
    expect(replay).toMatchObject({ id: "test-replay", step: 0, playing: true, fast: false, hands: "both", bottom: "p1" });
    expect(game).toEqual(shown(states[0], game!));
    expect(events).toHaveLength(record.cuts[0]);
    // nobody at this screen plays either seat
    expect(seats!.map((s) => s.controller)).toEqual(["remote", "remote"]);
    expect(seats!.map((s) => s.name)).toEqual(["Ann", "Bo"]);
  });

  it("Next Play shows one more play, and the log up to it", () => {
    store().replayNext();
    expect(store().replay!.step).toBe(1);
    expect(store().game).toEqual(shown(states[1], store().game!));
    expect(store().events).toEqual(record.events.slice(0, record.cuts[1]));
  });

  it("Pause and Play only change whether it plays by itself", () => {
    store().setReplayPlaying(false);
    expect(store().replay).toMatchObject({ step: 1, playing: false });
    store().replayNext(); // Next Play while paused: one play, still paused
    expect(store().replay).toMatchObject({ step: 2, playing: false });
    store().setReplayPlaying(true);
    expect(store().replay).toMatchObject({ step: 2, playing: true });
  });

  it("Fast Forward and the hands switch change nothing in the game", () => {
    const game = store().game;
    store().setReplayFast(true);
    store().setReplayHands("hide");
    expect(store().replay).toMatchObject({ fast: true, hands: "hide", step: 2 });
    expect(store().game).toBe(game);
  });

  it("nothing can be played on it", () => {
    const game = store().game;
    expect(store().dispatch({ type: "concede", player: "p1" })).toBe(false);
    expect(store().game).toBe(game);
  });

  it("played to its last play it is the finished game, and it stops", () => {
    while (store().replay!.step < last) store().replayNext();
    const { replay, game, events } = store();
    expect(replay).toMatchObject({ step: last, playing: false });
    expect(game).toEqual(shown(states[last], game!));
    expect(game!.phase).toBe("over");
    expect(game!.winner).toBe(states[last].winner);
    expect(events).toEqual(record.events);
    // nothing after the end
    store().replayNext();
    store().setReplayPlaying(true);
    expect(store().replay).toMatchObject({ step: last, playing: false });
    expect(store().game).toBe(game);
  });

  it("a finished replay is not sent in as a new game", () => {
    expect(store().replayId).toBeNull();
    expect(store().recording).toBeNull();
  });

  it("Watch again goes back to the opening hands, with the same settings", () => {
    store().restartReplay();
    expect(store().replay).toMatchObject({ step: 0, playing: true, fast: true, hands: "hide" });
    expect(store().game).toEqual(stateAfter(record, 0));
  });

  it("closing it clears the table", () => {
    store().closeReplay();
    expect(store()).toMatchObject({ replay: null, game: null, stage: "pick", seats: null });
    expect(store().events).toHaveLength(0);
  });
});
