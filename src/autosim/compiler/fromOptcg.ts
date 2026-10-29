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
import type { Action, CardRules, Classification, CompiledCard, Effect, Keyword, Timing } from "../ir/types";
import { passiveEffect, triggeredEffect } from "./abilities";
import { buildCategoryMap, buildNameMap } from "./catalogMaps";
import { DROP_TIMINGS, PROC_TIMING } from "./conditions";
import { replacementEffect } from "./replacements";
import { isRuleAbility, rulesOf } from "./rules";
import { Unsupported, keysOn, list, num, on } from "./dsl";
import { textSegments } from "./text";
import { TEXT_IR } from "./textIr";
import type { AbilityCtx, AbilityResult, CatalogCard, CompileContext, Json, OptcgAbility, OptcgCard, OptcgStep } from "./types";

export type { CatalogCard, CompileContext, OptcgAbility, OptcgCard, OptcgStep } from "./types";
export { buildCategoryMap, buildNameMap } from "./catalogMaps";
export { textSegments } from "./text";

// ─── card ───────────────────────────────────────────────────────────────────

/** Translate every ability of a card into `res` (timing by timing). */
function translateAbilities(card: OptcgCard, cat: CatalogCard | undefined, ctx: CompileContext, res: AbilityResult, rules: CardRules): void {
  const seen = new Map<Timing, number>();
  for (const ab0 of card.abilities) {
    if (isRuleAbility(ab0, rules)) continue; // a printed game rule: CompiledCard.rules (M5)
    // the queued half of "… at the start of their next Main Phase" (M5): the engine runs it from the restriction
    if (on(ab0.proc.QueuedStartOfMainPhase) && card.abilities.some((x) => x.steps.some((st) => on(st.effect?.QueueUpOppMainPhaseAction)))) continue;
    // a step's alternative target ("X or Y") rides on its spec as OrTarget (M5)
    const ab = { ...ab0, steps: ab0.steps.map((st) => (st.targetOverrides?.[0] && st.target?.[0]
      ? { ...st, target: [{ ...st.target[0], OrTarget: st.targetOverrides[0] }, ...st.target.slice(1)] } : st)) };
    if (keysOn(ab.proc).some((k) => /^Pre[A-Z]/.test(k))) {
      // "If … would be K.O.'d / removed …, you may … instead" (8-1-3-4, M5)
      const text = textSegments((cat?.effect ?? card.text ?? "")).find((l) => /would be|instead/i.test(l)) ?? (cat?.effect ?? card.text ?? "");
      const a: AbilityCtx = { card, ctx, timing: "replacement", flipped: false, lastSel: null, approx: res.approx, depth: 0, tailText: text };
      try {
        replacementEffect(ab, text, a, res);
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        res.dropped.push(`${keysOn(ab.proc).filter((k) => /^Pre[A-Z]/.test(k)).join("+")} (${e.message})`);
      }
      continue;
    }
    // "Your Leader and all of your Characters that do not have a type including "Roger Pirates" have their effects negated." (M5)
    if (on(ab.proc.RogerSilence)) {
      const m = /Your Leader and all of your Characters that do not have a type including "([^"]+)" have their effects negated/i.exec(cat?.effect ?? card.text ?? "");
      if (!m) { res.dropped.push("RogerSilence"); continue; }
      const types = [...new Set(Object.values(ctx.categoryTypes).flat().filter((t) => t.includes(m[1])))];
      res.effects.push({ timing: "static", actions: [{ kind: "negateEffect", scope: "all", duration: "permanentWhileInPlay",
        sel: { owner: "self", zone: "leaderOrCharacter", count: 99, chooser: "controller", filter: { typeExcludes: types.length ? types : [m[1]] } } }] });
      continue;
    }
    // "When one of your Characters with … is K.O.'d" (M5): the watched card's spec is written as a first, effect-less step
    if (on(ab.proc.YourCharacterMatchingTargetKOd) && ab.steps[0]?.target?.[0] && keysOn(ab.steps[0].effect).length === 0) {
      const spec = ab.steps[0].target[0];
      const shift = (st: OptcgStep): OptcgStep => (Array.isArray(st.effect?.Choices)
        ? { ...st, effect: { ...st.effect, Choices: list<Json>(st.effect!.Choices).map((o) => ({ ...o, JumpToStep: num(o.JumpToStep) - 1 })) } } : st);
      ab.proc = { ...ab.proc, YourCharacterMatchingTargetKOd: 1, MatchingTargetSpec: spec } as Json;
      ab.steps = ab.steps.slice(1).map(shift);
    }
    // "When you take damage or your Character with 6000 base power or more is K.O.'d" (M5): two timings
    if (on(ab.proc.MyLeaderHit) && ab.proc.YourCharacterOriginalPowerXOrMoreKOd !== undefined && ab.proc.YourCharacterKOd === undefined) {
      ab.proc = { ...ab.proc, YourCharacterKOd: 1 };
      if (on(ab.proc.OncePerTurn)) res.approx.add("an [Once Per Turn] with two timings counts each separately");
    }
    let timingKeys = keysOn(ab.proc).filter((k) => k in PROC_TIMING);
    // "Passive" next to an event timing is only a marker; two keys for one timing are one ability
    if (timingKeys.length > 1) timingKeys = timingKeys.filter((k) => k !== "Passive");
    timingKeys = timingKeys.filter((k, i) => timingKeys.findIndex((x) => PROC_TIMING[x] === PROC_TIMING[k]) === i);
    if (timingKeys.length > 1 && on(ab.proc.OncePerTurn)) res.approx.add("an [Once Per Turn] with two timings counts each separately");
    const unknownTimings = keysOn(ab.proc).filter((k) => DROP_TIMINGS.has(k) || /^Pre[A-Z]/.test(k));
    if (timingKeys.length === 0 || unknownTimings.length > 0) {
      res.dropped.push((unknownTimings.length ? unknownTimings : keysOn(ab.proc)).join("+") || "(no timing)");
      continue;
    }
    for (const key of timingKeys) {
      const raw = PROC_TIMING[key];
      const a: AbilityCtx = { card, ctx, timing: raw === "passive" ? "static" : raw, flipped: false, lastSel: null, approx: res.approx, depth: 0, tailText: null };
      if (raw === "passive") {
        translatePassive(card, cat, ab, a, res);
        continue;
      }
      const timing: Timing = raw === "activateMain" && card.type === "Event" ? "main" : raw;
      if (timing === "trigger" && cat && !cat.trigger && !(cat.effect ?? "").includes("[Trigger]")) {
        res.approx.add("optcg-ai has a [Trigger] the printed card does not have (ignored)");
        continue;
      }
      a.timing = timing;
      const nth = seen.get(timing) ?? 0;
      seen.set(timing, nth + 1);
      triggeredEffect(card, cat, ab, timing, nth, a, res);
    }
  }
}

