/**
 * optcg-ai → AUTOSIM IR compiler (AUTOSIM_PLAN.md §6, "M5 — copertura totale").
 *
 * Translates the card effects of the optcg-ai engine (the optcgwebsim
 * "actionV3" step language: `proc` + `steps`, documented in optcg-ai
 * `docs/effect-dsl/`) into AUTOSIM `CompiledCard`s. Pure and deterministic:
 * data in, IR out — no Node APIs, no I/O (the generator lives in
 * `__tests__/m5-optcg.test.ts`, which also guards the committed output
 * against drift).
 *
 * Principle (plan §1.3, "degradazione elegante"): never invent semantics.
 * An ability is compiled only when every part of it maps onto the IR with
 * the same meaning; otherwise it becomes a `manual` action carrying the
 * card's own text for that ability (the engine opens "resolve manually"),
 * or — when the IR has no timing for it at all — it is dropped and listed in
 * the card notes. Known approximations are listed per card in `notes`.
 *
 * Source precedence in the app (board-auto `compiledFor`): the hand-curated
 * batch (ST01+OP01) first, then this generated batch, then the text
 * heuristic fallback.
 */
import type {
  Action, Classification, CompiledCard, Condition, CostItem, Duration, Effect,
  Keyword, PeekDisposition, Selector, SelectorFilter, Timing,
} from "../ir/types";

// ─── input shapes (subset of optcg-ai src/engine/types.ts) ──────────────────

type Json = Record<string, unknown>;

export interface OptcgStep {
  effect?: Json;
  details?: Json;
  target?: Json[];
  targetOverrides?: Json[];
}

export interface OptcgAbility {
  proc: Json;
  steps: OptcgStep[];
}

export interface OptcgCard {
  id: string;
  name: string;
  type: "Leader" | "Character" | "Event" | "Stage";
  colors: number[];
  categories: number[];
  counter: number;
  abilities: OptcgAbility[];
  text: string;
}

/** The Sailing Network catalog card (public/data/cards.json), subset. */
export interface CatalogCard {
  id: string;
  category: string;
  types: string[];
  counter: number | null;
  effect: string | null;
  trigger: string | null;
}

export interface CompileContext {
  /** optcgwebsim CardCategory id → the catalog's type strings. */
  categoryTypes: Record<number, string[]>;
  /** optcgwebsim card name → the catalog's spelling ("Tony Tony Chopper" → "Tony Tony.Chopper"). */
  names: Record<string, string>;
}

/** Card names as the catalog spells them, learned from the shared ids. */
export function buildNameMap(optcg: Record<string, OptcgCard>, catalog: (CatalogCard & { name?: string })[]): Record<string, string> {
  const out: Record<string, string> = {};
  const byId = new Map(catalog.map((c) => [c.id, c]));
  for (const card of Object.values(optcg)) {
    const name = byId.get(card.id)?.name;
    if (name && name !== card.name && !(card.name in out)) out[card.name] = name;
  }
  return out;
}

const catalogNames = (names: string[], a: { ctx: CompileContext }) => names.map((n) => a.ctx.names[n] ?? n);

// ─── enums ──────────────────────────────────────────────────────────────────

const COLORS = ["Red", "Green", "Blue", "Purple", "Black", "Yellow"];
const CARD_TYPES = ["Leader", "Character", "Event", "Stage"] as const;

/** PascalCase enum names, for categories the catalog never shows (sets it
 *  doesn't have yet): "RedHairedPiratesAllies" → "Red Haired Pirates Allies". */
