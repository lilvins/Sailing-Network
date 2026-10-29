import { describe, expect, it } from "vitest";
import { createGame } from "../../engine/engine";
import type { AutoGameState } from "../../engine/state";
import { metaDecks, metaGameConfig, realDb } from "../../__bench__/metaGames";
import { agentStep, createRandomAgent, type Agent } from "../agent";
import { createGreedyAgent } from "../greedy";
import { determinize } from "../determinize";
import { seededRng } from "../../../lib/rng";

const MAX_STEPS = 3000;

/** Plays one meta game with agents[p1], agents[p2]; returns the final state and fallbacks. */
function play(i: number, round: number, agents: Record<string, Agent>) {
  let state: AutoGameState = createGame(realDb, metaGameConfig(i, round)).state;
  let fallbacks = 0;
  for (let n = 0; n < MAX_STEPS && state.phase !== "over"; n++) {
    const seat = state.pendingChoice?.player ?? state.turnPlayer;
    const step = agentStep(realDb, state, agents[seat]);
    if (step.fellBack) fallbacks++;
    state = step.state;
  }
  return { state, fallbacks };
}

describe("greedy agent on AUTOSIM", () => {
  it("beats the random player with every meta deck, without illegal moves", () => {
    let wins = 0, games = 0, fallbacks = 0;
    metaDecks.forEach((_, i) => {
      // the greedy plays deck i: once as p1, once as p2 (against the next deck)
      for (const greedySeat of ["p1", "p2"] as const) {
        const agents = greedySeat === "p1"
          ? { p1: createGreedyAgent(`g${i}`), p2: createRandomAgent(`r${i}`) }
          : { p1: createRandomAgent(`r${i}`), p2: createGreedyAgent(`g${i}`) };
        const run = play(i, greedySeat === "p1" ? 1 : 2, agents);
        expect(run.state.phase, `game ${i} ${greedySeat} did not finish`).toBe("over");
        games++; fallbacks += run.fallbacks;
        if (run.state.winner === greedySeat) wins++;
      }
    });
    expect(fallbacks).toBe(0);
    expect(wins / games).toBeGreaterThan(0.8);
  }, 300_000);

  it("determinize hides the opponent's hand and decks but keeps everything public", () => {
    const state = createGame(realDb, metaGameConfig(0)).state;
    const world = determinize(state, "p1", seededRng("x"));
    const ids = (s: AutoGameState, pid: string, zone: "hand" | "deck" | "life" | "characterArea") =>
      s.players[pid].zones[zone].map((iid) => s.players[pid].instances[iid].cardId);
    expect(ids(world, "p1", "hand")).toEqual(ids(state, "p1", "hand"));
    expect(world.players.p2.leaderIid).toBe(state.players.p2.leaderIid);
    // same cards in the opponent's hidden pool, different places
    const pool = (s: AutoGameState) => [...ids(s, "p2", "hand"), ...ids(s, "p2", "deck"), ...ids(s, "p2", "life")].sort();
    expect(pool(world)).toEqual(pool(state));
    expect(ids(world, "p2", "hand")).not.toEqual(ids(state, "p2", "hand"));
    expect(world.seed).not.toBe(state.seed);
  });
});
