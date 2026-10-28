// Static position evaluation used at the end of each rollout.
// Positive = good for `seat`. A finished game scores +/-WIN.

import { opp, power } from '../engine/game.js';
import { totalDon } from '../engine/state.js';
import type { Db, GameState, PlayerState, Seat } from '../engine/types.js';
import { type Playbook, type Style, styleOf } from './playbook.js';

export const WIN = 1000;

export interface StyleWeights {
  myLife: number;
  oppLife: number;
  hand: number;
  oppHand: number;
  chars: number;
  /** Penalty per cost point of non-expendable characters left rested (exposed to attacks). */
  rested: number;
}

export const STYLE_WEIGHTS: Record<Style, StyleWeights> = {
  flood: { myLife: 65, oppLife: 125, hand: 5, oppHand: 4, chars: 15, rested: 0 },
  race: { myLife: 80, oppLife: 130, hand: 7, oppHand: 4, chars: 11, rested: 1 },
  balanced: { myLife: 100, oppLife: 100, hand: 8, oppHand: 6, chars: 12, rested: 2 },
  conserve: { myLife: 115, oppLife: 85, hand: 10, oppHand: 7, chars: 10, rested: 4 },
  starve: { myLife: 110, oppLife: 50, hand: 10, oppHand: 13, chars: 13, rested: 4 },
};

export interface EvalOptions {
  /** Value of one DON!! on the field (cost area + attached). 0 = ignore DON (v1). */
  donWeight?: number;
}

export const DEFAULT_EVAL: EvalOptions = { donWeight: 12 };

/** Taking the opponent to 0 life is worth a lot regardless of style. */
const LAST_LIFE_BONUS = 110;
/** Per life point below the playbook's lifeFloor. */
const LIFE_FLOOR_PENALTY = 90;

/**
 * DON!! the player can use on their next turn: what is on the field plus the
 * (up to) 2 drawn in the DON!! phase. A DON!! returned to the DON!! deck only
 * costs something when it would not come back that way (e.g. at 10 DON, or with
 * Enel's 6-card DON!! deck already empty, returning one is free).
 */
export function nextTurnDon(p: PlayerState): number {
  return totalDon(p) + Math.min(2, p.donDeck);
}

function boardPower(db: Db, s: GameState, p: PlayerState): number {
  let sum = 0;
  for (const c of p.chars) sum += power(db, s, c.uid);
  return sum;
}

export function evaluate(db: Db, s: GameState, seat: Seat, pb: Playbook | null, opts: EvalOptions = DEFAULT_EVAL): number {
  if (s.winner !== null) return s.winner === seat ? WIN : -WIN;
  const w = STYLE_WEIGHTS[styleOf(pb)];
  const me = s.players[seat];
  const them = s.players[opp(seat)];
  const oppLifeWeight = them.life.length <= 1 ? Math.max(w.oppLife, LAST_LIFE_BONUS) : w.oppLife;

  let score =
    me.life.length * w.myLife -
    them.life.length * oppLifeWeight +
    (boardPower(db, s, me) - boardPower(db, s, them)) / 100 +
    me.hand.length * w.hand -
    them.hand.length * w.oppHand +
    (me.chars.length - them.chars.length) * w.chars +
    (nextTurnDon(me) - nextTurnDon(them)) * (pb?.donWeight ?? opts.donWeight ?? 0);

  if (w.rested > 0) {
    const expendable = pb?.expendableCost ?? 1;
    for (const c of me.chars) {
      const cost = db[c.id].cost;
      if (c.rested && cost > expendable) score -= w.rested * cost;
    }
  }
  const floor = pb?.lifeFloor;
  if (floor !== undefined && me.life.length < floor) score -= LIFE_FLOOR_PENALTY * (floor - me.life.length);
  return score;
}
