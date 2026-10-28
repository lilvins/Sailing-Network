// Moving cards between zones, playing characters, drawing, life, and dispatching
// the triggered abilities those events cause (including "would be removed"
// replacement effects).

import { procOk } from './conditions.js';
import { cost, immuneToEffect, negated, playerRule, power } from './query.js';
import { def, fieldCards, findCard, hasCategory, hasFlag, hasName, opp, shuffleInState, type Located } from './state.js';
import type { Activation, CardInst, Db, GameState, Json, MoveKind, Seat } from './types.js';

export const MAX_CHARACTERS = 5;

// ---------------------------------------------------------------------------
// Activations and triggers

export function makeActivation(inst: CardInst, owner: Seat, ability: number, timing: string, extra: Partial<Activation> = {}): Activation {
  return {
    uid: inst.uid,
    cardId: inst.id,
    ability,
    owner,
    controller: owner,
    timing,
    stepIdx: 0,
    targets: [],
    prevTargets: [],
    prevNames: [],
    savedInt: 0,
    savedString: '',
    free: false,
    checkedStep: -1,
    confirmedStep: -1,
    declaredStep: -1,
    executedAny: false,
    ...extra,
  };
}

export function queuePending(s: GameState, act: Activation): void {
  // turn player's triggers resolve first; otherwise in the order they happened
  const mine = act.controller === s.active;
  if (mine) {
    const i = s.pending.findIndex((p) => p.controller !== s.active);
    if (i >= 0) s.pending.splice(i, 0, act);
    else s.pending.push(act);
  } else s.pending.push(act);
}

export interface FireOpts {
  /** Only these players' field cards are scanned (default both). */
  seats?: Seat[];
  /** Scan these specific cards (any zone) instead of fields. */
  uids?: number[];
  main?: number;
  /** Extra filter on the proc value / card. */
  filter?: (value: unknown, proc: Json, inst: CardInst, owner: Seat) => boolean;
}

/** Fire every ability with `proc[key]` truthy on the scanned cards. */
export function fire(db: Db, s: GameState, key: string, opts: FireOpts = {}): void {
  const cards: { inst: CardInst; owner: Seat }[] = [];
  if (opts.uids) {
    for (const u of opts.uids) {
      const f = findCard(s, u);
      if (f) cards.push({ inst: f.inst, owner: f.owner });
    }
  } else {
    for (const seat of opts.seats ?? ([s.active, opp(s.active)] as Seat[])) for (const c of fieldCards(s.players[seat])) cards.push({ inst: c, owner: seat });
  }
  for (const { inst, owner } of cards) {
    const f = findCard(s, inst.uid);
    const onField = f && (f.zone === 'chars' || f.zone === 'leader' || f.zone === 'stage');
    if (onField && negated(db, s, inst, owner)) continue;
    db[inst.id].abilities.forEach((ab, i) => {
      const v = ab.proc[key];
      if (!v || (Array.isArray(v) && !v.length && key !== 'YourCharacterKOd')) return;
      if (opts.filter && !opts.filter(v, ab.proc, inst, owner)) return;
      if (ab.proc.OncePerTurn && inst.used.includes(i)) return;
      if (!procOk(db, s, inst, owner, ab.proc)) return;
      queuePending(s, makeActivation(inst, owner, i, key, { mainTarget: opts.main }));
    });
  }
}

// ---------------------------------------------------------------------------
// Zone moves

function pruneView(s: GameState, uid: number): void {
  if (s.view) s.view.cards = s.view.cards.filter((u) => u !== uid);
}

function detach(s: GameState, f: Located): void {
  const p = s.players[f.owner];
  switch (f.zone) {
    case 'chars':
      p.chars = p.chars.filter((c) => c.uid !== f.inst.uid);
      break;
    case 'stage':
      p.stage = null;
      break;
    case 'leader':
      throw new Error('cannot move a Leader');
    default:
      p[f.zone] = p[f.zone].filter((c) => c.uid !== f.inst.uid);
  }
  if (f.zone === 'chars' || f.zone === 'stage') {
    p.donRested += f.inst.don;
    f.inst.don = 0;
    f.inst.rested = false;
    f.inst.mods = [];
    f.inst.used = [];
    f.inst.enteredTurn = 0;
  }
  f.inst.faceUp = false;
}

