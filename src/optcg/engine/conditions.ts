// Conditions: `proc` condition keys (checked when an ability fires / is activated /
// while a passive applies) and step `details` conditions (checked when a step runs).
// All thresholds are inclusive. "You" = the ability's controller.

import { basePower, cost, hasKeyword, power } from './query.js';
import { attachedDon, def, fieldCards, findCard, hasCategory, hasName, opp, totalDon } from './state.js';
import type { Activation, CardInst, Db, GameState, Json, Seat } from './types.js';

/** proc keys that say WHEN an ability fires (OR'd) — not conditions. */
export const TIMING_KEYS = new Set([
  'Passive', 'OnPlay', 'ActivateMain', 'Trigger', 'Counter', 'OnAttack', 'OnAttackLeader', 'OnOpponentAttack',
  'OnOpponentAttackThis', 'OnBlock', 'OpponentActivatesBlocker', 'OnKO', 'OnKOEffectOnly', 'EndOfTurn', 'StartOfTurn',
  'QueuedEndOfTurn', 'QueuedStartOfMainPhase', 'StartOfGame', 'CardDrawn', 'DrewDonForTurn', 'MyDonIsReturned',
  'XMyDonIsReturned', 'MyDonIsReturnedMyEffects', 'OnRest', 'OnRestByOpponent', 'YouRestedCharacter', 'YouRemovedCharacter',
  'YouBouncedOppCharacter', 'YourCharacterRemoved', 'YourCharacterKOd', 'YourCharacterOriginalPowerXOrMoreKOd',
  'YourCharacterMatchingTargetKOd', 'AnyCharacterKOd', 'OpponentCharacterKOd', 'IHitLeader', 'AnyHitLeader', 'MyLeaderHit',
  'OppLosesLife', 'YourLifeSentToHand', 'LifeSentToHand', 'LifeSentToTrash', 'LifeSentToDeck', 'LifeSentToField',
  'OppActivatesEvent', 'OppPlaysEvent', 'YouActivateEvent', 'OppActivatesTrigger', 'YouActivateTrigger',
  'OppDeploysOriginalCostXOrMore', 'OppDeploysThroughCharacter', 'YouDeployed', 'YouDeployedFromTrash', 'DeployedAnyFromTrash',
  'YouDeployedTriggerCharacter', 'HandSentToTrashMyEffect', 'CardTrashedFromMyCategory', 'MyLeaderAttacks', 'MyLeaderAttacked',
  'AfterBattleCharacter', 'AfterFailedKO', 'BattlingStrikeType', 'PreTakeDamage', 'PreKO', 'PreKOEffectOnly', 'PreKOCombatOnly',
  'PreTrash', 'PreBounce', 'PreDeckBottom', 'PreSendToTopLife', 'PreSendToBottomLife', 'PreRest', 'PreRestCharacterOnly',
  'PreCharacterKOEffectOnly', 'PreAllyKO', 'PreAllyKOEffectOnly', 'PreAllyTrash', 'PreAllyBounce', 'PreAllyDeckBottom',
  'PreAllySendToTopLife', 'PreAllySendToBottomLife', 'StartOfMainPhase', 'LifeReachesZero', 'DonGiven', 'KOdInBattle', 'OppDeploys',
]);

/** proc keys that qualify triggers / meta: not conditions either. */
const NON_CONDITION_PROC = new Set([
  'Description', 'OncePerTurn', 'OnlyOppActions', 'PreAllyNotSelf', 'PreAllyColor', 'PreAllyCategory', 'PreAllyStrikeType',
  'PreAllyNamed', 'PreAllyNotNamed', 'PreAllyCostOrLower', 'PreAllyOriginalCostOrLower', 'PreAllyOriginalCostOrMore',
  'PreAllyOriginalPowerOrLower', 'PreAllyOriginalPowerOrMore', 'PreAllyPowerOrMore', 'PreAllyRested', 'ACOCColorReq',
  'AnotherCharacterAllowSameCard', 'AllyCostCount', 'OverrideLeaderCategoryName', 'OverrideLeaderStrikeType',
  'OverrideLeaderColorCountName', 'OrDonIsZero', 'AddlCharacterCategoryXPowerOrMore', 'UsoppLeader', 'RogerSilence',
  'DeckOut', 'temp', 'CategoryInPlayCount', 'AllyNameInPlayCount', 'RequireAll',
]);

