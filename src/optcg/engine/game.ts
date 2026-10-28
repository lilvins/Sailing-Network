// Rules engine: setup, turn structure, battle, legal actions and applying them.
//
// Flow: applyAction() performs one decision, then advance() runs the game
// forward (abilities on the stack, triggered abilities, battle steps, end of
// turn) until someone has to decide again (s.prompt, or the turn player in the
// main phase).

import { procOk } from './conditions.js';
import { bindDb, checkDeckOut, deploy, canDeploy, drawCards, fire, makeActivation, moveTo, removeCard, restCard } from './moves.js';
import { attackTargets, canAttack, canBlock, counterValue, hasKeyword, immuneInBattle, mutation, negated, playCost, playerRule, power, readSession } from './query.js';
import { answerPrompt, promptActions, runStack } from './runner.js';
import { expireMods, fieldCards, findCard, hasFlag, opp, shuffleInState, totalDon } from './state.js';
import type { Ability, Action, CardInst, Db, DeckList, GameState, PlayerState, Seat } from './types.js';

export const DON_DECK_SIZE = 10;
export const HAND_SIZE = 5;

export { findCard, opp, power, counterValue, hasKeyword };

function makeInst(s: GameState, id: string, owner: Seat): CardInst {
  return { uid: s.nextUid++, id, owner, rested: false, don: 0, enteredTurn: 0, used: [], mods: [], faceUp: false };
}

function emptyStats(): PlayerState['stats'] {
  return { eventMaxCost: 0, oppCharKOd: false, lostLife: false, handTrashedByEffect: false, battledCharacter: [] };
}

// ---------------------------------------------------------------------------
// Setup

export interface NewGameOptions {
  seed: number;
  first: Seat;
}

export function newGame(db: Db, decks: [DeckList, DeckList], opts: NewGameOptions): GameState {
  bindDb(db);
  const s = {
    turn: 0,
    active: opts.first,
    first: opts.first,
    phase: 'setup',
    battle: null,
    prompt: null,
    stack: [],
    pending: [],
    endOfTurn: [],
    startOfMain: [],
    view: null,
    ending: false,
    winner: null,
    nextUid: 1,
    rng: opts.seed >>> 0 || 1,
  } as unknown as GameState;
  const mk = (d: DeckList, owner: Seat): PlayerState => {
    if (!db[d.leader]) throw new Error(`unknown leader ${d.leader}`);
    const deck = d.cards.map((id) => {
      if (!db[id]) throw new Error(`unknown card ${id}`);
      return makeInst(s, id, owner);
    });
    shuffleInState(s, deck);
    return {
      name: d.name,
      leader: makeInst(s, d.leader, owner),
      chars: [],
      stage: null,
      hand: deck.splice(0, HAND_SIZE),
      deck,
      life: [],
      trash: [],
      donDeck: DON_DECK_SIZE,
      donActive: 0,
      donRested: 0,
      mods: [],
      stats: emptyStats(),
      extraTurns: 0,
    };
  };
  s.players = [mk(decks[0], 0), mk(decks[1], 1)];
  for (const seat of [0, 1] as Seat[]) {
    const override = playerRule(db, s, seat, 'DonDeckOverride');
    if (override) s.players[seat].donDeck = override;
  }
  s.prompt = { kind: 'mulligan', player: opts.first };
  return s;
}

/** Who must act next. */
export function actor(s: GameState): Seat {
  return s.prompt ? s.prompt.player : s.active;
}

/** Neither player may attack during their own first turn. */
export function canAttackThisTurn(s: GameState): boolean {
  return s.turn > 2;
}

/** Own turn number for a seat (1 = that player's first turn). */
export function ownTurnNumber(s: GameState, seat: Seat): number {
  return seat === s.first ? Math.ceil(s.turn / 2) : Math.floor(s.turn / 2);
}

// ---------------------------------------------------------------------------
// Legal actions

function abilityFeasible(db: Db, s: GameState, inst: CardInst, owner: Seat, ab: Ability, idx: number): boolean {
  if (ab.proc.OncePerTurn && inst.used.includes(idx)) return false;
  if (inst.used.includes(-1 - idx)) return false;
  if (!procOk(db, s, inst, owner, ab.proc)) return false;
  const p = s.players[owner];
  for (const st of ab.steps) {
    const dm = Number(st.effect?.DonMinus) || 0;
    if (dm && totalDon(p) < dm) return false;
  }
  return true;
}

