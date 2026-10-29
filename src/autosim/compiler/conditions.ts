/** proc / step `details` keys → IR Conditions, and the proc timing table. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Condition, Selector, SelectorFilter, Timing } from "../ir/types";
import { ATTRIBUTES, catalogNames } from "./catalogMaps";
import { extraCondition } from "./extraConditions";
import { CONTROL_KEYS, fail, keysOn, list, num, on } from "./dsl";
import { filterOf } from "./selectors";
import type { AbilityCtx, Json } from "./types";

// ─── conditions ─────────────────────────────────────────────────────────────

export const PROC_TIMING: Record<string, Timing | "passive"> = {
  Passive: "passive", UsoppLeader: "passive", OnPlay: "onPlay", OnAttack: "whenAttacking", OnKO: "onKO", OnBlock: "onBlock",
  Counter: "counter", Trigger: "trigger", ActivateMain: "activateMain", EndOfTurn: "endOfYourTurn",
  OnOpponentAttack: "onYourOpponentsAttack", OppActivatesEvent: "onOpponentActivatesEvent",
  OppPlaysEvent: "onOpponentActivatesEvent", YouActivateEvent: "onYouActivateEvent",
  OpponentCharacterKOd: "onOpponentCharacterKOd", StartOfTurn: "startOfYourTurn",
  OnOpponentAttackThis: "whenAttacked", QueuedEndOfTurn: "delayed",
  // M5 event timings (Effect.react narrows them, abilities.ts reactOf)
  MyDonIsReturned: "onYourDonReturned", XMyDonIsReturned: "onYourDonReturned", MyDonIsReturnedMyEffects: "onYourDonReturned",
  OnKOEffectOnly: "onKOByEffect", OnRest: "onRested", OnRestByOpponent: "onRested", IHitLeader: "onDealDamage",
  LifeReachesZero: "onLifeZero",
  YourCharacterKOd: "onCharacterKOd", AnyCharacterKOd: "onCharacterKOd", YourCharacterRemoved: "onCharacterRemoved",
  YouRemovedCharacter: "onCharacterRemoved", YouRestedCharacter: "onCharacterRestedBy", YouDeployed: "onYouPlayCharacter",
  HandSentToTrashMyEffect: "onHandTrashed",
  YouDeployedFromTrash: "onYouPlayCharacter", MyLeaderAttacks: "onLeaderAttacks", MyLeaderAttacked: "onLeaderAttacked",
  MyLeaderHit: "onTakeDamage", LifeSentToHand: "onLifeRemoved", OpponentActivatesBlocker: "onOpponentBlocks",
  AfterBattleCharacter: "afterBattleWithCharacter", DonGiven: "onDonGiven",
  CardTrashedFromMyCategory: "onHandTrashed", OppDeploysOriginalCostXOrMore: "onYouPlayCharacter", OppDeploysThroughCharacter: "onYouPlayCharacter",
  KOdInBattle: "onKOInBattle", BattlingStrikeType: "onBattlesCharacter", AfterFailedKO: "afterBattleWithCharacter", DrewDonForTurn: "onDonPhase", YouBouncedOppCharacter: "onCharacterBounced", OppDeploys: "onYouPlayCharacter", OnAttackLeader: "whenAttacking",
  YourCharacterMatchingTargetKOd: "onCharacterKOd",
  CardDrawn: "onDrawOutsideDrawPhase", YourLifeSentToHand: "onLifeToHand", YouDeployedTriggerCharacter: "onYouPlayCharacter",
  AnyHitLeader: "onYouDealDamage", OppLosesLife: "onLifeRemoved", OppActivatesTrigger: "onTriggerActivated", YouActivateTrigger: "onTriggerActivated",
};
/** Timing / replacement / rule keys the IR has no timing for (spec A §2b-2d):
 *  such abilities are dropped (listed in the notes) rather than run at a
 *  wrong moment. `Pre*` replacement keys are matched by prefix. */
export const DROP_TIMINGS = new Set([
  "QueuedStartOfMainPhase", "StartOfGame", "DeployedAnyFromTrash", "DeckOut",
]);
/** Proc keys with no rules meaning for the IR (labels / feasibility checks of
 *  costs the engine verifies itself). */
