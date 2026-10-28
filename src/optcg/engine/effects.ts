// One-shot effect keys: what happens when a step executes.
// targets[0] ("T0") is the main selection; "Tlast" is the last list chosen.

import { basePower, cost, playCost, power } from './query.js';
import {
  addMod, def, fieldCards, findCard, flagMod, opp, rand, thisTurn, untilEndOfNextTurnOf, untilEndOfTurnOf,
  untilStartOfNextTurnOf,
} from './state.js';
import {
  deploy, drawCards, fire, heal, makeActivation, moveTo, performRemoval, removeCard, restCard, returnDon, shuffleDeck,
} from './moves.js';
import { candidates, ctxOf } from './targets.js';
import { DON_ACTIVE, DON_RESTED, type Activation, type Db, type GameState, type Json, type Seat, type Step } from './types.js';

/** Keys that only qualify a sibling key or the runner. */
export const MODIFIER_KEYS = new Set([
  'ForcedFaceUp', 'DeploysRested', 'NoLog', 'DrawIsHidden', 'AddToLifeIsHidden', 'RevealTopDeckToOpponent', 'StartTopDeckFromLife',
  'LeaveLifeInPosition', 'RevealCard', 'Choices', 'ForceOpponent', 'DeclareCost', 'DeclareString', 'CopyTargetsAtEnd', 'PeekOppLife',
  'PeekSelfLife', 'RevealOppHand', 'HideOppHand', 'PeekOppTopDeckFlip', 'ImmuneToNoncombat', 'NoTakeLifeToTurnStart',
  'CantActivateDonToTurnEnd', 'FieldGainsTenacity', 'GainConfusion',
]);

/** Keys that are only meaningful as continuous (Passive) effects — read by query.ts. */
export const PASSIVE_KEYS = new Set([
  'Blocker', 'Rush', 'RushCharacters', 'DoubleAttack', 'Banish', 'Unblockable', 'CanAttackActive', 'PassiveCantAttack',
  'PassivePowerChange', 'Passive1KPerXTrash', 'Passive1KPerXEventTrash', 'Passive1KPerXRestedDon', 'PassivePowerPerUniqueDeploy',
  'PassiveBasePowerMatchLeader', 'PassiveCostChange', 'Passive1CostPerXTrash', 'Passive2CostPerXTrash', 'HandCostChange',
  'HandCounterChange', 'FieldPowerBuff', 'FieldPowerDebuff', 'FieldBasePowerChange', 'FieldDoubleAttack', 'FieldRushCharacters',
  'FieldBlocker', 'FieldRush', 'FieldUnblockable', 'FieldCantAttack', 'AllyFieldCostChange', 'OpponentFieldCostChange',
  'OtherCharsImmuneToNoncombatKO', 'OpponentFieldImmuneToRemoval', 'AllyHandPlayCostReduce', 'FreezeAllCostOrLess',
  'OpponentCanOnlyAttackMyName', 'CharacterTypeHas1KCounter', 'CharactersWithPowerHas2KCounter', 'CharactersWithNoCounterHaveXCounter',
  'ValidTargetsHaveXCounter', 'AllDeployRested', 'NoOnPlays', 'FaceUpLifeGoesToDeck', 'WinsByDeckout', 'DonDeckOverride',
  'BlockerMustBeXOrLess', 'ImmuneToRemoval', 'ImmuneToRest', 'ImmuneToRestFromLeaderOrChar', 'ImmuneToBattle', 'ImmuneToStrikes',
  'ImmuneToLeaderStrikes', 'VulnerableToStrikes', 'VulnerableToNoncombat', 'ImmuneToRemovalFromCharactersXBasePowerOrLess',
  'CantBeDeployedViaEffect', 'CountsAsEverything',
  // our extensions
  'Passive1KPerHandCard', 'OtherCharsImmuneToBattleKO', 'CantAttackLeaderOnPlayTurn',
]);

export const unknownEffects = new Set<string>();

const v = (x: unknown) => (typeof x === 'number' ? x : x ? 1 : 0);

