/** Input shapes of the optcg-ai data, the compile context and the per-ability translation state. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Effect, Keyword, Selector, Timing } from "../ir/types";

// ─── input shapes (subset of optcg-ai src/engine/types.ts) ──────────────────

export type Json = Record<string, unknown>;

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

// ─── per-ability translation state ──────────────────────────────────────────

export interface AbilityCtx {
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
  /** M5: inside a "look at your opponent's top card" (flip up … flip down) */
  peekFlipOpen?: boolean;
  /** the step being translated (builders that read a second target, M5) */
  currentStep?: OptcgStep;
  /** "you may X. If you do," phrases already turned into mayPay (M5) */
  mayUsed?: number;
}

export interface AbilityResult {
  keywords: Keyword[];
  effects: Effect[];
  /** abilities with no IR timing (listed in notes) */
  dropped: string[];
  manual: number;
  approx: Set<string>;
}
