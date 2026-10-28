// Continuous ("Passive") effects and the derived values that depend on them:
// power, base power, cost, counter, keywords, attack/block legality, immunities.
// Nothing is cached in the state: every query rescans the passives on the field.

import { procOk } from './conditions.js';
import { matchSpec } from './targets.js';
import { def, fieldCards, findCard, hasFlag, hasCategory, isSilenced, opp, sumMods } from './state.js';
import type { CardInst, Db, GameState, Json, Seat, TargetSpec } from './types.js';

export interface PassiveSrc {
  inst: CardInst;
  owner: Seat;
  eff: Json;
  spec?: TargetSpec;
}

const ROGER_PIRATES = 136;
let passiveDepth = 0;

// ---------------------------------------------------------------------------
// Read sessions: while nothing mutates the state (legal-action listing, AI
// decisions), derived values are memoised.

let cacheState: GameState | null = null;
let cache = new Map<string, unknown>();

export function readSession<T>(s: GameState, fn: () => T): T {
  const prevState = cacheState;
  const prevCache = cache;
  if (prevState !== s) {
    cacheState = s;
    cache = new Map();
  }
  try {
    return fn();
  } finally {
    cacheState = prevState;
    cache = prevCache;
  }
}

/** Mutations run with the cache off (the previous session is restored after). */
export function mutation<T>(fn: () => T): T {
  const prevState = cacheState;
  const prevCache = cache;
  cacheState = null;
  try {
    return fn();
  } finally {
    cacheState = prevState;
    cache = prevCache;
  }
}

function memo<T>(s: GameState, key: string, fn: () => T): T {
  if (cacheState !== s || guard.size) return fn();
  if (cache.has(key)) return cache.get(key) as T;
  const v = fn();
  cache.set(key, v);
  return v;
}

const rogerCache = new WeakMap<Db, Set<string>>();
function rogerCards(db: Db): Set<string> {
  let r = rogerCache.get(db);
  if (!r) {
    r = new Set(Object.values(db).filter((d) => d.abilities.some((a) => a.proc.RogerSilence)).map((d) => d.id));
    rogerCache.set(db, r);
  }
  return r;
}

/** Is this card's text currently negated? */
export function negated(db: Db, s: GameState, inst: CardInst, owner: Seat): boolean {
  if (isSilenced(inst)) return true;
  const p = s.players[owner];
  if (inst.uid !== p.leader.uid && !p.chars.includes(inst)) return false;
  if (!rogerCards(db).size) return false;
  if (hasCategory(db[inst.id], [ROGER_PIRATES])) return false;
  return fieldCards(p).some((c) => !isSilenced(c) && db[c.id].abilities.some((a) => a.proc.RogerSilence) && hasCategory(db[c.id], [ROGER_PIRATES]));
}

/** Passive effects of one card whose conditions currently hold (any zone). */
export function ownPassives(db: Db, s: GameState, inst: CardInst, owner: Seat): PassiveSrc[] {
  if (passiveDepth > 0) return [];
  const out: PassiveSrc[] = [];
  passiveDepth++;
  try {
    const d = db[inst.id];
    if (!d.passives.length) return out;
    if (negated(db, s, inst, owner)) return out;
    for (const i of d.passives) {
      const ab = d.abilities[i];
      if (!ab.steps[0]?.effect) continue;
      if (!procOk(db, s, inst, owner, ab.proc)) continue;
      out.push({ inst, owner, eff: ab.steps[0].effect, spec: ab.steps[0].target?.[0] });
    }
  } finally {
    passiveDepth--;
  }
  return out;
}

/** All passives from cards on the field (both players). */
const guard = new Set<number>();

/** Everything passive conditions can depend on, cheaply. */
function fingerprint(s: GameState): string {
  let f = `${s.turn}.${s.active}.${s.battle?.attacker ?? 0}.${s.battle?.target ?? 0}.${s.view?.cards.length ?? -1}`;
  for (const p of s.players) {
    f += `|${p.hand.length}.${p.trash.length}.${p.life.length}.${p.deck.length}.${p.donActive}.${p.donRested}.${p.mods.length}`;
    for (const c of fieldCards(p)) f += `,${c.uid}.${c.rested ? 1 : 0}.${c.don}.${c.mods.length}`;
    for (const c of p.life) if (c.faceUp) f += 'u';
  }
  return f;
}