function spacedName(pascal: string): string {
  return pascal.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Category id → catalog type strings, learned from the cards both databases
 * share: the catalog types that appear on EVERY card carrying the id (ties
 * kept: optcgwebsim merges a few near-identical types, e.g. CP7/CP8).
 */
export function buildCategoryMap(
  optcg: Record<string, OptcgCard>,
  catalog: CatalogCard[],
  enumNames: Record<string, string>,
): Record<number, string[]> {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const counts = new Map<number, Map<string, number>>();
  for (const card of Object.values(optcg)) {
    const cat = byId.get(card.id);
    if (!cat) continue;
    for (const id of card.categories) {
      const m = counts.get(id) ?? new Map<string, number>();
      for (const t of cat.types) m.set(t, (m.get(t) ?? 0) + 1);
      counts.set(id, m);
    }
  }
  const out: Record<number, string[]> = {};
  for (const [idStr, name] of Object.entries(enumNames)) {
    const id = Number(idStr);
    const m = counts.get(id);
    if (!m || m.size === 0) { out[id] = [spacedName(name)]; continue; }
    const max = Math.max(...m.values());
    const tied = [...m.entries()].filter(([, n]) => n === max).map(([t]) => t).sort();
    // ties (every Admiral is also Navy): keep the type(s) the enum name spells
    const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const named = tied.filter((t) => flat(t).includes(flat(name)) || flat(name).includes(flat(t)));
    out[id] = named.length > 0 ? named : tied;
  }
  return out;
}

// ─── small helpers ──────────────────────────────────────────────────────────

class Unsupported extends Error {}
const fail = (why: string): never => { throw new Unsupported(why); };

const on = (v: unknown): boolean => v === true || (typeof v === "number" && v !== 0);
const num = (v: unknown): number => (typeof v === "number" ? v : v === true ? 1 : 0);
const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const keysOn = (o: Json | undefined): string[] => Object.keys(o ?? {}).filter((k) => {
  const v = (o as Json)[k];
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v !== "" : on(v) || (typeof v === "object" && v !== null);
});

/** Effect keys that only modify a sibling key (spec B §1.1). */
const MODIFIER_KEYS = new Set([
  "ForcedFaceUp", "DeploysRested", "NoLog", "DrawIsHidden", "AddToLifeIsHidden",
  "RevealTopDeckToOpponent", "LeaveLifeInPosition",
]);
/** Step-control `details` keys (no condition semantics). */
const CONTROL_KEYS = new Set([
  "NoCancel", "Required", "FullTargetsRequired", "EndAfterStep", "ConfirmAction",
  "SearchingDeck", "CanUseOnPlays",
]);
const VIEW_OPEN = ["StartTopDeck", "StartTopDeckOpp", "StartTopDeckFromTrash", "StartTopDeckFromHand",
  "StartTopDeckFromDeck", "StartTopDeckFromLifeAll", "StartTopDeckFromOppTrash", "StartTopDeckFromOppLifeAll",
  "StartTopDeckFromLife"];
const VIEW_CLOSE = ["TopDeckToDeckBottom", "TopDeckToDeckTop", "TrashTopDeck", "ShuffleDeck", "CleanUpTopDeck",
  "TopDeckToLife", "TopDeckToOppLife"];

/** Timings that happen during the controller's own turn (for "until the end
 *  of the owner's turn" durations). */
const OWN_TURN_TIMINGS = new Set<Timing>(["onPlay", "activateMain", "main", "whenAttacking", "endOfYourTurn"]);

// ─── per-ability translation state ──────────────────────────────────────────

interface AbilityCtx {
  card: OptcgCard;
  ctx: CompileContext;
  timing: Timing;
  /** true after an odd number of ForceOpponent steps: "your" = the opponent. */
  flipped: boolean;
  /** zone/owner of the last selector, for "that card" (prev) bindings. */
  lastSel: Selector | null;
  approx: Set<string>;
  /** nesting depth of `sequence` (only the top level may fall back to a
   *  "continue by hand" tail) */
  depth: number;
  /** text for a "continue by hand" tail; null = whole-ability manual only */
  tailText: string | null;
}

const selfZone = (card: OptcgCard): Selector["zone"] =>
  card.type === "Leader" ? "leader" : card.type === "Stage" ? "stage" : "characterArea";

function ownerOf(spec: Json, a: AbilityCtx): Selector["owner"] {
  const friendly = on(spec.FriendlyOnly), enemy = on(spec.EnemyOnly);
  if (friendly === enemy) return "any";
  const mine = friendly !== a.flipped;
  return mine ? "self" : "opponent";
}

/** Filter keys of a target spec → SelectorFilter (throws on anything the IR
 *  can't express). `zoneKeys` are handled by the caller. */
const ZONE_KEYS = new Set(["DeployedCharacter", "HandCard", "TopDeckCard", "Leader", "StageCard", "DonAreaCard",
  "LifeCard", "TrashCard", "AttachedDon", "DeckCard"]);
const IGNORED_SPEC_KEYS = new Set(["FriendlyOnly", "EnemyOnly", "TargetCount", "OverrideUITargetCount",
  "WillBeRemoved", "AutoAllMatchingTargets"]);

function filterOf(spec: Json, a: AbilityCtx): SelectorFilter {
  const f: SelectorFilter = {};
  for (const k of keysOn(spec)) {
    if (ZONE_KEYS.has(k) || IGNORED_SPEC_KEYS.has(k)) continue;
    const v = spec[k];
    switch (k) {
      case "CostOrLess": f.costAtMost = Math.min(f.costAtMost ?? Infinity, num(v)); a.approx.add("cost filters read the printed cost"); break;
      case "CostOrMore": f.costAtLeast = Math.max(f.costAtLeast ?? -Infinity, num(v)); a.approx.add("cost filters read the printed cost"); break;
      case "OriginalCostOrLess": f.costAtMost = Math.min(f.costAtMost ?? Infinity, num(v)); break;
      case "OriginalCostOrMore": f.costAtLeast = Math.max(f.costAtLeast ?? -Infinity, num(v)); break;
      case "CostZero": f.costAtMost = 0; a.approx.add("cost filters read the printed cost"); break;
      case "PowerXOrLess": f.powerAtMost = num(v); break;
      case "PowerXOrMore": f.powerAtLeast = num(v); break;
      case "PowerZero": f.powerAtMost = 0; break;
      case "OriginalPowerXOrLess": f.powerAtMost = num(v); a.approx.add("base-power filters read the current power"); break;
      case "OriginalPowerXOrMore": f.powerAtLeast = num(v); a.approx.add("base-power filters read the current power"); break;
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
      default: fail(`target key ${k}`);
    }
  }
  return f;
}

function zoneOf(spec: Json): Selector["zone"] {
  const z = [...ZONE_KEYS].filter((k) => on(spec[k])).sort().join("+");
  switch (z) {
    case "DeployedCharacter": return "characterArea";
    case "Leader": return "leader";
    case "DeployedCharacter+Leader": return "leaderOrCharacter";
    case "StageCard": return "stage";
    case "HandCard": return "hand";
    case "TrashCard": return "trash";
    case "LifeCard": return "life";
    case "DonAreaCard": return "costArea";
    default: return fail(`target zone ${z || "(none)"}`);
  }
}

/** One target spec → Selector. `full` = exactly N (FullTargetsRequired / DON!! −N). */
function selectorOf(spec: Json | undefined, a: AbilityCtx, full: boolean): Selector {
  if (!spec) return fail("missing target");
  const chooser: Selector["chooser"] = a.flipped ? "opponent" : "controller";
  if (on(spec.AutoSelf) || on(spec.OnlySelf)) {
    if (on(spec.OnlySelf) && !on(spec.AutoSelf)) fail("OnlySelf");
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
  if (on(spec.NoUsingPreviousTargets) || on(spec.AutoMainTarget)) fail("previous/main-target binding");
  const zone = zoneOf(spec);
  const filter = filterOf(spec, a);
  const all = on(spec.AutoAllMatchingTargets);
  const raw = num(spec.TargetCount);
  const count = all || raw === 0 || raw >= 10 ? 99 : raw;
  const sel: Selector = { owner: ownerOf(spec, a), zone, count, chooser };
  if (Object.keys(filter).length > 0) sel.filter = filter;
  if (!all && !full) sel.upTo = true;
  a.lastSel = sel;
  return sel;
}

// ─── conditions ─────────────────────────────────────────────────────────────

const PROC_TIMING: Record<string, Timing | "passive"> = {
  Passive: "passive", OnPlay: "onPlay", OnAttack: "whenAttacking", OnKO: "onKO", OnBlock: "onBlock",
  Counter: "counter", Trigger: "trigger", ActivateMain: "activateMain", EndOfTurn: "endOfYourTurn",
  OnOpponentAttack: "onYourOpponentsAttack", OppActivatesEvent: "onOpponentActivatesEvent",
  OppPlaysEvent: "onOpponentActivatesEvent", YouActivateEvent: "onYouActivateEvent",
  OpponentCharacterKOd: "onOpponentCharacterKOd", StartOfTurn: "startOfYourTurn",
  OnOpponentAttackThis: "whenAttacked",
};
/** Timing / replacement / rule keys the IR has no timing for (spec A §2b-2d):
 *  such abilities are dropped (listed in the notes) rather than run at a
 *  wrong moment. `Pre*` replacement keys are matched by prefix. */
const DROP_TIMINGS = new Set([
  "OnAttackLeader", "OnKOEffectOnly", "QueuedEndOfTurn", "QueuedStartOfMainPhase", "StartOfGame", "CardDrawn",
  "DrewDonForTurn", "MyDonIsReturned", "XMyDonIsReturned", "MyDonIsReturnedMyEffects", "OnRest", "OnRestByOpponent",
  "YouRestedCharacter", "YouRemovedCharacter", "YouBouncedOppCharacter", "YourCharacterRemoved", "YourCharacterKOd",
  "YourCharacterOriginalPowerXOrMoreKOd", "YourCharacterMatchingTargetKOd", "AnyCharacterKOd", "IHitLeader",
  "AnyHitLeader", "MyLeaderHit", "OppLosesLife", "YourLifeSentToHand", "LifeSentToHand", "LifeSentToTrash",
  "LifeSentToDeck", "LifeSentToField", "OppActivatesTrigger", "YouActivateTrigger", "OppDeploysOriginalCostXOrMore",
  "OppDeploysThroughCharacter", "YouDeployed", "YouDeployedFromTrash", "DeployedAnyFromTrash",
  "YouDeployedTriggerCharacter", "HandSentToTrashMyEffect", "CardTrashedFromMyCategory", "MyLeaderAttacks",
  "MyLeaderAttacked", "AfterBattleCharacter", "AfterFailedKO", "BattlingStrikeType", "LifeReachesZero",
  "RogerSilence", "DeckOut", "UsoppLeader",
]);
/** Proc keys with no rules meaning for the IR (labels / feasibility checks of
 *  costs the engine verifies itself). */
const PROC_IGNORED = new Set(["Description", "OncePerTurn", "Active", "AvailableDon"]);

/** A proc or step-details condition → IR Condition (null = control/feasibility key). */
function conditionOf(key: string, v: unknown, a: AbilityCtx, where: "proc" | "step", all: Json): Condition | null {
  if (where === "step" && CONTROL_KEYS.has(key)) return null;
  if (a.flipped) fail(`condition ${key} under ForceOpponent`);
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
      if (keysOn(all).some((k) => k.startsWith("OverrideLeader"))) fail("OverrideLeader*");
      const types = list<number>(v).flatMap((id) => a.ctx.categoryTypes[id] ?? fail(`unknown category ${id}`));
      return { kind: "leaderIs", filter: { typeIncludes: [...new Set(types)] } };
    }
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
    case "DonXOrMore": return { kind: "donOnField", who: "self", atLeast: n };
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
    case "HasPreviousTargets":
      a.approx.add("\"if you do\" after an optional step is not tracked (the follow-up always runs)");
      return null;
    default: break;
  }
  if (where === "proc" && (PROC_IGNORED.has(key) || key in PROC_TIMING)) return null;
  if (where === "step" && CONTROL_KEYS.has(key)) return null;
  if (where === "step" && key === "AvailableDon") return null;
  return fail(`condition ${key}`);
}

