// Per-leader game plans. A playbook tells the AI how a deck wants to play:
// mulligan rules, which costs to play on which turn, how aggressive to be, and
// matchup-specific overrides. Files live in playbooks/<LEADER-ID>.json.

import { ownTurnNumber } from '../engine/game.js';
import type { GameState, Seat } from '../engine/types.js';

/**
 * flood    - go wide, attack face constantly
 * race     - trade life for damage, close fast
 * balanced - default
 * conserve - protect life and board, attack only with good numbers
 * starve   - attack the board / hand rather than life
 */
export type Style = 'flood' | 'race' | 'balanced' | 'conserve' | 'starve';

export interface MulliganRule {
  /** Keep if at least `minCheap` cards cost <= `cheapMaxCost`. */
  cheapMaxCost?: number;
  minCheap?: number;
  /** Keep if any of these cards is in the opening hand. */
  keepIfAny?: string[];
}

export interface PlaybookCore {
  name?: string;
  style?: Style;
  preferSecond?: boolean;
  mulligan?: MulliganRule;
  /** Costs to play on each own turn ("1".."8", 8 = 8+), best first. */
  curve?: { first?: Record<string, number[]>; second?: Record<string, number[]> };
  /** Characters at or below this cost may be traded freely. */
  expendableCost?: number;
  /** Defend harder when life is at or below this value. */
  lifeFloor?: number;
  /** Value of a DON!! in the evaluation for this deck (overrides the bot default; set by learning). */
  donWeight?: number;
  notes?: string[];
}

export interface Playbook extends PlaybookCore {
  leader: string;
  matchups?: Record<string, PlaybookCore & { note?: string }>;
}

export type PlaybookSet = Record<string, Playbook>;

/** The playbook for `seat`, with the matchup override for the opposing leader merged in. */
export function playbookFor(books: PlaybookSet, s: GameState, seat: Seat): Playbook | null {
  const mine = s.players[seat].leader.id;
  const theirs = s.players[seat === 0 ? 1 : 0].leader.id;
  const pb = books[mine];
  if (!pb) return null;
  const mu = pb.matchups?.[theirs];
  if (!mu) return pb;
  const { note: _note, ...override } = mu;
  return { ...pb, ...override, leader: pb.leader };
}

export function styleOf(pb: Playbook | null): Style {
  return pb?.style ?? 'balanced';
}

/** Preferred costs for this turn according to the playbook curve. */
export function curveCosts(pb: Playbook | null, s: GameState, seat: Seat): number[] {
  const curve = s.first === seat ? pb?.curve?.first : pb?.curve?.second;
  if (!curve) return [];
  return curve[String(Math.min(8, ownTurnNumber(s, seat)))] ?? [];
}
