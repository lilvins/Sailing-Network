/**
 * board-auto card compiler — catalog Card → engine CardDb.
 *
 * Source of truth, in order:
 *  1. The OFFICIAL M2 compilation batch (`src/autosim/data/compiled`,
 *     getCompiledCard) — ST01 + OP01 today, more sets as M3+ lands.
 *  2. The batch GENERATED from optcg-ai's effect data (M5,
 *     `src/autosim/compiler/fromOptcg.ts`, getGeneratedCard) — every other
 *     card optcg-ai knows; abilities the IR can't express are `manual`.
 *  3. For ids covered by neither: a CONSERVATIVE heuristic FALLBACK
 *     derived from the card text (below). It never invents semantics — when
 *     in doubt it degrades to `unsupported`/manual (plan §1.3):
 *
 *  · innate keywords ([Blocker], [Rush], …) — only when the tag opens a line
 *    of the effect text (official layout). "gains [Rush]" mid-sentence is NOT
 *    treated as innate.
 *  · [Trigger] text    → a `manual` trigger effect: the engine suspends damage
 *    and offers the reveal/decision (10-1-5); activating opens the
 *    "resolve manually" panel, then the card is trashed (10-1-5-3).
 *  · Event [Main] / [Counter] → when the line's FIRST sentence is one of the
 *    word-for-word power templates (POWER_TEMPLATES: "+N … during this
 *    battle", "Give … −N power during this turn", optional "You may trash 1
 *    card from your hand:" cost), it is compiled for real and only the rest of
 *    the line stays `manual`; otherwise the whole effect is `manual` (cost
 *    paid by the engine, effect resolved by hand in the manual panel).
 *
 * In the fallback, everything else (On Play, Activate: Main, …) stays
 * uncompiled = vanilla, by design, until its set is batch-compiled.
 * NO rules logic lives here — this is card data preparation only.
 */
import type { Card } from "../cards/cardsDb";
import type { Action, CompiledCard, CostItem, Effect, Keyword, Selector } from "../../autosim/ir/types";
import type { CardDb, EngineCard } from "../../autosim/engine/state";
import { allCompiledCards, getCompiledCard, getGeneratedCard } from "../../autosim/data/compiled";
import { isAutomaticStatic } from "../../autosim/engine/continuous";

/** Keyword tags in match order ([Rush: Character] before [Rush]). */
const KEYWORD_TAGS: [string, Keyword][] = [
  ["[Rush: Character]", "RushCharacter"],
  ["[Rush]", "Rush"],
  ["[Double Attack]", "DoubleAttack"],
  ["[Banish]", "Banish"],
  ["[Blocker]", "Blocker"],
  ["[Unblockable]", "Unblockable"],
];

/** Strip the keyword tags (and their reminder parentheticals) that OPEN a
 *  line; returns the keywords found and whatever text remains. */
function stripLeadingKeywords(rawLine: string): { kws: Keyword[]; rest: string } {
  let line = rawLine.trim();
  const kws: Keyword[] = [];
  let matched = true;
  while (matched) {
    matched = false;
    for (const [tag, kw] of KEYWORD_TAGS) {
      if (line.startsWith(tag)) {
        kws.push(kw);
        line = line.slice(tag.length).trimStart();
        // skip a reminder-text parenthetical right after the tag
        if (line.startsWith("(")) {
          const close = line.indexOf(")");
          line = close === -1 ? "" : line.slice(close + 1).trimStart();
        }
        matched = true;
        break;
      }
    }
  }
  return { kws, rest: line };
}

/**
 * Innate keywords: a keyword tag that OPENS a line of the effect text
 * (several in a row allowed: "[Rush] [Banish]"). A tag appearing later in a
 * line ("…gains [Rush]…") is an effect, not an innate keyword — skipped.
 */
export function innateKeywords(effectText: string | null | undefined): Keyword[] {
  const found = new Set<Keyword>();
  if (!effectText) return [];
  for (const rawLine of effectText.split("\n")) {
    for (const kw of stripLeadingKeywords(rawLine).kws) found.add(kw);
  }
  return [...found];
}

/** Whether any line of the text starts with the given tag. */
function hasLineTag(text: string | null | undefined, tag: string): boolean {
  if (!text) return false;
  return text.split("\n").some((l) => l.trim().startsWith(tag));
}