/** details keys that control the step runner (not conditions). */
export const STEP_CONTROL = new Set(['NoCancel', 'Required', 'FullTargetsRequired', 'ConfirmAction', 'EndAfterStep', 'CanUseOnPlays', 'SearchingDeck']);

const DON_COUNT_KEYS = new Set(['DonXOrMore', 'DonXOrLess', 'DonXLessThanOpp', 'LessOrEqDon', 'LessDon', 'AvailableDon', 'LessThanXAvailableDon']);

export interface CondCtx {
  db: Db;
  s: GameState;
  seat: Seat;
  /** The card owning the ability (may be in any zone). */
  actor: CardInst | null;
  /** The whole proc / details object (for modifier keys). */
  all: Json;
  act?: Activation;
}

export const unknownConditions = new Set<string>();

const num = (v: unknown) => (typeof v === 'number' ? v : v ? 1 : 0);
const list = (v: unknown) => (Array.isArray(v) ? v : []);

function chars(s: GameState, seat: Seat): CardInst[] {
  return s.players[seat].chars;
}

function leaderHasCategory(c: CondCtx, cats: number[]): boolean {
  const L = c.db[c.s.players[c.seat].leader.id];
  if (hasCategory(L, cats)) return true;
  const names = list(c.all.OverrideLeaderCategoryName);
  if (names.length && hasName(L, names)) return true;
  const attrs = list(c.all.OverrideLeaderStrikeType);
  return attrs.length > 0 && L.attributes.some((a) => attrs.includes(a));
}

function topFaces(life: CardInst[], n: number, faceUp: boolean, fromBottom = false): boolean {
  if (life.length < n) return false;
  const seq = fromBottom ? life.slice(0, n) : life.slice(life.length - n);
  return seq.every((c) => c.faceUp === faceUp);
}

function others(c: CondCtx): CardInst[] {
  const p = c.s.players[c.seat];
  return [...p.chars, ...(p.stage ? [p.stage] : [])].filter((x) => x.uid !== c.actor?.uid);
}

function viewCards(c: CondCtx): CardInst[] {
  const v = c.s.view;
  if (!v) return [];
  return v.cards.map((u) => findCard(c.s, u)?.inst).filter((x): x is CardInst => !!x);
}