/** Event [Main] / [Counter] ability index, if playable now. */
function eventAbility(db: Db, s: GameState, inst: CardInst, seat: Seat, key: 'ActivateMain' | 'Counter'): number {
  const p = s.players[seat];
  if (hasFlag(p.leader, 'cantPlayFromHand')) return -1;
  if (playCost(db, s, inst.uid) > p.donActive) return -1;
  const abs = db[inst.id].abilities;
  for (let i = 0; i < abs.length; i++) if (abs[i].proc[key] && abilityFeasible(db, s, inst, seat, abs[i], i)) return i;
  return -1;
}

export function legalActions(db: Db, s: GameState): Action[] {
  return readSession(s, () => legalActionsRaw(db, s));
}

function legalActionsRaw(db: Db, s: GameState): Action[] {
  if (s.winner !== null) return [];
  const pr = s.prompt;
  if (pr) {
    switch (pr.kind) {
      case 'mulligan':
        return [{ type: 'mulligan', redraw: false }, { type: 'mulligan', redraw: true }];
      case 'block': {
        const b = s.battle!;
        const blockers = s.players[pr.player].chars.filter((c) => c.uid !== b.target && canBlock(db, s, c.uid, b.attacker));
        return [...blockers.map((c): Action => ({ type: 'block', blocker: c.uid })), { type: 'block', blocker: null }];
      }
      case 'counter': {
        const p = s.players[pr.player];
        const out: Action[] = [];
        for (const c of p.hand) {
          const d = db[c.id];
          if (d.type === 'Character' && counterValue(db, s, c.uid) > 0) out.push({ type: 'counter', uid: c.uid });
          else if (d.type === 'Event' && eventAbility(db, s, c, pr.player, 'Counter') >= 0) out.push({ type: 'counter', uid: c.uid });
        }
        out.push({ type: 'counter', uid: null });
        return out;
      }
      case 'trigger':
        return [{ type: 'trigger', use: true }, { type: 'trigger', use: false }];
      default:
        return promptActions(s);
    }
  }
  if (s.phase !== 'main' || s.battle || s.ending || s.stack.length || s.pending.length) return [];

  const me = s.active;
  const p = s.players[me];
  const out: Action[] = [];
  for (const c of p.hand) {
    const d = db[c.id];
    if (d.type === 'Character' || d.type === 'Stage') {
      if (playCost(db, s, c.uid) <= p.donActive && canDeploy(db, s, c.uid, me, false)) out.push({ type: 'play', uid: c.uid });
    } else if (d.type === 'Event') {
      const i = eventAbility(db, s, c, me, 'ActivateMain');
      if (i >= 0) out.push({ type: 'activate', uid: c.uid, ability: i });
    }
  }
  for (const c of fieldCards(p)) {
    if (negated(db, s, c, me)) continue;
    db[c.id].abilities.forEach((ab, i) => {
      if (ab.proc.ActivateMain && abilityFeasible(db, s, c, me, ab, i)) out.push({ type: 'activate', uid: c.uid, ability: i });
    });
  }
  if (p.donActive > 0) {
    for (const c of [p.leader, ...p.chars]) {
      out.push({ type: 'attachDon', target: c.uid, n: 1 });
      if (p.donActive > 1) out.push({ type: 'attachDon', target: c.uid, n: p.donActive });
    }
  }
  if (canAttackThisTurn(s))
    for (const a of [p.leader, ...p.chars]) if (canAttack(db, s, a.uid)) for (const t of attackTargets(db, s, a.uid)) out.push({ type: 'attack', attacker: a.uid, target: t });
  out.push({ type: 'endTurn' });
  return out;
}

// ---------------------------------------------------------------------------
// Applying actions

export interface ApplyOptions {
  /** Mutate the given state instead of cloning it (used inside rollouts). */
  noClone?: boolean;
}

export function applyAction(db: Db, state: GameState, a: Action, opts: ApplyOptions = {}): GameState {
  const s = opts.noClone ? state : structuredClone(state);
  bindDb(db);
  mutation(() => {
    doAction(db, s, a);
    advance(db, s);
  });
  return s;
}