// ─── exact-pattern power changes on Event [Counter]/[Main] lines ─────────────
// The most common Event texts in every set are a single power change. The
// fallback compiles ONLY the first sentence and ONLY when it matches one of
// these templates word for word (official wording); whatever follows stays a
// `manual` action. Anything else → the whole line stays manual (plan §1.3).

const N = "(\\d+)";
const MINUS = "[−-]";
const self = (zone: Selector["zone"], upTo: boolean, filter?: Selector["filter"]): Selector =>
  ({ owner: "self", zone, count: 1, upTo, chooser: "controller", ...(filter ? { filter } : {}) });
const opp = (zone: Selector["zone"]): Selector =>
  ({ owner: "opponent", zone, count: 1, upTo: true, chooser: "controller" });

const POWER_TEMPLATES: { re: RegExp; build: (m: RegExpMatchArray) => Action }[] = [
  { re: new RegExp(`^Up to 1 of your Leader or Character cards gains \\+${N} power during this battle\\.$`),
    build: (m) => ({ kind: "powerMod", amount: +m[1], duration: "thisBattle", sel: self("leaderOrCharacter", true) }) },
  { re: new RegExp(`^Your Leader gains \\+${N} power during this battle\\.$`),
    build: (m) => ({ kind: "powerMod", amount: +m[1], duration: "thisBattle", sel: self("leader", false) }) },
  { re: new RegExp(`^Up to 1 of your Leader gains \\+${N} power during this battle\\.$`),
    build: (m) => ({ kind: "powerMod", amount: +m[1], duration: "thisBattle", sel: self("leader", true) }) },
  { re: new RegExp(`^Up to 1 of your Characters gains \\+${N} power during this battle\\.$`),
    build: (m) => ({ kind: "powerMod", amount: +m[1], duration: "thisBattle", sel: self("characterArea", true) }) },
  { re: new RegExp(`^Up to 1 of your \\{([^}]+)\\} type Leader or Character cards gains \\+${N} power during this battle\\.$`),
    build: (m) => ({ kind: "powerMod", amount: +m[2], duration: "thisBattle", sel: self("leaderOrCharacter", true, { typeIncludes: [m[1]] }) }) },
  { re: new RegExp(`^Up to 1 of your \\[([^\\]]+)\\] cards gains \\+${N} power during this battle\\.$`),
    build: (m) => ({ kind: "powerMod", amount: +m[2], duration: "thisBattle", sel: self("leaderOrCharacter", true, { nameIncludes: [m[1]] }) }) },
  { re: new RegExp(`^Give up to 1 of your opponent's Leader or Character cards ${MINUS}${N} power during this turn\\.$`),
    build: (m) => ({ kind: "powerMod", amount: -m[1], duration: "thisTurn", sel: opp("leaderOrCharacter") }) },
  { re: new RegExp(`^Give up to 1 of your opponent's Characters ${MINUS}${N} power during this turn\\.$`),
    build: (m) => ({ kind: "powerMod", amount: -m[1], duration: "thisTurn", sel: opp("characterArea") }) },
];

/** "You may trash 1 card from your hand: …" — the common optional cost. */
const TRASH_COST = /^You may trash 1 card from your hand:\s*/;

/** Compile the text of ONE [Counter]/[Main] line (tag already removed).
 *  Returns the automated effect, or a fully manual one when nothing matches. */
export function compileEventLine(timing: "counter" | "main", body: string, fullText: string): Effect {
  let text = body.trim();
  let optional = false;
  let cost: CostItem[] | undefined;
  const c = text.match(TRASH_COST);
  if (c) {
    optional = true;
    cost = [{ kind: "trashFromHand", sel: { owner: "self", zone: "hand", count: 1, chooser: "controller" } }];
    text = text.slice(c[0].length);
  }
  // first sentence = up to the first ". " (a period followed by a space/end)
  const cut = text.search(/\.(\s|$)/);
  const first = cut === -1 ? text : text.slice(0, cut + 1);
  const rest = cut === -1 ? "" : text.slice(cut + 1).trim();
  for (const t of POWER_TEMPLATES) {
    const m = first.match(t.re);
    if (!m) continue;
    const actions: Action[] = [t.build(m)];
    if (rest) actions.push({ kind: "manual", text: rest });
    return { timing, ...(optional ? { optional } : {}), ...(cost ? { cost } : {}), actions };
  }
  return { timing, actions: [{ kind: "manual", text: fullText }] };
}

/** The body of the first line opening with `tag` (e.g. "[Counter]"), or null.
 *  Lines with a combined tag ("[Main]/[Counter]", "[Counter][Main]") → null
 *  body (the caller keeps them manual). */
