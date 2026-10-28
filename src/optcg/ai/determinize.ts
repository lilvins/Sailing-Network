// Determinization: the searching player cannot see hidden cards, so before each
// rollout we reshuffle every card it has no information about. Card instances keep
// their uids and positions; only the card ids are permuted among hidden slots.

import type { CardInst, GameState, Seat } from '../engine/types.js';
import { Rng } from '../engine/rng.js';

function permuteIds(cards: CardInst[], rng: Rng): void {
  const ids = rng.shuffle(cards.map((c) => c.id));
  cards.forEach((c, i) => (c.id = ids[i]));
}

/**
 * Hidden from `seat`:
 *  - opponent: hand + deck + life (all face down)
 *  - self:     deck order + own life cards (life is placed face down)
 * Mutates `s` in place; call on a clone.
 */
export function determinize(s: GameState, seat: Seat, rng: Rng): void {
  const them = s.players[seat === 0 ? 1 : 0];
  permuteIds([...them.hand, ...them.deck, ...them.life], rng);
  const me = s.players[seat];
  permuteIds([...me.deck, ...me.life], rng);
  // Re-seed the engine RNG too so shuffles inside the rollout differ per sample.
  s.rng = (rng.next() * 0xffffffff) >>> 0 || 1;
}
