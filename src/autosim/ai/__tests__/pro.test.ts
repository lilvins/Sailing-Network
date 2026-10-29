import { describe, expect, it } from "vitest";
import { createGame } from "../../engine/engine";
import type { AutoGameState } from "../../engine/state";
import { metaGameConfig, realDb } from "../../__bench__/metaGames";
import { agentStep, type Agent } from "../agent";
import { createGreedyAgent } from "../greedy";
import { createProAgent } from "../pro";

const MAX_STEPS = 3000;
/** A small budget: these tests check correctness, the gauntlet measures strength. */
const SMALL = { candidates: 3, rollouts: 2 };

function play(i: number, agents: Record<string, Agent>) {
  let state: AutoGameState = createGame(realDb, metaGameConfig(i)).state;
  let fallbacks = 0;
  for (let n = 0; n < MAX_STEPS && state.phase !== "over"; n++) {
    const step = agentStep(realDb, state, agents[state.pendingChoice?.player ?? state.turnPlayer]);
    if (step.fellBack) fallbacks++;
    state = step.state;
  }
  return { state, fallbacks };
}

describe("Pro agent on AUTOSIM", () => {
  it("finishes meta games against the greedy without illegal moves", () => {
    for (const i of [0, 1, 2]) {
      const run = play(i, { p1: createProAgent(`pro${i}`, SMALL), p2: createGreedyAgent(`g${i}`) });
      expect(run.state.phase, `game ${i} did not finish`).toBe("over");
      expect(run.fallbacks).toBe(0);
    }
  }, 120_000);

  it("plays the same game twice from the same seeds (replay stays exact)", () => {
    const once = () => play(3, { p1: createProAgent("same", SMALL), p2: createProAgent("same2", SMALL) }).state;
    const a = once(), b = once();
    expect([a.winner, a.turn, a.rngUses]).toEqual([b.winner, b.turn, b.rngUses]);
  }, 120_000);
});
