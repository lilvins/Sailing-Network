/** proc / step condition keys that map onto the M5 general conditions:
 *  `compare`, `anyOf`, `selfMatches`, `ownTurnAtLeast` and the new filter
 *  fields. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { CompareOp, Condition, Quantity, Selector, SelectorFilter } from "../ir/types";
import { ATTRIBUTES, catalogNames, COLORS } from "./catalogMaps";
import { fail, list, num } from "./dsl";
import type { AbilityCtx, Json } from "./types";


const q = (count: Quantity["count"], who: Quantity["who"], plus?: number): Quantity => (plus ? { count, who, plus } : { count, who });
const cmp = (left: Quantity, op: CompareOp, right: Quantity | number): Condition => ({ kind: "compare", left, op, right });

const zone = (z: Selector["zone"], owner: Selector["owner"], filter?: SelectorFilter): Selector =>
  ({ owner, zone: z, count: 99, chooser: "controller", ...(filter ? { filter } : {}) });
const atLeast = (sel: Selector, n: number): Condition => ({ kind: "countInZone", sel, atLeast: n });
const atMost = (sel: Selector, n: number): Condition => ({ kind: "countInZone", sel, atMost: n });

const typesOf = (ids: number[], a: AbilityCtx): string[] =>
  [...new Set(ids.flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`)))];
const attributesOf = (ids: number[]): string[] => ids.map((id) => ATTRIBUTES[id] ?? fail(`attribute ${id}`));
const leaderIs = (filter: SelectorFilter): Condition => ({ kind: "leaderIs", filter });

/** "there is a Character with a cost of …" vs "you have …" / "your opponent
 *  has …": optcg-ai stores all three under one key; the printed text decides. */
function existsOwner(a: AbilityCtx, what: string): Selector["owner"] {
  const t = a.card.text ?? "";
  const found = ([["any", "there is"], ["self", "you have"], ["opponent", "your opponent has"]] as const)
    .filter(([, lead]) => new RegExp(`${lead} a Character with ${what}`, "i").test(t))
    .map(([o]) => o);
  if (found.length !== 1) return fail(`"a Character with ${what}": owner unclear in the text`);
  return found[0];
}

/** `{eCategory, iCount}` structs used by several keys. */
interface CategoryCount { eCategory: number; iCount: number }
/** `{sString, iCount}` structs (name + threshold). */
interface NameCount { sString: string; iCount: number }