function procConditions(proc: Json, a: AbilityCtx): Condition[] {
  const out: Condition[] = [];
  for (const k of keysOn(proc)) {
    const c = conditionOf(k, proc[k], a, "proc", proc);
    if (c) out.push(c);
  }
  return out;
}

function stepConditions(details: Json | undefined, a: AbilityCtx): Condition[] {
  const out: Condition[] = [];
  for (const k of keysOn(details)) {
    const c = conditionOf(k, (details as Json)[k], a, "step", details as Json);
    if (c) out.push(c);
  }
  return out;
}

// ─── costs ──────────────────────────────────────────────────────────────────

const isFull = (step: OptcgStep, k = 0): boolean =>
  list<number>(step.details?.FullTargetsRequired).includes(k);

/** A leading step that is part of the activation cost (before the `:`) →
 *  CostItem[]; null when the step is not cost-shaped. */
function costOf(step: OptcgStep, a: AbilityCtx): CostItem[] | null {
  const fx = step.effect ?? {};
  const keys = keysOn(fx).filter((k) => !MODIFIER_KEYS.has(k));
  if (keys.length === 0) return null;
  const spec = step.target?.[0];
  const out: CostItem[] = [];
  for (const k of keys) {
    const v = fx[k];
    switch (k) {
      case "DonTap": out.push({ kind: "restDon", count: num(v) }); break;
      case "DonMinus": out.push({ kind: "returnDonToDeck", count: num(v) }); break;
      case "RestSelf": out.push({ kind: "restSelf" }); break;
      case "TrashSelf": out.push({ kind: "trashSelf" }); break;
      case "TakeTopLife": out.push({ kind: "lifeToHand", count: num(v) }); break;
      case "TrashTopLife": out.push({ kind: "trashFromLife", count: num(v) }); break;
      case "TrashCard": case "SendToDeckBottom": case "SendToHand": case "Rest": {
        if (!spec || !on(spec.FriendlyOnly)) return null;
        const zone = zoneOf(spec);
        const sel = selectorOf(spec, a, true);
        delete sel.upTo;
        if (k === "TrashCard" && zone === "hand") out.push({ kind: "trashFromHand", sel });
        else if (k === "SendToDeckBottom" && zone === "hand" && !sel.filter) out.push({ kind: "handToDeckBottom", count: sel.count });
        else if (k === "SendToHand" && zone === "characterArea") out.push({ kind: "returnToHand", sel });
        else if (k === "Rest" && zone === "characterArea") out.push({ kind: "restFromField", sel });
        else return null;
        break;
      }
      default: return null;
    }
  }
  return out;
}

/** "add 1 card from the top or bottom of your Life to your hand:" — a Choices
 *  between TakeTopLife and TakeBottomLife used as a cost. */
function lifeChoiceCost(steps: OptcgStep[], i: number): { cost: CostItem[]; next: number } | null {
  const opts = list<Json>(steps[i].effect?.Choices);
  if (opts.length !== 2) return null;
  const takes = opts.map((o) => steps[typeof o.JumpToStep === "number" ? o.JumpToStep : i + 1]);
  const n = takes.map((s) => num(s?.effect?.TakeTopLife) || num(s?.effect?.TakeBottomLife));
  if (n[0] === 0 || n[0] !== n[1]) return null;
  const extra = takes.map((s) => keysOn(s?.effect).filter((k) => k !== "TakeTopLife" && k !== "TakeBottomLife").sort().join("+"));
  if (extra[0] !== extra[1] || (extra[0] !== "" && extra[0] !== "RestSelf")) return null;
  // the branches carry identical payoffs: continue after the last branch's cost step
  const last = Math.max(...opts.map((o) => (typeof o.JumpToStep === "number" ? o.JumpToStep : i + 1)));
  const cost: CostItem[] = [{ kind: "lifeToHand", count: n[0] }];
  if (extra[0] === "RestSelf") cost.unshift({ kind: "restSelf" });
  return { cost, next: last + 1 };
}

// ─── payoff actions ─────────────────────────────────────────────────────────

function durationFor(key: string, sel: Selector, a: AbilityCtx): Duration {
  switch (key) {
    case "BuffCombatPower": case "LoseBlockerThisBattle": return "thisBattle";
    case "BuffPowerToOppEnd": case "ChangeCostToOppEnd": case "GainBlockerToOppEnd": case "SetBasePowerToOppEnd":
      return "untilEndOfOpponentsNextTurn";
    case "BuffPowerToOwnersStart": case "GainCombatImmuneToStart":
      if (sel.owner !== "self") fail(`${key} on a non-own card`);
      return "untilStartOfYourNextTurn";
    case "BuffPowerToOwnersEnd": case "SilenceToOwnersEnd": case "CantAttack": case "CantRest":
      // "until the end of the target owner's turn" (spec B §1.13)
      if (sel.owner === "opponent" && OWN_TURN_TIMINGS.has(a.timing)) return "untilEndOfOpponentsNextTurn";
      if (sel.owner === "any") fail(`${key} on cards of either side`);
      return "thisTurn";
    default: return "thisTurn";
  }
}

const KEYWORD_GRANTS: Record<string, Keyword> = {
  GainRush: "Rush", GainDoubleAttack: "DoubleAttack", GainBanish: "Banish", GainUnblockable: "Unblockable",
  GainBlocker: "Blocker", GainBlockerToOppEnd: "Blocker", GainRushCharacters: "RushCharacter",
};
const RESTRICTIONS: Record<string, Extract<Action, { kind: "restriction" }>["what"]> = {
  CantAttack: "cannotAttack", LoseBlocker: "cannotBlock", LoseBlockerThisBattle: "cannotBlock",
  GainCanAttackActive: "canAttackActiveCharacters", GainImmune: "cannotBeKOd",
  GainCombatImmuneToStart: "cannotBeKOdInBattle",
};

