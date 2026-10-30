import { createGame, type GameConfig } from "../engine/engine";
import type { AutoGameState, PID } from "../engine/state";
import { agentStep, type Agent } from "../ai/agent";
import { createProAgent, type ProConfig } from "../ai/pro";
import { EVAL, EVAL_BASE, type EvalWeights } from "../ai/tuning";
import { metaDecks, realDb } from "../__bench__/metaGames";

/**
 * One paired match for training: the same deal (two random meta decks, one
 * seed) played twice with the two weight sets swapped between the seats, so
 * both sides pilot both decks on the same luck. Pure: no files, no workers —
 * scripts/train-autosim.mjs runs it in a worker pool.
 */
export type PairResult = { candidateWins: number; baseWins: number; unfinished: number; matchup: string; ms: number };

const MAX_STEPS = 3000;

export function playPair(candidate: EvalWeights, base: EvalWeights, index: number, runSeed: string, budget: Partial<ProConfig> = {}): PairResult {
  const t = performance.now();
  const config = pairConfig(index, runSeed);
  const result: PairResult = { candidateWins: 0, baseWins: 0, unfinished: 0, matchup: `${config.players[0].leader} vs ${config.players[1].leader}`, ms: 0 };
  for (const candidateSeat of ["p1", "p2"] as const) {
    const seed = `${config.seed}:${candidateSeat}`;
    const cand = createProAgent(`${seed}:cand`, { ...budget, weights: candidate });
    const other = createProAgent(`${seed}:base`, { ...budget, weights: base });
    const end = playGame(config, candidateSeat === "p1" ? { p1: cand, p2: other } : { p1: other, p2: cand });
    if (end.phase !== "over") result.unfinished++;
    else if (end.winner === candidateSeat) result.candidateWins++;
    else result.baseWins++;
  }
  result.ms = performance.now() - t;
  return result;
}

/** Match `index` of a run: a deterministic random pair of meta decks and first player. */
function pairConfig(index: number, runSeed: string): GameConfig {
  const n = metaDecks.length;
  const a = hash(`${runSeed}:${index}:a`) % n;
  const b = (a + 1 + (hash(`${runSeed}:${index}:b`) % (n - 1))) % n;
  const expand = (d: (typeof metaDecks)[number]) => d.cards.flatMap((c) => Array<string>(c.count).fill(c.id));
  return {
    seed: `train:${runSeed}:${index}`,
    players: [{ id: "p1", leader: metaDecks[a].leaderId, deck: expand(metaDecks[a]) }, { id: "p2", leader: metaDecks[b].leaderId, deck: expand(metaDecks[b]) }],
    firstPlayer: hash(`${runSeed}:${index}:f`) % 2 === 0 ? "p1" : "p2",
  };
}

function playGame(config: GameConfig, agents: Record<PID, Agent>): AutoGameState {
  let state = createGame(realDb, config).state;
  for (let i = 0; i < MAX_STEPS && state.phase !== "over"; i++) {
    state = agentStep(realDb, state, agents[state.pendingChoice?.player ?? state.turnPlayer]).state;
  }
  return state;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The weights training starts from (base + already learned) and the untouched base. */
export const startWeights = (): { current: EvalWeights; base: EvalWeights } => ({ current: { ...EVAL }, base: { ...EVAL_BASE } });