const fpCache = new WeakMap<GameState, { fp: string; val: PassiveSrc[] }>();

export function fieldPassives(db: Db, s: GameState): PassiveSrc[] {
  if (passiveDepth > 0) return [];
  return memo(s, 'fp', () => {
    const fp = fingerprint(s);
    const hit = fpCache.get(s);
    if (hit && hit.fp === fp) return hit.val;
    const out: PassiveSrc[] = [];
    for (const owner of [0, 1] as Seat[]) for (const c of fieldCards(s.players[owner])) out.push(...ownPassives(db, s, c, owner));
    fpCache.set(s, { fp, val: out });
    return out;
  });
}
/** Re-entrancy guard (numeric keys: kind * 2^24 + payload). */
function guarded<T>(key: number, fallback: T, fn: () => T): T {
  if (guard.has(key)) return fallback;
  guard.add(key);
  try {
    return fn();
  } finally {
    guard.delete(key);
  }
}

/** Does passive `src` (with a target filter) affect card `uid`? No filter = the source itself. */
function affects(db: Db, s: GameState, src: PassiveSrc, uid: number): boolean {
  if (!src.spec || src.spec.AutoSelf) return src.inst.uid === uid;
  return guarded(1 * 2 ** 40 + src.inst.uid * 2 ** 20 + uid, false, () =>
    matchSpec(db, s, src.spec!, uid, { ctl: src.owner, actor: src.inst.uid, prevTargets: [], prevNames: [], savedString: '', chosen: [] }),
  );
}

function onField(zone: string): boolean {
  return zone === 'chars' || zone === 'leader' || zone === 'stage';
}

export function basePower(db: Db, s: GameState, uid: number): number {
  const f = findCard(s, uid);
  if (!f) return 0;
  const d = def(db, f.inst);
  let b = d.power;
  const set = f.inst.mods.filter((m) => m.kind === 'basePower');
  if (set.length) b = set[set.length - 1].value;
  if (!onField(f.zone)) return b;
  return guarded(2 * 2 ** 40 + uid, b, () => {
    for (const src of fieldPassives(db, s)) {
      if (src.owner !== f.owner) continue;
      if (src.eff.FieldBasePowerChange && affects(db, s, src, uid)) b = src.eff.FieldBasePowerChange;
      if (src.eff.PassiveBasePowerMatchLeader && src.inst.uid === uid) {
        const L = s.players[f.owner].leader;
        b = L.uid === uid ? b : basePower(db, s, L.uid);
      }
    }
    return b;
  });
}

export function power(db: Db, s: GameState, uid: number): number {
  return memo(s, `P${uid}`, () => powerRaw(db, s, uid));
}

function powerRaw(db: Db, s: GameState, uid: number): number {
  const f = findCard(s, uid);
  if (!f) return 0;
  const d = def(db, f.inst);
  if (!onField(f.zone)) return d.power;
  return guarded(3 * 2 ** 40 + uid, d.power, () => {
    let p = basePower(db, s, uid) + sumMods(f.inst, 'power');
    if (f.owner === s.active) p += f.inst.don * 1000;
    const me = s.players[f.owner];
    for (const src of fieldPassives(db, s)) {
      const e = src.eff;
      const mine = src.owner === f.owner;
      if (mine && affects(db, s, src, uid)) {
        if (e.PassivePowerChange) p += e.PassivePowerChange;
        if (e.Passive1KPerXTrash) p += 1000 * Math.floor(me.trash.length / e.Passive1KPerXTrash);
        if (e.Passive1KPerXEventTrash) p += 1000 * Math.floor(me.trash.filter((c) => db[c.id].type === 'Event').length / e.Passive1KPerXEventTrash);
        if (e.Passive1KPerXRestedDon) p += 1000 * Math.floor(me.donRested / e.Passive1KPerXRestedDon);
        if (e.Passive1KPerHandCard) p += 1000 * me.hand.length;
        if (e.PassivePowerPerUniqueDeploy) p += e.PassivePowerPerUniqueDeploy * new Set(me.chars.map((c) => db[c.id].name)).size;
        if (e.FieldPowerBuff && src.spec) p += e.FieldPowerBuff;
      } else if (mine && e.FieldPowerBuff && !src.spec) {
        // no filter: whole own field
        p += e.FieldPowerBuff;
      }
      if (!mine && e.FieldPowerDebuff && f.zone === 'chars') p += e.FieldPowerDebuff;
    }
    return Math.max(0, p);
  });
}