/** One condition key → IR condition(s); undefined = not a key this table knows. */
export function extraCondition(key: string, v: unknown, a: AbilityCtx, all: Json): Condition[] | undefined {
  const n = num(v);
  switch (key) {
    // ── comparisons between players / thresholds (compare) ──
    case "LessOrEqDon": return [cmp(q("donOnField", "self"), "le", q("donOnField", "opponent"))];
    case "LessDon": return [cmp(q("donOnField", "self"), "lt", q("donOnField", "opponent"))];
    case "DonXLessThanOpp": return [cmp(q("donOnField", "self", n), "le", q("donOnField", "opponent"))];
    case "DonXOrLess": return [cmp(q("donOnField", "self"), "le", n)];
    case "OppDonXOrLess": return [cmp(q("donOnField", "opponent"), "le", n)];
    case "EitherDonXOrMore": return [{ kind: "anyOf", conditions: [cmp(q("donOnField", "self"), "ge", n), cmp(q("donOnField", "opponent"), "ge", n)] }];
    case "SelfAttachedDon": return [cmp(q("donGiven", "self"), "ge", n)];
    case "OppAttachedDon": return [cmp(q("donGiven", "opponent"), "ge", n)];
    case "SelfRestedDon": return [cmp(q("donRested", "self"), "ge", n)];
    case "OppRestedDon": return [cmp(q("donRested", "opponent"), "ge", n)];
    case "LessThanXAvailableDon": return [cmp(q("donActive", "self"), "le", n)];
    case "LessLife": case "LifeLess": return [cmp(q("life", "self"), "lt", q("life", "opponent"))];
    case "LessOrEqLife": case "LifeLessOrEqual": return [cmp(q("life", "self"), "le", q("life", "opponent"))];
    case "CombinedLifeXOrLess": return [cmp(q("life", "both"), "le", n)];
    case "CombinedLifeXOrMore": return [cmp(q("life", "both"), "ge", n)];
    case "EitherPlayerZeroLife": return [{ kind: "anyOf", conditions: [cmp(q("life", "self"), "le", 0), cmp(q("life", "opponent"), "le", 0)] }];
    case "HandDiffXOrMore": return [cmp(q("hand", "self", n), "le", q("hand", "opponent"))];
    case "OppXMoreOrMoreCharacters": return [cmp(q("characters", "self", n), "le", q("characters", "opponent"))];
    case "SelfRestedCards": return [cmp(q("restedCards", "self"), "ge", n)];
    case "OppRestedCards": return [cmp(q("restedCards", "opponent"), "ge", n)];
    case "TrashEventsXOrLess": return [atMost(zone("trash", "self", { category: ["Event"] }), n)];

    // ── face-up / face-down Life (M5) ──
    case "FacedownLife": return [{ kind: "lifeTop", who: "self", faceUp: false }];
    case "FaceupLife": return [{ kind: "lifeTop", who: "self", faceUp: true }];
    case "AnyFaceupLife": return [atLeast(zone("life", "self", { faceUp: true }), 1)];
    case "AnyFacedownLife": return [atLeast(zone("life", "self", { faceUp: false }), 1)];

    // ── the Leader ──
    case "LeaderColorCountOrMore": {
      if (Array.isArray(all.OverrideLeaderColorCountName)) {
        const names = catalogNames(list<string>(all.OverrideLeaderColorCountName), a);
        return [{ kind: "anyOf", conditions: [leaderIs({ colorCountAtLeast: n }), leaderIs({ nameIncludes: names })] }];
      }
      return [leaderIs({ colorCountAtLeast: n })];
    }
    case "OverrideLeaderColorCountName": return [];
    case "LeaderColorCountOrLess": return [leaderIs({ colorCountAtMost: n })];
    case "LeaderHasColors": return [leaderIs({ colors: list<number>(v).map((c) => COLORS[c] ?? fail(`color ${c}`)) })];
    case "LeaderStrikeTypeRequired": return [leaderIs({ attributes: attributesOf(list<number>(v)) })];
    case "OpponentLeaderStrikeTypeRequired": return [atLeast(zone("leader", "opponent", { attributes: attributesOf(list<number>(v)) }), 1)];
    case "LeaderPowerXOrMore": return [atLeast(zone("leader", "self", { powerAtLeast: n }), 1)];
    case "LeaderPowerZero": return [atLeast(zone("leader", "self", { powerAtMost: 0 }), 1)];
    case "OppLeaderPowerXOrMore": return [atLeast(zone("leader", "opponent", { powerAtLeast: n }), 1)];
    case "LeaderNameIncludes": return [leaderIs({ nameIncludes: list<string>(v) })];

    // ── this card ──
    case "PowerXOrMore": return [{ kind: "selfMatches", filter: { powerAtLeast: n } }];
    case "MyCostXOrMore": return [{ kind: "selfMatches", filter: { costAtLeast: n } }];
    case "FirstTurnOnly": return [{ kind: "selfMatches", filter: { playedThisTurn: true } }];
    case "TurnXOrLater": return [{ kind: "ownTurnAtLeast", count: n }];

    // ── "there is a Character …" on either side ──
    case "CostZeroExists": return [atLeast(zone("characterArea", existsOwner(a, "a cost of 0"), { costAtMost: 0 }), 1)];
    case "OppCostZeroExists": return [atLeast(zone("characterArea", "opponent", { costAtMost: 0 }), 1)];
    case "CostXOrMoreExists": case "CharacterCostXOrMore":
      return [atLeast(zone("characterArea", existsOwner(a, `a cost of ${n} or more`), { costAtLeast: n }), 1)];
    case "CostXOrLessExists": return [atLeast(zone("characterArea", "any", { costAtMost: n }), 1)]; // feasibility of a "place 1 Character …" cost
    case "CostZeroOrXOrMoreExists":
      return [{ kind: "anyOf", conditions: [atLeast(zone("characterArea", "any", { costAtMost: 0 }), 1), atLeast(zone("characterArea", "any", { costAtLeast: n }), 1)] }];
    case "OppCostZeroOrXOrMoreExists":
      return [{ kind: "anyOf", conditions: [atLeast(zone("characterArea", "opponent", { costAtMost: 0 }), 1), atLeast(zone("characterArea", "opponent", { costAtLeast: n }), 1)] }];
    case "AnyPowerXOrMore": return [atLeast(zone("characterArea", existsOwner(a, `${n} power or more`), { powerAtLeast: n }), 1)];
    case "NoBaseXOrMore": return [atMost(zone("characterArea", "any", { basePowerAtLeast: n }), 0)];

    // ── your opponent's Characters ──
    case "OppPowerXOrMore": case "OppCharPowerXOrMore": return [atLeast(zone("characterArea", "opponent", { powerAtLeast: n }), 1)];
    case "OppCharBaseXOrMore": case "OppBasePowerXOrMore": return [atLeast(zone("characterArea", "opponent", { basePowerAtLeast: n }), 1)];
    case "OppAnyBaseXOrMore": return [atLeast(zone("leaderOrCharacter", "opponent", { basePowerAtLeast: n }), 1)];
    case "Opp2CharsBaseXOrMore": return [atLeast(zone("characterArea", "opponent", { basePowerAtLeast: n }), 2)];
    case "OppNo2CharsBaseXOrMore": return [atMost(zone("characterArea", "opponent", { basePowerAtLeast: n }), 1)];

    // ── your deck / DON!! ──
    case "DeckXOrLess": return [cmp(q("deck", "self"), "le", n)];
    case "NoActiveDon": return [cmp(q("donActive", "self"), "le", 0)];
    case "BoardLessThanCostX": return [atMost(zone("characterArea", "self", { costAtLeast: n }), 4)]; // "do not have 5 Characters with a cost of N or more"

    // ── your Characters ──
    case "OtherCharacterPowerXOrMore": return [atLeast(zone("characterArea", "self", { powerAtLeast: n, excludeSelf: true }), 1)];
    case "CharacterPowerXOrMore": return [atLeast(zone("characterArea", "self", { powerAtLeast: n }), 1)];
    case "CharacterBasePowerXOrMore": return [atLeast(zone("characterArea", "self", { basePowerAtLeast: n }), 1)];
    case "TwoCharacterBasePowerXOrMore": return [atLeast(zone("characterArea", "self", { basePowerAtLeast: n }), 2)];
    case "TwoCharacterBasePowerX": return [atLeast(zone("characterArea", "self", { basePowerAtLeast: n, basePowerAtMost: n }), 2)];
    case "SelfNo2CharsPowXOrMore": return [atMost(zone("characterArea", "self", { powerAtLeast: n }), 2)];
    case "SelfAnyBaseXOrMore": return [atLeast(zone("characterArea", "self", { basePowerAtLeast: n, excludeSelf: true }), 1)];
    case "SelfNoCharBaseXOrMore": return [atMost(zone("characterArea", "self", { basePowerAtLeast: n, excludeSelf: true }), 0)];
    case "AllyBaseCostOrMore": return [atLeast(zone("characterArea", "self", { baseCostAtLeast: n }), Math.max(1, num(all.AllyCostCount)))];
    case "NoAllyCostOrMore": return [atMost(zone("characterArea", "self", { costAtLeast: n }), 0)];
    case "AllyStageCostOrMore": return [atLeast(zone("stage", "self", { costAtLeast: n }), 1)];
    case "FieldIsOnlyCategory": {
      const types = typesOf(list<number>(v), a);
      return [atLeast(zone("characterArea", "self"), 1), atMost(zone("characterArea", "self", { typeExcludes: types }), 0)];
    }
    case "AnotherCharacterOfCategory": {
      const filter: SelectorFilter = { typeIncludes: typesOf(list<number>(v), a), excludeSelf: true };
      if (Array.isArray(all.ACOCColorReq)) filter.colors = list<number>(all.ACOCColorReq).map((c) => COLORS[c] ?? fail(`color ${c}`));
      return [atLeast(zone("characterArea", "self", filter), 1)];
    }
    case "ACOCColorReq": case "AnotherCharacterAllowSameCard": return [];
    case "SelfCharacterCategory": {
      const s = v as CategoryCount;
      return [atLeast(zone("characterArea", "self", { typeIncludes: typesOf([s.eCategory], a) }), s.iCount)];
    }
    case "SelfRestedCharacterCategory": {
      const s = v as CategoryCount;
      return [atLeast(zone("characterArea", "self", { typeIncludes: typesOf([s.eCategory], a), rested: true }), s.iCount)];
    }
    case "CharacterCategoryXPowerOrMore": {
      const s = v as CategoryCount;
      const extra = list<number>(all.AddlCharacterCategoryXPowerOrMore);
      return [atLeast(zone("characterArea", "self", { typeIncludes: typesOf([s.eCategory, ...extra], a), powerAtLeast: s.iCount }), 1)];
    }
    case "AddlCharacterCategoryXPowerOrMore": return [];
    case "CharacterCategoryXCostOrMore": case "CostXOrHigherCharacterCategory": {
      const s = v as CategoryCount;
      return [atLeast(zone("characterArea", "self", { typeIncludes: typesOf([s.eCategory], a), costAtLeast: s.iCount }), 1)];
    }
    case "NotCharacterCategoryXCostOrMore":
      return list<CategoryCount>(v).map((s) => atMost(zone("characterArea", "self", { typeIncludes: typesOf([s.eCategory], a), costAtLeast: s.iCount }), 0));

    // ── names on your field ──
    case "NameOwned": return [atLeast(zone("leaderOrCharacter", "self", { nameIncludes: catalogNames(list<string>(v), a), excludeSelf: true }), 1)];
    case "NameIsRested": return [atLeast(zone("leaderOrCharacter", "self", { nameIncludes: catalogNames(list<string>(v), a), rested: true }), 1)];
    case "NamesWithBasePowerInYourDeploy":
      return [{ kind: "anyOf", conditions: list<NameCount>(v).map((s) => atLeast(zone("characterArea", "self", { nameIncludes: catalogNames([s.sString], a), basePowerAtLeast: s.iCount }), 1)) }];
    case "NamesWithPowerOnYourSide":
      return [{ kind: "anyOf", conditions: list<NameCount>(v).map((s) => atLeast(zone("leaderOrCharacter", "self", { nameIncludes: catalogNames([s.sString], a), powerAtLeast: s.iCount }), 1)) }];
    case "NamesInYourTrash":
      return catalogNames(list<string>(v), a).map((name) => atLeast(zone("trash", "self", { nameIncludes: [name] }), 1));
    default: return undefined;
  }
}