export const PROC_IGNORED = new Set(["Description", "OncePerTurn", "Active", "AvailableDon", "OnlyOppActions",
  // "a card is removed from your or your opponent's Life cards": read as one timing with LifeSentToHand (M5)
  "LifeSentToDeck", "LifeSentToField", "LifeSentToTrash",
  "YourCharacterOriginalPowerXOrMoreKOd"]); // read by reactOf (abilities.ts)

/** A proc or step-details condition → IR Condition (null = control/feasibility key). */
export function conditionOf(key: string, v: unknown, a: AbilityCtx, where: "proc" | "step", all: Json): Condition[] {
  if (where === "step" && CONTROL_KEYS.has(key)) return [];
  if (a.flipped) {
    // under ForceOpponent "you" is the opponent: read the key as written, then swap sides
    const unflipped = conditionOf(key, v, { ...a, flipped: false }, where, all);
    return unflipped.map((c) => flipSides(c, key));
  }
  if (key === "AllyNameInPlay" && list<string>(v).length > 1) {
    // "If you have [A] and [B]" / "[A] or [B]" (M5): the text says which
    const each = catalogNames(list<string>(v), a).map((name): Condition => ({ kind: "countInZone",
      sel: { owner: "self", zone: "characterArea", count: 99, chooser: "controller", filter: { nameIncludes: [name], excludeSelf: true } }, atLeast: 1 }));
    if (/if you have \[[^\]]+\] and \[/i.test(a.tailText ?? "")) return each;
    if (/if you have \[[^\]]+\] or \[/i.test(a.tailText ?? "")) return [{ kind: "anyOf", conditions: each }];
    fail("AllyNameInPlay with several names");
  }
  const c = baseCondition(key, v, a, where, all);
  return c === undefined ? (extraCondition(key, v, a, all) ?? fallback(key, where)) : c ? [c] : [];
}

/** The same condition seen from the other player (ForceOpponent). Only kinds
 *  that name their side explicitly can be flipped. */
function flipSides(c: Condition, key: string): Condition {
  const other = <T extends string>(w: T): T => (w === "self" ? "opponent" : w === "opponent" ? "self" : w) as T;
  switch (c.kind) {
    case "lifeAtMost": case "lifeAtLeast": case "handAtMost": case "handAtLeast": case "donOnField":
      return { ...c, who: other(c.who) };
    case "countInZone": return { ...c, sel: { ...c.sel, owner: other(c.sel.owner) } };
    case "compare":
      return { ...c, left: { ...c.left, who: other(c.left.who) }, right: typeof c.right === "number" ? c.right : { ...c.right, who: other(c.right.who) } };
    case "anyOf": return { ...c, conditions: c.conditions.map((x) => flipSides(x, key)) };
    default: return fail(`condition ${key} under ForceOpponent`);
  }
}

/** Keys with no condition meaning, or `Unsupported`. */
function fallback(key: string, where: "proc" | "step"): Condition[] {
  if (where === "proc" && (PROC_IGNORED.has(key) || key in PROC_TIMING)) return [];
  if (where === "step" && (CONTROL_KEYS.has(key) || key === "AvailableDon")) return [];
  return fail(`condition ${key}`);
}

