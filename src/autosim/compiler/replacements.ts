/** Replacement abilities (`Pre*` proc keys) → an Effect with timing
 *  "replacement" (8-1-3-4, M5): `replaces` from the proc keys, the "instead"
 *  steps as its cost. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { CostItem, Effect, SelectorFilter } from "../ir/types";
import { ATTRIBUTES, COLORS, catalogNames } from "./catalogMaps";
import { procConditions, stepConditions } from "./conditions";
import { trashViewCost } from "./costActions";
import { costOf, lifeChoiceCost } from "./costs";
import { fail, keysOn, list, num, on } from "./dsl";
import { stepActions } from "./actions";
import type { AbilityCtx, AbilityResult, Json, OptcgAbility } from "./types";

type Ev = NonNullable<Effect["replaces"]>["events"][number];

const SELF_EVENTS: Record<string, Ev[]> = {
  PreKO: ["koBattle", "koEffect"], PreKOEffectOnly: ["koEffect"], PreKOCombatOnly: ["koBattle"],
  PreRestCharacterOnly: ["rest"], // M5
  PreBounce: ["bounce"], PreDeckBottom: ["deckBottom"], PreSendToBottomLife: ["life"], PreSendToTopLife: ["life"], PreTrash: ["trash"],
};
const ALLY_EVENTS: Record<string, Ev[]> = {
  PreAllyKO: ["koBattle", "koEffect"], PreAllyKOEffectOnly: ["koEffect"],
  PreCharacterKOEffectOnly: ["koEffect"], // M5: "If your Character [X] would be K.O.'d by an effect" (the names are the value)
  PreAllyBounce: ["bounce"], PreAllyDeckBottom: ["deckBottom"], PreAllySendToBottomLife: ["life"], PreAllySendToTopLife: ["life"], PreAllyTrash: ["trash"],
};
/** Proc keys that narrow the protected ally. */
function allyFilter(p: Json, a: AbilityCtx): SelectorFilter & { excludeSelf?: boolean } {
  const f: SelectorFilter = {};
  for (const k of keysOn(p)) {
    const v = p[k];
    switch (k) {
      case "PreAllyCategory": f.typeIncludes = [...new Set(list<number>(v).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`)))]; break;
      case "PreAllyColor": f.colors = list<number>(v).map((c) => COLORS[c] ?? fail(`color ${c}`)); break;
      case "PreAllyOriginalCostOrLower": f.baseCostAtMost = num(v); break;
      case "PreAllyOriginalCostOrMore": f.baseCostAtLeast = num(v); break;
      case "PreAllyOriginalPowerOrLower": f.basePowerAtMost = num(v); break;
      case "PreAllyOriginalPowerOrMore": f.basePowerAtLeast = num(v); break;
      case "PreAllyPowerOrMore": f.powerAtLeast = num(v); break;
      case "PreAllyCostOrLower": f.costAtMost = num(v); break;
      case "PreAllyNotNamed": f.nameExcludes = catalogNames(list<string>(v), a); break;
      case "PreAllyNamed": f.nameIncludes = catalogNames(list<string>(v), a); break;
      case "PreAllyRested": f.rested = true; break;
      case "PreAllyStrikeType": f.attributes = list<number>(v).map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`)); break;
      case "PreAllyNotSelf": f.excludeSelf = true; break;
      case "PreCharacterKOEffectOnly": if (Array.isArray(v)) f.nameIncludes = catalogNames(list<string>(v), a); break;
      default:
        if (/^Pre/.test(k) && !(k in SELF_EVENTS) && !(k in ALLY_EVENTS)) fail(`replacement ${k}`);
    }
  }
  return f;
}

/** Proc keys that are part of the replacement, not conditions. */
const isReplacementKey = (k: string) => /^Pre[A-Z]/.test(k) || k === "OnlyOppActions";