/** The actions of one (non-view, non-Choices) step. */
function stepActions(step: OptcgStep, a: AbilityCtx): Action[] {
  const fx = step.effect ?? {};
  const keys = keysOn(fx).filter((k) => !MODIFIER_KEYS.has(k));
  if (keys.length === 0) return [];
  const spec = step.target?.[0];
  // "up to 1 … cost X or less and up to 1 … cost Y or less" (SecondCostOrLess,
  // TargetCount 2) = two selections in a row
  if (spec && on(spec.SecondCostOrLess) && num(spec.TargetCount) === 2 && keys.length === 1 && !on(spec.SecondCostOrLessCheckPrevTarget)) {
    const { SecondCostOrLess: y, ...rest } = spec;
    const first = { ...step, target: [{ ...rest, TargetCount: 1 }] };
    const second = { ...step, target: [{ ...rest, TargetCount: 1, CostOrLess: y }] };
    return [...stepActions(first, a), ...stepActions(second, a)];
  }
  const full = isFull(step);
  let firstSel: Selector | null = null;
  /** The step's selection: the first selector action prompts; siblings in the
   *  same step act on the same cards (spec B §1.1 — keys are simultaneous). */
  const sel = (): Selector => {
    if (firstSel) return { owner: firstSel.owner, zone: firstSel.zone, count: firstSel.count, prev: true, chooser: firstSel.chooser };
    firstSel = selectorOf(spec, a, full);
    return firstSel;
  };
  const who = (): "self" | "opponent" => (a.flipped ? "opponent" : "self");
  const out: Action[] = [];
  for (const k of keys) {
    const v = fx[k];
    switch (k) {
      case "DrawCards": out.push({ kind: "draw", count: num(v) }); break;
      case "KOCard": {
        const s = sel();
        if (!s.prev && s.zone !== "characterArea") fail("K.O. outside the Character area");
        out.push({ kind: "koTarget", sel: s });
        break;
      }
      case "BuffPower": case "BuffCombatPower": case "BuffPowerToOppEnd": case "BuffPowerToOwnersStart": case "BuffPowerToOwnersEnd": {
        const s = sel();
        out.push({ kind: "powerMod", sel: s, amount: num(v), duration: durationFor(k, s, a) });
        break;
      }
      case "ChangeCost": case "ChangeCostToOppEnd": {
        const s = sel();
        out.push({ kind: "costMod", sel: s, amount: num(v), duration: durationFor(k, s, a) });
        break;
      }
      case "SetBasePower": case "SetBasePowerToOppEnd": {
        const s = sel();
        out.push({ kind: "setBasePower", sel: s, amount: num(v), duration: durationFor(k, s, a) });
        break;
      }
      case "Rest": {
        if (spec && on(spec.DonAreaCard)) fail("rest DON!!");
        out.push({ kind: "restTarget", sel: sel() });
        break;
      }
      case "RestSelf": {
        const s: Selector = { owner: who(), zone: selfZone(a.card), count: 1, self: true, chooser: "controller" };
        out.push({ kind: "restTarget", sel: s });
        break;
      }
      case "Activate": {
        if (spec && on(spec.DonAreaCard)) {
          if (keysOn(spec).some((x) => ZONE_KEYS.has(x) && x !== "DonAreaCard")) fail("Activate DON!! or cards");
          const n = num(spec.TargetCount) || 1;
          out.push({ kind: "standDon", count: n });
          a.approx.add("\"set up to N DON!! as active\" always sets N");
        } else out.push({ kind: "standTarget", sel: sel() });
        break;
      }
      case "TrashCard": {
        if (!spec || !on(spec.HandCard) || keysOn(spec).some((x) => ZONE_KEYS.has(x) && x !== "HandCard")) fail("trash from a zone other than the hand");
        const s = sel();
        if (s.owner === "opponent" && s.chooser === "controller") fail("trash from the opponent's hand chosen by you");
        if (s.owner === "any") fail("trash from either hand");
        out.push({ kind: "discard", who: s.owner as "self" | "opponent", sel: s });
        break;
      }
      case "SendToHand": {
        const s = sel();
        if (s.zone === "trash") out.push({ kind: "addFromTrashToHand", sel: s });
        else if (s.zone === "characterArea" || s.zone === "leaderOrCharacter" || s.zone === "stage" || s.prev) out.push({ kind: "returnToHand", sel: s });
        else fail(`add to hand from ${s.zone}`);
        break;
      }
      case "SendToDeckBottom": case "SendToDeckTop": {
        const s = sel();
        if (!s.prev && s.zone !== "characterArea" && s.zone !== "stage") fail(`place at deck ${k} from ${s.zone}`);
        out.push({ kind: "returnToDeck", sel: s, where: k === "SendToDeckTop" ? "top" : "bottom" });
        break;
      }
      case "DeployCharacter": {
        const s = sel();
        if (s.zone !== "hand" && s.zone !== "trash") return fail(`play from ${s.zone}`);
        out.push({ kind: "playFromZone", zone: s.zone, sel: s, free: true, ...(on(fx.DeploysRested) ? { rested: true } : {}) });
        break;
      }
      case "DeploySelf": {
        if (a.timing !== "trigger") fail("play this card outside [Trigger]");
        out.push({ kind: "playFromZone", zone: "hand", free: true, sel: { owner: "self", zone: "hand", count: 1, self: true, chooser: "controller" } });
        break;
      }
      case "AttachRestedDon": {
        // "give up to N rested DON!! to 1 of your …": the "up to" is the DON count
        const s = sel();
        delete s.upTo;
        out.push({ kind: "giveRestedDon", sel: s, count: 1 });
        break;
      }
      case "OppTrashRandom": {
        // "your opponent trashes 1 card from their hand" / (flipped) "your opponent
        // chooses 1 card from your hand; trash that card"
        const owner = a.flipped ? "self" : "opponent";
        out.push({ kind: "discard", who: owner, sel: { owner, zone: "hand", count: num(v), chooser: a.flipped ? "opponent" : "controller" } });
        if (!a.flipped) a.approx.add("a random discard is chosen by the controller");
        break;
      }
      case "GainRestedDon": out.push({ kind: "placeDonInCostArea", count: num(v), rested: true }); break;
      case "GainActiveDon": out.push({ kind: "placeDonInCostArea", count: num(v) }); break;
      case "MillDeck": out.push({ kind: "mill", who: who(), count: num(v) }); break;
      case "Heal":
        out.push({ kind: "addToLife", sel: { owner: who(), zone: "deckTop", count: num(v), chooser: "controller" } });
        break;
      case "TakeTopLife": out.push({ kind: "lifeToHand", who: who(), count: num(v) }); break;
      case "OppTakeLife": out.push({ kind: "lifeToHand", who: a.flipped ? "self" : "opponent", count: num(v) }); break;
      case "TrashTopLife": out.push({ kind: "trashLife", who: who(), count: num(v) }); break;
      case "TrashOppLife": out.push({ kind: "trashLife", who: a.flipped ? "self" : "opponent", count: num(v) }); break;
      case "DonMinus": out.push({ kind: "returnDonToDeck", who: who(), count: num(v) }); break;
      case "SendToTopLife": {
        const s = sel();
        if (s.zone !== "characterArea" && !s.prev) fail(`add to Life from ${s.zone}`);
        out.push({ kind: "addToLife", sel: s, faceUp: on(fx.ForcedFaceUp) });
        break;
      }
      case "Silence": case "SilenceToOwnersEnd": {
        const s = sel();
        out.push({ kind: "negateEffect", sel: s, scope: "all", duration: durationFor(k, s, a) });
        break;
      }
      case "BecomeDefenderCharacter": out.push({ kind: "redirectAttack", sel: sel() }); break;
      case "EndCombat": out.push({ kind: "endBattle" }); break;
      default: {
        if (k in KEYWORD_GRANTS) {
          const s = sel();
          out.push({ kind: "grantKeyword", sel: s, keyword: KEYWORD_GRANTS[k], duration: durationFor(k, s, a) });
        } else if (k in RESTRICTIONS) {
          const s = sel();
          if ((k === "LoseBlocker" || k === "LoseBlockerThisBattle") && !s.prev && !s.self) s.filter = { ...(s.filter ?? {}), hasKeyword: "Blocker" };
          out.push({ kind: "restriction", sel: s, what: RESTRICTIONS[k], duration: durationFor(k, s, a) });
        } else fail(`effect ${k}`);
      }
    }
  }
  return out;
}