/** The original key table: a Condition, null (no meaning) or undefined (not here). */
function baseCondition(key: string, v: unknown, a: AbilityCtx, where: "proc" | "step", all: Json): Condition | null | undefined {
  const n = num(v);
  const self: Selector["owner"] = "self";
  const zoneCount = (zone: Selector["zone"], owner: Selector["owner"], filter?: SelectorFilter): Selector => ({
    owner, zone, count: 99, chooser: "controller", ...(filter ? { filter } : {}),
  });
  switch (key) {
    case "DonX": if (where === "proc") return { kind: "donAttached", count: n }; break;
    case "YourTurn": return { kind: "yourTurn" };
    case "OpponentTurn": return { kind: "opponentsTurn" };
    case "LeaderCategoryRequired": {
      const types = list<number>(v).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`));
      const byType: Condition = { kind: "leaderIs", filter: { typeIncludes: [...new Set(types)] } };
      // "… has the {X} type or is [Name] / has the <Strike> attribute" (M5)
      const alt: Condition[] = [];
      if (Array.isArray(all.OverrideLeaderCategoryName)) alt.push({ kind: "leaderIs", filter: { nameIncludes: catalogNames(list<string>(all.OverrideLeaderCategoryName), a) } });
      if (Array.isArray(all.OverrideLeaderStrikeType)) alt.push({ kind: "leaderIs", filter: { attributes: list<number>(all.OverrideLeaderStrikeType).map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`)) } });
      return alt.length > 0 ? { kind: "anyOf", conditions: [byType, ...alt] } : byType;
    }
    case "OverrideLeaderCategoryName": case "OverrideLeaderStrikeType": return null; // modifiers of LeaderCategoryRequired
    case "LeaderNameRequired": return { kind: "leaderIs", filter: { nameIncludes: catalogNames(list<string>(v), a) } };
    case "AllyNameNotInPlay":
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { nameIncludes: catalogNames(list<string>(v), a), excludeSelf: true }), atMost: 0 };
    case "NameInYourDeploy":
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { nameIncludes: catalogNames(list<string>(v), a), excludeSelf: true }), atLeast: 1 };
    case "AllyNameInPlay": {
      const names = catalogNames(list<string>(v), a);
      if (names.length !== 1) fail("AllyNameInPlay with several names");
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { nameIncludes: names, excludeSelf: true }), atLeast: Math.max(1, num(all.AllyNameInPlayCount)) };
    }
    case "AllyNameInPlayCount": return null;
    case "MatchingTargetSpec": return null;
    // "When this Character battles <Strike> attribute Characters" (M5): the other Character
    case "BattlingStrikeType":
      if (where !== "proc") return undefined;
      return { kind: "prevMatches", filter: { category: ["Character"], attributes: list<number>(v).map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`)) } };
    case "PreviousTargetNowInTrash": // "If you do," after "K.O. the Character you battled with" (M5)
      // elsewhere it follows a "trash 1 of your Characters:" cost: the payment itself
      if (where !== "step" || !/you may K\.O\. the opponent.s Character you battled with\. If you do,/i.test(a.tailText ?? "")) return null;
      return { kind: "prevInTrash" };
    // "If there is a [Monkey.D.Luffy] Character, this effect is negated." (M5): any player's
    case "NameNotInAnyDeploy":
      return { kind: "countInZone", sel: zoneCount("characterArea", "any", { nameIncludes: catalogNames(list<string>(v), a) }), atMost: 0 };
    // "If you have no other [Shirahoshi] with a base cost of 2" (M5)
    case "NoOtherNameWithBaseCostInYourDeploy": {
      const w = list<Json>(v);
      if (w.length !== 1) fail("NoOtherNameWithBaseCostInYourDeploy with several names");
      const cost = num(w[0].iCount);
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { nameIncludes: catalogNames([String(w[0].sString)], a), baseCostAtLeast: cost, baseCostAtMost: cost, excludeSelf: true }), atMost: 0 };
    }
    case "DeckOut": // "if your deck has 0 cards" (M5)
      if (where !== "step") return undefined;
      return { kind: "compare", left: { count: "deck", who: self }, op: "le", right: 0 }; // the watched card's spec (fromOptcg.ts), read by reactOf
    // "When this Leader attacks your opponent's Leader" (M5): the timing is [When Attacking]
    case "OnAttackLeader":
      if (where !== "proc") return undefined;
      return { kind: "attackingLeader" };
    // "If you have 2 or more Characters with a [Trigger]" (M5)
    case "NumTriggersInPlay":
      if (!new RegExp(`If you have ${n} or more Characters with a \\[Trigger\\]`, "i").test(a.tailText ?? "")) fail("NumTriggersInPlay without its text");
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { hasTrigger: true }), atLeast: n };
    // "if you have [Portgas.D.Ace] and [Monkey.D.Luffy] Characters with 6000 base power" (M5)
    case "NamesWithExactBasePowerInYourDeploy": {
      const want = list<Json>(v).map((x) => ({ name: String(x.sString), power: num(x.iCount) }));
      if (!on(all.RequireAll) || want.length < 2) fail("NamesWithExactBasePowerInYourDeploy: any of them?");
      const t = a.tailText ?? "";
      if (!want.every((w) => new RegExp(`Characters with ${w.power} base power`, "i").test(t))) fail("NamesWithExactBasePowerInYourDeploy without its text");
      return { kind: "allOf", conditions: want.map((w) => ({ kind: "countInZone" as const,
        sel: zoneCount("characterArea", self, { nameIncludes: catalogNames([w.name], a), basePowerAtLeast: w.power, basePowerAtMost: w.power }), atLeast: 1 })) };
    }
    case "RequireAll": return null;
    // "If your opponent's Character has been K.O.'d during this turn" (M5)
    case "AnyOppCharacterKOd":
      if (!/your opponent's Character has been K\.O\.'d during this turn/i.test(a.tailText ?? "")) fail("AnyOppCharacterKOd without its text");
      return { kind: "happenedThisTurn", who: "opponent", what: "characterKOd" };
    // "During the turn in which a card in your hand is trashed by an effect" (M5)
    case "MyHandTrashed":
      if (!/During the turn in which a card in your hand is trashed by an effect/i.test(a.tailText ?? a.card.text ?? "")) fail("MyHandTrashed without its text");
      return { kind: "happenedThisTurn", who: self, what: "handTrashed" };
    // "This Character gains …" after a cost: only while it is on the field — a "this card" action already is
    case "OnBoard": return null;
    // "If the trashed card has a cost of 6 or more" (M5): the card the mill before trashed
    case "LastTrashedCostXOrMore":
      if (!new RegExp(`If the trashed card has a cost of ${n} or more`, "i").test(a.tailText ?? "")) fail("LastTrashedCostXOrMore without its text");
      return { kind: "milledMatches", filter: { costAtLeast: n } };
    // "If you have a total of 4 or less cards in your Life area and hand" (M5)
    case "LifeHandXOrLess":
      if (!new RegExp(`a total of ${n} or less cards in your Life area and hand`, "i").test(a.tailText ?? "")) fail("LifeHandXOrLess without its text");
      return { kind: "compare", left: { count: "lifeAndHand", who: self }, op: "le", right: n };
    // "If the total cost of your Characters is 5 or more" (M5)
    case "AllyTotalCostOrMore":
      if (!new RegExp(`the total cost of your Characters is ${n} or more`, "i").test(a.tailText ?? "")) fail("AllyTotalCostOrMore without its text");
      return { kind: "compare", left: { count: "charactersTotalCost", who: self }, op: "ge", right: n };
    // "If you have 5 {Impel Down} type Characters with different card names" (M5)
    case "FieldIsFullAndUnique": return { kind: "compare", left: { count: "distinctNames", who: self }, op: "ge", right: 5 };
    case "FieldIsOnlyCategory": {
      const types = list<number>(v).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`));
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { typeExcludes: [...new Set(types)] }), atMost: 0 };
    }
    case "ActivatedEventXOrMore": // "If you have activated an Event with a base cost of N or more during this turn" (M5)
      if (!/activated an Event with a base cost of \d+ or more during this turn/i.test(a.tailText ?? "")) fail("ActivatedEventXOrMore without its text");
      return { kind: "activatedEventThisTurn", minBaseCost: n };
    case "FieldIsOnlyCounterless": // "If you only have Characters without a Counter" (M5)
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { counter: "some" }), atMost: 0 };
    case "LeaderActive": return { kind: "countInZone", sel: zoneCount("leader", self, { rested: false }), atLeast: 1 };
    case "OppRestedCharacters": return { kind: "countInZone", sel: zoneCount("characterArea", "opponent", { rested: true }), atLeast: n };
    case "LifeXOrLess": return { kind: "lifeAtMost", who: "self", count: n };
    case "LifeXOrMore": return { kind: "lifeAtLeast", who: "self", count: n };
    case "ZeroLife": case "LifeIsZero": return { kind: "lifeAtMost", who: "self", count: 0 };
    case "OppLifeXOrLess": return { kind: "lifeAtMost", who: "opponent", count: n };
    case "OppLifeXOrMore": return { kind: "lifeAtLeast", who: "opponent", count: n };
    case "HandXOrLess": return { kind: "handAtMost", who: "self", count: n };
    case "HandXOrMore": return { kind: "handAtLeast", who: "self", count: n };
    case "HandEmpty": return { kind: "handAtMost", who: "self", count: 0 };
    case "OppHandXOrMore": return { kind: "handAtLeast", who: "opponent", count: n };
    case "TrashXOrMore": return { kind: "countInZone", sel: zoneCount("trash", self), atLeast: n };
    case "TrashEventsXOrMore": return { kind: "countInZone", sel: zoneCount("trash", self, { category: ["Event"] }), atLeast: n };
    case "DonXOrMore": // "0 or N or more DON!!" when OrDonIsZero rides along
      if (all.OrDonIsZero) return { kind: "anyOf", conditions: [{ kind: "compare", left: { count: "donOnField", who: "self" }, op: "le", right: 0 }, { kind: "donOnField", who: "self", atLeast: n }] };
      return { kind: "donOnField", who: "self", atLeast: n };
    case "OrDonIsZero": return null; // modifier of DonXOrMore
    case "OppDonXOrMore": return { kind: "donOnField", who: "opponent", atLeast: n };
    case "CharactersOrMore": return { kind: "countInZone", sel: zoneCount("characterArea", self), atLeast: n };
    case "CharactersOrLess": return { kind: "countInZone", sel: zoneCount("characterArea", self), atMost: n };
    case "OppCharactersOrMore": return { kind: "countInZone", sel: zoneCount("characterArea", "opponent"), atLeast: n };
    case "OppCharactersOrLess": return { kind: "countInZone", sel: zoneCount("characterArea", "opponent"), atMost: n };
    case "SelfRestedCharacters": return { kind: "countInZone", sel: zoneCount("characterArea", self, { rested: true }), atLeast: n };
    case "Rested": if (where === "proc") return { kind: "selfRested" }; break;
    case "CategoryInPlayRequired": {
      const types = list<number>(v).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`));
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { typeIncludes: [...new Set(types)] }), atLeast: Math.max(1, num(all.CategoryInPlayCount)) };
    }
    case "CategoryInPlayCount": return null; // modifier of CategoryInPlayRequired
    case "AllyCostOrMore":
      return { kind: "countInZone", sel: zoneCount("characterArea", self, { costAtLeast: n }), atLeast: Math.max(1, num(all.AllyCostCount)) };
    case "AllyCostCount": return null;
    case "TopDeckCountOrMore": return null; // view feasibility — the peek handles an empty view
    // "if the revealed card's type includes …" — the top card of the deck (M5)
    case "TopDeckHasCategory": {
      const types = list<number>(v).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`));
      return { kind: "countInZone", sel: { owner: self, zone: "deckTop", count: 1, chooser: "controller", filter: { typeIncludes: [...new Set(types)] } }, atLeast: 1 };
    }
    case "TopDeckMatches": // a revealed-card check moved here by views.ts
      return { kind: "countInZone", sel: { owner: self, zone: "deckTop", count: 1, chooser: "controller", filter: filterOf(v as Json, a) }, atLeast: 1 };
    case "TopDeckMatchesSavedCost": // "If the revealed card has the chosen cost" (M5)
      if (!/top of your opponent's deck/i.test(a.tailText ?? "")) fail("chosen cost: whose deck?");
      return { kind: "deckTopCostDeclared", who: "opponent" };
    case "TopDeckCostOrMore":
      return { kind: "countInZone", sel: { owner: self, zone: "deckTop", count: 1, chooser: "controller", filter: { costAtLeast: n } }, atLeast: 1 };
    case "HasPreviousTargets": return { kind: "hadTargets" }; // checked against the previous action in sequence.ts
    // "If you do" after moving the previous target (deck / Life / hand, M5): it moved = it was chosen
    case "PreviousTargetNowInDeck": case "PreviousTargetNowInLife": case "PreviousTargetNowInHand": return { kind: "hadTargets" };
    default: break;
  }
  return undefined;
}

export function procConditions(proc: Json, a: AbilityCtx): Condition[] {
  const out: Condition[] = [];
  for (const k of keysOn(proc)) {
    out.push(...conditionOf(k, proc[k], a, "proc", proc));
  }
  return out;
}

export function stepConditions(details: Json | undefined, a: AbilityCtx, keepHadTargets = false): Condition[] {
  const out: Condition[] = [];
  for (const k of keysOn(details)) {
    out.push(...conditionOf(k, (details as Json)[k], a, "step", details as Json));
  }
  if (keepHadTargets || !out.some((c) => c.kind === "hadTargets")) return out;
  // outside a run of actions "if you do" has nothing to look back at
  a.approx.add("\"if you do\" after an optional step is not tracked (the follow-up always runs)");
  return out.filter((c) => c.kind !== "hadTargets");
}