function translatePassive(card: OptcgCard, cat: CatalogCard | undefined, ab: OptcgAbility, a: AbilityCtx, res: AbilityResult): void {
  try {
    passiveEffect(card, cat, ab, a, res);
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    res.dropped.push(`continuous effect (${e.message})`);
  }
}

/** "… at the end of this turn" (M5): point every scheduleEndOfTurn at a
 *  `delayed` effect of the card — the QueuedEndOfTurn ability, or one made
 *  from the action's own inline steps. */
function bindScheduled(effects: Effect[]): void {
  const queued = effects.findIndex((fx) => fx.timing === "delayed");
  const bind = (actions: Action[]): Action[] => actions.map((x): Action => {
    if (x.kind === "ifThen") return { ...x, then: bind(x.then), ...(x.else ? { else: bind(x.else) } : {}) };
    if (x.kind === "chooseOne") return { ...x, options: x.options.map(bind) };
    if (x.kind === "mayPay") return { ...x, then: bind(x.then) };
    if (x.kind !== "scheduleEndOfTurn") return x;
    if (x.actions) {
      effects.push({ timing: "delayed", actions: x.actions });
      return { kind: "scheduleEndOfTurn", effectIndex: effects.length - 1, ...(x.aboutPrev ? { aboutPrev: true } : {}) };
    }
    if (queued < 0) return { kind: "manual", text: "Resolve by hand at the end of this turn (the delayed part of this card)." };
    return { kind: "scheduleEndOfTurn", effectIndex: queued };
  });
  for (const fx of [...effects]) fx.actions = bind(fx.actions);
}

/** Abilities the IR has no timing for must still SAY so in game: their
 *  untimed text segments ride along as an inert `static` manual effect
 *  (board-auto flags it "not yet automatic"; the engine never runs it). */
