/**
 * AUTOSIM Effect IR — the card-effect classification (AUTOSIM_PLAN.md §5).
 *
 * Every card compiles into a `CompiledCard`: a JSON-serializable description
 * of its effects as timing × conditions × cost × actions × selectors.
 * The AI compilation pipeline (plan §6) emits these; `validate.ts` checks them
 * against `schema.json` plus semantic lint rules; the engine executes them
 * (Action execution lands in M2 — M0 only defines and validates the IR).
 *
 * Everything here must stay JSON-serializable (no functions, no classes).
 */

export type Keyword =
  | "Rush"            // 10-1-1
  | "DoubleAttack"    // 10-1-2
  | "Banish"          // 10-1-3
  | "Blocker"         // 10-1-4
  | "RushCharacter"   // 10-1-6 [Rush: Character]
  | "Unblockable";    // 10-1-7

/** When an effect activates (comprehensive rules 8-1-3, 10-2). */
export type Timing =
  | "onPlay"                  // 10-2-6
  | "whenAttacking"           // 10-2-5
  | "onKO"                    // 10-2-17
  | "onBlock"                 // 10-2-15
  | "counter"                 // 10-2-4 (Event [Counter])
  | "trigger"                 // 10-1-5 ([Trigger] from Life)
  | "activateMain"            // 10-2-2
  | "main"                    // 10-2-3 (Event [Main])
  | "endOfYourTurn"           // 10-2-7
  | "endOfOpponentsTurn"      // 10-2-8
  | "startOfYourTurn"         // 6-2-2
  | "startOfOpponentsTurn"    // 6-2-2
  | "onYourOpponentsAttack"   // 10-2-16
  | "whenAttacked"            // 7-1-3-1
  | "endOfBattle"             // 7-1-5-2
  | "static";                 // permanent effects (8-1-3-3)

export type Duration =
  | "instant"
  | "thisBattle"                  // expires 7-1-5-3/4
  | "thisTurn"                    // expires 6-6-1-3
  | "untilStartOfYourNextTurn"    // expires 6-2-1
  | "untilEndOfOpponentsNextTurn"
  | "permanentWhileInPlay";

export type Who = "self" | "opponent" | "both";

export interface SelectorFilter {
  typeIncludes?: string[];    // {Type} braces (2-4-3)
  nameIncludes?: string[];    // [Name] / "partial" (2-1-2)
  colors?: string[];
  category?: ("Leader" | "Character" | "Event" | "Stage")[];
  costAtMost?: number;
  costAtLeast?: number;
  powerAtMost?: number;
  powerAtLeast?: number;
  rested?: boolean;
  hasKeyword?: Keyword;
  excludeSelf?: boolean;
}

export interface Selector {
  owner: "self" | "opponent" | "any";
  zone:
    | "characterArea" | "leader" | "leaderOrCharacter" | "stage"
    | "hand" | "trash" | "deckTop" | "costArea" | "life";
  filter?: SelectorFilter;
  count: number;
  upTo?: boolean;             // 4-8: may choose 0..count
  self?: boolean;             // the compiled card itself
  chooser: "controller" | "opponent";
}

/** Activation costs (before the `:` colon — 8-3-1). */
export type CostItem =
  | { kind: "restDon"; count: number }          // ① symbols (8-3-1-5)
  | { kind: "returnDonToDeck"; count: number }  // DON!! −X (8-3-1-6, 10-2-10)
  | { kind: "restSelf" }
  | { kind: "trashFromHand"; sel: Selector }
  | { kind: "trashSelf" }
  | { kind: "trashFromLife"; count: number };

/** Conditions ([DON!!xX], [Your Turn], … — 8-3-2). */
export type Condition =
  | { kind: "donAttached"; count: number }          // [DON!! xX] (10-2-9)
  | { kind: "yourTurn" }                            // 10-2-11
  | { kind: "opponentsTurn" }                       // 10-2-12
  | { kind: "leaderIs"; filter: SelectorFilter }
  | { kind: "countInZone"; sel: Selector; atLeast?: number; atMost?: number }
  | { kind: "lifeAtMost"; who: Who; count: number }
  | { kind: "lifeAtLeast"; who: Who; count: number }
  | { kind: "handAtMost"; who: Who; count: number }
  | { kind: "handAtLeast"; who: Who; count: number };

