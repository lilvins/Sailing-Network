/**
 * Tuning of the AUTOSIM agents — numbers only, no logic. Change a value here
 * and every agent picks it up; nothing else in src/autosim/ai hard-codes a
 * weight. Values start from optcg-ai's "balanced" style (src/ai/evaluate.ts).
 */
export const EVAL = {
  /** Points per own Life card. */
  myLife: 100,
  /** Points per opponent Life card (and the higher value at the last one). */
  oppLife: 100,
  oppLastLife: 110,
  /** Points per card in hand, own and opponent's. */
  hand: 8,
  oppHand: 6,
  /** Points per Character on the field (difference between the players). */
  chars: 12,
  /** Board power difference is divided by this (5000 power = 50 points). */
  powerDivisor: 100,
  /** Points per DON!! the player will have next turn. */
  don: 12,
  /** Penalty per cost point of a rested Character costing more than `expendableCost`. */
  rested: 2,
  expendableCost: 1,
  /** A finished game. */
  win: 10_000,
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
