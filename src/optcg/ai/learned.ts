// Parameters the bot learns from played games (see scripts/learn.ts).
// They are layered on top of the hand-written playbooks: per leader, and per
// opposing leader, the attack style and the value of a DON!! in the evaluation.

import type { PlaybookSet, Style } from './playbook.js';

export interface LearnedTweak {
  style?: Style;
  donWeight?: number;
}

export interface LearnedLeader extends LearnedTweak {
  matchups?: Record<string, LearnedTweak>;
}

export interface LearnedResults {
  games: number;
  wins: number;
}

export interface LearnedParams {
  version: number;
  updatedAt: string;
  leaders: Record<string, LearnedLeader>;
  /** Results the bot has collected (games it played as this leader, by opponent leader). */
  stats?: Record<string, Record<string, LearnedResults>>;
  /** What the last learning run tried, for the record. */
  log?: string[];
}

export function emptyLearned(): LearnedParams {
  return { version: 1, updatedAt: new Date(0).toISOString(), leaders: {} };
}

/** Playbooks with the learned tweaks applied (a new object; inputs untouched). */
export function applyLearned(books: PlaybookSet, learned: LearnedParams | null | undefined): PlaybookSet {
  if (!learned) return books;
  const out: PlaybookSet = { ...books };
  for (const [leader, t] of Object.entries(learned.leaders)) {
    const base = out[leader] ?? { leader };
    const matchups = { ...(base.matchups ?? {}) };
    for (const [opp, m] of Object.entries(t.matchups ?? {})) matchups[opp] = { ...(matchups[opp] ?? {}), ...m };
    out[leader] = {
      ...base,
      ...(t.style ? { style: t.style } : {}),
      ...(t.donWeight !== undefined ? { donWeight: t.donWeight } : {}),
      matchups,
    };
  }
  return out;
}