export type Dest = 'hand' | 'trash' | 'deckTop' | 'deckBottom' | 'lifeTop' | 'lifeBottom';

/** Move a card (not a Leader) to `dest` of its owner. No triggers. */
export function moveTo(s: GameState, uid: number, dest: Dest, faceUp = false): Located | null {
  const f = findCard(s, uid);
  if (!f || f.zone === 'leader') return null;
  detach(s, f);
  pruneView(s, uid);
  const p = s.players[f.owner];
  switch (dest) {
    case 'hand':
      p.hand.push(f.inst);
      break;
    case 'trash':
      p.trash.push(f.inst);
      break;
    case 'deckTop':
      p.deck.unshift(f.inst);
      break;
    case 'deckBottom':
      p.deck.push(f.inst);
      break;
    case 'lifeTop':
      f.inst.faceUp = faceUp;
      p.life.push(f.inst);
      break;
    case 'lifeBottom':
      f.inst.faceUp = faceUp;
      p.life.unshift(f.inst);
      break;
  }
  if (f.zone === 'life') afterLifeLeft(s, f.owner, dest);
  return f;
}

const LIFE_EVENT: Record<Dest, string | null> = {
  hand: 'LifeSentToHand',
  trash: 'LifeSentToTrash',
  deckTop: 'LifeSentToDeck',
  deckBottom: 'LifeSentToDeck',
  lifeTop: null,
  lifeBottom: null,
};

let dbRef: Db | null = null;
/** The engine sets this once so zone moves can fire life triggers. */
export function bindDb(db: Db): void {
  dbRef = db;
}

function afterLifeLeft(s: GameState, owner: Seat, dest: Dest): void {
  const db = dbRef;
  if (!db) return;
  s.players[owner].stats.lostLife = true;
  const ev = LIFE_EVENT[dest];
  if (ev) fire(db, s, ev);
  if (dest === 'hand') fire(db, s, 'YourLifeSentToHand', { seats: [owner] });
  fire(db, s, 'OppLosesLife', { seats: [opp(owner)] });
  if (s.players[owner].life.length === 0) fire(db, s, 'LifeReachesZero', { seats: [owner] });
}

// ---------------------------------------------------------------------------
// Removal with immunity and replacement effects

const SELF_PRE: Record<MoveKind, (combat: boolean) => string[]> = {
  ko: (c) => ['PreKO', c ? 'PreKOCombatOnly' : 'PreKOEffectOnly'],
  trash: () => ['PreTrash'],
  bounce: () => ['PreBounce'],
  deckBottom: () => ['PreDeckBottom'],
  deckTop: () => [],
  topLife: () => ['PreSendToTopLife'],
  bottomLife: () => ['PreSendToBottomLife'],
  rest: () => ['PreRest', 'PreRestCharacterOnly'],
  damage: () => ['PreTakeDamage'],
};
const ALLY_PRE: Record<MoveKind, (combat: boolean) => string[]> = {
  ko: (c) => (c ? ['PreAllyKO'] : ['PreAllyKO', 'PreAllyKOEffectOnly']),
  trash: () => ['PreAllyTrash'],
  bounce: () => ['PreAllyBounce'],
  deckBottom: () => ['PreAllyDeckBottom'],
  deckTop: () => [],
  topLife: () => ['PreAllySendToTopLife'],
  bottomLife: () => ['PreAllySendToBottomLife'],
  rest: () => [],
  damage: () => [],
};