function cardsOf(s: GameState, uids: number[]) {
  return uids
    .filter((u) => u >= 0)
    .map((u) => findCard(s, u))
    .filter((f): f is NonNullable<typeof f> => !!f);
}

function onField(zone: string): boolean {
  return zone === 'chars' || zone === 'stage' || zone === 'leader';
}

function openView(db: Db, s: GameState, act: Activation, step: Step, key: string, n: number): void {
  const ctl = act.controller;
  const spec = step.target?.[0];
  const filter = (uids: number[]) => (spec ? uids.filter((u) => matchLoose(db, s, act, spec, u)) : uids);
  const p = s.players[ctl];
  const o = s.players[opp(ctl)];
  const eff = step.effect ?? {};
  let owner: Seat = ctl;
  let source: 'deck' | 'hand' | 'trash' | 'life' = 'deck';
  let cards: number[] = [];
  switch (key) {
    case 'StartTopDeck':
      if (eff.StartTopDeckFromLife) {
        source = 'life';
        cards = p.life.slice(-n).reverse().map((c) => c.uid);
      } else cards = p.deck.slice(0, n).map((c) => c.uid);
      break;
    case 'StartTopDeckOpp':
      owner = opp(ctl);
      cards = o.deck.slice(0, n).map((c) => c.uid);
      break;
    case 'StartTopDeckFromTrash':
      source = 'trash';
      cards = filter(p.trash.map((c) => c.uid));
      break;
    case 'StartTopDeckFromOppTrash':
      owner = opp(ctl);
      source = 'trash';
      cards = filter(o.trash.map((c) => c.uid));
      break;
    case 'StartTopDeckFromHand':
      source = 'hand';
      cards = filter(p.hand.map((c) => c.uid));
      break;
    case 'StartTopDeckFromDeck':
      cards = filter(p.deck.map((c) => c.uid));
      break;
    case 'StartTopDeckFromLifeAll':
      source = 'life';
      cards = filter([...p.life].reverse().map((c) => c.uid));
      break;
    case 'StartTopDeckFromOppLifeAll':
      owner = opp(ctl);
      source = 'life';
      cards = filter([...o.life].reverse().map((c) => c.uid));
      break;
  }
  s.view = { owner, viewer: ctl, source, cards, revealed: !!eff.RevealTopDeckToOpponent };
}

/** View filters are written like targets of the source zone; accept zone-less matches too. */
function matchLoose(db: Db, s: GameState, act: Activation, spec: Json, u: number): boolean {
  const zoneFree: Json = { ...spec };
  for (const k of ['HandCard', 'TrashCard', 'DeckCard', 'LifeCard', 'TopDeckCard', 'DeployedCharacter', 'Leader', 'StageCard']) delete zoneFree[k];
  zoneFree.TopDeckCard = 1;
  const saved = s.view;
  s.view = { owner: act.controller, viewer: act.controller, source: 'deck', cards: [u], revealed: false };
  const ok = candidates(db, s, zoneFree, ctxOf(act)).includes(u);
  s.view = saved;
  return ok;
}

function closeView(s: GameState, dest: 'deckBottom' | 'deckTop' | 'lifeTop' | 'trash' | 'none', faceUp = false): void {
  const view = s.view;
  if (!view) return;
  const uids = [...view.cards];
  s.view = null;
  if (dest === 'none') return;
  for (const u of uids) {
    const f = findCard(s, u);
    if (!f) continue;
    if (dest === 'deckBottom') moveTo(s, u, 'deckBottom');
    else if (dest === 'deckTop') moveTo(s, u, 'deckTop');
    else if (dest === 'lifeTop') moveTo(s, u, 'lifeTop', faceUp);
    else moveTo(s, u, 'trash');
  }
}

function takeLife(_db: Db, s: GameState, seat: Seat, n: number, from: 'top' | 'bottom', dest: 'hand' | 'trash'): void {
  const p = s.players[seat];
  for (let i = 0; i < n && p.life.length; i++) {
    const c = from === 'top' ? p.life[p.life.length - 1] : p.life[0];
    moveTo(s, c.uid, dest);
  }
}