function doAction(db: Db, s: GameState, a: Action): void {
  const pr = s.prompt;
  if (pr && pr.kind !== 'mulligan' && pr.kind !== 'block' && pr.kind !== 'counter' && pr.kind !== 'trigger') {
    if (!answerPrompt(db, s, a)) throw new Error(`illegal answer ${a.type} to ${pr.kind}`);
    return;
  }
  switch (a.type) {
    case 'mulligan': {
      if (pr?.kind !== 'mulligan') throw new Error('no mulligan pending');
      const p = s.players[pr.player];
      if (a.redraw) {
        p.deck.push(...p.hand.splice(0));
        shuffleInState(s, p.deck);
        p.hand.push(...p.deck.splice(0, HAND_SIZE));
      }
      if (pr.player === s.first) s.prompt = { kind: 'mulligan', player: opp(s.first) };
      else {
        s.prompt = null;
        for (const pl of s.players) pl.life.push(...pl.deck.splice(0, db[pl.leader.id].life));
        for (const seat of [s.first, opp(s.first)] as Seat[]) fire(db, s, 'StartOfGame', { uids: [s.players[seat].leader.uid] });
        s.turn = 1;
        s.active = s.first;
        startTurn(db, s);
      }
      return;
    }
    case 'play': {
      const p = s.players[s.active];
      const c = p.hand.find((x) => x.uid === a.uid);
      if (!c) throw new Error('card not in hand');
      const price = playCost(db, s, a.uid);
      if (price > p.donActive) throw new Error('not enough DON');
      p.donActive -= price;
      p.donRested += price;
      if (hasFlag(p.leader, 'rosinanteLaw') && db[c.id].names.includes('Trafalgar Law')) p.leader.mods = p.leader.mods.filter((m) => m.name !== 'rosinanteLaw');
      if (hasFlag(p.leader, 'wanoDiscount') && db[c.id].categories.includes(30) && db[c.id].cost >= 3) p.leader.mods = p.leader.mods.filter((m) => m.name !== 'wanoDiscount');
      deploy(db, s, a.uid, s.active);
      return;
    }
    case 'activate': {
      const f = findCard(s, a.uid);
      if (!f || f.owner !== s.active) throw new Error('illegal activate');
      const d = db[f.inst.id];
      const timing = d.type === 'Event' ? 'EventMain' : 'ActivateMain';
      s.stack.push(makeActivation(f.inst, f.owner, a.ability, timing));
      return;
    }
    case 'attachDon': {
      const p = s.players[s.active];
      const f = findCard(s, a.target);
      if (!f || f.owner !== s.active || a.n > p.donActive) throw new Error('illegal attachDon');
      p.donActive -= a.n;
      f.inst.don += a.n;
      fire(db, s, 'DonGiven', { seats: [s.active], main: a.target });
      return;
    }
    case 'attack':
      return declareAttack(db, s, a.attacker, a.target);
    case 'endTurn': {
      const p = s.players[s.active];
      fire(db, s, 'EndOfTurn', { seats: [s.active] });
      s.pending.push(...s.endOfTurn.splice(0));
      void p;
      s.ending = true;
      s.phase = 'end';
      return;
    }
    case 'block': {
      if (pr?.kind !== 'block' || !s.battle) throw new Error('no block pending');
      s.prompt = null;
      if (a.blocker !== null) {
        const f = findCard(s, a.blocker);
        if (!f) throw new Error('illegal blocker');
        restCard(db, s, f.inst, f.owner, f.owner);
        s.battle.target = a.blocker;
        s.battle.blocked = true;
        fire(db, s, 'OnBlock', { uids: [a.blocker] });
        fire(db, s, 'OpponentActivatesBlocker', { seats: [s.battle.attackerOwner] });
      }
      return;
    }
    case 'counter': {
      if (pr?.kind !== 'counter' || !s.battle) throw new Error('no counter pending');
      s.prompt = null;
      if (a.uid === null) {
        s.battle.counterDone = true;
        return;
      }
      const seat = pr.player;
      const c = s.players[seat].hand.find((x) => x.uid === a.uid);
      if (!c) throw new Error('counter not in hand');
      const d = db[c.id];
      if (d.type === 'Character') {
        const v = counterValue(db, s, c.uid);
        moveTo(s, c.uid, 'trash');
        const t = findCard(s, s.battle.target);
        if (t) t.inst.mods.push({ kind: 'power', value: v, until: { at: 'battle' } });
      } else {
        const i = eventAbility(db, s, c, seat, 'Counter');
        if (i < 0) throw new Error('counter event not playable');
        s.stack.push(makeActivation(c, seat, i, 'Counter'));
      }
      return;
    }
    case 'trigger': {
      if (pr?.kind !== 'trigger') throw new Error('no trigger pending');
      s.prompt = null;
      if (a.use) {
        const f = findCard(s, pr.uid);
        if (f) {
          const i = db[f.inst.id].abilities.findIndex((x) => x.proc.Trigger);
          if (i >= 0) {
            s.stack.push(makeActivation(f.inst, pr.player, i, 'Trigger'));
            fire(db, s, 'YouActivateTrigger', { seats: [pr.player] });
            fire(db, s, 'OppActivatesTrigger', { seats: [opp(pr.player)] });
          }
        }
      }
      return;
    }
    default:
      throw new Error(`unexpected action ${a.type}`);
  }
}