function allyFilterOk(db: Db, s: GameState, proc: Json, protectedCard: CardInst, holder: CardInst): boolean {
  const d = db[protectedCard.id];
  if (proc.PreAllyNotSelf && protectedCard.uid === holder.uid) return false;
  if (d.type !== 'Character' && protectedCard.uid !== holder.uid) return false;
  if (proc.PreAllyColor?.length && !d.colors.some((k: number) => proc.PreAllyColor.includes(k))) return false;
  if (proc.PreAllyCategory?.length && !hasCategory(d, proc.PreAllyCategory)) return false;
  if (proc.PreAllyStrikeType?.length && !d.attributes.some((a) => proc.PreAllyStrikeType.includes(a))) return false;
  if (proc.PreAllyNamed?.length && !hasName(d, proc.PreAllyNamed)) return false;
  if (proc.PreAllyNotNamed?.length && hasName(d, proc.PreAllyNotNamed)) return false;
  if (proc.PreAllyCostOrLower && cost(db, s, protectedCard.uid) > proc.PreAllyCostOrLower) return false;
  if (proc.PreAllyOriginalCostOrLower && d.cost > proc.PreAllyOriginalCostOrLower) return false;
  if (proc.PreAllyOriginalCostOrMore && d.cost < proc.PreAllyOriginalCostOrMore) return false;
  if (proc.PreAllyOriginalPowerOrLower && d.power > proc.PreAllyOriginalPowerOrLower) return false;
  if (proc.PreAllyOriginalPowerOrMore && d.power < proc.PreAllyOriginalPowerOrMore) return false;
  if (proc.PreAllyRested && !protectedCard.rested) return false;
  if (proc.PreAllyPowerOrMore && power(db, s, protectedCard.uid) < proc.PreAllyPowerOrMore) return false;
  return true;
}

/** Find one replacement ability for a card about to be moved, if any. */
export function findReplacement(db: Db, s: GameState, uid: number, kind: MoveKind, by: Seat, combat: boolean): Activation | null {
  const f = findCard(s, uid);
  if (!f) return null;
  const owner = f.owner;
  const selfKeys = SELF_PRE[kind](combat);
  const allyKeys = ALLY_PRE[kind](combat);
  for (const holder of fieldCards(s.players[owner])) {
    if (negated(db, s, holder, owner)) continue;
    const abilities = db[holder.id].abilities;
    for (let i = 0; i < abilities.length; i++) {
      const proc = abilities[i].proc;
      if (proc.OnlyOppActions && by === owner) continue;
      if (proc.OncePerTurn && holder.used.includes(i)) continue;
      let hit = holder.uid === uid && selfKeys.some((k) => proc[k]);
      if (!hit && allyKeys.some((k) => proc[k])) hit = allyFilterOk(db, s, proc, f.inst, holder);
      if (!hit && kind === 'ko' && !combat && proc.PreCharacterKOEffectOnly?.length) hit = hasName(db[f.inst.id], proc.PreCharacterKOEffectOnly);
      if (!hit) continue;
      if (!procOk(db, s, holder, owner, proc)) continue;
      return makeActivation(holder, owner, i, 'replacement', {
        mainTarget: uid,
        prevTargets: [uid],
        replacement: { move: kind, uid, by, combat },
      });
    }
  }
  return null;
}

export interface RemoveOpts {
  combat?: boolean;
  source?: number;
  faceUp?: boolean;
  /** Skip replacement lookup (used when a replacement was declined). */
  noReplace?: boolean;
}

/**
 * Remove a card from the field (or move a non-field card) by player `by`.
 * Returns 'done', 'immune', or 'replaced' (a replacement ability was pushed on
 * the stack; the move happens later only if it is declined).
 */
export function removeCard(db: Db, s: GameState, uid: number, kind: MoveKind, by: Seat, opts: RemoveOpts = {}): 'done' | 'immune' | 'replaced' {
  const f = findCard(s, uid);
  if (!f) return 'immune';
  const fromField = f.zone === 'chars' || f.zone === 'stage' || f.zone === 'leader';
  if (fromField && !opts.combat && immuneToEffect(db, s, uid, by, kind === 'ko' ? 'ko' : kind === 'rest' ? 'rest' : 'remove', opts.source)) return 'immune';
  if (fromField && !opts.noReplace) {
    const rep = findReplacement(db, s, uid, kind, by, !!opts.combat);
    if (rep) {
      s.stack.push(rep);
      return 'replaced';
    }
  }
  performRemoval(db, s, uid, kind, by, opts);
  return 'done';
}