/** Current cost (field or hand). */
export function cost(db: Db, s: GameState, uid: number): number {
  return memo(s, `C${uid}`, () => costRaw(db, s, uid));
}

function costRaw(db: Db, s: GameState, uid: number): number {
  const f = findCard(s, uid);
  if (!f) return 0;
  const d = def(db, f.inst);
  return guarded(4 * 2 ** 40 + uid, d.cost, () => {
    let c = d.cost + sumMods(f.inst, 'cost');
    const me = s.players[f.owner];
    let selfFamily = false;
    for (const src of ownPassives(db, s, f.inst, f.owner)) {
      const e = src.eff;
      if (!selfFamily && e.PassiveCostChange) {
        c += e.PassiveCostChange;
        selfFamily = true;
      }
      if (e.Passive1CostPerXTrash) c += Math.floor(me.trash.length / e.Passive1CostPerXTrash);
      if (e.Passive2CostPerXTrash) c += 2 * Math.floor(me.trash.length / e.Passive2CostPerXTrash);
      if (f.zone === 'hand' && e.HandCostChange) c += e.HandCostChange;
    }
    if (onField(f.zone)) {
      for (const src of fieldPassives(db, s)) {
        const e = src.eff;
        if (src.owner === f.owner && e.AllyFieldCostChange && src.inst.uid !== uid && affects(db, s, src, uid)) c += e.AllyFieldCostChange;
        if (src.owner !== f.owner && e.OpponentFieldCostChange && f.zone === 'chars' && s.active === src.owner) c += e.OpponentFieldCostChange;
      }
    }
    return Math.max(0, c);
  });
}

/** Cost to play a card from hand right now (after discounts). */
export function playCost(db: Db, s: GameState, uid: number): number {
  const f = findCard(s, uid);
  if (!f) return 0;
  let c = cost(db, s, uid);
  const p = s.players[f.owner];
  for (const fc of fieldCards(p)) for (const src of ownPassives(db, s, fc, f.owner)) if (src.eff.AllyHandPlayCostReduce && affects(db, s, src, uid)) c -= src.eff.AllyHandPlayCostReduce;
  const d = def(db, f.inst);
  const wano = p.leader.mods.find((m) => m.kind === 'flag' && m.name === 'wanoDiscount');
  if (wano && d.type === 'Character' && d.categories.includes(30) && d.cost >= 3) c -= wano.value;
  if (hasFlag(p.leader, 'rosinanteLaw') && d.names.includes('Trafalgar Law') && d.cost >= 4) c = 0;
  return Math.max(0, c);
}

/** Counter value of a card in hand (Characters; Events use [Counter] abilities). */
export function counterValue(db: Db, s: GameState, uid: number): number {
  const f = findCard(s, uid);
  if (!f) return 0;
  const d = def(db, f.inst);
  if (d.type !== 'Character') return 0;
  let v = d.counter;
  for (const src of ownPassives(db, s, f.inst, f.owner)) if (src.eff.HandCounterChange) v += src.eff.HandCounterChange;
  for (const src of fieldPassives(db, s)) {
    if (src.owner !== f.owner) continue;
    const e = src.eff;
    if (e.CharacterTypeHas1KCounter && d.counter === 0 && hasCategory(d, e.CharacterTypeHas1KCounter)) v += 1000;
    if (e.CharactersWithPowerHas2KCounter && d.power === e.CharactersWithPowerHas2KCounter) v += 2000;
    if (e.CharactersWithNoCounterHaveXCounter && d.counter === 0) v += e.CharactersWithNoCounterHaveXCounter;
    if (e.ValidTargetsHaveXCounter && src.spec && affects(db, s, src, uid)) v += e.ValidTargetsHaveXCounter;
  }
  return v;
}

export type Keyword = 'Blocker' | 'Rush' | 'RushCharacters' | 'DoubleAttack' | 'Banish' | 'Unblockable' | 'CanAttackActive';
const KW_INDEX: Record<Keyword, number> = { Blocker: 0, Rush: 1, RushCharacters: 2, DoubleAttack: 3, Banish: 4, Unblockable: 5, CanAttackActive: 6 };