function lineBody(text: string | null | undefined, tag: string): string | null {
  if (!text) return null;
  for (const l of text.split("\n")) {
    const t = l.trim();
    if (!t.startsWith(tag)) continue;
    const body = t.slice(tag.length).trim();
    return body.startsWith("/") || body.startsWith("[") ? "" : body;
  }
  return null;
}

/** FALLBACK ONLY (uncompiled sets): derive the conservative CompiledCard for
 *  a catalog card (or null = vanilla). Batch-covered ids never reach this. */
export function deriveCompiled(card: Card): CompiledCard | null {
  const keywords = innateKeywords(card.effect);
  const effects: Effect[] = [];

  if (card.category === "Event") {
    for (const [tag, timing] of [["[Main]", "main"], ["[Counter]", "counter"]] as const) {
      if (!hasLineTag(card.effect, tag)) continue;
      const body = lineBody(card.effect, tag);
      effects.push(body
        ? compileEventLine(timing, body, card.effect ?? "")
        : { timing, actions: [{ kind: "manual", text: card.effect ?? "" }] });
    }
  }

  if (card.trigger) {
    const text = card.trigger.trimStart().startsWith("[Trigger]") ? card.trigger : `[Trigger] ${card.trigger}`;
    effects.push({ timing: "trigger", actions: [{ kind: "manual", text }] });
  }

  if (keywords.length === 0 && effects.length === 0) return null; // vanilla

  const isManual = (fx: Effect) => fx.actions.some((a) => a.kind === "manual");
  const automated = effects.filter((fx) => !isManual(fx) || fx.actions.length > 1).length;
  return {
    cardId: card.id,
    version: 1,
    confidence: effects.length > 0 ? 0.5 : 0.9,
    classification: effects.length === 0 ? "keyword-only"
      : effects.every((fx) => !isManual(fx)) ? "compiled"
      : automated > 0 ? "partial" : "unsupported",
    keywords,
    counterValue: card.counter ?? undefined,
    effects,
    notes: "FALLBACK — derived by the board-auto heuristic compiler (set not batch-compiled yet)",
  };
}

/** The IR for a card: official batch first, then the batch generated from
 *  optcg-ai, then the heuristic fallback. */
export function compiledFor(card: Card): CompiledCard | undefined {
  const official = getCompiledCard(card.id);
  const generated = getGeneratedCard(card.id);
  // M5: the M2 batch left a few effects to "resolve manually"; a generated IR that runs them wins
  const manual = (c: CompiledCard) => JSON.stringify(c.effects).includes('"kind":"manual"');
  if (official && generated && manual(official) && !manual(generated)) return generated;
  return official ?? generated ?? deriveCompiled(card) ?? undefined;
}

// ─── automation transparency (an effect that doesn't run must SAY so) ────────

/** Timings the engine actually fires today (M3: enqueue points in battle.ts /
 *  effects.ts + the [Activate: Main] intent + [Main]/[Counter] windows).
 *  Everything else is stored but inert — update this list as M4+ lands. */
const ENGINE_RUNNABLE_TIMINGS = new Set<string>([
  "onPlay", "whenAttacking", "onKO", "onBlock", "counter", "trigger", "main", "onYourOpponentsAttack",
  "activateMain", "endOfYourTurn", "endOfOpponentsTurn", "endOfBattle",
  "onYouActivateEvent", "onOpponentActivatesEvent", "onOpponentCharacterKOd",
  "delayed", // M5: runs when its card schedules it
  "whenAttacked", "onYourDonReturned", "onKOByEffect", "onRested", "onDealDamage", "onLifeZero", // M5 event timings
  "onCharacterKOd", "onCharacterRemoved", "onCharacterRestedBy", "onYouPlayCharacter", "onHandTrashed",
  "replacement", // M5: "… instead" (8-1-3-4)
  "onLeaderAttacks", "onLeaderAttacked", "onTakeDamage", "onLifeRemoved", "onOpponentBlocks", "afterBattleWithCharacter", "onDonGiven", "onDrawOutsideDrawPhase", "onLifeToHand", "onYouDealDamage", "onTriggerActivated", "onKOInBattle", "onDonPhase", "onCharacterBounced", "onBattlesCharacter", "startOfYourTurn", "startOfOpponentsTurn", // M5
]);

