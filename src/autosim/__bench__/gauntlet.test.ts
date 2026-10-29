// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { createGame } from "../engine/engine";
import type { AutoGameState, PID } from "../engine/state";
import { agentStep, type Agent } from "../ai/agent";
import { createGreedyAgent } from "../ai/greedy";
import { createProAgent } from "../ai/pro";
import { metaDecks, metaGameConfig, realDb } from "./metaGames";

/**
 * Pro vs Greedy gauntlet — skipped in the normal suite, run with
 * `npm run gauntlet:autosim` (GAUNTLET=1). Paired games: the same deal is
 * played twice with the agents swapped, so each agent pilots both decks on
 * the same luck. GAUNTLET_DECKS (default 8) meta decks × GAUNTLET_ROUNDS
 * opponents (default 1). GAUNTLET_PRO = JSON overrides of the Pro config.
 * Writes a JSON summary to GAUNTLET_OUT if set.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MAX_STEPS = 3000;

type Seat = { agent: Agent; ms: number; decisions: number };

function play(i: number, round: number, seats: Record<PID, Seat>): AutoGameState {
  let state = createGame(realDb, metaGameConfig(i, round)).state;
  for (let n = 0; n < MAX_STEPS && state.phase !== "over"; n++) {
    const seat = seats[state.pendingChoice?.player ?? state.turnPlayer];
    const t = performance.now();
    state = agentStep(realDb, state, seat.agent).state;
    seat.ms += performance.now() - t;
    seat.decisions++;
  }
  return state;
}

describe.skipIf(!env.GAUNTLET)("Pro vs Greedy gauntlet", () => {
  it("plays paired games on the meta decks", () => {
    const decks = Math.min(Number(env.GAUNTLET_DECKS ?? 8), metaDecks.length);
    const rounds = Number(env.GAUNTLET_ROUNDS ?? 1);
    const byDeck: Record<string, { wins: number; games: number }> = {};
    const pro: Seat = { agent: createProAgent("gauntlet-pro", env.GAUNTLET_PRO ? JSON.parse(env.GAUNTLET_PRO) : {}), ms: 0, decisions: 0 };
    const greedy: Seat = { agent: createGreedyAgent("gauntlet-greedy"), ms: 0, decisions: 0 };
    let wins = 0, games = 0;
    for (let i = 0; i < decks; i++) {
      for (let round = 1; round <= rounds; round++) {
        for (const proSeat of ["p1", "p2"] as const) {
          const state = play(i, round, proSeat === "p1" ? { p1: pro, p2: greedy } : { p1: greedy, p2: pro });
          const deck = proSeat === "p1" ? metaDecks[i] : metaDecks[(i + round) % metaDecks.length];
          const row = (byDeck[`${deck.leaderId} ${deck.leaderName}`] ??= { wins: 0, games: 0 });
          row.games++; games++;
          if (state.winner === proSeat) { row.wins++; wins++; }
          console.log(`deck ${i} round ${round} pro=${proSeat} winner=${state.winner} turn=${state.turn}`);
        }
      }
    }
    const result = {
      proWinRate: wins / games, games, byDeck,
      msPerDecision: { pro: pro.ms / pro.decisions, greedy: greedy.ms / greedy.decisions },
    };
    console.log(JSON.stringify(result, null, 2));
    if (env.GAUNTLET_OUT) writeFileSync(env.GAUNTLET_OUT, JSON.stringify(result, null, 2));
  }, 3_600_000);
});
