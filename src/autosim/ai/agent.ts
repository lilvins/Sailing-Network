import { applyIntent, applyIntentInPlace, type EngineResult } from "../engine/engine";
import type { PlayerIntent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import type { AutoGameState, CardDb, PID } from "../engine/state";
import { seededRng } from "../../lib/rng";
import { randomIntent } from "./random";

/**
 * An agent answers every situation of the game with one intent: Main Phase
 * moves and all 13 kinds of prompt. It only reads the state; the caller
 * (table, test, self-play) applies the intent through the engine.
 */
export interface Agent {
  readonly name: string;
  decide(db: CardDb, state: AutoGameState, pid: PID): PlayerIntent;
}

export function createRandomAgent(seed = "random"): Agent {
  const rng = seededRng(seed);
  return { name: "Random", decide: (db, state) => randomIntent(db, state, rng) };
}

/** Who must answer now: the player of the open prompt, else the turn player. */
export function actorOf(db: CardDb, state: AutoGameState): PID {
  return legalMoves(db, state).actor;
}

export interface AgentStep extends EngineResult {
  intent: PlayerIntent;
  /** The agent's intent was refused and a random legal one was played instead. */
  fellBack: boolean;
}

const FALLBACK_TRIES = 20;

/**
 * One move by `agent` for the seat that must act. legalMoves is advisory, so
 * an agent can still pick something the engine refuses: then a random legal
 * intent is played instead (and the step says so), never an endless loop.
 * `inPlace` = rollout mode (the state is changed); otherwise the table mode.
 */
export function agentStep(db: CardDb, state: AutoGameState, agent: Agent, inPlace = false): AgentStep {
  const apply = inPlace ? applyIntentInPlace : applyIntent;
  const pid = actorOf(db, state);
  const intent = agent.decide(db, state, pid);
  try {
    return { ...apply(db, state, intent), intent, fellBack: false };
  } catch (first) {
    const rng = seededRng(`fallback:${state.seed}:${state.rngUses}:${state.turn}`);
    for (let i = 0; i < FALLBACK_TRIES; i++) {
      const alt = randomIntent(db, state, rng);
      try { return { ...apply(db, state, alt), intent: alt, fellBack: true }; } catch { /* try another */ }
    }
    throw first;
  }
}