/** Evaluate one condition key. Returns null when the key is unknown. */
export function condition(key: string, val: unknown, c: CondCtx): boolean | null {
  const { db, s, seat } = c;
  const me = s.players[seat];
  const them = s.players[opp(seat)];
  const n = num(val);
  const actor = c.actor;
  const myChars = chars(s, seat);
  const oppChars = chars(s, opp(seat));
  const bothChars = [...myChars, ...oppChars];
  const L = db[me.leader.id];
  switch (key) {
    // --- this card
    case 'DonX':
      return !!actor && actor.don >= n;
    case 'Active':
      return !!actor && !actor.rested;
    case 'Rested':
      return !!actor && actor.rested;
    case 'FirstTurnOnly':
      return !!actor && actor.enteredTurn === s.turn;
    case 'OnBoard':
      return !!actor && myChars.some((x) => x.uid === actor.uid);
    case 'MyCostXOrMore':
      return !!actor && cost(db, s, actor.uid) >= n;
    case 'PowerXOrMore':
      return !!actor && power(db, s, actor.uid) >= n;
    case 'HasBattledCharacter':
      return !!actor && me.stats.battledCharacter.includes(actor.uid);
    // --- turn
    case 'YourTurn':
      return s.active === seat;
    case 'OpponentTurn':
      return s.active !== seat;
    case 'TurnXOrLater':
      return Math.ceil(s.turn / 2) >= n;
    // --- DON
    case 'AvailableDon':
      return me.donActive >= n;
    case 'LessThanXAvailableDon':
      return me.donActive <= n;
    case 'OppAvailableDon':
      return them.donActive >= n;
    case 'SelfRestedDon':
      return me.donRested >= n;
    case 'OppRestedDon':
      return them.donRested >= n;
    case 'DonXOrMore':
      return totalDon(me) >= n;
    case 'DonXOrLess':
      return totalDon(me) <= n;
    case 'DonXLessThanOpp':
      return totalDon(me) + n <= totalDon(them);
    case 'LessOrEqDon':
      return totalDon(me) <= totalDon(them);
    case 'LessDon':
      return totalDon(me) < totalDon(them);
    case 'OppDonXOrMore':
      return totalDon(them) >= n;
    case 'OppDonXOrLess':
      return totalDon(them) <= n;
    case 'EitherDonXOrMore':
      return totalDon(me) >= n || totalDon(them) >= n;
    case 'SelfAttachedDon':
      return attachedDon(me) >= n;
    case 'SelfLeaderAttachedDon':
      return me.leader.don >= n;
    case 'OppAttachedDon':
      return attachedDon(them) >= n;
    // --- trash / hand / deck
    case 'TrashXOrMore':
      return me.trash.length >= n;
    case 'TrashEventsXOrMore':
      return me.trash.filter((x) => db[x.id].type === 'Event').length >= n;
    case 'TrashEventsXOrLess':
      return me.trash.filter((x) => db[x.id].type === 'Event').length <= n;
    case 'HandXOrLess':
      return me.hand.length <= n;
    case 'HandXOrMore':
      return me.hand.length >= n;
    case 'HandEmpty':
      return me.hand.length === 0;
    case 'OppHandXOrMore':
      return them.hand.length >= n;
    case 'HandDiffXOrMore':
      return me.hand.length + n <= them.hand.length;
    case 'DeckOut':
      return me.deck.length === 0;
    // --- our extensions (cards the site only had in its legacy format)
    case 'DeckXOrLess':
      return me.deck.length <= n;
    case 'DeckXOrMore':
      return me.deck.length >= n;
    case 'LifeHandXOrLess':
      return me.life.length + me.hand.length <= n;
    case 'NoActiveDon':
      return me.donActive === 0;
    case 'OtherCharacterPowerXOrMore':
      return myChars.some((x) => x.uid !== actor?.uid && power(db, s, x.uid) >= n);
    case 'LastTrashedCostXOrMore': {
      const top = me.trash[me.trash.length - 1];
      return !!top && db[top.id].cost >= n;
    }
    case 'NamesInYourTrash':
      return list(val).every((nm) => me.trash.some((x) => db[x.id].names.includes(nm)));
    // --- life
    case 'LifeXOrLess':
      return me.life.length <= n;
    case 'LifeXOrMore':
      return me.life.length >= n;
    case 'ZeroLife':
    case 'LifeIsZero':
      return me.life.length === 0;
    case 'EitherPlayerZeroLife':
      return me.life.length === 0 || them.life.length === 0;
    case 'LessLife':
    case 'LifeLess':
      return me.life.length < them.life.length;
    case 'LessOrEqLife':
    case 'LifeLessOrEqual':
      return me.life.length <= them.life.length;
    case 'OppLifeXOrMore':
      return them.life.length >= n;
    case 'OppLifeXOrLess':
      return them.life.length <= n;
    case 'CombinedLifeXOrLess':
      return me.life.length + them.life.length <= n;
    case 'CombinedLifeXOrMore':
      return me.life.length + them.life.length >= n;
    case 'FacedownLife':
      return topFaces(me.life, n, false);
    case 'FaceupLife':
      return topFaces(me.life, n, true);
    case 'FaceupBotLife':
      return topFaces(me.life, n, true, true);
    case 'FacedownBotLife':
      return topFaces(me.life, n, false, true);
    case 'AnyFaceupLife':
      return me.life.some((x) => x.faceUp);
    case 'AnyFacedownLife':
      return me.life.some((x) => !x.faceUp);
    case 'OppLostLife':
      return them.stats.lostLife;
    case 'MyHandTrashed':
      return me.stats.handTrashedByEffect;
    // --- characters
    case 'CharactersOrMore':
      return myChars.length >= n;
    case 'CharactersOrLess':
      return myChars.length <= n;
    case 'OppCharactersOrMore':
      return oppChars.length >= n;
    case 'OppCharactersOrLess':
      return oppChars.length <= n;
    case 'OppXMoreOrMoreCharacters':
      return oppChars.length - myChars.length >= n;
    case 'SelfRestedCharacters':
      return myChars.filter((x) => x.rested).length >= n;
    case 'OppRestedCharacters':
      return oppChars.filter((x) => x.rested).length >= n;
    case 'SelfRestedCards':
      return fieldCards(me).filter((x) => x.rested).length + me.donRested >= n;
    case 'OppRestedCards':
      return fieldCards(them).filter((x) => x.rested).length + them.donRested >= n;
    case 'SelfRestedCharacterCategory': {
      const v = val as { eCategory: number; iCount: number };
      return myChars.filter((x) => x.rested && db[x.id].categories.includes(v.eCategory)).length >= v.iCount;
    }
    case 'SelfCharacterCategory': {
      const v = val as { eCategory: number; iCount: number };
      return myChars.filter((x) => db[x.id].categories.includes(v.eCategory)).length >= v.iCount;
    }
    case 'CategoryInPlayRequired':
      return myChars.filter((x) => hasCategory(db[x.id], list(val))).length >= Math.max(1, num(c.all.CategoryInPlayCount));
    case 'CostXOrHigherCharacterCategory':
    case 'CharacterCategoryXCostOrMore': {
      const v = val as { eCategory: number; iCount: number };
      return myChars.some((x) => db[x.id].categories.includes(v.eCategory) && cost(db, s, x.uid) >= v.iCount);
    }
    case 'NotCharacterCategoryXCostOrMore':
      return list(val).every((v: { eCategory: number; iCount: number }) => !myChars.some((x) => db[x.id].categories.includes(v.eCategory) && cost(db, s, x.uid) >= v.iCount));
    case 'CharacterCategoryXPowerOrMore': {
      const v = val as { eCategory: number; iCount: number };
      const cats = [v.eCategory, ...list(c.all.AddlCharacterCategoryXPowerOrMore)];
      return myChars.some((x) => hasCategory(db[x.id], cats) && power(db, s, x.uid) >= v.iCount);
    }
    case 'AnotherCharacterOfCategory': {
      const colors = list(c.all.ACOCColorReq);
      const allowSame = !!c.all.AnotherCharacterAllowSameCard;
      const myName = actor ? db[actor.id].name : '';
      return myChars.some(
        (x) =>
          x.uid !== actor?.uid &&
          (allowSame || db[x.id].name !== myName) &&
          hasCategory(db[x.id], list(val)) &&
          (!colors.length || db[x.id].colors.some((k) => colors.includes(k))),
      );
    }
    case 'FieldIsOnlyCategory':
      return myChars.length > 0 && myChars.every((x) => hasCategory(db[x.id], list(val)));
    case 'FieldIsOnlyCounterless':
      return myChars.every((x) => db[x.id].counter === 0);
    case 'FieldIsFullAndUnique':
      return myChars.length >= 5 && new Set(myChars.map((x) => db[x.id].name)).size === myChars.length;
    case 'BoardLessThanCostX':
      return !(myChars.length >= 5 && myChars.every((x) => cost(db, s, x.uid) >= n));
    case 'CostZeroExists':
      return bothChars.some((x) => cost(db, s, x.uid) === 0);
    case 'OppCostZeroExists':
      return oppChars.some((x) => cost(db, s, x.uid) === 0);
    case 'CostXOrMoreExists':
    case 'CharacterCostXOrMore':
      return bothChars.some((x) => cost(db, s, x.uid) >= n);
    case 'CostXOrLessExists':
      return bothChars.some((x) => cost(db, s, x.uid) <= n);
    case 'CostZeroOrXOrMoreExists':
      return bothChars.some((x) => cost(db, s, x.uid) <= 0 || cost(db, s, x.uid) >= n);
    case 'OppCostZeroOrXOrMoreExists':
      return oppChars.some((x) => cost(db, s, x.uid) <= 0 || cost(db, s, x.uid) >= n);
    case 'AllyCostOrMore':
      return myChars.filter((x) => cost(db, s, x.uid) >= n).length >= Math.max(1, num(c.all.AllyCostCount));
    case 'AllyBaseCostOrMore':
      return myChars.filter((x) => db[x.id].cost >= n).length >= Math.max(1, num(c.all.AllyCostCount));
    case 'NoAllyCostOrMore':
      return !myChars.some((x) => cost(db, s, x.uid) >= n);
    case 'AllyStageCostOrMore':
      return !!me.stage && cost(db, s, me.stage.uid) >= n;
    case 'AllyTotalCostOrMore':
      return myChars.reduce((t, x) => t + cost(db, s, x.uid), 0) >= n;
    case 'AllyVanilla':
      return myChars.some((x) => db[x.id].abilities.length === 0);
    case 'NumTriggersInPlay':
      return myChars.filter((x) => db[x.id].abilities.some((a) => a.proc.Trigger)).length >= n;
    case 'CharacterPowerXOrMore':
      return myChars.some((x) => power(db, s, x.uid) >= n);
    case 'CharacterBasePowerXOrMore':
      return myChars.some((x) => basePower(db, s, x.uid) >= n);
    case 'OppCharPowerXOrMore':
    case 'OppPowerXOrMore':
      return oppChars.some((x) => power(db, s, x.uid) >= n);
    case 'OppBasePowerXOrMore':
    case 'OppCharBaseXOrMore':
      return oppChars.some((x) => basePower(db, s, x.uid) >= n);
    case 'Opp2CharsBaseXOrMore':
      return oppChars.filter((x) => basePower(db, s, x.uid) >= n).length >= 2;
    case 'OppNo2CharsBaseXOrMore':
      return oppChars.filter((x) => basePower(db, s, x.uid) >= n).length < 2;
    case 'AnyPowerXOrMore':
      return bothChars.some((x) => power(db, s, x.uid) >= n);
    case 'SelfNo2CharsPowXOrMore':
      return myChars.filter((x) => power(db, s, x.uid) >= n).length <= 2;
    case 'NoBaseXOrMore':
      return ![me.leader, them.leader, ...bothChars].some((x) => basePower(db, s, x.uid) >= n);
    case 'OppAnyBaseXOrMore':
      return [them.leader, ...oppChars].some((x) => basePower(db, s, x.uid) >= n);
    case 'SelfAnyBaseXOrMore':
      return [me.leader, ...myChars].some((x) => x.uid !== actor?.uid && basePower(db, s, x.uid) >= n);
    case 'SelfNoCharBaseXOrMore':
      return !myChars.some((x) => x.uid !== actor?.uid && basePower(db, s, x.uid) >= n);
    case 'TwoCharacterBasePowerX':
      return myChars.filter((x) => basePower(db, s, x.uid) === n).length >= 2;
    case 'TwoCharacterBasePowerXOrMore':
      return myChars.filter((x) => basePower(db, s, x.uid) >= n).length >= 2;
    // --- names
    case 'NameInYourDeploy':
      return others(c).some((x) => hasName(db[x.id], list(val)));
    case 'AllyNameNotInPlay':
      return !others(c).some((x) => hasName(db[x.id], list(val)));
    case 'AllyNameInPlay': {
      const need = Math.max(1, num(c.all.AllyNameInPlayCount));
      const pool = [...others(c), me.leader].filter((x) => x.uid !== actor?.uid);
      return list(val).every((nm) => pool.filter((x) => db[x.id].names.includes(nm)).length >= need);
    }
    case 'NameOwned':
      return [me.leader, ...others(c)].some((x) => hasName(db[x.id], list(val)));
    case 'NameIsRested':
      return [me.leader, ...myChars].some((x) => x.rested && hasName(db[x.id], list(val)));
    case 'NameNotInAnyDeploy':
      return !others(c).some((x) => hasName(db[x.id], list(val))) && !oppChars.some((x) => hasName(db[x.id], list(val)));
    case 'NamesWithBasePowerInYourDeploy':
      return list(val).some((v: { sString: string; iCount: number }) => myChars.some((x) => db[x.id].names.includes(v.sString) && basePower(db, s, x.uid) >= v.iCount));
    case 'NamesWithExactBasePowerInYourDeploy': {
      const test = (v: { sString: string; iCount: number }) => myChars.some((x) => x.uid !== actor?.uid && db[x.id].names.includes(v.sString) && basePower(db, s, x.uid) === v.iCount);
      return c.all.RequireAll ? list(val).every(test) : list(val).some(test);
    }
    case 'NamesWithPowerOnYourSide':
      return list(val).some((v: { sString: string; iCount: number }) => [me.leader, ...myChars].some((x) => db[x.id].names.includes(v.sString) && power(db, s, x.uid) >= v.iCount));
    case 'NoOtherNameWithBaseCostInYourDeploy':
      return list(val).every((v: { sString: string; iCount: number }) => !myChars.some((x) => x.uid !== actor?.uid && db[x.id].names.includes(v.sString) && db[x.id].cost === v.iCount));
    // --- leader
    case 'LeaderCategoryRequired':
      return leaderHasCategory(c, list(val));
    case 'LeaderNameRequired':
      return hasName(L, list(val));
    case 'LeaderNameIncludes':
      return list(val).some((sub) => L.names.some((nm) => nm.includes(sub)));
    case 'LeaderStrikeTypeRequired':
      return L.attributes.some((a) => list(val).includes(a));
    case 'OpponentLeaderStrikeTypeRequired':
      return db[them.leader.id].attributes.some((a) => list(val).includes(a));
    case 'LeaderColorCountOrMore': {
      const names = list(c.all.OverrideLeaderColorCountName);
      return L.colors.length >= n || (names.length > 0 && hasName(L, names));
    }
    case 'LeaderColorCountOrLess':
      return L.colors.length <= n;
    case 'LeaderHasColors':
      return L.colors.some((k) => list(val).includes(k));
    case 'LeaderActive':
      return !me.leader.rested;
    case 'LeaderPowerXOrMore':
      return power(db, s, me.leader.uid) >= n;
    case 'LeaderPowerZero':
      return power(db, s, me.leader.uid) <= 0;
    case 'OppLeaderPowerXOrMore':
      return power(db, s, them.leader.uid) >= n;
    // --- view (look at / reveal)
    case 'TopDeckCountOrMore':
      return viewCards(c).length >= n;
    case 'TopDeckHasCategory':
      return viewCards(c).some((x) => hasCategory(db[x.id], list(val)));
    case 'TopDeckHasType':
      return viewCards(c).some((x) => list(val).includes(['Leader', 'Character', 'Event', 'Stage'].indexOf(db[x.id].type)));
    case 'TopDeckCostOrMore':
      return viewCards(c).some((x) => db[x.id].cost >= n);
    case 'TopDeckCostOrLess':
      return viewCards(c).some((x) => db[x.id].cost <= n);
    case 'TopDeckMatchesSavedCost':
      return viewCards(c).some((x) => db[x.id].cost === (c.act?.savedInt ?? -1));
    // --- previous targets
    case 'HasPreviousTargets':
      return (c.act?.prevTargets.length ?? 0) > 0;
    case 'NoPreviousTargets':
      return (c.act?.prevTargets.length ?? 0) === 0;
    case 'PreviousTargetNowInTrash':
    case 'PreviousTargetNowInHand':
    case 'PreviousTargetNowInDeck':
    case 'PreviousTargetNowInLife': {
      const first = c.act?.prevTargets[0];
      if (first === undefined) return true;
      const zone = { PreviousTargetNowInTrash: 'trash', PreviousTargetNowInHand: 'hand', PreviousTargetNowInDeck: 'deck', PreviousTargetNowInLife: 'life' }[key];
      return findCard(s, first)?.zone === zone;
    }
    case 'HasValidTargets':
      return true; // checked by the runner when the list is built
    // --- battle
    case 'AttackerHasStrikeTypes': {
      if (!s.battle) return true;
      const a = findCard(s, s.battle.attacker);
      return !!a && db[a.inst.id].attributes.some((x) => list(val).includes(x));
    }
    case 'AttackerHasCardTypes': {
      if (!s.battle) return true;
      const a = findCard(s, s.battle.attacker);
      return !!a && ['Leader', 'Character', 'Event', 'Stage'].indexOf(db[a.inst.id].type) === list(val)[0];
    }
    case 'AnyOppCharacterKOd':
      return me.stats.oppCharKOd;
    case 'ActivatedEventXOrMore':
      return me.stats.eventMaxCost >= n;
    default:
      return null;
  }
}