const FLAG_OF: Record<Keyword, string[]> = {
  Blocker: ['blocker'],
  Rush: ['rush'],
  RushCharacters: ['rushCharacters'],
  DoubleAttack: ['doubleAttack'],
  Banish: ['banish'],
  Unblockable: ['unblockable'],
  CanAttackActive: ['canAttackActive'],
};
const FIELD_KEY: Partial<Record<Keyword, string>> = {
  Blocker: 'FieldBlocker',
  Rush: 'FieldRush',
  RushCharacters: 'FieldRushCharacters',
  DoubleAttack: 'FieldDoubleAttack',
  Unblockable: 'FieldUnblockable',
};

export function hasKeyword(db: Db, s: GameState, uid: number, kw: Keyword): boolean {
  return memo(s, `K${kw}${uid}`, () => hasKeywordRaw(db, s, uid, kw));
}

function hasKeywordRaw(db: Db, s: GameState, uid: number, kw: Keyword): boolean {
  const f = findCard(s, uid);
  if (!f) return false;
  if (kw === 'Blocker' && hasFlag(f.inst, 'loseBlocker')) return false;
  if (FLAG_OF[kw].some((n) => hasFlag(f.inst, n))) return true;
  return guarded(5 * 2 ** 40 + KW_INDEX[kw] * 2 ** 20 + uid, false, () => {
    for (const src of ownPassives(db, s, f.inst, f.owner)) if (src.eff[kw] && !src.spec) return true;
    const fk = FIELD_KEY[kw];
    for (const src of fieldPassives(db, s)) {
      if (src.owner !== f.owner) continue;
      if (src.eff[kw] && src.spec && affects(db, s, src, uid)) return true;
      if (fk && src.eff[fk] && affects(db, s, { ...src, spec: src.spec ?? { DeployedCharacter: 1, Leader: 1, FriendlyOnly: 1 } }, uid)) return true;
    }
    return false;
  });
}

export function canAttack(db: Db, s: GameState, uid: number): boolean {
  const f = findCard(s, uid);
  if (!f || f.inst.rested || f.owner !== s.active) return false;
  if (f.zone !== 'leader' && f.zone !== 'chars') return false;
  if (hasFlag(f.inst, 'cantAttack') || hasFlag(f.inst, 'cantRest')) return false;
  for (const src of ownPassives(db, s, f.inst, f.owner)) if (src.eff.PassiveCantAttack) return false;
  for (const src of fieldPassives(db, s)) if (src.eff.FieldCantAttack && src.spec && affects(db, s, src, uid)) return false;
  return true;
}

/** Legal attack targets for an attacker that can attack. */
export function attackTargets(db: Db, s: GameState, uid: number): number[] {
  const f = findCard(s, uid)!;
  const them = s.players[opp(f.owner)];
  const sick = f.zone === 'chars' && f.inst.enteredTurn === s.turn;
  const rush = hasKeyword(db, s, uid, 'Rush');
  const rushChars = hasKeyword(db, s, uid, 'RushCharacters');
  if (sick && !rush && !rushChars) return [];
  const activeOk = hasKeyword(db, s, uid, 'CanAttackActive');
  const noLeader = hasFlag(s.players[f.owner].leader, 'cantAttackLeader');
  const out: number[] = [];
  const noLeaderOnPlay = sick && ownPassives(db, s, f.inst, f.owner).some((p) => p.eff.CantAttackLeaderOnPlayTurn);
  if (!(sick && !rush) && !noLeader && !noLeaderOnPlay) out.push(them.leader.uid);
  for (const c of them.chars) {
    if (!c.rested && !activeOk) continue;
    const capped = f.inst.mods.find((m) => m.kind === 'flag' && m.name === 'cantAttackOrigCostOrLess');
    if (capped && db[c.id].cost <= capped.value) continue;
    out.push(c.uid);
  }
  // "Your opponent can only attack [this card]"
  const forced = fieldPassives(db, s).filter((p) => p.owner !== f.owner && p.eff.OpponentCanOnlyAttackMyName);
  if (forced.length) {
    const names = forced.map((p) => db[p.inst.id].name);
    const allowed = out.filter((t) => {
      const tf = findCard(s, t)!;
      return names.includes(db[tf.inst.id].name);
    });
    return allowed;
  }
  return out;
}

