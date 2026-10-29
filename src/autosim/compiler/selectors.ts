/** actionV3 target specs → IR Selector (zone, owner, count, filter). (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Quantity, Selector, SelectorFilter } from "../ir/types";
import { ATTRIBUTES, CARD_TYPES, COLORS, catalogNames } from "./catalogMaps";
import { fail, keysOn, list, num, on } from "./dsl";
import type { AbilityCtx, Json, OptcgCard } from "./types";

export const selfZone = (card: OptcgCard): Selector["zone"] =>
  card.type === "Leader" ? "leader" : card.type === "Stage" ? "stage" : "characterArea";

export function ownerOf(spec: Json, a: AbilityCtx): Selector["owner"] {
  const friendly = on(spec.FriendlyOnly), enemy = on(spec.EnemyOnly);
  if (friendly === enemy) return "any";
  const mine = friendly !== a.flipped;
  return mine ? "self" : "opponent";
}

/** Filter keys of a target spec → SelectorFilter (throws on anything the IR
 *  can't express). `zoneKeys` are handled by the caller. */
export const ZONE_KEYS = new Set(["DeployedCharacter", "HandCard", "TopDeckCard", "Leader", "StageCard", "DonAreaCard",
  "LifeCard", "TrashCard", "AttachedDon", "DeckCard"]);
export const IGNORED_SPEC_KEYS = new Set(["FriendlyOnly", "EnemyOnly", "TargetCount", "OverrideUITargetCount",
  "WillBeRemoved", "AutoAllMatchingTargets",
  // set constraints, read by selectorOf
  "CombinedCostXOrLess", "CombinedPowerXOrLess", "NoDuplicateNames",
  // the alternative target, read by selectorOf
  "OrTarget"]);

/** "with a cost equal to or less than the number of …": the key, the
 *  quantity, and the printed phrase that must back it (the data has strays). */
