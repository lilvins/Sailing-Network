/**
 * IR validation: structural checks mirroring types.ts plus semantic lint rules
 * (AUTOSIM_PLAN.md §6, level a+b). Hand-rolled — no schema-library dependency;
 * schema.json documents the same contract for the AI pipeline.
 */
import type { Action, CompiledCard, Effect, Selector } from "./types";

const KEYWORDS = ["Rush", "DoubleAttack", "Banish", "Blocker", "RushCharacter", "Unblockable"];
const TIMINGS = [
  "onPlay", "whenAttacking", "onKO", "onBlock", "counter", "trigger",
  "activateMain", "main", "endOfYourTurn", "endOfOpponentsTurn",
  "startOfYourTurn", "startOfOpponentsTurn", "onYourOpponentsAttack",
  "whenAttacked", "endOfBattle", "onYouActivateEvent",
  "onOpponentActivatesEvent", "onOpponentCharacterKOd", "static",
];
const DURATIONS = [
  "instant", "thisBattle", "thisTurn", "untilStartOfYourNextTurn",
  "untilEndOfOpponentsNextTurn", "permanentWhileInPlay",
];
const CLASSIFICATIONS = ["vanilla", "keyword-only", "compiled", "partial", "unsupported"];
const ZONES = [
  "characterArea", "leader", "leaderOrCharacter", "stage",
  "hand", "trash", "deckTop", "costArea", "life",
];
const ACTION_KINDS = [
  "powerMod", "koTarget", "draw", "restTarget", "standTarget", "discard",
  "grantKeyword", "restriction", "returnToHand", "returnToDeck", "playFromZone",
  "peekDeck", "mill", "addFromTrashToHand", "lifeToHand", "trashLife", "addToLife",
  "giveRestedDon", "attachDonFromDeck", "placeDonInCostArea", "returnDonToDeck",
  "standDon", "costMod", "setBasePower", "negateEffect", "redirectAttack",
  "endBattle", "ifThen", "chooseOne", "manual",
];
const COST_KINDS = [
  "restDon", "returnDonToDeck", "restSelf", "trashFromHand", "trashSelf",
  "trashFromLife", "lifeToHand", "handToDeckBottom", "returnToHand", "restFromField",
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function checkSelector(sel: unknown, path: string, errors: string[]): void {
  if (typeof sel !== "object" || sel === null) { errors.push(`${path}: selector must be an object`); return; }
  const s = sel as Selector;
  if (!["self", "opponent", "any"].includes(s.owner)) errors.push(`${path}.owner invalid: ${s.owner}`);
  if (!ZONES.includes(s.zone)) errors.push(`${path}.zone invalid: ${s.zone}`);
  if (!Number.isInteger(s.count) || s.count < 0) errors.push(`${path}.count must be an integer ≥ 0`);
  if (!["controller", "opponent"].includes(s.chooser)) errors.push(`${path}.chooser invalid: ${s.chooser}`);
}

function checkAction(a: unknown, path: string, errors: string[]): void {
  if (typeof a !== "object" || a === null) { errors.push(`${path}: action must be an object`); return; }
  const act = a as Action;
  if (!ACTION_KINDS.includes(act.kind)) { errors.push(`${path}.kind unknown: ${(act as { kind: string }).kind}`); return; }
  const withSel = act as { sel?: unknown };
  if ("sel" in act && withSel.sel !== undefined) checkSelector(withSel.sel, `${path}.sel`, errors);
  const withDur = act as { duration?: string };
  if ("duration" in act && withDur.duration !== undefined && !DURATIONS.includes(withDur.duration)) {
    errors.push(`${path}.duration invalid: ${withDur.duration}`);
  }
  if (act.kind === "ifThen") {
    act.then.forEach((x, i) => checkAction(x, `${path}.then[${i}]`, errors));
    act.else?.forEach((x, i) => checkAction(x, `${path}.else[${i}]`, errors));
  }
  if (act.kind === "chooseOne") {
    act.options.forEach((opt, i) => opt.forEach((x, j) => checkAction(x, `${path}.options[${i}][${j}]`, errors)));
  }
  if (act.kind === "manual" && (typeof act.text !== "string" || !act.text.trim())) {
    errors.push(`${path}: manual action requires non-empty text`);
  }
}

function lintEffect(fx: Effect, path: string, errors: string[]): void {
  // Semantic rules the schema can't express:
  // static effects are continuous — instant makes no sense on them and
  // one-shot timings shouldn't carry permanentWhileInPlay durations.
  for (const [i, a] of fx.actions.entries()) {
    const dur = (a as { duration?: string }).duration;
    if (fx.timing === "static" && dur === "instant") {
      errors.push(`${path}.actions[${i}]: static effect with instant duration`);
    }
    if (fx.timing !== "static" && dur === "permanentWhileInPlay" && a.kind !== "grantKeyword") {
      errors.push(`${path}.actions[${i}]: one-shot timing with permanentWhileInPlay duration`);
    }
  }
  // [Once Per Turn] on static effects is meaningless (10-2-13 applies to activations)
  if (fx.timing === "static" && fx.oncePerTurn) {
    errors.push(`${path}: oncePerTurn on a static effect`);
  }
  // counter/trigger/main are hand-activation timings — a cost of restSelf makes no sense
  if (["counter", "main", "trigger"].includes(fx.timing) && fx.cost?.some((c) => c.kind === "restSelf")) {
    errors.push(`${path}: restSelf cost on a hand-activated timing`);
  }
}

/** Structural + lint validation of one compiled card. */
export function validateCompiledCard(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) return { ok: false, errors: ["not an object"] };
  const c = input as CompiledCard;

  if (typeof c.cardId !== "string" || !/^[A-Z0-9]+-\d+$/.test(c.cardId)) errors.push(`cardId invalid: ${String(c.cardId)}`);
  if (c.version !== 1) errors.push(`version must be 1`);
  if (typeof c.confidence !== "number" || c.confidence < 0 || c.confidence > 1) errors.push(`confidence must be 0..1`);
  if (!CLASSIFICATIONS.includes(c.classification)) errors.push(`classification invalid: ${c.classification}`);
  if (!Array.isArray(c.keywords)) errors.push(`keywords must be an array`);
  else for (const k of c.keywords) if (!KEYWORDS.includes(k)) errors.push(`unknown keyword: ${k}`);
  if (!Array.isArray(c.effects)) errors.push(`effects must be an array`);
  else {
    for (const [i, fx] of c.effects.entries()) {
      const path = `effects[${i}]`;
      if (!TIMINGS.includes(fx.timing)) errors.push(`${path}.timing invalid: ${fx.timing}`);
      if (!Array.isArray(fx.actions) || fx.actions.length === 0) errors.push(`${path}.actions must be a non-empty array`);
      else fx.actions.forEach((a, j) => checkAction(a, `${path}.actions[${j}]`, errors));
      for (const [j, c] of (fx.cost ?? []).entries()) {
        if (!COST_KINDS.includes((c as { kind: string }).kind)) {
          errors.push(`${path}.cost[${j}].kind unknown: ${(c as { kind: string }).kind}`);
        }
      }
      lintEffect(fx, path, errors);
    }
    // classification coherence
    if (c.classification === "vanilla" && (c.effects.length > 0 || c.keywords.length > 0)) {
      errors.push(`vanilla card must have no effects and no keywords`);
    }
    if (c.classification === "keyword-only" && c.effects.length > 0) {
      errors.push(`keyword-only card must have no effects`);
    }
    if (c.classification === "compiled" && c.effects.length === 0 && c.keywords.length === 0) {
      errors.push(`compiled card with no effects and no keywords — should be vanilla`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Validate a whole compiled set; returns per-card failures. */
export function validateCompiledSet(cards: unknown[]): { ok: boolean; failures: Record<string, string[]> } {
  const failures: Record<string, string[]> = {};
  for (const [i, c] of cards.entries()) {
    const res = validateCompiledCard(c);
    if (!res.ok) failures[(c as CompiledCard)?.cardId ?? `#${i}`] = res.errors;
  }
  return { ok: Object.keys(failures).length === 0, failures };
}