export function canBlock(db: Db, s: GameState, uid: number, attacker: number): boolean {
  const f = findCard(s, uid);
  if (!f || f.zone !== 'chars' || f.inst.rested) return false;
  if (hasFlag(f.inst, 'cantRest') || hasFlag(s.players[f.owner].leader, 'noBlocker')) return false;
  if (!hasKeyword(db, s, uid, 'Blocker')) return false;
  if (hasKeyword(db, s, attacker, 'Unblockable')) return false;
  const af = findCard(s, attacker);
  if (af) {
    for (const src of ownPassives(db, s, af.inst, af.owner)) if (src.eff.BlockerMustBeXOrLess && power(db, s, uid) >= src.eff.BlockerMustBeXOrLess) return false;
    const cap = af.inst.mods.find((m) => m.kind === 'flag' && m.name === 'blockerMaxPower');
    if (cap && power(db, s, uid) >= cap.value) return false;
  }
  return true;
}

/** Would an opponent's effect be unable to remove / K.O. / rest this card? */
export function immuneToEffect(db: Db, s: GameState, uid: number, by: Seat, kind: 'ko' | 'remove' | 'rest', source?: number): boolean {
  const f = findCard(s, uid);
  if (!f || f.owner === by) return false;
  if (!onField(f.zone)) return false;
  if (kind === 'rest') {
    if (hasFlag(f.inst, 'cantRest')) return true;
    for (const src of ownPassives(db, s, f.inst, f.owner)) {
      if (src.eff.ImmuneToRest) return true;
      if (src.eff.ImmuneToRestFromLeaderOrChar && source !== undefined) {
        const sf = findCard(s, source);
        if (sf && (sf.zone === 'leader' || sf.zone === 'chars')) return true;
      }
    }
    return false;
  }
  if (hasFlag(f.inst, 'effectImmune') || hasFlag(f.inst, 'immune')) return true;
  const sf = source !== undefined ? findCard(s, source) : null;
  for (const src of ownPassives(db, s, f.inst, f.owner)) {
    const e = src.eff;
    if (e.ImmuneToRemoval) return true;
    if (kind === 'ko' && e.ImmuneToNoncombat) return true;
    if (e.ImmuneToRemovalFromCharactersXBasePowerOrLess && sf?.zone === 'chars' && basePower(db, s, sf.inst.uid) <= e.ImmuneToRemovalFromCharactersXBasePowerOrLess) return true;
    if (kind === 'ko' && e.VulnerableToNoncombat && !(sf && db[sf.inst.id].attributes.some((a) => e.VulnerableToNoncombat.includes(a)))) return true;
  }
  for (const src of fieldPassives(db, s)) {
    if (src.owner === f.owner && kind === 'ko' && src.eff.OtherCharsImmuneToNoncombatKO && src.inst.uid !== uid && affects(db, s, src, uid)) return true;
    if (src.owner === by && src.eff.OpponentFieldImmuneToRemoval && f.zone === 'chars') return true;
  }
  return false;
}

/** Can this card not be K.O.'d in battle by `attacker`? */
export function immuneInBattle(db: Db, s: GameState, uid: number, attacker: number): boolean {
  const f = findCard(s, uid);
  if (!f) return false;
  if (hasFlag(f.inst, 'combatImmune') || hasFlag(f.inst, 'immune')) return true;
  const af = findCard(s, attacker);
  const attrs = af ? [...db[af.inst.id].attributes, ...af.inst.mods.filter((m) => m.kind === 'attr').map((m) => m.value)] : [];
  const isLeader = af?.zone === 'leader';
  for (const src of fieldPassives(db, s))
    if (src.owner === f.owner && src.eff.OtherCharsImmuneToBattleKO && src.inst.uid !== uid && affects(db, s, src, uid)) return true;
  for (const src of ownPassives(db, s, f.inst, f.owner)) {
    const e = src.eff;
    if (e.ImmuneToBattle) return true;
    if (!isLeader && e.ImmuneToStrikes && attrs.some((a) => e.ImmuneToStrikes.includes(a))) return true;
    if (e.ImmuneToLeaderStrikes && attrs.some((a) => e.ImmuneToLeaderStrikes.includes(a))) return true;
    if (e.VulnerableToStrikes && !attrs.some((a) => e.VulnerableToStrikes.includes(a))) return true;
  }
  return false;
}

/** Player-level passive rule flag from any of that player's field cards. */
export function playerRule(db: Db, s: GameState, seat: Seat, key: string): number {
  for (const c of fieldCards(s.players[seat])) for (const src of ownPassives(db, s, c, seat)) if (src.eff[key]) return Number(src.eff[key]) || 1;
  return 0;
}
