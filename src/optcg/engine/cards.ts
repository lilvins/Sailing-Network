// Card database: the optcgwebsim card file (stats + actionV3 effects) merged with
// the official English text and our own overrides (data/overrides.json) for the
// cards the site still encodes in its legacy format.

import type { Ability, CardType, Db } from './types.js';

const CARD_TYPES: CardType[] = ['Leader', 'Character', 'Event', 'Stage'];
export const STRIKE_TYPES = ['Strike', 'Slash', 'Ranged', 'Special', 'Wisdom', 'None'];

interface SiteCard {
  cardID: string;
  characterName: string;
  cardType: number;
  colors: number[];
  categories: number[];
  cost: number;
  power: number;
  counter: number;
  life: number;
  strikeType: number;
  extraStrikeTypes: number[];
  extraNames: string[];
  actionV3s: Ability[];
  cardActions: unknown[];
}

export interface Enums {
  CardCategory: Record<string, string>;
  CardColor: Record<string, string>;
  CardType: Record<string, string>;
}

export function buildDb(cards: Record<string, SiteCard>, text: Record<string, string>, overrides: Record<string, Ability[]> = {}): Db {
  const db: Db = {};
  for (const [id, c] of Object.entries(cards)) {
    if (id === 'Don') continue;
    const legacyOnly = c.cardActions?.length > 0 && !c.actionV3s?.length;
    const abilities = (overrides[id] ?? c.actionV3s ?? []).map((a) => ({ proc: a.proc ?? {}, steps: a.steps ?? [] }));
    db[id] = {
      id,
      name: c.characterName,
      names: [c.characterName, ...(c.extraNames ?? [])],
      type: CARD_TYPES[c.cardType] ?? 'Character',
      colors: c.colors ?? [],
      categories: c.categories ?? [],
      cost: c.cost ?? 0,
      power: c.power ?? 0,
      counter: c.counter ?? 0,
      life: c.life ?? 0,
      attributes: [c.strikeType, ...(c.extraStrikeTypes ?? [])].filter((x) => x !== undefined && x !== 5),
      abilities,
      passives: abilities.flatMap((a, i) => (a.proc.Passive || a.proc.UsoppLeader ? [i] : [])),
      text: text[id] ?? '',
      unsupported: legacyOnly && !overrides[id] ? ['<legacy format>'] : [],
    };
  }
  return db;
}