function disclosureForDropped(text: string): Effect | null {
  const TIMED = /\[(On Play|When Attacking|On K\.O\.|On Block|Counter|Activate: Main|Main|End of Your Turn|On Your Opponent's Attack)\]/;
  const untimed = textSegments(text === "-" ? "" : text)
    .filter((seg) => !TIMED.test(seg))
    .filter((seg) => seg.replace(/\[(Rush|Blocker|Banish|Double Attack|Unblockable|Rush: Character)\]\s*(\([^)]*\))?/g, "").trim() !== "");
  return untimed.length > 0 ? { timing: "static", actions: [{ kind: "manual", text: untimed.join("\n") }] } : null;
}

function classify(card: OptcgCard, res: AbilityResult, keywords: Keyword[], hasText: boolean, hasRules: boolean): Classification {
  const automated = res.effects.filter((fx) => !fx.actions.some((x) => x.kind === "manual")).length;
  let classification: Classification;
  if (res.effects.length === 0 && res.dropped.length === 0 && hasRules) {
    classification = keywords.length > 0 ? "keyword-only" : "compiled"; // only printed game rules (CompiledCard.rules)
  } else if (res.effects.length === 0 && res.dropped.length === 0) {
    classification = keywords.length > 0 ? "keyword-only" : hasText && card.abilities.length > 0 ? "unsupported" : "vanilla";
  } else if (res.manual === 0 && res.dropped.length === 0) classification = "compiled";
  else if (automated > 0 || keywords.length > 0) classification = "partial";
  else classification = "unsupported";
  return classification === "vanilla" && hasText ? "unsupported" : classification;
}

function confidenceOf(classification: Classification, approximations: number): number {
  switch (classification) {
    case "vanilla": return 1;
    case "keyword-only": return 0.95;
    case "compiled": return approximations > 0 ? 0.75 : 0.85;
    case "partial": return 0.6;
    default: return 0.3;
  }
}

export function compileOptcgCard(card: OptcgCard, cat: CatalogCard | undefined, ctx: CompileContext): CompiledCard | null {
  // optcg-ai has no effect data for a card the catalog gives text to: nothing
  // to translate — leave it to the text heuristic fallback
  const catText = (cat?.effect ?? "").trim();
  if (card.abilities.length === 0 && ((catText !== "" && catText !== "-") || !!cat?.trigger) && !TEXT_IR[card.id]) return null;

  const res: AbilityResult = { keywords: [], effects: [], dropped: [], manual: 0, approx: new Set() };
  const text = (cat?.effect ?? card.text ?? "").trim();
  const rules = rulesOf(text, ctx);
  if (rules.startOfGamePlay) res.approx.add("the start-of-game Stage is the first matching card of the decklist");
  const byText = TEXT_IR[card.id];
  if (byText && (typeof byText.text === "string" ? byText.text === text : byText.text.test(text))) {
    res.effects.push(...structuredClone(byText.effects));
    res.keywords.push(...(byText.keywords ?? []));
    res.approx.add(`IR written from the printed text (${byText.reason})`);
  } else translateAbilities(card, cat, ctx, res, rules);
  if (res.dropped.length > 0) {
    const disclosure = disclosureForDropped(text);
    if (disclosure) res.effects.push(disclosure);
  }
  bindScheduled(res.effects);
  const keywords = [...new Set(res.keywords)];
  const hasText = (text !== "" && text !== "-") || !!cat?.trigger;
  const classification = classify(card, res, keywords, hasText, Object.keys(rules).length > 0);
  const approx = [...res.approx];
  const notes = [
    "GENERATED from optcg-ai (actionV3) by src/autosim/compiler/fromOptcg.ts",
    ...approx.map((x) => `approx: ${x}`),
    ...res.dropped.map((x) => `not expressible in the IR yet: ${x}`),
  ];
  const counter = cat ? cat.counter : card.counter > 0 ? card.counter : null;
  return {
    ...(Object.keys(rules).length > 0 ? { rules } : {}),
    cardId: card.id, version: 1, confidence: confidenceOf(classification, approx.length), classification, keywords,
    ...(counter !== null && counter !== undefined ? { counterValue: counter } : {}),
    effects: classification === "vanilla" || classification === "keyword-only" ? [] : res.effects,
    notes: notes.join(" · "),
  };
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