export function replacementEffect(ab: OptcgAbility, text: string, a: AbilityCtx, res: AbilityResult): void {
  const p = ab.proc;
  const selfEv = keysOn(p).flatMap((k) => SELF_EVENTS[k] ?? []);
  const allyEv = keysOn(p).flatMap((k) => ALLY_EVENTS[k] ?? []);
  if (selfEv.length === 0 && allyEv.length === 0) fail("replacement without a removal");
  const { excludeSelf, ...filter } = allyFilter(p, a);
  const replaces: NonNullable<Effect["replaces"]> = allyEv.length > 0
    ? { events: [...new Set([...allyEv, ...selfEv])], subject: "ally", ...(Object.keys(filter).length ? { filter } : {}), ...(excludeSelf ? { excludeSelf: true } : {}) }
    : { events: [...new Set(selfEv)], subject: "self" };
  if (on(p.OnlyOppActions) || /by your opponent's effect/i.test(text)) replaces.byOpponent = true;
  if (on(p.PreRestCharacterOnly)) {
    if (!/would be rested by your opponent's Character's effect/i.test(text)) fail("PreRestCharacterOnly without its text");
    replaces.byOpponent = true;
    a.approx.add("\"by your opponent's Character's effect\" answers any effect of the opponent");
  }

  // the remaining proc keys are ordinary conditions ([Opponent's Turn], Leader …)
  const rest: Json = {};
  for (const k of keysOn(p)) if (!isReplacementKey(k)) rest[k] = p[k];
  const conds = procConditions(rest, a);

  // the "instead" steps are the cost: all of it must be possible (8-3-1-3)
  const cost: CostItem[] = [];
  let optional = /you may/i.test(text);
  const steps = [...ab.steps];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (keysOn(st.effect).length === 0 && !st.target) {
      if (on(st.details?.ConfirmAction)) optional = true;
      conds.push(...stepConditions(st.details, a));
      continue;
    }
    // "trash 1 card from the top or bottom of your Life cards instead" (M5)
    if (Array.isArray(st.effect?.Choices)) {
      const lc = lifeChoiceCost(steps, i);
      if (!lc) fail("replacement with a choice");
      conds.push(...stepConditions(st.details, a));
      cost.push(...lc!.cost);
      i = lc!.next - 1;
      continue;
    }
    // "you may give that Character −1000 power during this turn instead of that Character being K.O.'d" (M5)
    if (keysOn(st.effect).join() === "BuffPreAlly") {
      const m = /you may give that Character −(\d+) power during this turn instead/i.exec(text);
      if (!m) fail("BuffPreAlly without its text");
      cost.push({ kind: "action", action: { kind: "powerMod", amount: -Number(m![1]), duration: "thisTurn", sel: { owner: "self", zone: "characterArea", count: 1, prev: true, chooser: "controller" } } });
      continue;
    }
    // "you may add it to the top of your Life cards face-down instead" (M5): the protected card
    if (keysOn(st.effect).join() === "SendPreAllyToTopLife" && /add it to the top of your Life cards face-down instead/i.test(text)) {
      cost.push({ kind: "action", action: { kind: "addToLife", sel: { owner: "self", zone: "characterArea", count: 1, prev: true, chooser: "controller" } } });
      continue;
    }
    // "ImmuneToNoncombat" next to the "instead" payment is only the protection itself
    if (keysOn(st.effect).includes("ImmuneToNoncombat") && keysOn(st.effect).length > 1) {
      const effect = { ...(st.effect ?? {}) } as Json;
      delete effect.ImmuneToNoncombat;
      steps[i] = { ...st, effect };
      i--;
      continue;
    }
    const tv = trashViewCost(steps, i, a);
    if (tv) { cost.push(...(tv.riders ?? []), tv.cost); i = tv.next - 1; continue; }
    const c = costOf(st, a, true);
    if (c) { cost.push(...c); continue; }
    // any other action done in full ("rest 1 of your opponent's Characters instead")
    for (const act of stepActions({ ...st, details: { ...(st.details ?? {}), FullTargetsRequired: [0] } }, a)) {
      if ("sel" in act) delete act.sel.upTo;
      cost.push({ kind: "action", action: act });
    }
  }
  // "Once per turn, this Character cannot be K.O.'d by your opponent's effects." (M5): nothing to pay
  const immunity = cost.length === 0 && /Once per turn, this Character cannot be K\.O\.'d by (your opponent's )?effects/i.test(text);
  // "all of your yellow {Scientist} type Characters cannot be removed from the field by your opponent's effects" (M5): a static immunity
  if (cost.length === 0 && replaces.subject === "ally" && replaces.byOpponent && /all of your [^.]*Characters cannot be removed from the field by your opponent's effects/i.test(text)) {
    res.effects.push({ timing: "static", ...(conds.length ? { conditions: conds } : {}), actions: [{ kind: "restriction", what: "cannotBeRemovedByOpponent", duration: "permanentWhileInPlay",
      sel: { owner: "self", zone: "characterArea", count: 99, chooser: "controller", ...(replaces.filter ? { filter: replaces.filter } : {}) } }] });
    return;
  }
  if (cost.length === 0 && !immunity) fail("replacement without an \"instead\"");
  if (immunity) optional = false;
  const fx: Effect = { timing: "replacement", replaces, actions: [], cost };
  if (conds.length > 0) fx.conditions = conds;
  if (/once per turn/i.test(text) || on(p.OncePerTurn)) fx.oncePerTurn = true;
  if (optional) fx.optional = true;
  res.effects.push(fx);
}
