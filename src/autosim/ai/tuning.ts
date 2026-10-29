/**
 * Tuning of the AUTOSIM agents — numbers only, no logic. Change a value here
 * and every agent picks it up; nothing else in src/autosim/ai hard-codes a
 * weight. Values start from optcg-ai's "balanced" style (src/ai/evaluate.ts).
 */
import learned from "./learned.json";
/**
 * Weights of the position evaluation (evaluate.ts). The theory behind each
 * term — what counts as being ahead in One Piece and why — is written out in
 * docs/bot/teoria-del-vantaggio.md. Training (npm run train:autosim) changes
 * them through learned.json, never by editing this file.
 */
export type EvalWeights = {
  /** Value of the 5th+ Life card; each Life closer to 0 is worth `lifeConvex` more (convex: the last one is the game). */
  myLifeBase: number;
  oppLifeBase: number;
  lifeConvex: number;
  /** Points per card in hand (options), own and opponent's. */
  hand: number;
  oppHand: number;
  /** Points per 1000 counter in hand (defence budget). */
  counter: number;
  /** Points per Character on the field (difference). */
  chars: number;
  /** Board power difference is divided by this (5000 power = 50 points). */
  powerDivisor: number;
  /** Points per active Blocker. */
  blocker: number;
  /** Points per DON!! the player will have next turn. */
  don: number;
  /** Penalty per cost point of a rested Character costing more than `expendableCost`. */
  rested: number;
  expendableCost: number;
  /** Points per attacker beyond the opponent's shield (both sides), and extra when it is positive (lethal in sight). */
  pressure: number;
  lethalBonus: number;
  /** How much the role (beatdown / control) shifts the weights of Life and of hand. */
  roleShift: number;
};

export const EVAL_BASE: EvalWeights = {
  myLifeBase: 70, oppLifeBase: 70, lifeConvex: 20,
  hand: 6, oppHand: 5, counter: 10,
  chars: 12, powerDivisor: 100, blocker: 8,
  don: 12, rested: 2, expendableCost: 1,
  pressure: 15, lethalBonus: 60, roleShift: 0.15,
};

/** The evaluation before the theory (phase 2/3.1), kept as data for A/B gauntlets. */
export const EVAL_V1: EvalWeights = {
  myLifeBase: 100, oppLifeBase: 100, lifeConvex: 0,
  hand: 8, oppHand: 6, counter: 0,
  chars: 12, powerDivisor: 100, blocker: 0,
  don: 12, rested: 2, expendableCost: 1,
  pressure: 0, lethalBonus: 0, roleShift: 0,
};

/** Current weights: the base ones with what training adopted on top. */
export const EVAL: EvalWeights = { ...EVAL_BASE, ...(learned.eval as Partial<EvalWeights>) };

/** Score of a finished game (beyond any position value). */
export const WIN = 10_000;

/** Fixed parts of the evaluation (rules of thumb, not trained). */
export const SHIELD = {
  /** Vins's rule: shield = blockers + Life + counter in hand ÷ 3000. */
  counterPerShield: 3000,
  /** An attacker counts if it reaches the Leader with this much help (one DON!!). */
  reach: 1000,
  /** Pressure is clamped to ±this many attackers. */
  maxPressure: 3,
  /** Life cards above this many are all worth the base value. */
  convexLives: 5,
} as const;

export const GREEDY = {
  /** Mulligan unless the hand holds this many cards costing ≤ cheapCost. */
  keepCheap: 2,
  cheapCost: 3,
  /** Counter for the Leader only at this Life or less. */
  counterLeaderAtLife: 2,
  /** Counter for a Character only if it costs at least this. */
  counterCharFromCost: 4,
  /** A main-phase play must raise the evaluation by more than this. */
  minGain: 1,
  /** Lookahead: at most this many options compared per choice. */
  maxOptions: 6,
  /** Lookahead: steps played to let an effect / battle resolve. */
  settleSteps: 60,
} as const;

export const PRO = {
  /** Main Phase: moves kept after the quick ranking (End Turn is always added). */
  candidates: 6,
  /** Rollouts per candidate on average; successive halving spends the same total. */
  rollouts: 8,
  /**
   * Turn changes simulated after the candidate move. 1 = to the end of the
   * current turn: measured best (Pro vs Greedy, 64 paired games each:
   * horizon 1 64%, 2 50%, 3 52%) — the quick policy is too rough to judge
   * further turns, its noise drowns the signal.
   */
  horizon: 1,
  /** Safety cap on the moves of one rollout. */
  maxRolloutSteps: 400,
  /** Block window: blockers compared besides "no block" and the greedy pick. */
  blockOptions: 2,
} as const;

/** Quick ranking of Main Phase moves, so the search spends its budget on plausible ones. */
export const PRIOR = {
  play: 45,
  playPerCost: 5,
  attack: 46,
  /** Bonus for hitting the Leader, and for hitting a Character (plus per cost point). */
  attackFace: 21,
  attackChar: 9,
  attackCharPerCost: 3,
  /** Power margin is divided by this. */
  marginDivisor: 500,
  /** A Leader attack one counter card stops is worth less while they have Life to spare. */
  weakFaceFactor: 0.6,
  weakFaceMargin: 2000,
  giveDon: 28,
  activate: 24,
  endTurn: 4,
} as const;