function declareAttack(db: Db, s: GameState, attacker: number, target: number): void {
  const f = findCard(s, attacker);
  if (!f || f.owner !== s.active || !canAttack(db, s, attacker) || !canAttackThisTurn(s)) throw new Error('illegal attack');
  const t = findCard(s, target);
  if (!t) throw new Error('illegal attack target');
  s.battle = { attacker, target, attackerOwner: s.active, step: 'attack', blocked: false, counterDone: false, hit: null, damageLeft: 0 };
  restCard(db, s, f.inst, f.owner, f.owner);
  const def = opp(s.active);
  fire(db, s, 'OnAttack', { uids: [attacker] });
  if (t.zone === 'leader') fire(db, s, 'OnAttackLeader', { uids: [attacker] });
  if (f.zone === 'leader') fire(db, s, 'MyLeaderAttacks', { seats: [s.active] });
  fire(db, s, 'OnOpponentAttack', { seats: [def], main: attacker });
  fire(db, s, 'OnOpponentAttackThis', { uids: [target] });
  if (t.zone === 'leader') fire(db, s, 'MyLeaderAttacked', { seats: [def] });
}

// ---------------------------------------------------------------------------
// Turn structure and battle steps

function startTurn(db: Db, s: GameState): void {
  expireMods(s, 'start', s.turn);
  const me = s.active;
  const p = s.players[me];
  for (const pl of s.players) for (const c of fieldCards(pl)) c.used = [];
  p.stats = emptyStats();
  fire(db, s, 'StartOfTurn', { uids: [p.leader.uid] });
  // Refresh: attached DON!! return to the cost area; everything becomes active
  // unless frozen.
  const freezeCaps = fieldCards(s.players[0])
    .concat(fieldCards(s.players[1]))
    .flatMap((c) => db[c.id].abilities.filter((a) => a.proc.Passive && a.steps[0]?.effect?.FreezeAllCostOrLess).map((a) => a.steps[0].effect!.FreezeAllCostOrLess as number));
  const cap = freezeCaps.length ? Math.max(...freezeCaps) : -1;
  for (const c of fieldCards(p)) {
    p.donActive += c.don;
    c.don = 0;
    const frozen = c.mods.some((m) => m.until.at === 'refresh' && m.name === 'frozen');
    const capped = cap >= 0 && p.chars.includes(c) && db[c.id].cost <= cap;
    if (!frozen && !capped) c.rested = false;
    c.mods = c.mods.filter((m) => !(m.until.at === 'refresh' && m.until.seat === me));
  }
  p.donActive += p.donRested;
  p.donRested = 0;
  if (s.turn !== 1) drawCards(db, s, me, 1);
  const k = Math.min(p.donDeck, s.turn === 1 ? 1 : 2);
  p.donDeck -= k;
  p.donActive += k;
  if (k > 0) fire(db, s, 'DrewDonForTurn', { uids: [p.leader.uid] });
  s.phase = 'main';
  for (const q of s.startOfMain.filter((x) => x.seat === me)) s.pending.push(q.act);
  s.startOfMain = s.startOfMain.filter((x) => x.seat !== me);
  fire(db, s, 'StartOfMainPhase', { seats: [me] });
}

function finishTurn(db: Db, s: GameState): void {
  const me = s.active;
  if (s.players[me].deck.length === 0 && fieldCards(s.players[me]).some((c) => db[c.id].abilities.some((a) => a.proc.DeckOut))) {
    s.winner = opp(me);
    return;
  }
  expireMods(s, 'end', s.turn);
  s.ending = false;
  s.view = null;
  if (s.players[me].extraTurns > 0) s.players[me].extraTurns--;
  else s.active = opp(me);
  s.turn++;
  startTurn(db, s);
}