export function performRemoval(db: Db, s: GameState, uid: number, kind: MoveKind, by: Seat, opts: RemoveOpts = {}): void {
  const f = findCard(s, uid);
  if (!f) return;
  const owner = f.owner;
  const wasChar = f.zone === 'chars';
  if (kind === 'rest') {
    restCard(db, s, f.inst, owner, by);
    return;
  }
  const dest: Dest = { ko: 'trash', trash: 'trash', bounce: 'hand', deckBottom: 'deckBottom', deckTop: 'deckTop', topLife: 'lifeTop', bottomLife: 'lifeBottom', damage: 'hand' }[kind] as Dest;
  const d = def(db, f.inst);
  moveTo(s, uid, dest, opts.faceUp);
  if (f.zone === 'hand' && kind === 'trash' && !opts.combat) {
    s.players[owner].stats.handTrashedByEffect = true;
    if (by === owner) fire(db, s, 'HandSentToTrashMyEffect', { seats: [owner] });
  }
  if (!wasChar) return;
  if (kind === 'ko') {
    fire(db, s, 'OnKO', { uids: [uid] });
    if (!opts.combat && by !== owner) fire(db, s, 'OnKOEffectOnly', { uids: [uid] });
    fire(db, s, 'YourCharacterKOd', { seats: [owner], main: uid, filter: (v) => !Array.isArray(v) || !v.length || hasCategory(d, v as number[]) });
    fire(db, s, 'YourCharacterOriginalPowerXOrMoreKOd', { seats: [owner], main: uid, filter: (v) => d.power >= Number(v) });
    fire(db, s, 'AnyCharacterKOd', { main: uid });
    fire(db, s, 'OpponentCharacterKOd', { seats: [opp(owner)], main: uid });
    s.players[opp(owner)].stats.oppCharKOd = true;
  }
  if (!opts.combat) {
    fire(db, s, 'YouRemovedCharacter', { seats: [by], main: uid });
    fire(db, s, 'YourCharacterRemoved', {
      seats: [owner],
      main: uid,
      filter: (v, proc) => (!proc.OnlyOppActions || by !== owner) && Array.isArray(v) && hasCategory(d, v as number[]),
    });
    if (kind === 'bounce' && by !== owner) fire(db, s, 'YouBouncedOppCharacter', { seats: [by], main: uid });
  }
}

export function restCard(db: Db, s: GameState, inst: CardInst, owner: Seat, by: Seat): void {
  if (inst.rested) return;
  inst.rested = true;
  fire(db, s, 'OnRest', { uids: [inst.uid] });
  if (by !== owner) fire(db, s, 'OnRestByOpponent', { uids: [inst.uid] });
  if (s.players[owner].chars.includes(inst)) fire(db, s, 'YouRestedCharacter', { seats: [by], main: inst.uid });
}

// ---------------------------------------------------------------------------
// Playing cards

export interface DeployOpts {
  rested?: boolean;
  byEffect?: boolean;
  /** Character that caused an effect play (for OppDeploysThroughCharacter). */
  viaCharacter?: boolean;
}

/** Can `seat` currently put this card onto the field? */
export function canDeploy(db: Db, s: GameState, uid: number, seat: Seat, byEffect: boolean): boolean {
  const f = findCard(s, uid);
  if (!f) return false;
  const d = def(db, f.inst);
  const p = s.players[seat];
  if (d.type === 'Character') {
    if (hasFlag(p.leader, 'cantPlayChars')) return false;
    const cap = p.leader.mods.find((m) => m.kind === 'flag' && m.name === 'cantPlayOrigCostOrMore');
    if (cap && d.cost >= cap.value) return false;
  }
  if (f.zone === 'hand' && hasFlag(p.leader, 'cantPlayFromHand')) return false;
  if (byEffect) for (const ab of d.abilities) if (ab.proc.Passive && ab.steps[0]?.effect?.CantBeDeployedViaEffect) return false;
  return d.type === 'Character' || d.type === 'Stage';
}

