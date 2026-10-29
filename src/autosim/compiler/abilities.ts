/** One ability → IR Effect: passives (keywords / statics) and triggered or activated abilities. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Action, Condition, CostItem, Effect, Keyword, Quantity, Selector, SelectorFilter, Timing } from "../ir/types";
import { ATTRIBUTES } from "./catalogMaps";
import { procConditions, stepConditions } from "./conditions";
import { alternativeCost, orderChoiceCost, trashViewCost } from "./costActions";
import { costOf, lifeChoiceCost } from "./costs";
import { Unsupported, fail, keysOn, list, num, on } from "./dsl";
import { filterOf, selectorOf, selfZone } from "./selectors";
import { sequence } from "./sequence";
import { abilityText, hasCostColon } from "./text";
import type { AbilityCtx, AbilityResult, CatalogCard, Json, OptcgAbility, OptcgCard, OptcgStep } from "./types";

// ─── abilities → effects ────────────────────────────────────────────────────

export const PASSIVE_KEYWORDS: Record<string, Keyword> = {
  Blocker: "Blocker", Rush: "Rush", DoubleAttack: "DoubleAttack", Banish: "Banish",
  Unblockable: "Unblockable", RushCharacters: "RushCharacter",
};

export function selfSel(card: OptcgCard): Selector {
  return { owner: "self", zone: selfZone(card), count: 1, self: true, chooser: "controller" };
}

export function passiveEffect(card: OptcgCard, cat: CatalogCard | undefined, ab: OptcgAbility, a: AbilityCtx, res: AbilityResult): void {
  const step = ab.steps[0] ?? {};
  const fx = step.effect ?? {};
  const keys = keysOn(fx);
  // "[DON!! xN] [When Attacking] your opponent cannot activate [Blocker] …" is
  // stored as a passive; it is a When Attacking effect lasting the battle
  // (10-1-7-1), which the engine runs today (statics wait for M4)
  const text = (cat?.effect ?? card.text ?? "");
  if (on(ab.proc.DonX) && text.includes("[When Attacking]") && /cannot activate (a )?\[Blocker\]/.test(text)
    && keys.length === 1 && (keys[0] === "Unblockable" || keys[0] === "BlockerMustBeXOrLess")) {
    a.timing = "whenAttacking";
    const conds = procConditions(ab.proc, a);
    const action: Action = keys[0] === "Unblockable"
      ? { kind: "grantKeyword", sel: selfSel(card), keyword: "Unblockable", duration: "thisBattle" }
      : { kind: "restriction", what: "cannotBlock", duration: "thisBattle",
          sel: { owner: "opponent", zone: "characterArea", count: 99, chooser: "controller", filter: { hasKeyword: "Blocker", powerAtLeast: num(fx.BlockerMustBeXOrLess) } } };
    res.effects.push({ timing: "whenAttacking", ...(conds.length ? { conditions: conds } : {}), actions: [action] });
    return;
  }
  const conds = [...procConditions(ab.proc, a), ...stepConditions(step.details, a)];
  const actions: Action[] = [];
  for (const k of keys) {
    const v = fx[k];
    if (k in PASSIVE_KEYWORDS) {
      if (conds.length === 0) { res.keywords.push(PASSIVE_KEYWORDS[k]); continue; }
      actions.push({ kind: "grantKeyword", sel: selfSel(card), keyword: PASSIVE_KEYWORDS[k], duration: "permanentWhileInPlay" });
      continue;
    }
    switch (k) {
      case "PassivePowerChange": actions.push({ kind: "powerMod", sel: selfSel(card), amount: num(v), duration: "permanentWhileInPlay" }); break;
      case "PassiveCostChange": actions.push({ kind: "costMod", sel: selfSel(card), amount: num(v), duration: "permanentWhileInPlay" }); break;
      case "CanAttackActive": actions.push({ kind: "restriction", sel: selfSel(card), what: "canAttackActiveCharacters", duration: "permanentWhileInPlay" }); break;
      case "PassiveCantAttack": actions.push({ kind: "restriction", sel: selfSel(card), what: "cannotAttack", duration: "permanentWhileInPlay" }); break;
      case "ImmuneToBattle": actions.push({ kind: "restriction", sel: selfSel(card), what: "cannotBeKOdInBattle", duration: "permanentWhileInPlay" }); break;
      case "FieldPowerBuff": {
        const spec = step.target?.[0];
        const s = selectorOf(spec, a, false);
        if (s.owner !== "self") fail("FieldPowerBuff outside your field");
        actions.push({ kind: "powerMod", sel: { ...s, count: 99, upTo: undefined }, amount: num(v), duration: "permanentWhileInPlay" });
        break;
      }
      case "FieldPowerDebuff":
        actions.push({ kind: "powerMod", sel: { owner: "opponent", zone: "characterArea", count: 99, chooser: "controller" }, amount: num(v), duration: "permanentWhileInPlay" });
        break;
      case "OtherCharsImmuneToBattleKO": {
        const s = selectorOf(step.target?.[0], a, false);
        actions.push({ kind: "restriction", sel: { ...s, count: 99, upTo: undefined, filter: { ...(s.filter ?? {}), excludeSelf: true } }, what: "cannotBeKOdInBattle", duration: "permanentWhileInPlay" });
        break;
      }
      default: {
        const more = passiveM5(k, v, step, card, text, a);
        if (!more) fail(`passive ${k}`);
        actions.push(...more!);
      }
    }
  }
  for (const act of actions) if ("sel" in act && act.sel && act.sel.upTo === undefined) delete act.sel.upTo;
  if (actions.length > 0) res.effects.push({ timing: "static", ...(conds.length ? { conditions: conds } : {}), actions });
}

/** M5 passives: hand cost, immunities, field-wide cost / base power /
 *  keywords, "+N for every …". Null = not a key this table knows. */