/** What to do with cards seen by a deck peek. */
export interface PeekDisposition {
  reveal?: boolean;
  addToHand?: Selector["filter"];   // add up to N matching (search)
  addCount?: number;
  play?: Selector["filter"];        // play matching from among them
  playCount?: number;
  rest: "topAnyOrder" | "bottomAnyOrder" | "shuffle" | "trash";
}

export type Action =
  // ── Tier 1 — core (majority of the pool) ──────────────────────────────────
  | { kind: "powerMod"; sel: Selector; amount: number; duration: Duration }
  | { kind: "koTarget"; sel: Selector }                       // 10-2-1
  | { kind: "draw"; count: number; upTo?: boolean }           // 4-5
  | { kind: "restTarget"; sel: Selector }
  | { kind: "standTarget"; sel: Selector }
  | { kind: "discard"; who: Who; sel: Selector }              // trash from hand (10-2-14)
  | { kind: "grantKeyword"; sel: Selector; keyword: Keyword; duration: Duration }
  | { kind: "restriction"; sel: Selector;
      what: "cannotAttack" | "cannotBeKOd" | "cannotBlock" | "cannotBeAttacked" | "mustAttackIfAble";
      duration: Duration }
  // ── Tier 2 — zones & resources ────────────────────────────────────────────
  | { kind: "returnToHand"; sel: Selector }
  | { kind: "playFromZone"; zone: "hand" | "trash" | "revealed"; sel: Selector;
      free?: boolean; rested?: boolean }
  | { kind: "peekDeck"; who: Who; count: number; then: PeekDisposition }
  | { kind: "mill"; who: Who; count: number }
  | { kind: "addFromTrashToHand"; sel: Selector }
  | { kind: "lifeToHand"; who: Who; count: number }
  | { kind: "trashLife"; who: Who; count: number }
  | { kind: "addToLife"; sel: Selector; faceUp?: boolean }
  | { kind: "giveRestedDon"; sel: Selector; count: number }   // from cost area
  | { kind: "attachDonFromDeck"; sel: Selector; count: number; rested?: boolean }
  | { kind: "placeDonInCostArea"; count: number; rested?: boolean }
  | { kind: "returnDonToDeck"; who: Who; count: number }
  | { kind: "costMod"; sel: Selector; amount: number; duration: Duration }
  | { kind: "setBasePower"; sel: Selector; amount: number; duration: Duration } // 4-9
  // ── Tier 3 — control & meta ───────────────────────────────────────────────
  | { kind: "negateEffect"; sel: Selector; scope: string; duration: Duration }
  | { kind: "redirectAttack"; sel: Selector }
  | { kind: "endBattle" }
  | { kind: "ifThen"; if: Condition[]; then: Action[]; else?: Action[] }  // 4-10
  | { kind: "chooseOne"; options: Action[][] }
  | { kind: "manual"; text: string };  // explicit escape hatch

export interface Effect {
  timing: Timing;
  oncePerTurn?: boolean;        // [Once Per Turn] (10-2-13)
  optional?: boolean;           // "you may" (8-1-2)
  conditions?: Condition[];
  cost?: CostItem[];
  actions: Action[];            // resolved in written order (1-3-7)
}

export type Classification =
  | "vanilla"        // no effect text at all
  | "keyword-only"   // only keyword effects (e.g. just [Blocker])
  | "compiled"       // fully expressed in IR
  | "partial"        // some effects compiled, some manual
  | "unsupported";   // falls back to manual resolution in-game

export interface CompiledCard {
  cardId: string;
  version: 1;
  /** Pipeline self-assessed confidence, 0..1. <0.75 → triage (plan §6). */
  confidence: number;
  classification: Classification;
  keywords: Keyword[];
  counterValue?: number;
  effects: Effect[];
  notes?: string;
}