/** "Look at N / reveal N" views (spec B §1.6) → one peekDeck / trash action. */
function viewActions(steps: OptcgStep[], i: number, end: number, a: AbilityCtx): { actions: Action[]; next: number } {
  const open = steps[i].effect ?? {};
  const openKeys = keysOn(open).filter((k) => !MODIFIER_KEYS.has(k));
  if (openKeys.length !== 1) fail(`view step with ${openKeys.join("+")}`);
  const kind = openKeys[0];
  // collect the pick steps and the closing step
  let j = i + 1;
  const picks: OptcgStep[] = [];
  let close: string | null = null;
  for (; j < end; j++) {
    const s = steps[j];
    const keys = keysOn(s.effect).filter((k) => !MODIFIER_KEYS.has(k));
    if (Array.isArray(s.effect?.Choices)) {
      // "place them at the top or bottom of the deck": a Choices whose branches
      // are single closing steps
      const opts = list<Json>(s.effect?.Choices);
      const targets = opts.map((o) => (typeof o.JumpToStep === "number" ? o.JumpToStep : j + 1));
      const closes = targets.map((t) => keysOn(steps[t]?.effect).filter((k) => VIEW_CLOSE.includes(k)));
      if (closes.length === 2 && closes.every((c) => c.length === 1) && new Set(closes.flat()).size === 2
        && closes.flat().every((c) => c === "TopDeckToDeckBottom" || c === "TopDeckToDeckTop")) {
        close = "topOrBottom";
        j = end;
        break;
      }
      fail("Choices inside a view");
    }
    const closing = keys.filter((k) => VIEW_CLOSE.includes(k));
    const other = keys.filter((k) => !VIEW_CLOSE.includes(k));
    if (other.length > 0) {
      if (!s.target?.[0] || !on(s.target[0].TopDeckCard)) break; // a step that no longer reads the view
      picks.push(s);
    }
    if (closing.length > 0) {
      close = closing[0];
      j++;
      // a deck search closes the view, then shuffles
      if (close === "CleanUpTopDeck" && kind === "StartTopDeckFromDeck" && on(steps[j]?.effect?.ShuffleDeck)) { close = "ShuffleDeck"; j++; }
      break;
    }
  }
  for (const p of picks) {
    if (stepConditions(p.details, a).length > 0) fail("conditional pick inside a view");
    if (p.effect?.Choices) fail("Choices inside a view");
  }

  if (kind === "StartTopDeck" || kind === "StartTopDeckOpp" || kind === "StartTopDeckFromDeck") {
    if (kind === "StartTopDeckOpp" && a.flipped) fail("opponent view under ForceOpponent");
    if (kind === "StartTopDeckFromDeck" && close !== "ShuffleDeck") fail("deck search without a shuffle");
    const then: PeekDisposition = {
      rest: close === "topOrBottom" ? "topOrBottomAnyOrder"
        : close === "TopDeckToDeckBottom" ? "bottomAnyOrder"
        : close === "TrashTopDeck" ? "trash"
        : close === "ShuffleDeck" ? "shuffle"
        : close === null || close === "TopDeckToDeckTop" || close === "CleanUpTopDeck" ? "topAnyOrder"
        : fail(`view closed by ${close}`),
    };
    let reveal = on(open.RevealTopDeckToOpponent);
    for (const p of picks) {
      const keys = keysOn(p.effect).filter((k) => !MODIFIER_KEYS.has(k) && !VIEW_CLOSE.includes(k));
      const spec = p.target?.[0] as Json;
      if (keysOn(spec).some((k) => ZONE_KEYS.has(k) && k !== "TopDeckCard" && !(k === "DeckCard" && kind === "StartTopDeckFromDeck"))) fail("pick from the view and another zone");
      const f = filterOf(spec, a);
      const n = num(spec.TargetCount) || 1;
      if (keys.length !== 1) fail(`view pick ${keys.join("+")}`);
      if (keys[0] === "SendToHand") {
        if (then.addToHand) fail("two add-to-hand picks");
        then.addToHand = f; then.addCount = n;
        if (!on(p.effect?.DrawIsHidden)) reveal = true;
      } else if (keys[0] === "DeployCharacter") {
        if (then.play) fail("two play picks");
        then.play = f; then.playCount = n;
        if (on(p.effect?.DeploysRested)) then.playRested = true;
      } else fail(`view pick ${keys[0]}`);
    }
    if (reveal) then.reveal = true;
    const who = kind === "StartTopDeckOpp" ? "opponent" : a.flipped ? "opponent" : "self";
    if (kind === "StartTopDeckFromDeck") {
      // search the whole deck (50 = more than any deck holds), then shuffle;
      // the view filter of the opening step narrows what may be taken
      const vf = filterOf(steps[i].target?.[0] ?? {}, a);
      if (then.addToHand) then.addToHand = { ...vf, ...then.addToHand };
      if (then.play) then.play = { ...vf, ...then.play };
    }
    return { actions: [{ kind: "peekDeck", who, count: kind === "StartTopDeckFromDeck" ? 50 : num(open[kind]), then }], next: j };
  }

  if (kind === "StartTopDeckFromTrash") {
    if (close !== null && close !== "CleanUpTopDeck") fail(`trash view closed by ${close}`);
    const base = filterOf(steps[i].target?.[0] ?? {}, a);
    const actions: Action[] = [];
    for (const p of picks) {
      const keys = keysOn(p.effect).filter((k) => !MODIFIER_KEYS.has(k) && !VIEW_CLOSE.includes(k));
      const spec = p.target?.[0] as Json;
      if (keys.length !== 1) fail(`trash pick ${keys.join("+")}`);
      const f = { ...base, ...filterOf(spec, a) };
      const raw = num(spec.TargetCount);
      const s: Selector = { owner: a.flipped ? "opponent" : "self", zone: "trash", count: raw === 0 || raw >= 10 ? 99 : raw, upTo: true, chooser: a.flipped ? "opponent" : "controller" };
      if (Object.keys(f).length > 0) s.filter = f;
      if (keys[0] === "SendToHand") actions.push({ kind: "addFromTrashToHand", sel: s });
      else if (keys[0] === "DeployCharacter") {
        const act: Action = { kind: "playFromZone", zone: "trash", sel: s, free: true };
        if (on(p.effect?.DeploysRested)) act.rested = true;
        actions.push(act);
      } else fail(`trash pick ${keys[0]}`);
      a.lastSel = s;
    }
    if (actions.length === 0) fail("trash view without a pick");
    return { actions, next: j };
  }
  return fail(`view ${kind}`);
}