function passiveM5(k: string, v: unknown, step: OptcgStep, card: OptcgCard, text: string, a: AbilityCtx): Action[] | null {
  const P = "permanentWhileInPlay" as const;
  const self = selfSel(card);
  const field = (): Selector => {
    const s = selectorOf(step.target?.[0], a, false);
    return { ...s, count: 99, upTo: undefined } as Selector;
  };
  // "by your opponent's effects" vs "by effects" (any player's)
  const byOpp = /by your opponent's effects/i.test(text);
  const per = (q: Quantity): { scale: { q: Quantity; per: number } } => ({ scale: { q, per: num(v) || 1 } });
  switch (k) {
    // counters in the hand (M5)
    case "HandCounterChange": return [{ kind: "setCounter", sel: { owner: "self", zone: "hand", count: 1, self: true, chooser: "controller" }, amount: num(v), duration: P }];
    case "CharactersWithPowerHas2KCounter":
      return [{ kind: "setCounter", sel: { owner: "self", zone: "hand", count: 99, chooser: "controller", filter: { category: ["Character"], powerAtLeast: num(v), powerAtMost: num(v) } }, amount: 2000, duration: P }];
    case "CharactersWithNoCounterHaveXCounter":
      return [{ kind: "setCounter", sel: { owner: "self", zone: "hand", count: 99, chooser: "controller", filter: { category: ["Character"], counter: "none" } }, amount: num(v), duration: P }];
    case "CharacterTypeHas1KCounter": {
      const types = list<number>(v).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`));
      return [{ kind: "setCounter", sel: { owner: "self", zone: "hand", count: 99, chooser: "controller", filter: { category: ["Character"], typeIncludes: [...new Set(types)], counter: "none" } }, amount: 1000, duration: P }];
    }
    // "Give blue Events in your hand −1 cost" / "the cost of playing … from your hand will be reduced by 1" (M5)
    case "AllyHandPlayCostReduce": {
      const s = selectorOf(step.target?.[0], a, false);
      if (s.zone !== "hand") return null;
      return [{ kind: "costMod", sel: { ...s, count: 99, upTo: undefined } as Selector, amount: -num(v), duration: P }];
    }
    case "HandCostChange": return [{ kind: "costMod", sel: { owner: "self", zone: "hand", count: 1, self: true, chooser: "controller" }, amount: num(v), duration: P }];
    case "ImmuneToNoncombat": return [{ kind: "restriction", sel: self, what: byOpp ? "cannotBeKOdByOpponent" : "cannotBeKOd", duration: P }];
    case "ImmuneToRemoval":
      if (!byOpp) fail("removal immunity against every player");
      return [{ kind: "restriction", sel: self, what: "cannotBeRemovedByOpponent", duration: P }];
    case "ImmuneToRest":
      if (!byOpp) fail("rest immunity against every player");
      return [{ kind: "restriction", sel: self, what: "cannotBeRestedByOpponent", duration: P }];
    case "OtherCharsImmuneToNoncombatKO": {
      const s = field();
      return [{ kind: "restriction", sel: s, what: byOpp ? "cannotBeKOdByOpponent" : "cannotBeKOd", duration: P }];
    }
    // "all Characters with a cost of 5 or less do not become active in your and your opponent's Refresh Phases" (M5)
    case "FreezeAllCostOrLess":
      if (!new RegExp(`all Characters with a cost of ${num(v)} or less do not become active in your and your opponent's Refresh Phases`, "i").test(text)) return null;
      return [{ kind: "restriction", sel: { owner: "any", zone: "characterArea", count: 99, chooser: "controller", filter: { costAtMost: num(v) } }, what: "noRefresh", duration: P }];
    // "Your Character cards are played rested." (M5): on your Leader
    case "AllDeployRested":
      if (!/Your Character cards are played rested/i.test(text)) return null;
      return [{ kind: "restriction", sel: { owner: "self", zone: "leader", count: 1, chooser: "controller" }, what: "charactersPlayedRested", duration: P }];
    // "this Character's base power becomes the same as your Leader's base power" (M5)
    case "PassiveBasePowerMatchLeader":
      if (!/this Character's base power becomes the same as your Leader's base power/i.test(text)) return null;
      a.approx.add("the Leader's printed base power is used");
      return [{ kind: "setBasePower", sel: self, amount: 0, fromLeaderBase: true, duration: P }];
    // "Your [On Play] effects are negated." (M5)
    case "NoOnPlays":
      if (!/Your \[On Play\] effects are negated/i.test(text)) return null;
      return [{ kind: "restriction", sel: { owner: "self", zone: "leader", count: 1, chooser: "controller" }, what: "onPlaysNegated", duration: P }];
    // "This card in your hand cannot be played by effects." (M5)
    case "CantBeDeployedViaEffect":
      if (!/This card in your hand cannot be played by effects/i.test(text)) return null;
      return [{ kind: "restriction", sel: { owner: "self", zone: "hand", count: 1, self: true, chooser: "controller" }, what: "cannotBePlayedByEffects", duration: P }];
    // "cannot be K.O.'d by effects of Characters without the <Special> attribute" (M5)
    case "VulnerableToNoncombat": {
      const attrs = list<number>(v).map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`));
      if (!new RegExp(`cannot be K\\.O\\.'d by effects of Characters without the [＜<]${attrs[0]}[＞>] attribute`, "i").test(text)) return null;
      return [{ kind: "restriction", sel: self, what: "cannotBeKOdByEffectsOf", duration: P, sourceFilter: { category: ["Character"], attributesExclude: attrs } }];
    }
    // "cannot be K.O.'d by effects of your opponent's Characters with 5000 base power or less" (M5)
    case "ImmuneToRemovalFromCharactersXBasePowerOrLess":
      if (!new RegExp(`cannot be K\\.O\\.'d by effects of your opponent's Characters with ${num(v)} base power or less`, "i").test(text)) return null;
      return [{ kind: "restriction", sel: self, what: "cannotBeKOdByEffectsOf", duration: P, sourceOpponentOnly: true, sourceFilter: { category: ["Character"], basePowerAtMost: num(v) } }];
    // "cannot be K.O.'d in battle by Characters without the <Special> attribute" (M5)
    case "VulnerableToStrikes": {
      const attrs = list<number>(v).map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`));
      if (!new RegExp(`cannot be K\\.O\\.'d in battle by Characters without the [＜<]${attrs[0]}[＞>] attribute`, "i").test(text)) return null;
      return [{ kind: "restriction", sel: self, what: "cannotBeKOdInBattle", duration: P, attackerCharactersOnly: true, exceptAttributes: attrs }];
    }
    // "Your face-up Life cards are placed at the bottom of your deck instead of being added to your hand, according to the rules." (M5)
    case "FaceUpLifeGoesToDeck":
      if (!/Your face-up Life cards are placed at the bottom of your deck instead of being added to your hand, according to the rules/i.test(text)) return null;
      return [{ kind: "restriction", sel: { owner: "self", zone: "leader", count: 1, chooser: "controller" }, what: "faceUpLifeToDeck", duration: P }];
    // "This Character cannot attack." (M5)
    case "PassiveCantAttack":
      if (!/This Character cannot attack(?! a)/i.test(text)) return null;
      return [{ kind: "restriction", sel: self, what: "cannotAttack", duration: P }];
    // "all Characters with a cost of 3 or 4 cannot attack" (M5): both players'
    case "FieldCantAttack": {
      const s = field();
      if (!/all Characters with a cost of \d+ or \d+ cannot attack/i.test(text)) return null;
      return [{ kind: "restriction", sel: { ...s, owner: "any" }, what: "cannotAttack", duration: P }];
    }
    // "All of your opponent's Characters cannot be removed from the field by your effects." (M5)
    case "OpponentFieldImmuneToRemoval":
      if (!/All of your opponent's Characters cannot be removed from the field by your effects/i.test(text)) return null;
      return [{ kind: "restriction", sel: { owner: "opponent", zone: "characterArea", count: 99, chooser: "controller" }, what: "cannotBeRemovedByOpponent", duration: P }];
    // "This Character cannot be rested by your opponent's Leader and Character effects" (M5)
    case "ImmuneToRestFromLeaderOrChar":
      if (!/cannot be rested by your opponent's Leader and Character effects/i.test(text)) return null;
      a.approx.add("\"cannot be rested by your opponent's Leader and Character effects\" also covers Events and Stages");
      return [{ kind: "restriction", sel: self, what: "cannotBeRestedByOpponent", duration: P }];
    // "This Character cannot attack a Leader on the turn in which it is played." (M5)
    case "CantAttackLeaderOnPlayTurn":
      if (!/cannot attack a Leader on the turn in which it is played/i.test(text)) return null;
      return [{ kind: "restriction", sel: { ...self, filter: { playedThisTurn: true } }, what: "cannotAttackLeaders", duration: P }];
    // "your opponent cannot attack any card other than the Character [this card]" (M5)
    case "OpponentCanOnlyAttackMyName":
      if (!/cannot attack any card other than the Character \[/i.test(text)) return null;
      return [{ kind: "restriction", sel: self, what: "onlyAttackTarget", duration: P }];
    case "ImmuneToStrikes": case "ImmuneToLeaderStrikes": {
      const attrs = list<number>(v).map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`));
      const both = k === "ImmuneToStrikes" && Array.isArray((step.effect as Json).ImmuneToLeaderStrikes);
      if (k === "ImmuneToLeaderStrikes" && Array.isArray((step.effect as Json).ImmuneToStrikes)) return []; // folded into ImmuneToStrikes
      if (k === "ImmuneToLeaderStrikes") {
        // "cannot be K.O.'d in battle by Leaders" (M5)
        if (!/cannot be K\.O\.'d in battle by Leaders/i.test(text)) fail("battle immunity against Leaders only");
        return [{ kind: "restriction", sel: self, what: "cannotBeKOdInBattle", duration: P, attackerLeadersOnly: true,
          ...(attrs.length > 0 && attrs.length < ATTRIBUTES.length ? { attributes: attrs } : {}) }];
      }
      return [{ kind: "restriction", sel: self, what: "cannotBeKOdInBattle", duration: P,
        ...(attrs.length > 0 && attrs.length < ATTRIBUTES.length ? { attributes: attrs } : {}),
        ...(both ? {} : { attackerCharactersOnly: true }) }];
    }
    case "FieldBasePowerChange": return [{ kind: "setBasePower", sel: field(), amount: num(v), duration: P }];
    case "OpponentFieldCostChange": return [{ kind: "costMod", sel: step.target?.[0] ? field() : { owner: "opponent", zone: "characterArea", count: 99, chooser: "controller" }, amount: num(v), duration: P }];
    case "AllyFieldCostChange": return [{ kind: "costMod", sel: step.target?.[0] ? field() : { owner: "self", zone: "characterArea", count: 99, chooser: "controller" }, amount: num(v), duration: P }];
    case "FieldDoubleAttack": return [{ kind: "grantKeyword", sel: field(), keyword: "DoubleAttack", duration: P }];
    case "FieldBlocker": return [{ kind: "grantKeyword", sel: field(), keyword: "Blocker", duration: P }];
    case "FieldUnblockable": return [{ kind: "grantKeyword", sel: field(), keyword: "Unblockable", duration: P }];
    case "FieldRush": return [{ kind: "grantKeyword", sel: field(), keyword: "Rush", duration: P }];
    case "FieldRushCharacters": return [{ kind: "grantKeyword", sel: field(), keyword: "RushCharacter", duration: P }];
    case "Passive1KPerXTrash": return [{ kind: "powerMod", sel: self, amount: 1000, duration: P, ...per({ count: "trash", who: "self" }) }];
    case "Passive1KPerXEventTrash": return [{ kind: "powerMod", sel: self, amount: 1000, duration: P, ...per({ count: "trashEvents", who: "self" }) }];
    case "Passive1KPerXRestedDon": return [{ kind: "powerMod", sel: self, amount: 1000, duration: P, ...per({ count: "donRested", who: "self" }) }];
    case "PassivePowerPerUniqueDeploy": // "+1000 power for each of your Characters with a different card name"
      if (!/for each of your Characters with a different card name/i.test(text)) return null;
      a.approx.add("\"each of your Characters with a different card name\" counts every different name, this Character's included");
      return [{ kind: "powerMod", sel: self, amount: num(v), duration: P, scale: { q: { count: "distinctNames", who: "self" }, per: 1 } }];
    case "Passive1KPerHandCard": return [{ kind: "powerMod", sel: self, amount: 1000, duration: P, ...per({ count: "hand", who: "self" }) }];
    case "Passive2CostPerXTrash": return [{ kind: "costMod", sel: self, amount: 2, duration: P, ...per({ count: "trash", who: "self" }) }];
    case "Passive1CostPerXTrash": return [{ kind: "costMod", sel: self, amount: 1, duration: P, ...per({ count: "trash", who: "self" }) }];
    default: return null;
  }
}

/** Neutralize the Event play cost / Trigger self-trash in step 0 (the engine
 *  pays / does them). Returns a same-length copy, so `JumpToStep` indices of
 *  Choices keep pointing at the right steps. */
export function payoffSteps(card: OptcgCard, timing: Timing, steps: OptcgStep[]): OptcgStep[] {
  const strip = (st: OptcgStep, keys: string[]): OptcgStep => {
    const effect: Json = {};
    for (const k of Object.keys(st.effect ?? {})) if (!keys.includes(k)) effect[k] = (st.effect as Json)[k];
    return { ...st, effect };
  };
  // [Trigger]: "trash this card" is the trigger's own resolution (10-1-5-3),
  // done by the engine — wherever the data writes it
  if (timing === "trigger") return steps.map((st) => (keysOn(st.effect).includes("TrashSelf") ? strip(st, ["TrashSelf"]) : st));
  const out = [...steps];
  if ((timing === "counter" || timing === "main") && card.type === "Event" && keysOn(steps[0]?.effect).includes("TrashSelf")) {
    out[0] = strip(steps[0], ["TrashSelf", "DonTap"]);
    // the play cost again, written as a conditional extra DON!! payment
    // ("4 or more Events in your trash → −3 cost" = the hand cost change)
    if (keysOn(out[1]?.effect).join() === "DonTap" && !out[1].target && !on(out[1].details?.ConfirmAction) && !on(out[1].details?.Required)) {
      out[1] = strip(out[1], ["DonTap"]);
    }
  }
  return out;
}

/** [Once Per Turn] follows the printed text (the data has a few strays both
 *  ways); outside an Event's [Main]/[Counter], a data flag also counts when the
 *  text says "haven't … this turn" (an OPT in disguise). */
function isOncePerTurn(card: OptcgCard, ab: OptcgAbility, timing: Timing, text: string): boolean {
  const eventPlay = card.type === "Event" && (timing === "main" || timing === "counter");
  return /once per turn/i.test(text) || (!eventPlay && on(ab.proc.OncePerTurn) && /haven't .*this turn/i.test(text));
}

interface CostRead {
  cost: CostItem[];
  /** conditions on the cost steps / leading gates (activation conditions) */
  gate: Condition[];
  optional: boolean;
  /** first payoff step */
  next: number;
}

/** The leading steps before the ":" (8-3-1) → IR costs. Without a colon in
 *  the text, only a leading "you may" confirmation is read. */
function readCost(steps: OptcgStep[], text: string, ab: OptcgAbility, a: AbilityCtx): CostRead {
  const read: CostRead = { cost: [], gate: [], optional: false, next: 0 };
  const isBareStep = (st: OptcgStep) => keysOn(st.effect).length === 0 && !st.target;
  if (!hasCostColon(text) && !on(ab.proc.Active)) {
    while (read.next < steps.length && isBareStep(steps[read.next]) && on(steps[read.next].details?.ConfirmAction)) {
      read.optional = true;
      read.gate.push(...stepConditions(steps[read.next].details, a));
      read.next++;
    }
    return read;
  }
  let undo: { next: number; costLen: number; gateLen: number; optional: boolean } | null = null;
  for (; read.next < steps.length; read.next++) {
    const st = steps[read.next];
    // a target-only "is there a valid target?" check before the costs (M5): nothing to pay
    if (keysOn(st.effect).length === 0 && st.target && on(st.details?.HasValidTargets) && read.cost.length === 0) continue;
    if (isBareStep(st)) {
      if (on(st.details?.ConfirmAction)) read.optional = true;
      read.gate.push(...stepConditions(st.details, a));
      continue;
    }
    const tv = trashViewCost(steps, read.next, a);
    if (tv) {
      read.cost.push(...(tv.riders ?? []), tv.cost);
      if (!on(st.details?.NoCancel)) read.optional = true;
      read.next = tv.next - 1;
      continue;
    }
    if (Array.isArray(st.effect?.Choices) && list<Json>(st.effect?.Choices).length === 1) {
      // a single-button Choices is a confirmation ("pay DON!! −1?")
      const to = list<Json>(st.effect?.Choices)[0].JumpToStep;
      read.optional = true;
      read.next = (typeof to === "number" && to > read.next ? to : read.next + 1) - 1;
      continue;
    }
    const cancel = list<Json>(st.effect?.Choices);
    if (cancel.length === 2 && cancel.some((o) => o.ButtonText === "Choice.Cancel")) {
      // "Cancel / Do it" — the "you may" of the cost; go on with the other branch
      const go = cancel.find((o) => o.ButtonText !== "Choice.Cancel")!.JumpToStep;
      const stop = cancel.find((o) => o.ButtonText === "Choice.Cancel")!.JumpToStep;
      if (typeof go === "number" && go > read.next && typeof stop === "number" && keysOn(steps[stop]?.effect).length === 0 && !steps[stop]?.target) {
        read.optional = true;
        read.next = go - 1;
        continue;
      }
    }
    if (Array.isArray(st.effect?.Choices)) {
      const oc = lifeChoiceCost(steps, read.next) ?? orderChoiceCost(steps, read.next, a, (x) => costOf(x, a, true))
        ?? alternativeCost(steps, read.next, text, (x) => costOf(x, a));
      if (!oc) break;
      const lc = oc;
      read.cost.push(...lc.cost);
      if (!on(st.details?.NoCancel)) read.optional = true;
      read.next = lc.next - 1;
      continue;
    }
    let c = costOf(st, a);
    // "You may trash 1 card from your hand and place 1 Character … at the bottom of the owner's deck:" —
    // the second named cost is marked NoCancel in the data (M5)
    if (!c && on(st.details?.NoCancel) && read.cost.length > 0 && /\band\b/.test(beforeColon(text)) && read.next + 1 < steps.length) {
      const c2 = costOf(st, a, true);
      if (c2 && c2.every((item) => costNamed(item, beforeColon(text)))) c = c2;
    }
    if (!c) {
      // "You may rest this Character: Draw 1 card …" written as one step (M5): split it
      const split = splitCostStep(st, text, a);
      if (split) {
        // a ①–⑩ DON!! rest is printed first (8-3-1-1 written order)
        for (const c2 of split.cost) if (c2.kind === "restDon") read.cost.unshift(c2); else read.cost.push(c2);
        read.gate.push(...stepConditions(st.details, a));
        if (!on(st.details?.NoCancel)) read.optional = true;
        steps[read.next] = split.payoff;
      }
      break;
    }
    const more = steps[read.next + 1];
    if (c.length === 1 && c[0].kind === "returnDonToDeck" && on(more?.effect?.OptionalReturnDon)) {
      // "return 1 or more DON!! cards from your field to your DON!! deck:" (M5) — one option per amount
      const base = c[0].count;
      const options = Array.from({ length: 10 - base + 1 }, (_, k): CostItem[] => [{ kind: "returnDonToDeck", count: base + k }]);
      c = [{ kind: "oneOf", options, labels: options.map((o) => `Return ${(o[0] as { count: number }).count} DON!!`) }];
      read.next++;
    }
    // a step the text before the ":" doesn't name is the payoff (OP01-002: "➁: … return 1 of your Characters")
    if (hasCostColon(text) && !/resolve this effect manually$/.test(text) && !c.every((item) => costNamed(item, beforeColon(text)))) break;
    undo = { next: read.next, costLen: read.cost.length, gateLen: read.gate.length, optional: read.optional };
    read.gate.push(...stepConditions(st.details, a));
    if (!on(st.details?.NoCancel) || on(st.details?.ConfirmAction)) read.optional = true;
    read.cost.push(...c);
  }
  // the last "cost" left no payoff: it was the payoff ("You may rest 1 DON!!: trash 5 cards from the top of your deck", M5)
  if (read.next >= steps.length && undo && undo.costLen > 0) {
    read.cost.length = undo.costLen; read.gate.length = undo.gateLen; read.next = undo.next; read.optional = undo.optional;
  }
  // "③ … :" written inside the first payoff step (M5): the DON!! rest joins the cost
  const pay = steps[read.next];
  const circled = /[\u2460-\u2469\u2780-\u2789]/.exec(text);
  if (pay && num(pay.effect?.DonTap) > 0 && keysOn(pay.effect).length > 1 && circled
    && circledValue(circled[0]) === num(pay.effect?.DonTap) && !read.cost.some((c) => c.kind === "restDon")) {
    read.cost.unshift({ kind: "restDon", count: num(pay.effect?.DonTap) });
    const effect = { ...(pay.effect as Json) };
    delete effect.DonTap;
    steps[read.next] = { ...pay, effect };
  }
  if (read.cost.length === 0) fail(`a cost (":") that does not map onto IR costs: ${costShape(steps[read.next])}`);
  return read;
}

/** The text before the cost colon (reminders and [tags] removed). */
const beforeColon = (text: string): string => text.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").split(":")[0] ?? "";

/** How a cost item is worded before the ":" (a cost the text doesn't name is not one). */
const COST_WORDS: Partial<Record<string, RegExp>> = {
  restDon: /\brest\b|[\u2460-\u2469\u2780-\u2789]/i, returnDonToDeck: /DON!! ?[−-]|\breturn\b/i, restSelf: /\brest\b/i, trashSelf: /\btrash\b/i,
  trashFromHand: /\btrash\b|discard/i, trashFromLife: /\bLife\b/i, lifeToHand: /\bLife\b/i, handToDeckBottom: /\bdeck\b/i,
  returnToHand: /\breturn\b|\bhand\b/i, restFromField: /\brest\b/i,
  koTarget: /K\.O\./, returnToDeck: /\bdeck\b/i, discard: /\btrash\b/i, restTarget: /\brest\b/i, trashTarget: /\btrash\b|K\.O\./i,
  reveal: /\breveal\b/i, giveActiveDon: /\bgive\b/i, giveRestedDon: /\bgive\b/i, powerMod: /\bpower\b|[−+-]\d/i, mill: /\btrash\b|\bdeck\b/i,
  trashLife: /\bLife\b/i, flipLife: /face-(up|down)/i,
};
function costNamed(item: CostItem, before: string): boolean {
  if (item.kind === "oneOf") return item.options.some((o) => o.every((x) => costNamed(x, before)));
  const kind = item.kind === "action" ? item.action.kind : item.kind;
  const rx = COST_WORDS[kind];
  return !rx || rx.test(before);
}

/** ①–⑩ / ➀–➉ (the card text uses both) → the number. */
const circledValue = (ch: string): number => {
  const c = ch.charCodeAt(0);
  return c >= 0x2780 ? c - 0x2780 + 1 : c - 0x2460 + 1;
};

/** Cost keys a step may carry next to its payoff, with how the text before the ":" names them. */
const COST_SPLIT: Record<string, RegExp> = {
  RestSelf: /\brest this\b/i, TrashSelf: /\btrash this\b/i, FlipTopLifeUp: /face-up/i,
  TakeTopLife: /\bLife\b/i, TrashTopLife: /\bLife\b/i,
  DonTap: /[\u2460-\u2469\u2780-\u2789]|\brest \d+ of your DON/i, DonMinus: /DON!! ?[−-]\d/,
};

/** A step holding both the cost (named before the ":") and the payoff → the two parts. */
function splitCostStep(st: OptcgStep, text: string, a: AbilityCtx): { cost: CostItem[]; payoff: OptcgStep } | null {
  const before = text.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").split(":")[0] ?? "";
  const keys = keysOn(st.effect);
  const costKeys = keys.filter((k) => COST_SPLIT[k]?.test(before));
  if (costKeys.length === 0 || costKeys.length === keys.length) return null;
  const pick = (ks: string[]): Json => Object.fromEntries(ks.map((k) => [k, (st.effect as Json)[k]]));
  const cost = costOf({ ...st, effect: pick(costKeys), target: undefined }, a, true);
  if (!cost) return null;
  return { cost, payoff: { ...st, effect: pick(keys.filter((k) => !costKeys.includes(k))) } };
}

/** "EffectKey@zone[+filter keys]" of the step that stopped the cost reading (diagnostics). */
function costShape(st: OptcgStep | undefined): string {
  if (!st) return "(no step)";
  const spec = st.target?.[0];
  const zone = spec ? Object.keys(spec).filter((k) => on(spec[k]) && /Card$|Character$|^Leader$|Don$/.test(k)).join("+") : "";
  return `${keysOn(st.effect).join("+") || "(none)"}${zone ? `@${zone}` : ""}`;
}

/** Drop conditions that only restate a cost's feasibility (life for a Life
 *  cost, hand for a hand cost), and duplicates. */
function tidyConditions(conds: Condition[], cost: CostItem[]): Condition[] {
  const implied = (c: Condition) =>
    (c.kind === "lifeAtLeast" && c.who === "self" && cost.some((x) => (x.kind === "lifeToHand" || x.kind === "trashFromLife") && x.count >= c.count))
    || (c.kind === "handAtLeast" && c.who === "self" && cost.some((x) => (x.kind === "trashFromHand" && x.sel.count >= c.count) || (x.kind === "handToDeckBottom" && x.count >= c.count)));
  const seen = new Set<string>();
  return conds.filter((c) => {
    const key = JSON.stringify(c);
    if (implied(c) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Cross-check against the printed text: when optcg-ai's data contradicts
 *  it, the ability goes to "resolve manually" instead of doing the wrong thing. */
function checkAgainstText(guardText: string, conds: Condition[], actions: Action[], cost: CostItem[]): void {
  const ir = JSON.stringify(actions);
  if (/\bif your Leader (is \[|has the \{|is multicolou?red)/i.test(guardText) && !JSON.stringify([conds, actions]).includes("leaderIs")) {
    // the text wins (M5): a Leader condition opening the payoff gates the whole effect
    const m = /(?:^|:\s*)(?:\[[^\]]*\]\s*)*If your Leader (?:is \[([^\]]+)\]|has the \{([^}]+)\} type), /.exec(guardText);
    const tail = m ? guardText.slice(m.index + m[0].length) : "";
    if (!m || /\bif your Leader\b/i.test(tail)) return fail("the text has a Leader condition the effect data lacks");
    conds.push({ kind: "leaderIs", filter: m[1] ? { nameIncludes: [m[1]] } : { typeIncludes: [m[2]] } });
  }
  if (/Leader or Character/.test(guardText) && !/leaderOrCharacter|"zone":"leader"/.test(JSON.stringify([actions, cost])) && /"zone":"characterArea"/.test(ir)) {
    // "up to 1 of your {X} type Leader or Character cards gains …" (M5): one own selector, the text wins
    const own = actions.filter((x) => "sel" in x && x.sel.zone === "characterArea");
    const m = /up to 1 of your (?:\{[^}]+\} type )?Leader or Character cards gains/i.test(guardText);
    if (m && own.length === 1 && actions.length === own.length && "sel" in own[0] && own[0].sel.owner === "self" && own[0].kind === "powerMod") own[0].sel.zone = "leaderOrCharacter";
    else fail("the text names \"Leader or Character\" targets the effect data lacks");
  }
  if (!/opponent/i.test(guardText) && /"owner":"opponent"/.test(ir)) {
    // "Place / return up to 1 Character … to the owner's deck / hand" (M5): any player's Character — the text wins
    const anyOwner = (a: Action): boolean => ["returnToDeck", "returnToHand", "koTarget"].includes(a.kind) && "sel" in a
      && a.sel.owner === "opponent" && a.sel.zone === "characterArea";
    const flat = actions.flatMap((a) => (a.kind === "ifThen" ? [...a.then, ...(a.else ?? [])] : [a]));
    const opp = flat.filter((a) => "sel" in a && a.sel.owner === "opponent");
    if (/\bthe owner's (deck|hand)\b/i.test(guardText) && opp.length > 0 && opp.every(anyOwner)) {
      for (const a of opp) if ("sel" in a) a.sel.owner = "any";
    } else fail("the effect data targets the opponent's cards; the text does not");
  }
}

/** M5 event timings: which events the ability answers ("2 or more DON!!",
 *  "by your effect", "by your opponent's effect"). The printed text wins. */
function reactOf(ab: OptcgAbility, timing: Timing, text: string, a: AbilityCtx): Effect["react"] | null {
  const p = ab.proc;
  const watched = watchedOf(p, timing, text, a);
  if (watched) return watched;
  if (timing === "onYourDonReturned") {
    const r: NonNullable<Effect["react"]> = {};
    if (num(p.XMyDonIsReturned) > 1) r.minCount = num(p.XMyDonIsReturned);
    if (on(p.MyDonIsReturnedMyEffects) || /returned to your DON!! deck by your effect/i.test(text)) r.by = "you";
    return r;
  }
  if (timing === "onKOByEffect") {
    const opp = on(p.OnlyOppActions) || /by your opponent's effect/i.test(text);
    return opp ? { by: "opponent" } : { byEffect: true };
  }
  if (timing === "onLifeRemoved" && on(p.OppLosesLife)) {
    if (!/When a card is removed from your opponent's Life cards/i.test(text)) fail("opponent's Life removal without its text");
    return { whose: "opponents" };
  }
  if (timing === "onTriggerActivated") {
    const mine = on(p.YouActivateTrigger), theirs = on(p.OppActivatesTrigger);
    if (mine && theirs) return {};
    return mine ? { whose: "yours" } : { whose: "opponents" };
  }
  if (timing === "onRested" && (on(p.OnRestByOpponent) || /rested by your opponent's/i.test(text))) return { by: "opponent" };
  if (on(p.OnlyOppActions)) fail("OnlyOppActions outside a K.O. by effect");
  return null;
}

/** Watching timings (M5): whose card, which cards, whose effect. */
function watchedOf(p: Json, timing: Timing, text: string, a: AbilityCtx): Effect["react"] | null {
  const types = (key: string): string[] => [...new Set(list<number>(p[key]).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`)))];
  const chars = (key: string): SelectorFilter => {
    const f: SelectorFilter = { category: ["Character"] };
    const t = types(key);
    if (t.length > 0) f.typeIncludes = t;
    return f;
  };
  const byOpp = /by your opponent's effect/i.test(text);
  switch (timing) {
    case "onCharacterKOd": {
      if (p.MatchingTargetSpec) { // "When one of your Characters with the <Wisdom> attribute and without [Blocker] is K.O.'d" (M5)
        const { DeployedCharacter: _d, FriendlyOnly: _f, ...spec } = p.MatchingTargetSpec as Json;
        return { whose: "yours", filter: { category: ["Character"], ...filterOf(spec, a) } };
      }
      if (Array.isArray(p.YourCharacterKOd) || p.YourCharacterKOd === 1) {
        const filter: SelectorFilter = p.YourCharacterKOd === 1 ? { category: ["Character"] } : chars("YourCharacterKOd");
        if (num(p.YourCharacterOriginalPowerXOrMoreKOd) > 0) filter.basePowerAtLeast = num(p.YourCharacterOriginalPowerXOrMoreKOd);
        return { whose: "yours", filter };
      }
      return { filter: { category: ["Character"] } }; // AnyCharacterKOd
    }
    case "onCharacterRemoved":
      if (on(p.YouRemovedCharacter)) return { by: "you", filter: { category: ["Character"] } };
      return { whose: "yours", filter: chars("YourCharacterRemoved"), ...(byOpp || on(p.OnlyOppActions) ? { by: "opponent" as const } : { byEffect: true }) };
    case "onCharacterRestedBy": return { by: "you", filter: { category: ["Character"] } };
    case "onCharacterBounced":
      if (!/When your opponent's Character is returned to the owner's hand by your effect/i.test(text)) fail("YouBouncedOppCharacter without its text");
      return { by: "you", whose: "opponents", filter: { category: ["Character"] } };
    case "onYouPlayCharacter":
      if (p.YouDeployedFromTrash !== undefined) return { whose: "yours", fromTrash: true, filter: chars("YouDeployedFromTrash") };
      // "when your opponent plays a Character with a base cost of 8 or more, or … using a Character's effect" (M5)
      if (p.OppDeploysOriginalCostXOrMore !== undefined || on(p.OppDeploysThroughCharacter)) {
        const n = num(p.OppDeploysOriginalCostXOrMore);
        if (n && !new RegExp(`when your opponent plays a Character with a base cost of ${n} or more`, "i").test(text)) fail("OppDeploysOriginalCostXOrMore without its text");
        if (on(p.OppDeploysThroughCharacter) && !/when your opponent plays a Character using a Character's effect/i.test(text)) fail("OppDeploysThroughCharacter without its text");
        return { whose: "opponents", filter: n ? { category: ["Character"], baseCostAtLeast: n } : { category: ["Character"], baseCostAtLeast: 99 },
          ...(on(p.OppDeploysThroughCharacter) ? { orSourceFilter: { category: ["Character"] } } : {}) };
      }
      if (on(p.OppDeploys)) {
        if (!/When your opponent plays a Character/i.test(text)) fail("OppDeploys without its text");
        return { whose: "opponents", filter: { category: ["Character"] } };
      }
      if (on(p.YouDeployedTriggerCharacter)) {
        if (!/when you play a Character with a \[Trigger\]/i.test(text)) fail("YouDeployedTriggerCharacter without its text");
        return { whose: "yours", filter: { category: ["Character"], hasTrigger: true } };
      }
      return { whose: "yours", filter: { category: ["Character"] } };
    case "onHandTrashed":
      // "When a card is trashed from your hand by your {Navy} type card's effect" (M5)
      if (p.CardTrashedFromMyCategory !== undefined) {
        if (!/trashed from your hand by your \{[^}]+\} type card's effect/i.test(text)) fail("CardTrashedFromMyCategory without its text");
        return { whose: "yours", by: "you", sourceFilter: { typeIncludes: types("CardTrashedFromMyCategory") } };
      }
      return { whose: "yours", byEffect: true };
    default: return null;
  }
}

/** A triggered / activated ability → one Effect (or a manual one). */
export function triggeredEffect(card: OptcgCard, cat: CatalogCard | undefined, ab: OptcgAbility, timing: Timing,
  nth: number, a: AbilityCtx, res: AbilityResult): void {
  const text = abilityText(card, cat, timing, nth);
  const base: Effect = { timing, actions: [] };
  if (isOncePerTurn(card, ab, timing, text)) base.oncePerTurn = true;
  const react = reactOf(ab, timing, text, a);
  if (react) base.react = react;
  a.tailText = text;
  try {
    const conds = procConditions(ab.proc, a);
    const steps = payoffSteps(card, timing, ab.steps);
    // a delayed ("at the end of this turn") ability has no cost of its own:
    // the colon in its text belongs to the ability that scheduled it
    const { cost, gate, optional, next } = readCost(steps, timing === "delayed" ? "" : text, ab, a);
    let actions = sequence(steps, next, steps.length, a);
    if (actions.length === 0) fail("no executable step");
    const allConds = [...conds, ...gate];
    // a gate wrapping the whole payoff reads better (and is checked before the
    // cost is paid) as an activation condition (8-3-2)
    if (actions.length === 1 && actions[0].kind === "ifThen" && !actions[0].else) {
      allConds.push(...actions[0].if);
      actions = actions[0].then;
    }
    const finalConds = tidyConditions(allConds, cost);
    // "[Trigger] Activate this card's [Main] effect.": check against the card's whole text
    const guardText = /Activate this card's \[/.test(text) ? `${text}\n${cat?.effect ?? card.text}` : text;
    checkAgainstText(guardText, finalConds, actions, cost);
    const fx: Effect = { ...base, actions };
    if (finalConds.length > 0) fx.conditions = finalConds;
    if (cost.length > 0) fx.cost = cost;
    if (optional) fx.optional = true;
    res.effects.push(fx);
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    res.manual++;
    res.effects.push({ ...base, actions: [{ kind: "manual", text }] });
    res.approx.add(`${timing}: resolved by hand (${e.message})`);
  }
}
