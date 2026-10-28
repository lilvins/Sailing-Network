// OPTCGSim .deck format: one line per card, "NxCODE" (e.g. "4xOP01-016").
// The leader is the single card whose type is Leader.

import type { Db, DeckList } from './types.js';

export function parseDeck(db: Db, text: string, name = 'deck'): DeckList {
  let leader = '';
  const cards: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s*x\s*([A-Z0-9]+-\d+)/i);
    if (!m) throw new Error(`bad deck line: ${line}`);
    const count = parseInt(m[1], 10);
    const id = m[2].toUpperCase();
    const def = db[id];
    if (!def) throw new Error(`card ${id} not in database`);
    if (def.type === 'Leader') leader = id;
    else for (let i = 0; i < count; i++) cards.push(id);
  }
  if (!leader) throw new Error(`${name}: no leader`);
  if (cards.length !== 50) throw new Error(`${name}: ${cards.length} cards, expected 50`);
  return { name, leader, cards };
}