const TIMING_LABEL: Record<string, string> = {
  static: "this continuous effect",
  startOfYourTurn: "start-of-turn effects",
  startOfOpponentsTurn: "start-of-turn effects",
  whenAttacked: "[When Attacked]",
  onOpponentPlaysCharacter: "effects on the opponent's plays",
};

/** Effect text the fallback could NOT capture (anything beyond line-opening
 *  keywords and, on Events, the [Main]/[Counter] windows). */
function fallbackResidualLines(card: Card): string[] {
  const text = card.effect?.trim();
  if (!text || text === "-") return [];
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const { rest } = stripLeadingKeywords(rawLine);
    if (rest === "") continue;
    if (card.category === "Event" && (rest.startsWith("[Main]") || rest.startsWith("[Counter]"))) continue;
    out.push(rest);
  }
  return out;
}

export interface AutomationInfo {
  /** Some effects resolve through the "resolve manually" panel. */
  manual: boolean;
  /** Some effect text does nothing automatically yet (engine debt / uncompiled set). */
  inert: boolean;
  /** One-line disclosure for the preview panel; null = fully automated. */
  note: string | null;
}

const autoInfoCache = new Map<string, AutomationInfo>();

export function automationInfo(card: Card): AutomationInfo {
  const hit = autoInfoCache.get(card.id);
  if (hit) return hit;
  const fromBatch = getCompiledCard(card.id) !== undefined || getGeneratedCard(card.id) !== undefined;
  const effects = compiledFor(card)?.effects ?? [];
  // "manual" actions, and the few kinds the engine still hands to the "resolve manually" panel (effects.ts planAction)
  const manual = effects.some((fx) => {
    const s = JSON.stringify(fx.actions);
    return s.includes('"kind":"manual"') || s.includes('"kind":"endBattle"') || s.includes('"zone":"revealed"');
  });
  // M4: a `static` effect made only of continuous power/cost/keyword/restriction
  // changes runs (engine/continuous.ts); other statics are still inert
  const inertTimings = [...new Set(effects.filter((fx) => !isAutomaticStatic(fx)).map((fx) => fx.timing).filter((t) => !ENGINE_RUNNABLE_TIMINGS.has(t)))];
  const residual = fromBatch ? [] : fallbackResidualLines(card);
  const bits: string[] = [];
  if (residual.length > 0) {
    bits.push(`set ${card.set} isn't compiled yet, so effect text beyond keywords / [Trigger] / [Main] / [Counter] does nothing automatically`);
  }
  if (inertTimings.length === 1 && inertTimings[0] === "static") {
    bits.push("this continuous effect is not automatic yet — everything else on this card runs");
  } else if (inertTimings.length > 0) {
    bits.push(`the engine can't run ${inertTimings.map((t) => TIMING_LABEL[t] ?? t).join(", ")} yet`);
  }
  if (manual) bits.push('resolved by hand via the "resolve manually" panel');
  const info: AutomationInfo = {
    manual,
    inert: inertTimings.length > 0 || residual.length > 0,
    note: bits.length > 0 ? `Automation: ${bits.join(" · ")}.` : null,
  };
  autoInfoCache.set(card.id, info);
  return info;
}

/** Set prefixes (e.g. "OP15") among `cardIds` that no compiled batch covers. */
export function uncompiledSetsOf(cardIds: Iterable<string>): string[] {
  const compiledSets = new Set(allCompiledCards().map((c) => c.cardId.split("-")[0]));
  const missing = new Set<string>();
  for (const id of cardIds) {
    const set = id.split("-")[0];
    if (!compiledSets.has(set) && !getGeneratedCard(id)) missing.add(set);
  }
  return [...missing].sort();
}

/** Build the engine CardDb over the loaded catalog. Compilation is cached. */
export function makeCardDb(cardsById: Map<string, Card>): CardDb {
  const cache = new Map<string, EngineCard>();
  return (cardId: string): EngineCard => {
    const hit = cache.get(cardId);
    if (hit) return hit;
    const card = cardsById.get(cardId);
    if (!card) throw new Error(`unknown card ${cardId}`);
    const engineCard: EngineCard = {
      id: card.id,
      category: card.category,
      cost: card.cost, // Leader: Life value (shared local-DB quirk)
      power: card.power,
      counter: card.counter,
      colors: card.colors,
      types: card.types,
      name: card.name,
      attributes: card.attributes,
      compiled: compiledFor(card),
      hasEffect: !!card.effect && card.effect.trim() !== "" && card.effect.trim() !== "-",
    };
    cache.set(cardId, engineCard);
    return engineCard;
  };
}