export function deploy(db: Db, s: GameState, uid: number, seat: Seat, opts: DeployOpts = {}): boolean {
  const f = findCard(s, uid);
  if (!f) return false;
  const d = def(db, f.inst);
  const p = s.players[seat];
  const from = f.zone;
  if (d.type === 'Stage') {
    if (p.stage) moveTo(s, p.stage.uid, 'trash');
    moveTo(s, uid, 'hand'); // detach from wherever it is
    p.hand = p.hand.filter((c) => c.uid !== uid);
    f.inst.enteredTurn = s.turn;
    p.stage = f.inst;
    fireOnPlay(db, s, f.inst, seat);
    return true;
  }
  if (d.type !== 'Character') return false;
  if (p.chars.length >= MAX_CHARACTERS) {
    // Rule: trash one of your Characters to make room (cheapest, fewest DON).
    const victim = [...p.chars].sort((a, b) => db[a.id].cost - db[b.id].cost || a.don - b.don)[0];
    moveTo(s, victim.uid, 'trash');
  }
  moveTo(s, uid, 'hand');
  p.hand = p.hand.filter((c) => c.uid !== uid);
  f.inst.enteredTurn = s.turn;
  f.inst.rested = !!opts.rested || playerRule(db, s, seat, 'AllDeployRested') > 0;
  p.chars.push(f.inst);
  if (from === 'life') fire(db, s, 'LifeSentToField');
  fireOnPlay(db, s, f.inst, seat);
  fire(db, s, 'YouDeployed', { seats: [seat], main: uid });
  if (from === 'trash') {
    fire(db, s, 'YouDeployedFromTrash', { seats: [seat], main: uid, filter: (v) => !Array.isArray(v) || hasCategory(d, v as number[]) });
    fire(db, s, 'DeployedAnyFromTrash', { seats: [seat], main: uid });
  }
  if (d.abilities.some((a) => a.proc.Trigger)) fire(db, s, 'YouDeployedTriggerCharacter', { seats: [seat], main: uid });
  fire(db, s, 'OppDeploysOriginalCostXOrMore', { seats: [opp(seat)], main: uid, filter: (v) => d.cost >= Number(v) });
  fire(db, s, 'OppDeploys', { seats: [opp(seat)], main: uid });
  if (opts.viaCharacter) fire(db, s, 'OppDeploysThroughCharacter', { seats: [opp(seat)], main: uid });
  return true;
}

function fireOnPlay(db: Db, s: GameState, inst: CardInst, seat: Seat): void {
  if (playerRule(db, s, seat, 'NoOnPlays')) return;
  if (hasFlag(s.players[seat].leader, 'noOnPlay')) return;
  fire(db, s, 'OnPlay', { uids: [inst.uid] });
}

// ---------------------------------------------------------------------------
// Draw / life / DON

export function drawCards(db: Db, s: GameState, seat: Seat, n: number, byEffect = false): void {
  const p = s.players[seat];
  if (byEffect && hasFlag(p.leader, 'cantDraw')) return;
  for (let i = 0; i < n; i++) {
    const c = p.deck.shift();
    if (!c) break;
    p.hand.push(c);
    if (byEffect) fire(db, s, 'CardDrawn', { seats: [seat] });
  }
  checkDeckOut(db, s, seat);
}

export function checkDeckOut(db: Db, s: GameState, seat: Seat): void {
  if (s.players[seat].deck.length > 0 || s.winner !== null) return;
  if (playerRule(db, s, seat, 'WinsByDeckout')) {
    s.winner = seat;
    return;
  }
  for (const c of fieldCards(s.players[seat])) if (db[c.id].abilities.some((a) => a.proc.DeckOut)) return; // loses at end of turn instead
  s.winner = opp(seat);
}

/** Top N of deck to top of Life (face-down). */
export function heal(s: GameState, seat: Seat, n: number): void {
  const p = s.players[seat];
  for (let i = 0; i < n; i++) {
    const c = p.deck.shift();
    if (!c) break;
    c.faceUp = false;
    p.life.push(c);
  }
}

export function returnDon(db: Db, s: GameState, seat: Seat, n: number): number {
  // Return rested cost-area DON first, then active, then attached (fewest-DON cards first).
  const p = s.players[seat];
  let left = n;
  const take = (k: number) => {
    const t = Math.min(k, left);
    left -= t;
    return t;
  };
  const r = take(p.donRested);
  p.donRested -= r;
  const a = take(p.donActive);
  p.donActive -= a;
  for (const c of [...p.chars, p.leader].sort((x, y) => x.don - y.don)) {
    const t = take(c.don);
    c.don -= t;
  }
  const returned = n - left;
  p.donDeck += returned;
  if (returned > 0) {
    fire(db, s, 'MyDonIsReturned', { seats: [seat] });
    fire(db, s, 'XMyDonIsReturned', { seats: [seat], filter: (v) => returned >= Number(v) });
  }
  return returned;
}

export function shuffleDeck(s: GameState, seat: Seat): void {
  shuffleInState(s, s.players[seat].deck);
}
