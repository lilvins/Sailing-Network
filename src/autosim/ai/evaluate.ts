import type { AutoGameState, AutoPlayerState, CardDb, PID } from "../engine/state";
import { effectivePower, opponentOf } from "../engine/state";
import { EVAL } from "./tuning";

/**
 * Static evaluation of a position for `pid`: positive = good for pid.
 * Used by the greedy agent to compare the outcome of its options, and later
 * by the Pro agent at the end of each rollout. Life, hand, board and DON,
 * weighted by tuning.ts.
 */
export function evaluate(db: CardDb, state: AutoGameState, pid: PID): number {
  if (state.phase === "over") return state.winner === pid ? EVAL.win : -EVAL.win;
  const me = state.players[pid];
  const them = state.players[opponentOf(state, pid)];
  const oppLife = them.zones.life.length <= 1 ? EVAL.oppLastLife : EVAL.oppLife;

  let score =
    me.zones.life.length * EVAL.myLife -
    them.zones.life.length * oppLife +
    (boardPower(db, state, me) - boardPower(db, state, them)) / EVAL.powerDivisor +
    me.zones.hand.length * EVAL.hand -
    them.zones.hand.length * EVAL.oppHand +
    (me.zones.characterArea.length - them.zones.characterArea.length) * EVAL.chars +
    (nextTurnDon(me) - nextTurnDon(them)) * EVAL.don;

  for (const iid of me.zones.characterArea) {
    const cost = db(me.instances[iid].cardId).cost ?? 0;
    if (me.instances[iid].rested && cost > EVAL.expendableCost) score -= EVAL.rested * cost;
  }
  return score;
}

/** DON!! usable next turn: on the field now plus the (up to) 2 of the DON!! phase. */
function nextTurnDon(p: AutoPlayerState): number {
  const given = Object.values(p.don.given).reduce((s, n) => s + n, 0);
  return p.don.active + p.don.rested + given + Math.min(2, p.don.deck);
}

/** Characters' power without the DON!! bonus (that one disappears at the end of the turn). */
function boardPower(db: CardDb, state: AutoGameState, p: AutoPlayerState): number {
  let sum = 0;
  for (const iid of p.zones.characterArea) {
    const donBonus = p.id === state.turnPlayer ? (p.don.given[iid] ?? 0) * 1000 : 0;
    sum += effectivePower(db, state, p.id, iid) - donBonus;
  }
  return sum;
}