function attackerStillThere(s: GameState): boolean {
  const b = s.battle!;
  const a = findCard(s, b.attacker);
  const t = findCard(s, b.target);
  return !!a && !!t && (a.zone === 'leader' || a.zone === 'chars') && (t.zone === 'leader' || t.zone === 'chars');
}

function resolveDamage(db: Db, s: GameState): void {
  const b = s.battle!;
  if (b.hit === null) {
    if (!attackerStillThere(s)) {
      b.step = 'end';
      return;
    }
    b.hit = power(db, s, b.attacker) >= power(db, s, b.target);
    const tgt = findCard(s, b.target)!;
    if (tgt.zone === 'chars') {
      s.players[b.attackerOwner].stats.battledCharacter.push(b.attacker);
      if (b.hit && !immuneInBattle(db, s, b.target, b.attacker)) {
        removeCard(db, s, b.target, 'ko', b.attackerOwner, { combat: true, source: b.attacker });
        if (findCard(s, b.target)?.zone === 'trash') fire(db, s, 'KOdInBattle', { uids: [b.attacker], main: b.target });
      }
      b.step = 'end';
      return;
    }
    if (!b.hit) {
      b.step = 'end';
      return;
    }
    b.damageLeft = hasKeyword(db, s, b.attacker, 'DoubleAttack') ? 2 : 1;
  }
  if (b.damageLeft <= 0) {
    b.step = 'end';
    return;
  }
  b.damageLeft--;
  const defender = opp(b.attackerOwner);
  const dp = s.players[defender];
  const card = dp.life[dp.life.length - 1];
  if (!card) {
    s.winner = b.attackerOwner;
    return;
  }
  fire(db, s, 'MyLeaderHit', { seats: [defender] });
  fire(db, s, 'IHitLeader', { uids: [b.attacker] });
  fire(db, s, 'AnyHitLeader', { seats: [b.attackerOwner] });
  if (hasKeyword(db, s, b.attacker, 'Banish')) {
    moveTo(s, card.uid, 'trash');
    return;
  }
  if (card.faceUp && playerRule(db, s, defender, 'FaceUpLifeGoesToDeck')) {
    moveTo(s, card.uid, 'deckBottom');
    return;
  }
  moveTo(s, card.uid, 'hand');
  if (db[card.id].abilities.some((a) => a.proc.Trigger)) s.prompt = { kind: 'trigger', player: defender, uid: card.uid };
}

export function advance(db: Db, s: GameState): void {
  for (let guard = 0; guard < 20000; guard++) {
    if (s.winner !== null) {
      s.phase = 'over';
      s.prompt = null;
      return;
    }
    if (s.prompt) return;
    if (s.stack.length || s.pending.length) {
      runStack(db, s);
      continue;
    }
    const b = s.battle;
    if (b) {
      switch (b.step) {
        case 'attack':
          if (!attackerStillThere(s)) {
            b.step = 'end';
            continue;
          }
          b.step = 'block';
          if (s.players[opp(b.attackerOwner)].chars.some((c) => c.uid !== b.target && canBlock(db, s, c.uid, b.attacker))) {
            s.prompt = { kind: 'block', player: opp(b.attackerOwner) };
            return;
          }
          continue;
        case 'block':
          b.step = 'counter';
          continue;
        case 'counter':
          if (!attackerStillThere(s)) {
            b.step = 'end';
            continue;
          }
          if (!b.counterDone) {
            s.prompt = { kind: 'counter', player: opp(b.attackerOwner) };
            return;
          }
          b.step = 'damage';
          continue;
        case 'damage':
          resolveDamage(db, s);
          continue;
        case 'end': {
          const t = findCard(s, b.target);
          if (t && t.zone !== 'leader') fire(db, s, 'AfterBattleCharacter', { uids: [b.attacker], main: b.target });
          s.battle = null;
          for (const pl of s.players)
            for (const c of [...pl.chars]) if (hasFlag(c, 'toDeckBottomAfterBattle')) moveTo(s, c.uid, 'deckBottom');
          expireMods(s, 'battle');
          continue;
        }
      }
    }
    if (s.ending) {
      finishTurn(db, s);
      continue;
    }
    checkDeckOut(db, s, 0);
    checkDeckOut(db, s, 1);
    if (s.winner !== null) continue;
    return;
  }
  throw new Error('advance() did not settle');
}
