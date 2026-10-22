/**
 * board-auto card compiler — catalog Card → engine CardDb.
 *
 * Source of truth, in order:
 *  1. The OFFICIAL M2 compilation batch (`src/autosim/data/compiled`,
 *     getCompiledCard) — ST01 + OP01 today, more sets as M3+ lands.
 *  2. For ids NOT covered by a batch: a CONSERVATIVE heuristic FALLBACK
 *     derived from the card text (below). It never invents semantics — when
 *     in doubt it degrades to `unsupported`/manual (plan §1.3):
 *
 *  · innate keywords ([Blocker], [Rush], …) — only when the tag opens a line
 *    of the effect text (official layout). "gains [Rush]" mid-sentence is NOT
 *    treated as innate.
 *  · [Trigger] text    → a `manual` trigger effect: the engine suspends damage
 *    and offers the reveal/decision (10-1-5); activating opens the
 *    "resolve manually" panel, then the card is trashed (10-1-5-3).
 *  · Event [Main]      → a `manual` main effect: playable, cost paid by the
 *    engine, effect resolved by hand in the manual panel.
 *  · Event [Counter]   → a `manual` counter effect: usable in the Counter
 *    Step, card cost paid by the engine (7-1-3-2-2), resolved by hand.
 *
 * In the fallback, everything else (On Play, Activate: Main, …) stays
 * uncompiled = vanilla, by design, until its set is batch-compiled.
 * NO rules logic lives here — this is card data preparation only.
 */
import type { Card } from "../cards/cardsDb";
import type { CompiledCard, Effect, Keyword } from "../../autosim/ir/types";
import type { CardDb, EngineCard } from "../../autosim/engine/state";
import { getCompiledCard } from "../../autosim/data/compiled";

/** Keyword tags in match order ([Rush: Character] before [Rush]). */
const KEYWORD_TAGS: [string, Keyword][] = [
  ["[Rush: Character]", "RushCharacter"],
  ["[Rush]", "Rush"],
  ["[Double Attack]", "DoubleAttack"],
  ["[Banish]", "Banish"],
  ["[Blocker]", "Blocker"],
  ["[Unblockable]", "Unblockable"],
];

/**
 * Innate keywords: a keyword tag that OPENS a line of the effect text
 * (several in a row allowed: "[Rush] [Banish]"). A tag appearing later in a
 * line ("…gains [Rush]…") is an effect, not an innate keyword — skipped.
 */
export function innateKeywords(effectText: string | null | undefined): Keyword[] {
  const found = new Set<Keyword>();
  if (!effectText) return [];
  for (const rawLine of effectText.split("\n")) {
    let line = rawLine.trim();
    let matched = true;
    while (matched) {
      matched = false;
      for (const [tag, kw] of KEYWORD_TAGS) {
        if (line.startsWith(tag)) {
          found.add(kw);
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
  }
  return [...found];
}

/** Whether any line of the text starts with the given tag. */
function hasLineTag(text: string | null | undefined, tag: string): boolean {
  if (!text) return false;
  return text.split("\n").some((l) => l.trim().startsWith(tag));
}

/** FALLBACK ONLY (uncompiled sets): derive the conservative CompiledCard for
 *  a catalog card (or null = vanilla). Batch-covered ids never reach this. */
export function deriveCompiled(card: Card): CompiledCard | null {
  const keywords = innateKeywords(card.effect);
  const effects: Effect[] = [];

  if (card.category === "Event") {
    if (hasLineTag(card.effect, "[Main]")) {
      effects.push({ timing: "main", actions: [{ kind: "manual", text: card.effect }] });
    }
    if (hasLineTag(card.effect, "[Counter]")) {
      effects.push({ timing: "counter", actions: [{ kind: "manual", text: card.effect }] });
    }
  }

  if (card.trigger) {
    const text = card.trigger.trimStart().startsWith("[Trigger]") ? card.trigger : `[Trigger] ${card.trigger}`;
    effects.push({ timing: "trigger", actions: [{ kind: "manual", text }] });
  }

  if (keywords.length === 0 && effects.length === 0) return null; // vanilla

  return {
    cardId: card.id,
    version: 1,
    confidence: effects.length > 0 ? 0.5 : 0.9,
    classification: effects.length > 0 ? "unsupported" : "keyword-only",
    keywords,
    counterValue: card.counter ?? undefined,
    effects,
    notes: "FALLBACK — derived by the board-auto heuristic compiler (set not batch-compiled yet)",
  };
}

/** The IR for a card: official batch first, heuristic fallback otherwise. */
export function compiledFor(card: Card): CompiledCard | undefined {
  return getCompiledCard(card.id) ?? deriveCompiled(card) ?? undefined;
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
      compiled: compiledFor(card),
    };
    cache.set(cardId, engineCard);
    return engineCard;
  };
}
