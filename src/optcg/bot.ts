// Public entry point for embedding the engine and the bot (browser or Node).
// Everything here is pure: data comes in as JSON (see scripts/build-bundle.ts).

import type { LearnedParams } from './ai/learned.js';
import { applyLearned } from './ai/learned.js';
import type { PlaybookSet } from './ai/playbook.js';
import { CasualAgent, ProAgent, type Agent, type ProConfig } from './ai/pro.js';
import type { Db, DeckList } from './engine/types.js';

export * from './engine/game.js';
export { parseDeck } from './engine/deck.js';
export { power, cost, counterValue, playCost, hasKeyword, canAttack, attackTargets } from './engine/query.js';
export { findCard, opp } from './engine/state.js';
export { abilityOf, trace } from './engine/runner.js';
export { actionLabel, cardName, choiceLabel, describePrompt, stepLabel } from './ui.js';
export type * from './engine/types.js';
export { replay, startRecord, type GameRecord } from './record.js';
export { applyLearned, emptyLearned, type LearnedParams } from './ai/learned.js';
export type { Agent, ProConfig } from './ai/pro.js';
export type { Playbook, PlaybookSet } from './ai/playbook.js';

export type BotLevel = 'casual' | 'pro-fast' | 'pro';

/** Search settings per level. 'pro-fast' answers in ~0.1 s, 'pro' in ~0.5 s per decision. */
export const LEVELS: Record<Exclude<BotLevel, 'casual'>, Partial<ProConfig>> = {
  'pro-fast': { candidates: 4, rollouts: 4, turns: 2 },
  pro: {},
};

export interface MetaDeck extends DeckList {
  pop: number;
  wr: number;
}

/** Everything the bot needs, as produced by scripts/build-bundle.ts. */
export interface EngineBundle {
  version: string;
  builtAt: string;
  db: Db;
  playbooks: PlaybookSet;
  metaDecks: MetaDeck[];
}

export function createBot(bundle: EngineBundle, level: BotLevel, seed: number, learned?: LearnedParams | null): Agent {
  const books = applyLearned(bundle.playbooks, learned);
  if (level === 'casual') return new CasualAgent(bundle.db, books);
  return new ProAgent(bundle.db, books, seed, LEVELS[level]);
}
