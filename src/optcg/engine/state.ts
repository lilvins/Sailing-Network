// Low-level state helpers: lookup, randomness, temporary modifiers and durations.

import { nextRandom } from './rng.js';
import type { CardDef, CardInst, Db, Expiry, GameState, Mod, PlayerState, Seat } from './types.js';

export function opp(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function rand(s: GameState): number {
  const [v, next] = nextRandom(s.rng);
  s.rng = next;
  return v;
}

export function shuffleInState<T>(s: GameState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export type Zone = 'leader' | 'chars' | 'stage' | 'hand' | 'trash' | 'life' | 'deck';

export interface Located {
  inst: CardInst;
  owner: Seat;
  zone: Zone;
}

export function findCard(s: GameState, uid: number): Located | null {
  for (const owner of [0, 1] as Seat[]) {
    const p = s.players[owner];
    if (p.leader.uid === uid) return { inst: p.leader, owner, zone: 'leader' };
    for (const c of p.chars) if (c.uid === uid) return { inst: c, owner, zone: 'chars' };
    if (p.stage?.uid === uid) return { inst: p.stage, owner, zone: 'stage' };
  }
  for (const owner of [0, 1] as Seat[]) {
    const p = s.players[owner];
    for (const zone of ['hand', 'trash', 'life', 'deck'] as const)
      for (const c of p[zone]) if (c.uid === uid) return { inst: c, owner, zone };
  }
  return null;
}

export function fieldCards(p: PlayerState): CardInst[] {
  return [p.leader, ...p.chars, ...(p.stage ? [p.stage] : [])];
}

export function def(db: Db, c: CardInst): CardDef {
  return db[c.id];
}

export function hasName(d: CardDef, names: string[]): boolean {
  return d.names.some((n) => names.includes(n));
}

export function hasCategory(d: CardDef, cats: number[]): boolean {
  return d.categories.some((c) => cats.includes(c));
}

/** Total DON!! on a player's field: cost area + attached. */
export function totalDon(p: PlayerState): number {
  return p.donActive + p.donRested + fieldCards(p).reduce((n, c) => n + c.don, 0);
}

export function attachedDon(p: PlayerState): number {
  return [p.leader, ...p.chars].reduce((n, c) => n + c.don, 0);
}

// ---------------------------------------------------------------------------
// Durations

export function thisTurn(s: GameState): Expiry {
  return { at: 'end', turn: s.turn };
}

/** Until the end of `seat`'s next turn (its current turn if it is the turn player). */
export function untilEndOfTurnOf(s: GameState, seat: Seat): Expiry {
  return { at: 'end', turn: s.active === seat ? s.turn : s.turn + 1 };
}

/** Until the end of the next turn of `seat` that has not started yet. */
export function untilEndOfNextTurnOf(s: GameState, seat: Seat): Expiry {
  return { at: 'end', turn: s.active === seat ? s.turn + 2 : s.turn + 1 };
}

/** Until the start of `seat`'s next turn. */
export function untilStartOfNextTurnOf(s: GameState, seat: Seat): Expiry {
  return { at: 'start', turn: s.active === seat ? s.turn + 2 : s.turn + 1 };
}

export function addMod(c: { mods: Mod[] }, mod: Mod): void {
  c.mods.push(mod);
}

export function flagMod(name: string, until: Expiry): Mod {
  return { kind: 'flag', name, value: 1, until };
}

export function hasFlag(c: { mods: Mod[] }, name: string): boolean {
  return c.mods.some((m) => m.kind === 'flag' && m.name === name);
}

export function sumMods(c: { mods: Mod[] }, kind: Mod['kind']): number {
  let v = 0;
  for (const m of c.mods) if (m.kind === kind) v += m.value;
  return v;
}

function expired(m: Mod, point: 'battle' | 'end' | 'start', turn: number): boolean {
  if (point === 'battle') return m.until.at === 'battle';
  if (m.until.at !== point) return false;
  return (m.until as { turn: number }).turn <= turn;
}

/** Drop modifiers that expire at this point (end of battle / end or start of `turn`). */
export function expireMods(s: GameState, point: 'battle' | 'end' | 'start', turn = s.turn): void {
  for (const p of s.players) {
    p.mods = p.mods.filter((m) => !expired(m, point, turn));
    for (const c of [...fieldCards(p), ...p.hand, ...p.trash, ...p.life, ...p.deck]) {
      if (c.mods.length) c.mods = c.mods.filter((m) => !expired(m, point, turn));
    }
  }
}

export function isSilenced(c: CardInst): boolean {
  return hasFlag(c, 'silenced');
}