/** Merge consecutive "give 1 rested DON!!" on the same target into one action
 *  ("give this Character up to 2 rested DON!!" is written as two steps). */
function mergeDon(actions: Action[]): Action[] {
  const out: Action[] = [];
  for (const act of actions) {
    const prev = out[out.length - 1];
    if (act.kind === "giveRestedDon" && prev?.kind === "giveRestedDon"
      && (act.sel.prev || (act.sel.self && prev.sel.self))) {
      prev.count += act.count;
      continue;
    }
    out.push(act);
  }
  return out;
}

/** Translate steps [i, end) into actions. At the top level, a step the IR
 *  can't express ends the automatic part: what was translated so far runs,
 *  and a `manual` action carries the rest of the ability (8-1-2 "as much as
 *  possible", plan §1.3). */
function sequence(steps: OptcgStep[], i: number, end: number, a: AbilityCtx): Action[] {
  a.depth++;
  try {
    return sequenceInner(steps, i, end, a);
  } finally {
    a.depth--;
  }
}

function sequenceInner(steps: OptcgStep[], i: number, end: number, a: AbilityCtx): Action[] {
  const out: Action[] = [];
  const topLevel = a.depth === 1 && a.tailText !== null;
  while (i < end) {
    if (topLevel) {
      const before = out.length;
      try {
        const r = sequenceStep(steps, i, end, a, out);
        if (r === null) return mergeDon(out);
        i = r;
        continue;
      } catch (e) {
        if (!(e instanceof Unsupported) || before === 0) throw e;
        out.length = before;
        out.push({ kind: "manual", text: `Continue by hand (the earlier part already resolved): ${a.tailText}` });
        a.approx.add(`the rest of an ability is resolved by hand (${e.message})`);
        return mergeDon(out);
      }
    }
    const r = sequenceStep(steps, i, end, a, out);
    if (r === null) return mergeDon(out);
    i = r;
  }
  return mergeDon(out);
}

/** One step of a sequence: appends to `out`; returns the next index, or null
 *  when the rest of the sequence was consumed. */
function sequenceStep(steps: OptcgStep[], i: number, end: number, a: AbilityCtx, out: Action[]): number | null {
  {
    const step = steps[i];
    const fx = step.effect ?? {};
    const conds = stepConditions(step.details, a);
    const required = on(step.details?.Required);

    if (keysOn(fx).length === 0 && !step.target) {
      // pure gate / landing pad / confirm prompt
      if (conds.length > 0) {
        if (!required) return i + 1; // a gate that only skips itself does nothing
        const rest = sequence(steps, i + 1, end, a);
        if (rest.length > 0) out.push({ kind: "ifThen", if: conds, then: rest });
        return null;
      }
      return i + 1;
    }
    if (on(fx.ForceOpponent)) {
      if (keysOn(fx).length > 1 || step.target) fail("ForceOpponent with siblings");
      if (conds.length > 0) {
        const flippedRest = (() => { a.flipped = !a.flipped; try { return sequence(steps, i + 1, end, a); } finally { a.flipped = !a.flipped; } })();
        out.push({ kind: "ifThen", if: conds, then: flippedRest });
        return null;
      }
      a.flipped = !a.flipped;
      return i + 1;
    }
    if (Array.isArray(fx.Choices)) {
      out.push(...choices(steps, i, end, a, conds));
      return null;
    }
    let acts: Action[];
    let next = i + 1;
    if (VIEW_OPEN.some((k) => on(fx[k]))) {
      const v = viewActions(steps, i, end, a);
      acts = v.actions; next = v.next;
    } else {
      acts = stepActions(step, a);
    }
    if (on(step.details?.EndAfterStep)) next = end;
    if (conds.length > 0) {
      if (required) {
        const rest = sequence(steps, next, end, a);
        out.push({ kind: "ifThen", if: conds, then: [...acts, ...rest] });
        return null;
      }
      if (acts.length > 0) out.push({ kind: "ifThen", if: conds, then: acts });
    } else out.push(...acts);
    return next >= end ? null : next;
  }
}

/** A Choices step (spec B §1.9). Each option jumps to a step and runs to the
 *  first EndAfterStep or the end of the ability. "0 DON / 1 DON"-style pairs
 *  where one branch does nothing = an optional benefit → run the benefit. */
function choices(steps: OptcgStep[], i: number, end: number, a: AbilityCtx, conds: Condition[]): Action[] {
  const opts = list<Json>(steps[i].effect?.Choices);
  const lastSelBefore = a.lastSel;
  const branches = opts.map((o) => {
    const start = typeof o.JumpToStep === "number" ? o.JumpToStep : i + 1;
    if (start <= i || start > end) fail("Choices jumping backwards");
    a.lastSel = lastSelBefore;
    return sequence(steps, start, end, a);
  });
  let acts: Action[];
  const nonEmpty = branches.filter((b) => b.length > 0);
  if (nonEmpty.length === 0) acts = [];
  else if (nonEmpty.length === 1 && branches.length === 2
    && nonEmpty[0].every((x) => x.kind === "placeDonInCostArea" || x.kind === "draw" || x.kind === "standDon")) {
    acts = nonEmpty[0];
    a.approx.add("an optional \"up to\" benefit is always taken");
  } else if (branches.length === 1) acts = branches[0];
  else acts = [{ kind: "chooseOne", options: branches }];
  if (conds.length > 0 && acts.length > 0) return [{ kind: "ifThen", if: conds, then: acts }];
  return acts;
}

// ─── abilities → effects ────────────────────────────────────────────────────

const PASSIVE_KEYWORDS: Record<string, Keyword> = {
  Blocker: "Blocker", Rush: "Rush", DoubleAttack: "DoubleAttack", Banish: "Banish",
  Unblockable: "Unblockable", RushCharacters: "RushCharacter",
};

interface AbilityResult {
  keywords: Keyword[];
  effects: Effect[];
  /** abilities with no IR timing (listed in notes) */
  dropped: string[];
  manual: number;
  approx: Set<string>;
}

function selfSel(card: OptcgCard): Selector {
  return { owner: "self", zone: selfZone(card), count: 1, self: true, chooser: "controller" };
}