/** Damage outside battle: life to hand, losing at 0. */
function damage(db: Db, s: GameState, seat: Seat, n: number): void {
  const p = s.players[seat];
  for (let i = 0; i < n; i++) {
    if (!p.life.length) {
      s.winner = opp(seat);
      return;
    }
    takeLife(db, s, seat, 1, 'top', 'hand');
  }
}

function inlineAct(_db: Db, s: GameState, act: Activation, steps: Step[], prevTargets: number[] = []): Activation {
  const f = findCard(s, act.uid)!;
  return makeActivation(f.inst, act.owner, -1, 'queued', { controller: act.controller, inline: { proc: {}, steps }, prevTargets });
}

/** Apply every effect key of a step. */
export function applyStep(db: Db, s: GameState, act: Activation, step: Step): void {
  const eff = step.effect ?? {};
  const ctl = act.controller;
  const me = s.players[ctl];
  const them = s.players[opp(ctl)];
  const T0 = act.targets[0] ?? [];
  const nonEmpty = act.targets.filter((t) => t && t.length);
  const Tlast = nonEmpty[nonEmpty.length - 1] ?? [];
  const actor = findCard(s, act.uid);
  const cards = cardsOf(s, T0);
  const turn = thisTurn(s);

  // Views open before anything else in the step.
  for (const key of Object.keys(eff)) {
    if (key.startsWith('StartTopDeck') && key !== 'StartTopDeckFromLife' && eff[key]) openView(db, s, act, step, key, v(eff[key]));
  }

  for (const [key, raw] of Object.entries(eff)) {
    if (!raw && raw !== 0) continue;
    const n = v(raw);
    if (key.startsWith('StartTopDeck') || MODIFIER_KEYS.has(key) || PASSIVE_KEYS.has(key)) continue;
    switch (key) {
      // ----- costs and basics
      case 'DonTap': {
        if (act.free && act.stepIdx === 0) break;
        const donPicks = T0.filter((u) => u === DON_ACTIVE(ctl));
        // An Event's step-0 DonTap is its play cost (after cost changes).
        const isEventCost = act.stepIdx === 0 && actor?.zone === 'hand' && def(db, actor.inst).type === 'Event';
        const k = Math.min(isEventCost ? playCost(db, s, act.uid) : donPicks.length || n, me.donActive);
        me.donActive -= k;
        me.donRested += k;
        break;
      }
      case 'TrashSelf':
        if (actor && actor.zone !== 'leader') {
          if (act.free && act.stepIdx === 0 && def(db, actor.inst).type === 'Event' && actor.zone !== 'hand') break;
          if (onField(actor.zone)) removeCard(db, s, act.uid, 'trash', ctl);
          else moveTo(s, act.uid, 'trash');
        }
        break;
      case 'DrawCards':
        drawCards(db, s, ctl, n, true);
        break;
      case 'DrawSavedCount':
        drawCards(db, s, ctl, act.savedInt, true);
        break;
      case 'TrashCard':
        for (const f of cards) {
          if (onField(f.zone)) removeCard(db, s, f.inst.uid, 'trash', ctl, { source: act.uid });
          else performRemoval(db, s, f.inst.uid, 'trash', ctl);
        }
        break;
      case 'KOCard':
        for (const f of cards) if (onField(f.zone)) removeCard(db, s, f.inst.uid, 'ko', ctl, { source: act.uid });
        break;
      case 'KOIfCostXOrLess':
        for (const f of cards)
          if (onField(f.zone) && cost(db, s, f.inst.uid) <= n) removeCard(db, s, f.inst.uid, f.zone === 'stage' ? 'trash' : 'ko', ctl, { source: act.uid });
        break;
      case 'SendToHand':
        for (const f of cards) {
          if (onField(f.zone)) removeCard(db, s, f.inst.uid, 'bounce', ctl, { source: act.uid });
          else moveTo(s, f.inst.uid, 'hand');
        }
        break;
      case 'SendToDeckBottom':
      case 'SendToDeckTop':
      case 'InfiniteReturnToDeck': {
        const top = key === 'SendToDeckTop';
        for (const f of key === 'InfiniteReturnToDeck' ? cardsOf(s, Tlast) : cards) {
          if (onField(f.zone)) removeCard(db, s, f.inst.uid, top ? 'deckTop' : 'deckBottom', ctl, { source: act.uid });
          else moveTo(s, f.inst.uid, top ? 'deckTop' : 'deckBottom');
        }
        break;
      }
      case 'SendToTopLife':
      case 'SendToBottomLife': {
        const top = key === 'SendToTopLife';
        for (const f of cards) {
          if (onField(f.zone)) removeCard(db, s, f.inst.uid, top ? 'topLife' : 'bottomLife', ctl, { source: act.uid, faceUp: !!eff.ForcedFaceUp });
          else moveTo(s, f.inst.uid, top ? 'lifeTop' : 'lifeBottom', !!eff.ForcedFaceUp);
        }
        break;
      }
      case 'SendPreAllyToTopLife':
        if (act.mainTarget !== undefined) moveTo(s, act.mainTarget, 'lifeTop', false);
        break;
      case 'DeployCharacter':
        for (const u of Tlast) deploy(db, s, u, ctl, { rested: !!eff.DeploysRested, byEffect: true, viaCharacter: actor?.zone === 'chars' });
        break;
      case 'DeploySelf':
        if (actor && !onField(actor.zone)) deploy(db, s, act.uid, ctl, { rested: !!eff.DeploysRested, byEffect: true });
        break;
      // ----- power
      case 'BuffPower':
        for (const f of cards) addMod(f.inst, { kind: 'power', value: n, until: turn });
        break;
      case 'BuffCombatPower':
        for (const f of cards) addMod(f.inst, { kind: 'power', value: n, until: { at: 'battle' } });
        break;
      case 'BuffPowerToOppEnd':
        for (const f of cards) addMod(f.inst, { kind: 'power', value: n, until: untilEndOfNextTurnOf(s, opp(f.owner)) });
        break;
      case 'BuffPowerToOwnersEnd':
        for (const f of cards) addMod(f.inst, { kind: 'power', value: n, until: untilEndOfTurnOf(s, f.owner) });
        break;
      case 'BuffPowerToOwnersStart':
        for (const f of cards) addMod(f.inst, { kind: 'power', value: n, until: untilStartOfNextTurnOf(s, f.owner) });
        break;
      case 'BuffXPerPrevTargets':
        if (act.prevTargets.length) for (const f of cards) addMod(f.inst, { kind: 'power', value: n * act.prevTargets.length, until: turn });
        break;
      case 'BuffCombatXPerPrevTargets':
        if (act.prevTargets.length) for (const f of cards) addMod(f.inst, { kind: 'power', value: n * act.prevTargets.length, until: { at: 'battle' } });
        break;
      case 'BuffXPerGivenDon':
        for (const f of cards) addMod(f.inst, { kind: 'power', value: n * f.inst.don, until: turn });
        break;
      case 'BuffXPerTopDeckCost': {
        const top = s.view?.cards[0];
        const tc = top !== undefined ? findCard(s, top) : null;
        if (tc) for (const f of cards) addMod(f.inst, { kind: 'power', value: n * db[tc.inst.id].cost, until: turn });
        break;
      }
      case 'BuffSelf1KPerXTargets':
        if (actor) addMod(actor.inst, { kind: 'power', value: 1000 * Math.floor(Tlast.length / n), until: turn });
        break;
      case 'BuffPreAlly': {
        const t = act.mainTarget !== undefined ? findCard(s, act.mainTarget) : null;
        if (t) addMod(t.inst, { kind: 'power', value: n, until: turn });
        break;
      }
      case 'SetBasePower':
        for (const f of cards) addMod(f.inst, { kind: 'basePower', value: n, until: turn });
        break;
      case 'SetBasePowerToOppEnd':
        for (const f of cards) addMod(f.inst, { kind: 'basePower', value: n, until: untilEndOfNextTurnOf(s, opp(f.owner)) });
        break;
      case 'SetBasePowerToZero':
        for (const f of cards) addMod(f.inst, { kind: 'basePower', value: 0, until: turn });
        break;
      case 'SetPowerToZero':
        for (const f of cards) addMod(f.inst, { kind: 'power', value: -power(db, s, f.inst.uid), until: turn });
        break;
      case 'SwapBasePower':
        if (cards.length === 2) {
          const [a, b] = cards.map((f) => basePower(db, s, f.inst.uid));
          addMod(cards[0].inst, { kind: 'basePower', value: b, until: turn });
          addMod(cards[1].inst, { kind: 'basePower', value: a, until: turn });
        }
        break;
      case 'SwapBasePowerWithLeader':
        if (cards[0]) {
          const L = me.leader;
          const a = basePower(db, s, L.uid);
          const b = basePower(db, s, cards[0].inst.uid);
          addMod(L, { kind: 'basePower', value: b, until: { at: 'battle' } });
          addMod(cards[0].inst, { kind: 'basePower', value: a, until: { at: 'battle' } });
        }
        break;
      case 'MatchOpponentPowerUntilTurnEnd':
        if (actor && cards[0]) addMod(actor.inst, { kind: 'basePower', value: power(db, s, cards[0].inst.uid), until: turn });
        break;
      case 'MatchLeaderToBasePowerUntilTurnEnd':
      case 'MatchLeaderToBasePowerUntilTurnStart': {
        const val = power(db, s, them.leader.uid);
        const until = key.endsWith('End') ? turn : untilStartOfNextTurnOf(s, ctl);
        for (const f of cards) addMod(f.inst, { kind: 'basePower', value: val, until });
        break;
      }
      case 'ChangeCost':
        for (const f of cards) addMod(f.inst, { kind: 'cost', value: n, until: turn });
        break;
      case 'ChangeCostToOppEnd':
        for (const f of cards) addMod(f.inst, { kind: 'cost', value: n, until: untilEndOfNextTurnOf(s, opp(f.owner)) });
        break;
      // ----- rest / activate
      case 'Rest':
        for (const u of T0) {
          if (u < 0) {
            const seat = (u === DON_ACTIVE(0) ? 0 : u === DON_ACTIVE(1) ? 1 : -1) as Seat | -1;
            if (seat !== -1 && s.players[seat].donActive > 0) {
              s.players[seat].donActive--;
              s.players[seat].donRested++;
            }
            continue;
          }
          const f = findCard(s, u);
          if (f && onField(f.zone)) removeCard(db, s, u, 'rest', ctl, { source: act.uid });
        }
        break;
      case 'RestSelf':
        if (actor && onField(actor.zone)) restCard(db, s, actor.inst, actor.owner, ctl);
        break;
      case 'Activate':
        for (const u of T0) {
          if (u < 0) {
            const seat = (u === DON_RESTED(0) ? 0 : u === DON_RESTED(1) ? 1 : -1) as Seat | -1;
            if (seat !== -1 && s.players[seat].donRested > 0) {
              s.players[seat].donRested--;
              s.players[seat].donActive++;
            }
            continue;
          }
          const f = findCard(s, u);
          if (f && onField(f.zone)) f.inst.rested = false;
        }
        break;
      case 'ActivateDonN': {
        const k = Math.min(n, me.donRested);
        me.donRested -= k;
        me.donActive += k;
        break;
      }
      case 'Freeze':
        for (const f of cards) addMod(f.inst, flagMod('frozen', { at: 'refresh', seat: f.owner }));
        break;
      // ----- DON
      case 'AttachRestedDon':
      case 'AttachActiveDon':
        for (const f of cards) {
          const p = s.players[f.owner];
          if (key === 'AttachRestedDon' && p.donRested > 0) {
            p.donRested--;
            f.inst.don++;
          } else if (key === 'AttachActiveDon' && p.donActive > 0) {
            p.donActive--;
            f.inst.don++;
          } else continue;
          fire(db, s, 'DonGiven', { seats: [f.owner], main: f.inst.uid });
        }
        break;
      case 'DetachDon':
        for (const f of cards)
          if (f.inst.don > 0) {
            f.inst.don--;
            s.players[f.owner].donRested++;
          }
        break;
      case 'TransferDon': {
        const to = act.targets[1]?.[0] !== undefined ? findCard(s, act.targets[1][0]) : null;
        if (!to) break;
        for (const u of T0) {
          const src = u <= -1000 ? findCard(s, -1000 - u) : null;
          if (src && src.inst.don > 0) {
            src.inst.don--;
            to.inst.don++;
          }
        }
        break;
      }
      case 'DonMinus':
      case 'OptionalReturnDon': {
        const picks = T0.filter((u) => u < 0);
        if (!picks.length) {
          if (key === 'DonMinus') returnDon(db, s, ctl, n);
          break;
        }
        let returned = 0;
        for (const u of picks) {
          if (u === DON_ACTIVE(ctl) && me.donActive) me.donActive--;
          else if (u === DON_RESTED(ctl) && me.donRested) me.donRested--;
          else if (u <= -1000) {
            const f = findCard(s, -1000 - u);
            if (!f || !f.inst.don) continue;
            f.inst.don--;
          } else continue;
          me.donDeck++;
          returned++;
        }
        if (returned) {
          fire(db, s, 'MyDonIsReturned', { seats: [ctl] });
          fire(db, s, 'XMyDonIsReturned', { seats: [ctl], filter: (x) => returned >= Number(x) });
        }
        break;
      }
      case 'DonMinusToOppCount': {
        const diff = fieldCards(me).reduce((t, c) => t + c.don, me.donActive + me.donRested) - fieldCards(them).reduce((t, c) => t + c.don, them.donActive + them.donRested);
        if (diff > 0) returnDon(db, s, ctl, diff);
        break;
      }
      case 'GainRestedDon':
      case 'GainActiveDon': {
        const k = Math.min(n, me.donDeck);
        me.donDeck -= k;
        if (key === 'GainActiveDon') me.donActive += k;
        else me.donRested += k;
        break;
      }
      // ----- deck / life
      case 'Heal':
        heal(s, ctl, n);
        break;
      case 'MillDeck':
      case 'MillForXPreviousTargets': {
        const k = key === 'MillDeck' ? n : act.prevTargets.length;
        for (let i = 0; i < k && me.deck.length; i++) moveTo(s, me.deck[0].uid, 'trash');
        break;
      }
      case 'TakeTopLife':
        takeLife(db, s, ctl, n, 'top', 'hand');
        break;
      case 'TakeBottomLife':
        takeLife(db, s, ctl, n, 'bottom', 'hand');
        break;
      case 'OppTakeLife':
        takeLife(db, s, opp(ctl), n, 'top', 'hand');
        break;
      case 'TrashTopLife':
        takeLife(db, s, ctl, n, 'top', 'trash');
        break;
      case 'TrashBottomLife':
        takeLife(db, s, ctl, n, 'bottom', 'trash');
        break;
      case 'TrashOppLife':
        takeLife(db, s, opp(ctl), n, 'top', 'trash');
        break;
      case 'TrashLifeTo':
        takeLife(db, s, ctl, Math.max(0, me.life.length - n), 'top', 'trash');
        break;
      case 'TrashAllFaceUpLife':
        for (const c of me.life.filter((x) => x.faceUp)) moveTo(s, c.uid, 'trash');
        break;
      case 'TakeDamage':
        damage(db, s, ctl, n);
        break;
      case 'DealDamage':
        damage(db, s, opp(ctl), n);
        break;
      case 'FlipTopLifeUp':
      case 'FlipTopLifeDown':
        for (const c of me.life.slice(-Math.min(n, me.life.length))) c.faceUp = key === 'FlipTopLifeUp';
        break;
      case 'FlipBotLifeUp':
      case 'FlipBotLifeDown':
        if (me.life[0]) me.life[0].faceUp = key === 'FlipBotLifeUp';
        break;
      case 'FlipLifeDown':
        for (const f of cards) f.inst.faceUp = false;
        break;
      case 'SendOppTopLifeToBot':
        if (them.life.length) them.life.unshift(them.life.pop()!);
        break;
      case 'SendTopLifeToBot':
        if (me.life.length) me.life.unshift(me.life.pop()!);
        break;
      case 'TopDeckToDeckBottom':
        closeView(s, 'deckBottom');
        break;
      case 'TopDeckToDeckTop':
        closeView(s, 'deckTop');
        break;
      case 'TopDeckToLife':
      case 'TopDeckToOppLife':
        closeView(s, 'lifeTop', !!eff.ForcedFaceUp);
        break;
      case 'TrashTopDeck':
        closeView(s, 'trash');
        break;
      case 'CleanUpTopDeck':
        closeView(s, 'none');
        break;
      case 'ShuffleDeck':
        s.view = null;
        shuffleDeck(s, ctl);
        break;
      case 'ShuffleHandIntoDeck': {
        const k = me.hand.length;
        for (const c of [...me.hand]) moveTo(s, c.uid, 'deckBottom');
        shuffleDeck(s, ctl);
        drawCards(db, s, ctl, k, true);
        break;
      }
      case 'OppTrashRandom':
        for (let i = 0; i < n && them.hand.length; i++) {
          const c = them.hand[Math.floor(rand(s) * them.hand.length)];
          performRemoval(db, s, c.uid, 'trash', ctl);
        }
        break;
      // ----- keywords / flags on targets
      case 'GainRush':
      case 'GainRushCharacters':
      case 'GainBanish':
      case 'GainDoubleAttack':
      case 'GainBlocker':
      case 'GainUnblockable':
      case 'GainCanAttackActive':
      case 'LoseBlocker': {
        const name = { GainRush: 'rush', GainRushCharacters: 'rushCharacters', GainBanish: 'banish', GainDoubleAttack: 'doubleAttack', GainBlocker: 'blocker', GainUnblockable: 'unblockable', GainCanAttackActive: 'canAttackActive', LoseBlocker: 'loseBlocker' }[key]!;
        for (const f of cards) addMod(f.inst, flagMod(name, turn));
        break;
      }
      case 'GainBlockerToOppEnd':
        for (const f of cards) addMod(f.inst, flagMod('blocker', untilEndOfNextTurnOf(s, opp(f.owner))));
        break;
      case 'GainCombatImmuneToStart':
        for (const f of cards) addMod(f.inst, flagMod('combatImmune', untilStartOfNextTurnOf(s, ctl)));
        break;
      case 'GainImmune':
        for (const f of cards) if (f.zone === 'chars') addMod(f.inst, flagMod('immune', turn));
        break;
      case 'EffectImmune':
        for (const f of cards) addMod(f.inst, flagMod('effectImmune', untilEndOfNextTurnOf(s, opp(ctl))));
        break;
      case 'AllCharsEffectImmune':
        for (const c of me.chars) addMod(c, flagMod('effectImmune', untilEndOfNextTurnOf(s, opp(ctl))));
        break;
      case 'CantAttack':
        for (const f of cards) addMod(f.inst, flagMod('cantAttack', untilEndOfTurnOf(s, f.owner)));
        break;
      case 'CantRest':
        for (const f of cards) addMod(f.inst, flagMod('cantRest', untilEndOfTurnOf(s, f.owner)));
        break;
      case 'CantAttackOrigCostOrLess':
        for (const f of cards) addMod(f.inst, { kind: 'flag', name: 'cantAttackOrigCostOrLess', value: n, until: turn });
        break;
      case 'Silence':
        for (const f of cards) addMod(f.inst, flagMod('silenced', turn));
        break;
      case 'SilenceToOwnersEnd':
        for (const f of cards) addMod(f.inst, flagMod('silenced', untilEndOfTurnOf(s, f.owner)));
        break;
      case 'GainStrikeTypes':
        for (const f of cards) for (const a of raw as number[]) addMod(f.inst, { kind: 'attr', value: a, until: turn });
        break;
      // ----- battle
      case 'BecomeDefenderCharacter':
        if (s.battle && cards[0]) s.battle.target = cards[0].inst.uid;
        break;
      case 'EndCombat':
        if (s.battle) {
          s.battle.hit = false;
          s.battle.step = 'end';
        }
        break;
      // ----- game end
      case 'WinTheGame':
        s.winner = ctl;
        break;
      case 'LoseTheGame':
        s.winner = opp(ctl);
        break;
      case 'TakeAnotherTurn':
        me.extraTurns++;
        break;
      // ----- delayed
      case 'QueueUpEndOfTurnAction':
        if (actor && s.active === act.owner) s.endOfTurn.push(makeActivation(actor.inst, act.owner, n, 'QueuedEndOfTurn'));
        break;
      case 'QueueUpOppMainPhaseAction':
        s.startOfMain.push({ seat: opp(ctl), act: { ...inlineAct(db, s, act, [{ effect: { DonTap: 1 } }]), controller: opp(ctl) } });
        break;
      case 'TurnEndActivateDon':
        s.endOfTurn.push(inlineAct(db, s, act, [{ effect: { ActivateDonN: n } }]));
        break;
      case 'HealEndOfTurn':
        s.endOfTurn.push(inlineAct(db, s, act, [{ effect: { Heal: n } }]));
        break;
      case 'GainEphemeral':
        s.endOfTurn.push(inlineAct(db, s, act, [{ effect: { SendToDeckBottom: 1 }, target: [{ AutoCopyPreviousTargets: 1 }] }], T0));
        break;
      case 'ActivateAllFilmCharsEndOfTurn':
        s.endOfTurn.push(inlineAct(db, s, act, [{ effect: { Activate: 1 }, target: [{ FriendlyOnly: 1, DeployedCharacter: 1, OnlyCategories: [31], AutoAllMatchingTargets: 1 }] }]));
        break;
      case 'ActivateMainOfCard':
        for (const f of cards) {
          const idx = db[f.inst.id].abilities.findIndex((a) => a.proc.ActivateMain);
          if (idx >= 0) s.stack.push(makeActivation(f.inst, f.owner, idx, 'EventMain', { controller: ctl, free: true }));
        }
        break;
      // ----- player restrictions (stored on the leader)
      case 'CantPlayAnyCharactersToField':
        addMod(me.leader, flagMod('cantPlayChars', turn));
        break;
      case 'CantPlayOriginalCostOrMore':
        addMod(me.leader, { kind: 'flag', name: 'cantPlayOrigCostOrMore', value: n, until: turn });
        break;
      case 'CantPlayAnyCardsFromHand':
        addMod(me.leader, flagMod('cantPlayFromHand', turn));
        break;
      case 'CantDrawFromEffects':
        addMod(me.leader, flagMod('cantDraw', turn));
        break;
      case 'OppNoBlockerThisTurn':
        addMod(them.leader, flagMod('noBlocker', turn));
        break;
      case 'OppNoOnPlayToTurnEnd':
        addMod(them.leader, flagMod('noOnPlay', untilEndOfNextTurnOf(s, opp(ctl))));
        break;
      case 'FieldCantAttackLeader':
        addMod(me.leader, flagMod('cantAttackLeader', turn));
        break;
      // our extensions
      case 'NextWanoPlayCostReduce':
        addMod(me.leader, { kind: 'flag', name: 'wanoDiscount', value: n, until: turn });
        break;
      case 'EndOfBattleToDeckBottom':
        if (actor && s.battle) addMod(actor.inst, flagMod('toDeckBottomAfterBattle', { at: 'end', turn: s.turn }));
        break;
      case 'LoseBlockerThisBattle':
        for (const f of cards) addMod(f.inst, flagMod('loseBlocker', { at: 'battle' }));
        break;
      case 'RosinanteLeader':
        addMod(me.leader, flagMod('rosinanteLaw', turn));
        break;
      // ----- saved values
      case 'SaveTargetCount':
        act.savedInt = T0.length;
        break;
      case 'SaveTargetName': {
        const f = cards[0];
        if (f) act.savedString = db[f.inst.id].name;
        break;
      }
      case 'SaveHandSize':
        act.savedInt = me.hand.length;
        break;
      default:
        unknownEffects.add(key);
    }
  }
  // drop view cards that left their zone
  if (s.view) {
    const view = s.view;
    const zone = view.source;
    view.cards = view.cards.filter((u) => findCard(s, u)?.zone === zone && findCard(s, u)?.owner === view.owner);
  }
}