const compiled = new WeakMap<Json, [string, unknown][]>();

function conditionEntries(obj: Json, skip: Set<string>): [string, unknown][] {
  let e = compiled.get(obj);
  if (!e) {
    e = Object.entries(obj).filter(
      ([k, v]) => !skip.has(k) && !TIMING_KEYS.has(k) && !NON_CONDITION_PROC.has(k) && !(v === 0 || v === false || (Array.isArray(v) && v.length === 0 && k !== 'NamesInYourTrash')),
    );
    compiled.set(obj, e);
  }
  return e;
}

function evalAll(obj: Json, c: CondCtx, skip: Set<string>): boolean {
  const entries = conditionEntries(obj, skip);
  if (!entries.length) return true;
  const donZero = !!obj.OrDonIsZero && totalDon(c.s.players[c.seat]) === 0;
  for (const [k, v] of entries) {
    if (donZero && DON_COUNT_KEYS.has(k)) continue;
    const r = condition(k, v, c);
    if (r === null) {
      unknownConditions.add(k);
      return false;
    }
    if (!r) return false;
  }
  return true;
}

export function procOk(db: Db, s: GameState, actor: CardInst, seat: Seat, proc: Json, act?: Activation): boolean {
  return evalAll(proc, { db, s, seat, actor, all: proc, act }, new Set());
}

export function detailsOk(db: Db, s: GameState, act: Activation, details: Json): boolean {
  const actor = findCard(s, act.uid)?.inst ?? null;
  return evalAll(details, { db, s, seat: act.controller, actor, all: details, act }, STEP_CONTROL);
}

export { hasKeyword, def };