function passiveEffect(card: OptcgCard, cat: CatalogCard | undefined, ab: OptcgAbility, a: AbilityCtx, res: AbilityResult): void {
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
      default: fail(`passive ${k}`);
    }
  }
  for (const act of actions) if ("sel" in act && act.sel && act.sel.upTo === undefined) delete act.sel.upTo;
  if (actions.length > 0) res.effects.push({ timing: "static", ...(conds.length ? { conditions: conds } : {}), actions });
}

/** The catalog text split into one segment per ability: a new line, or a "["
 *  right after a sentence end (the catalog sometimes glues abilities:
 *  "…Characters.[On Your Opponent's Attack] …"); "•" option lines stay with
 *  the ability that introduces them ("Choose one:"). */
export function textSegments(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[•・-]/.test(l) && lines.length > 0) lines[lines.length - 1] += `\n${l}`;
    else lines.push(l);
  }
  return lines.flatMap((l) => l.split(/(?<=[.)])\s*(?=\[(?!Trigger\]))/)).map((l) => l.trim()).filter(Boolean);
}

/** The segment of the catalog text that carries an ability (for `manual`). */
function abilityText(card: OptcgCard, cat: CatalogCard | undefined, timing: Timing, nth: number): string {
  const TAGS: Partial<Record<Timing, string>> = {
    onPlay: "[On Play]", whenAttacking: "[When Attacking]", onKO: "[On K.O.]", onBlock: "[On Block]",
    counter: "[Counter]", activateMain: "[Activate: Main]", main: "[Main]", endOfYourTurn: "[End of Your Turn]",
    onYourOpponentsAttack: "[On Your Opponent's Attack]", startOfYourTurn: "start of your turn",
  };
  if (timing === "trigger") {
    const t = cat?.trigger ?? textSegments(`${cat?.effect ?? ""}\n${card.text}`).find((l) => l.includes("[Trigger]"));
    if (t) return t.trim().startsWith("[Trigger]") ? t.trim() : `[Trigger] ${t.trim()}`;
  }
  const text = (cat?.effect && cat.effect !== "-" ? cat.effect : card.text) ?? "";
  const tag = TAGS[timing];
  if (tag) {
    // one ability per segment: a new line, or a "[" right after a sentence end
    // (the catalog sometimes glues abilities: "…Characters.[On Your Opponent's Attack] …")
    const lines = textSegments(text).filter((l) => l.includes(tag));
    if (lines[nth] ?? lines[0]) return (lines[nth] ?? lines[0]).trim();
  }
  return text.trim() || `${card.id}: resolve this effect manually`;
}

/** Neutralize the Event play cost / Trigger self-trash in step 0 (the engine
 *  pays / does them). Returns a same-length copy, so `JumpToStep` indices of
 *  Choices keep pointing at the right steps. */
function payoffSteps(card: OptcgCard, timing: Timing, steps: OptcgStep[]): OptcgStep[] {
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
  }
  return out;
}

/** Text before the ability's ":" (its activation cost, 8-3-1). */
function hasCostColon(text: string): boolean {
  const body = text.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "");
  return /:/.test(body);
}