const DYNAMIC_COST: Record<string, [Quantity, RegExp]> = {
  CostOppLifeOrLess: [{ count: "life", who: "opponent" }, /number of your opponent's Life cards/i],
  CostCombinedLifeOrLess: [{ count: "life", who: "both" }, /total of your and your opponent's Life cards/i],
  CostDonOrLess: [{ count: "donOnField", who: "self" }, /number of DON!! cards on your field/i],
  CostOppDonOrLess: [{ count: "donOnField", who: "opponent" }, /number of DON!! cards on your opponent's field/i],
  CostMyLifeOrLess: [{ count: "life", who: "self" }, /your number of Life cards|number of your Life cards/i],
};

/** Constraints that stay on the "or" side of NameOverrides / ColoredEventOverrides. */
const OR_KEEPS: (keyof SelectorFilter)[] = ["costAtMost", "costAtLeast", "baseCostAtMost", "baseCostAtLeast", "costAtMostQ",
  "excludeSelf", "rested", "nameExcludes"];

export function filterOf(spec: Json, a: AbilityCtx): SelectorFilter {
  const f: SelectorFilter = {};
  for (const k of keysOn(spec)) {
    if (ZONE_KEYS.has(k) || IGNORED_SPEC_KEYS.has(k)) continue;
    const v = spec[k];
    switch (k) {
      case "CostOrLess": f.costAtMost = Math.min(f.costAtMost ?? Infinity, num(v)); break;
      case "CostOrMore": f.costAtLeast = Math.max(f.costAtLeast ?? -Infinity, num(v)); break;
      case "OriginalCostOrLess": f.baseCostAtMost = Math.min(f.baseCostAtMost ?? Infinity, num(v)); break;
      case "OriginalCostOrMore": f.baseCostAtLeast = Math.max(f.baseCostAtLeast ?? -Infinity, num(v)); break;
      case "CostZero": f.costAtMost = 0; break;
      case "PowerXOrLess": f.powerAtMost = num(v); break;
      case "PowerXOrMore": f.powerAtLeast = num(v); break;
      case "PowerZero": f.powerAtMost = 0; break;
      case "OriginalPowerXOrLess": f.basePowerAtMost = num(v); break;
      case "CostEqualGivenDon": f.costEqualsGivenDon = true; break; // M5
      case "NotBlocker": f.lacksKeyword = "Blocker"; break; // M5: "without [Blocker]"
      case "OriginalPowerXOrMore": f.basePowerAtLeast = num(v); break;
      case "OnlyCategories": {
        if (on(spec.RequireAllCategories)) fail("RequireAllCategories");
        const types = list<number>(v).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`));
        f.typeIncludes = [...new Set(types)];
        break;
      }
      case "OnlyTypes": f.category = list<number>(v).map((t) => CARD_TYPES[t] ?? fail(`card type ${t}`)); break;
      case "OnlyColors": f.colors = list<number>(v).map((c) => COLORS[c] ?? fail(`color ${c}`)); break;
      case "OnlyNames": f.nameIncludes = catalogNames(list<string>(v), a); break;
      case "NotNames": f.nameExcludes = catalogNames(list<string>(v), a); break;
      case "NotSelf": f.excludeSelf = true; break;
      case "RestedOnly": f.rested = true; break;
      case "ActiveOnly": f.rested = false; break;
      case "HasBlocker": f.hasKeyword = "Blocker"; break;
      case "GivenDon": f.donGivenAtLeast = num(v); break;
      case "HasNoEffects": f.noBaseEffect = true; break;
      case "HasNoOnPlay": f.lacksTiming = "onPlay"; break;
      case "HasNoOnAttack": f.lacksTiming = "whenAttacking"; break;
      case "HasActivateMain": f.hasTiming = "main"; break; // an Event's [Main]
      case "BasePowerZero": f.basePowerAtMost = 0; break;
      case "StrikeTypeOverrides": break; // after the loop
      case "NameOverrides": case "ColoredEventOverrides": break; // after the loop
      case "CostOppLifeOrLess": case "CostCombinedLifeOrLess": case "CostDonOrLess": case "CostOppDonOrLess": case "CostMyLifeOrLess": {
        const [q, phrase] = DYNAMIC_COST[k];
        if (!phrase.test(a.tailText ?? "")) fail(`${k} without the printed phrase`);
        f.costAtMostQ = a.flipped ? { ...q, who: q.who === "self" ? "opponent" : q.who === "opponent" ? "self" : q.who } : q;
        break;
      }
      case "HasTrigger": f.hasTrigger = true; break;
      case "DifferentColorFromPrevTarget": f.otherColorThanPrev = true; break;
      case "TargetCountHandOverflow": break; // read by the TrashCard builder (keepInHand)
      // "up to 1 … cost X or less and up to 1 … cost Y or less" written as two picks:
      // the first pick reads X, the second (CheckPrevTarget) Y — the player picks the order (M5)
      case "SecondCostOrLess":
        if (on(spec.SecondCostOrLessCheckPrevTarget)) {
          f.costAtMost = Math.min(f.costAtMost ?? Infinity, num(v));
          if (/the other card rested/i.test(a.tailText ?? "")) a.approx.add("the lower-cost pick is the one played rested");
        }
        else if (num(spec.TargetCount) !== 1) fail(`target key ${k}`);
        break;
      case "SecondCostOrLessCheckPrevTarget": break;
      case "OnlyStrikeTypes": f.attributes = list<number>(v).map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`)); break;
      default: fail(`target key ${k}`);
    }
  }
  return withOverrides(f, spec, a);
}

/** "… or [Name]" / "… or Event card": a second filter a card may match instead. */
function withOverrides(f: SelectorFilter, spec: Json, a: AbilityCtx): SelectorFilter {
  const names = list<string>(spec.NameOverrides);
  const eventColors = list<number>(spec.ColoredEventOverrides);
  const strikes = list<number>(spec.StrikeTypeOverrides);
  if (strikes.length > 0) {
    // "{X} type or <Slash> attribute Character card": the attribute replaces the type only
    if (names.length > 0 || eventColors.length > 0) fail("several overrides");
    const { typeIncludes: _t, ...others } = f;
    return { ...f, or: { ...others, attributes: strikes.map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`)) } };
  }
  if (names.length === 0 && eventColors.length === 0) return f;
  if (names.length > 0 && eventColors.length > 0) fail("NameOverrides + ColoredEventOverrides");
  const or: SelectorFilter = {};
  for (const k of OR_KEEPS) if (f[k] !== undefined) (or as Record<string, unknown>)[k] = f[k];
  if (names.length > 0) or.nameIncludes = catalogNames(names, a);
  else {
    or.category = ["Event"];
    if (eventColors.length < COLORS.length) or.colors = eventColors.map((c) => COLORS[c] ?? fail(`color ${c}`));
  }
  return { ...f, or };
}

export function zoneOf(spec: Json): Selector["zone"] {
  const z = [...ZONE_KEYS].filter((k) => on(spec[k])).sort().join("+");
  switch (z) {
    case "DeployedCharacter": return "characterArea";
    case "Leader": return "leader";
    case "DeployedCharacter+Leader": return "leaderOrCharacter";
    case "Leader+StageCard": return "leaderOrStage";
    case "DeployedCharacter+StageCard": return "characterOrStage";
    case "DeployedCharacter+Leader+StageCard": return "field";
    case "StageCard": return "stage";
    case "HandCard": return "hand";
    case "TrashCard": return "trash";
    case "LifeCard": return "life";
    case "DonAreaCard": return "costArea";
    default: return fail(`target zone ${z || "(none)"}`);
  }
}

/** The event subject of a timing (AutoMainTarget, M5). */
const SUBJECT_OF: Partial<Record<string, { owner: Selector["owner"]; zone: Selector["zone"] }>> = {
  onYouPlayCharacter: { owner: "self", zone: "characterArea" },
  onYourOpponentsAttack: { owner: "opponent", zone: "leaderOrCharacter" },
  afterBattleWithCharacter: { owner: "opponent", zone: "characterArea" },
};

/** One target spec → Selector. `full` = exactly N (FullTargetsRequired / DON!! −N). */
export function selectorOf(spec: Json | undefined, a: AbilityCtx, full: boolean): Selector {
  if (!spec) return fail("missing target");
  const chooser: Selector["chooser"] = a.flipped ? "opponent" : "controller";
  if (on(spec.AutoSelf) || on(spec.OnlySelf)) {
    if (on(spec.OnlySelf) && !on(spec.AutoSelf) && spec.OrTarget) fail("OnlySelf or another target");
    const sel: Selector = { owner: a.flipped ? "opponent" : "self", zone: selfZone(a.card), count: 1, self: true, chooser };
    a.lastSel = sel;
    return sel;
  }
  if (on(spec.AutoCopyPreviousTargets) || on(spec.RequirePreviousTargets)) {
    if (!a.lastSel) fail("previous targets without a previous selection");
    if (on(spec.RequirePreviousTargets) && !on(spec.AutoCopyPreviousTargets)) a.approx.add("\"one of the previous targets\" binds to all of them");
    const prev = a.lastSel as Selector;
    return { owner: prev.owner, zone: prev.zone, count: prev.count, prev: true, chooser };
  }
  if (on(spec.AutoMainTarget) && !on(spec.NoUsingPreviousTargets)) {
    // "that Character" = the card the event was about (M5): the played Character,
    // the attacking card — the engine binds it as the effect's first previous target
    const subject = SUBJECT_OF[a.timing];
    if (!subject) return fail("previous/main-target binding");
    const sel: Selector = { owner: subject.owner, zone: subject.zone, count: 1, prev: true, chooser };
    const f = filterOf({ ...spec, AutoMainTarget: undefined }, a);
    if (Object.keys(f).length > 0) sel.filter = f;
    a.lastSel = sel;
    return sel;
  }
  if (on(spec.NoUsingPreviousTargets) || on(spec.AutoMainTarget)) fail("previous/main-target binding");
  const zone = zoneOf(spec);
  const filter = filterOf(spec, a);
  const all = on(spec.AutoAllMatchingTargets);
  const raw = spec.TargetCountHandOverflow !== undefined ? 99 : num(spec.TargetCount);
  const count = all || raw === 0 || raw >= 10 ? 99 : raw;
  const sel: Selector = { owner: ownerOf(spec, a), zone, count, chooser };
  if (Object.keys(filter).length > 0) sel.filter = filter;
  // set constraints (M5): "with a total cost / power of N or less", "different names"
  if (spec.CombinedCostXOrLess !== undefined) sel.totalCostAtMost = num(spec.CombinedCostXOrLess);
  if (spec.CombinedPowerXOrLess !== undefined) sel.totalPowerAtMost = num(spec.CombinedPowerXOrLess);
  if (on(spec.NoDuplicateNames)) {
    if (count === 1) fail("different names across separate picks");
    sel.distinctNames = true;
  }
  if (!all && !full) sel.upTo = true;
  if (spec.OrTarget) orTarget(sel, spec, spec.OrTarget as Json, a);
  a.lastSel = sel;
  return sel;
}

const ZONE_CATEGORY: Partial<Record<Selector["zone"], NonNullable<SelectorFilter["category"]>>> = {
  characterArea: ["Character"], leader: ["Leader"], stage: ["Stage"],
};
const UNION_ZONE: Record<string, Selector["zone"]> = {
  "characterArea+leader": "leaderOrCharacter", "characterArea+stage": "characterOrStage", "leader+stage": "leaderOrStage",
};

/** "Rest up to 1 of your Leader or 1 [Corrida Coliseum]" — the data's
 *  alternative target spec (targetOverrides, M5): the union of the zones, a
 *  card matching either side's filter. */
function orTarget(sel: Selector, spec: Json, alt: Json, a: AbilityCtx): void {
  if (on(spec.FriendlyOnly) !== on(alt.FriendlyOnly) || on(spec.EnemyOnly) !== on(alt.EnemyOnly)) fail("alternative target of the other player");
  const zb = zoneOf(alt);
  const side = (z: Selector["zone"], f: SelectorFilter, other: Selector["zone"]): SelectorFilter => {
    if (z === other || f.category || z === unionOf(z, other)) return f;
    const cat = ZONE_CATEGORY[z] ?? fail(`alternative target in ${z}`);
    return { ...f, category: cat };
  };
  const fa = sel.filter ?? {};
  const fb = filterOf({ ...alt, OrTarget: undefined }, a);
  if (fa.or || fb.or) fail("alternative target with its own overrides");
  // "… Character card that is either [Perona] or has the attribute": the card type holds for both
  if (zb === sel.zone && fa.category && !fb.category) fb.category = fa.category;
  const own = sel.zone;
  sel.zone = unionOf(own, zb);
  sel.filter = { ...side(zoneFor(sel.zone, spec), fa, zb), or: side(zb, fb, zoneFor(sel.zone, spec)) };
}
const unionOf = (x: Selector["zone"], y: Selector["zone"]): Selector["zone"] => {
  if (x === y) return x;
  if (x === "leaderOrCharacter" && (y === "characterArea" || y === "leader")) return x;
  if (y === "leaderOrCharacter" && (x === "characterArea" || x === "leader")) return y;
  return UNION_ZONE[[x, y].sort().join("+")] ?? fail(`alternative target ${x} or ${y}`);
};
/** The zone of the spec's own side (before the union). */
const zoneFor = (_union: Selector["zone"], spec: Json): Selector["zone"] => zoneOf({ ...spec, OrTarget: undefined });