function triggeredEffect(card: OptcgCard, cat: CatalogCard | undefined, ab: OptcgAbility, timing: Timing,
  nth: number, a: AbilityCtx, res: AbilityResult): void {
  const text = abilityText(card, cat, timing, nth);
  const base: Effect = { timing, actions: [] };
  // [Once Per Turn] follows the printed text (the data has a few strays both ways)
  // (an Event's [Main]/[Counter] only when printed; elsewhere data or text)
  const eventPlay = card.type === "Event" && (timing === "main" || timing === "counter");
  void eventPlay;
  if (/once per turn/i.test(text) || (!eventPlay && on(ab.proc.OncePerTurn) && /haven't .*this turn/i.test(text))) base.oncePerTurn = true;
  a.tailText = text;
  const manual = (why: string): void => {
    res.manual++;
    res.effects.push({ ...base, actions: [{ kind: "manual", text }] });
    res.approx.add(`${timing}: resolved by hand (${why})`);
  };
  try {
    const conds = procConditions(ab.proc, a);
    const steps = payoffSteps(card, timing, ab.steps);
    const cost: CostItem[] = [];
    let optional = false;
    let i = 0;
    // leading ConfirmAction / gates
    const gate: Condition[] = [];
    if (hasCostColon(text) || on(ab.proc.Active)) {
      for (; i < steps.length; i++) {
        const st = steps[i];
        if (keysOn(st.effect).length === 0 && !st.target) {
          if (on(st.details?.ConfirmAction)) optional = true;
          gate.push(...stepConditions(st.details, a));
          continue;
        }
        if (Array.isArray(st.effect?.Choices)) {
          const lc = lifeChoiceCost(steps, i);
          if (!lc) break;
          cost.push(...lc.cost);
          if (!on(st.details?.NoCancel)) optional = true;
          i = lc.next - 1;
          continue;
        }
        const c = costOf(st, a);
        if (!c) break;
        gate.push(...stepConditions(st.details, a));
        if (!on(st.details?.NoCancel) || on(st.details?.ConfirmAction)) optional = true;
        cost.push(...c);
      }
      if (cost.length === 0) fail("a cost (\":\") that does not map onto IR costs");
    } else {
      // no cost: a leading ConfirmAction-only step is a "you may"
      while (i < steps.length && keysOn(steps[i].effect).length === 0 && !steps[i].target && on(steps[i].details?.ConfirmAction)) {
        optional = true;
        gate.push(...stepConditions(steps[i].details, a));
        i++;
      }
    }
    let actions = sequence(steps, i, steps.length, a);
    if (actions.length === 0) fail("no executable step");
    const allConds = [...conds, ...gate];
    // a gate wrapping the whole payoff reads better (and is checked before the
    // cost is paid) as an activation condition (8-3-2)
    if (actions.length === 1 && actions[0].kind === "ifThen" && !actions[0].else) {
      allConds.push(...actions[0].if);
      actions = actions[0].then;
    }
    // drop conditions that only restate a cost's feasibility (life for a Life
    // cost, hand for a hand cost) and duplicates
    const implied = (c: Condition) =>
      (c.kind === "lifeAtLeast" && c.who === "self" && cost.some((x) => (x.kind === "lifeToHand" || x.kind === "trashFromLife") && x.count >= c.count))
      || (c.kind === "handAtLeast" && c.who === "self" && cost.some((x) => (x.kind === "trashFromHand" && x.sel.count >= c.count) || (x.kind === "handToDeckBottom" && x.count >= c.count)));
    const seenCond = new Set<string>();
    const finalConds = allConds.filter((c) => {
      const key = JSON.stringify(c);
      if (implied(c) || seenCond.has(key)) return false;
      seenCond.add(key);
      return true;
    });
    const fx: Effect = { ...base, actions };
    const ir = JSON.stringify(actions);
    // "[Trigger] Activate this card's [Main] effect.": check against the card's whole text
    const guardText = /Activate this card's \[/.test(text) ? `${text}\n${cat?.effect ?? card.text}` : text;
    // text cross-check: a Leader condition printed on the card must be in the IR
    if (/\bif your Leader (is \[|has the \{|is multicolou?red)/i.test(guardText) && !JSON.stringify([finalConds, actions]).includes("leaderIs")) {
      fail("the text has a Leader condition the effect data lacks");
    }
    if (/Leader or Character/.test(guardText) && !/leaderOrCharacter|"zone":"leader"/.test(JSON.stringify([actions, cost])) && /"zone":"characterArea"/.test(ir)) {
      fail("the text names \"Leader or Character\" targets the effect data lacks");
    }
    if (!/opponent/i.test(guardText) && /"owner":"opponent"/.test(ir)) fail("the effect data targets the opponent's cards; the text does not");
    if (finalConds.length > 0) fx.conditions = finalConds;
    if (cost.length > 0) fx.cost = cost;
    if (optional) fx.optional = true;
    res.effects.push(fx);
  } catch (e) {
    if (e instanceof Unsupported) manual(e.message);
    else throw e;
  }
}

// ─── card ───────────────────────────────────────────────────────────────────

export function compileOptcgCard(card: OptcgCard, cat: CatalogCard | undefined, ctx: CompileContext): CompiledCard | null {
  // optcg-ai has no effect data for a card the catalog gives text to: nothing
  // to translate — leave it to the text heuristic fallback
  const catText = (cat?.effect ?? "").trim();
  if (card.abilities.length === 0 && ((catText !== "" && catText !== "-") || !!cat?.trigger)) return null;
  const res: AbilityResult = { keywords: [], effects: [], dropped: [], manual: 0, approx: new Set() };
  const seen = new Map<Timing, number>();
  for (const ab of card.abilities) {
    const timingKeys = keysOn(ab.proc).filter((k) => k in PROC_TIMING);
    const unknownTimings = keysOn(ab.proc).filter((k) => DROP_TIMINGS.has(k) || /^Pre[A-Z]/.test(k));
    if (timingKeys.length === 0 || unknownTimings.length > 0) {
      res.dropped.push((unknownTimings.length ? unknownTimings : keysOn(ab.proc)).join("+") || "(no timing)");
      continue;
    }
    for (const key of timingKeys) {
      let timing = PROC_TIMING[key];
      const a: AbilityCtx = { card, ctx, timing: timing === "passive" ? "static" : timing, flipped: false, lastSel: null, approx: res.approx, depth: 0, tailText: null };
      if (timing === "passive") {
        try { passiveEffect(card, cat, ab, a, res); } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          res.dropped.push(`continuous effect (${e.message})`);
        }
        continue;
      }
      if (timing === "activateMain" && card.type === "Event") timing = "main";
      if (timing === "trigger" && cat && !cat.trigger && !(cat.effect ?? "").includes("[Trigger]")) { res.dropped.push("a [Trigger] the printed card does not have"); continue; }
      a.timing = timing;
      const nth = seen.get(timing) ?? 0;
      seen.set(timing, nth + 1);
      triggeredEffect(card, cat, ab, timing, nth, a, res);
    }
  }

  const keywords = [...new Set(res.keywords)];
  const effects = res.effects;
  const text = (cat?.effect ?? card.text ?? "").trim();
  // abilities the IR has no timing for must still SAY so in game: their
  // untimed text segments ride along as an inert `static` manual effect
  // (board-auto flags it "not yet automatic"; the engine never runs it)
  if (res.dropped.length > 0) {
    const TIMED = /\[(On Play|When Attacking|On K\.O\.|On Block|Counter|Activate: Main|Main|End of Your Turn|On Your Opponent's Attack)\]/;
    const untimed = textSegments(text === "-" ? "" : text)
      .filter((seg) => !TIMED.test(seg))
      .filter((seg) => seg.replace(/\[(Rush|Blocker|Banish|Double Attack|Unblockable|Rush: Character)\]\s*(\([^)]*\))?/g, "").trim() !== "");
    if (untimed.length > 0) effects.push({ timing: "static", actions: [{ kind: "manual", text: untimed.join("\n") }] });
  }
  const hasText = (text !== "" && text !== "-") || !!cat?.trigger;
  const automated = effects.filter((fx) => !fx.actions.some((x) => x.kind === "manual")).length;
  let classification: Classification;
  if (effects.length === 0 && res.dropped.length === 0) {
    classification = keywords.length > 0 ? "keyword-only" : hasText && card.abilities.length > 0 ? "unsupported" : "vanilla";
  } else if (res.manual === 0 && res.dropped.length === 0) classification = "compiled";
  else if (automated > 0 || keywords.length > 0) classification = "partial";
  else classification = "unsupported";
  if (classification === "vanilla" && hasText) classification = "unsupported";

  const approx = [...res.approx];
  const confidence = classification === "vanilla" ? 1
    : classification === "keyword-only" ? 0.95
    : classification === "compiled" ? (approx.length > 0 ? 0.75 : 0.85)
    : classification === "partial" ? 0.6 : 0.3;
  const notes = [
    "GENERATED from optcg-ai (actionV3) by src/autosim/compiler/fromOptcg.ts",
    ...approx.map((x) => `approx: ${x}`),
    ...res.dropped.map((x) => `not expressible in the IR yet: ${x}`),
  ];
  const counter = cat ? cat.counter : card.counter > 0 ? card.counter : null;
  const out: CompiledCard = {
    cardId: card.id, version: 1, confidence, classification, keywords,
    ...(counter !== null && counter !== undefined ? { counterValue: counter } : {}),
    effects: classification === "vanilla" || classification === "keyword-only" ? [] : effects,
    notes: notes.join(" · "),
  };
  return out;
}

export interface CoverageCounts {
  vanilla: number; "keyword-only": number; compiled: number; partial: number; unsupported: number; total: number;
  /** vanilla + keyword-only + compiled, as a percentage of total. */
  coveredPct: number;
}

export function coverageOf(cards: CompiledCard[]): Record<string, CoverageCounts> {
  const rows: Record<string, CoverageCounts> = {};
  const bump = (key: string, cls: Classification) => {
    const row = (rows[key] ??= { vanilla: 0, "keyword-only": 0, compiled: 0, partial: 0, unsupported: 0, total: 0, coveredPct: 0 });
    row[cls]++; row.total++;
  };
  for (const c of cards) { bump(c.cardId.split("-")[0], c.classification); bump("ALL", c.classification); }
  for (const row of Object.values(rows)) row.coveredPct = Math.round(((row.vanilla + row["keyword-only"] + row.compiled) / row.total) * 1000) / 10;
  return rows;
}

/** Compile every optcg-ai card (sorted by id, deterministic). */
export function compileAllOptcg(
  optcg: Record<string, OptcgCard>, catalog: (CatalogCard & { name?: string })[], enumNames: Record<string, string>,
): CompiledCard[] {
  const ctx: CompileContext = { categoryTypes: buildCategoryMap(optcg, catalog, enumNames), names: buildNameMap(optcg, catalog) };
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return Object.keys(optcg).sort().flatMap((id) => compileOptcgCard(optcg[id], byId.get(id), ctx) ?? []);
}
