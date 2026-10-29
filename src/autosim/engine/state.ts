/**
 * AUTOSIM engine state — fully JSON-serializable (AUTOSIM_PLAN.md §1, §4).
 * The state is derivable by folding `applyEvent` (events.ts) over the event
 * log; the engine (engine.ts) is the only writer and always goes through
 * events. Rule references ("7-1-2-1") point at
 * docs/rules/op_comprehensive_rules_v1.2.0.txt.
 */
import type { Action, CompiledCard, CostItem, Duration, Keyword, SelectorFilter } from "../ir/types";
import { activeModifiers } from "./continuous";
import { cachedPerVersion } from "./stateVersion";

export type PID = string;
export type Iid = string; // deterministic instance id: `${seat}#${n}`

/** Minimal card data the engine needs. Resolved via a CardDb lookup —
 *  card metadata never lives inside the game state. */
export interface EngineCard {
  id: string;
  category: "Leader" | "Character" | "Event" | "Stage";
  /** Play cost; for Leaders this is the Life value (local DB quirk, see cardsDb). */
  cost: number | null;
  power: number | null;
  counter: number | null;
  colors: string[];
  types: string[];
  /** Card name, used by `nameIncludes` selector filters (optional — synthetic
   *  test DBs may omit it; a filter on a missing name simply never matches). */
  name?: string;
  /** Attributes (Strike, Slash, …) for `attributes` filters (M5; optional). */
  attributes?: string[];
  /** M1+: compiled IR for the card (keywords + effects). Absent = vanilla. */
  compiled?: CompiledCard;
  /** M5: the card has printed effect text ("no base effect" filters).
   *  Absent = judged from `compiled`. */
  hasEffect?: boolean;
}
export type CardDb = (cardId: string) => EngineCard;

export interface AutoInstance {
  iid: Iid;
  cardId: string;
  rested: boolean;
  /** Turn the card entered the character area — summoning sickness (3-7-4). */
  playedOnTurn?: number;
  /** Life cards only (M5): turned face-up. Set whenever a card enters the
   *  Life area; meaningless elsewhere. */
  faceUp?: boolean;
}

/** DON!! are 10 identical cards — modeled as counters, not instances.
 *  `given` maps a Leader/Character iid to the number of DON!! given to it
 *  (given DON are neither active nor rested, 4-4-2). */
export interface DonState {
  deck: number;
  active: number;
  rested: number;
  given: Record<Iid, number>;
  /** M5: rested DON!! that stay rested in the owner's next Refresh Phase */
  frozen?: number;
}

export interface AutoPlayerState {
  id: PID;
  leaderIid: Iid;
  zones: {
    deck: Iid[];       // secret, index 0 = top (3-2)
    hand: Iid[];       // secret (3-4)
    trash: Iid[];      // open, last = top (3-5)
    life: Iid[];       // secret, LAST = top (3-10; dealt bottom-first 2-9-2-1)
    characterArea: Iid[]; // max 5 (3-7-6)
    stage: Iid[];      // max 1 (3-8-5)
  };
  instances: Record<Iid, AutoInstance>;
  don: DonState;
  /** Player took (or declined) their one mulligan (5-2-1-6). */
  mulliganResolved: boolean;
  /** M5: base costs of the Events this player activated during this turn */
  eventsThisTurn?: number[];
  /** M5: this turn, a card of this player's hand was trashed by an effect / a Character of theirs was K.O.'d */
  thisTurn?: { handTrashed?: boolean; characterKOd?: boolean; leaderBattledCharacter?: boolean };
  /** "when your deck is reduced to 0, you win the game instead of losing" (Leader rule, M5) */
  deckOutWins?: boolean;
  /** "You lose at the end of the turn in which your deck becomes 0 cards" (Leader rule, M5) */
  deckOutAtEnd?: boolean;
}

export type RestrictionKind =
  | "cannotAttack" | "cannotBeKOd" | "cannotBeKOdInBattle" | "cannotBlock"
  | "cannotBeAttacked" | "mustAttackIfAble"
  // "your opponent cannot attack any card other than this Character" (M5): on the lure itself
  | "onlyAttackTarget"
  // a positive permission, stored with the same modifier machinery (M3):
  | "canAttackActiveCharacters"
  // "will not become active in the next Refresh Phase" (M5) — read and
  // consumed by that player's Refresh Phase (6-2-4)
  | "skipNextRefresh"
  // "cannot be rested" (M5): not by effects or costs, and so it can neither
  // attack (7-1-1-1 rests the attacker) nor block (10-1-4-1)
  | "cannotBeRested"
  // "you cannot play Character cards (with a base cost of N or more) during
  // this turn" (M5): stored on the player's Leader, amount = N (0 = all)
  | "cannotPlayCharacters"
  // M5 — "by your opponent's effects" variants (the effect's controller is
  // the other player): K.O., removal from the field (K.O., bounce, deck,
  // trash, Life), being rested
  | "cannotBeKOdByOpponent" | "cannotBeRemovedByOpponent" | "cannotBeRestedByOpponent"
  // "you cannot add Life cards to your hand using your own effects" (M5): on the player's Leader
  | "cannotTakeLifeByOwnEffects"
  // "you cannot draw cards using your own effects" (M5): on the player's Leader
  | "cannotDrawByOwnEffects"
  // "you cannot set DON!! cards as active using Character effects" (M5): on the player's Leader
  | "cannotStandDonByCharacters"
  // "your opponent cannot activate [Blocker] during this turn" (M5): on the blocked player's Leader
  | "noBlockers"
  // "This Character cannot attack a Leader" (M5)
  | "cannotAttackLeaders"
  // M5: "you cannot attack a Leader during this turn" (on the Leader), "do not become active in
  // Refresh Phases" (static), "Your Character cards are played rested" (on the Leader)
  | "noLeaderAttacks" | "noRefresh" | "charactersPlayedRested" | "cannotPlayFromHand"
  // M5: "negate the effect of …" — the card's own effects and keywords do nothing
  | "effectsNegated"
  // M5: on a Leader — "Your [On Play] effects are negated"; on a card in the hand — "cannot be played by effects"
  | "onPlaysNegated" | "cannotBePlayedByEffects" | "cannotBeKOdByEffectsOf"
  // M5: "this Leader cannot attack your opponent's Characters with a base cost of N or less" (amount = N)
  | "cannotAttackCharactersBaseCostAtMost"
  | "toDeckBottomAtEndOfBattle" // M5: read by endBattle (battle.ts)
  | "faceUpLifeToDeck" // M5: on a Leader — damage sends face-up Life cards to the deck bottom
  | "gainsAttribute" // M5: "gains the <Slash> attribute" (attributes)
  | "restDonAtMainStart" // M5: read at the start of the Main Phase (battle.ts)
  | "grantsReplacement" // M5: read by findReplacements (replacements.ts)
  | "attackTaxDiscard"; // M5: attacking costs `amount` cards from the hand (battle.ts)

/** A continuous modifier produced by a resolved one-shot effect (plan §4):
 *  recalculated over base values — base power is never mutated. Durations
 *  expire at the exact rule points (thisBattle 7-1-5-3/4, thisTurn 6-6-1-3,
 *  untilStartOfYourNextTurn 6-2-1) inside the event reducer. */
export interface Modifier {
  source: Iid;
  /** Player whose effect created the modifier (expiry ordering 7-1-5-3/4). */
  controller: PID;
  kind: "powerMod" | "keywordGrant" | "restriction" | "costMod" | "basePower" | "counter" | "playDiscount";
  /** playDiscount (M5): the cards of targetOwner's hand it applies to (name / base cost) */
  filter?: { nameIncludes?: string[]; baseCostAtLeast?: number };
  targetOwner: PID;
  targetIid: Iid;
  amount?: number;            // powerMod
  keyword?: Keyword;          // keywordGrant
  restriction?: RestrictionKind;
  /** cannotBeKOdInBattle only against attackers with one of these attributes
   *  ("by <Slash> attribute cards", M5); `attackerCharactersOnly` = not Leaders */
  attributes?: string[];
  attackerCharactersOnly?: boolean;
  attackerLeadersOnly?: boolean;
  /** M5: see the restriction action (ir/types.ts) */
  exceptAttributes?: string[];
  sourceFilter?: SelectorFilter;
  sourceOpponentOnly?: boolean;
  duration: Duration;
  /** Turn-anchored durations: whose "your turn" the wording refers to. */
  anchor: PID;
  /** Global turn number the modifier was created on (expiry bookkeeping). */
  createdTurn: number;
}

/** A battle in progress (7-1). The step advances via events; windows and
 *  effect resolution pause on ChoiceRequests. */
export interface BattleState {
  attackerOwner: PID;
  attackerIid: Iid;
  defenderOwner: PID;
  /** The current target instance (leader or a rested character). A [Blocker]
   *  redirect (10-1-4-1) swaps this. */
  targetIid: Iid;
  step: "attack" | "block" | "counter" | "damage" | "ended";
  /** 7-1-2-1: [Blocker] can be activated only once during the battle. */
  blockerUsed: boolean;
  /** Damage instances still to process while damage is suspended by a
   *  [Trigger] decision (8-6-2-1) or by an executing trigger effect. */
  pendingDamage: number;
  /** M5: "when this card's attack deals damage" already queued this battle */
  damageReacted?: boolean;
  /** M5: replacements declined for the battle K.O. ("sourceIid:effectIndex") */
  koDeclined?: string[];
  /** M5: damage replacements declined for the current damage instance ("sourceIid:effectIndex") */
  damageDeclined?: string[];
}

/** An auto effect whose activation timing was fulfilled, waiting in the
 *  resolution queue (8-6). `gen` is the fulfillment generation: effects
 *  fulfilled earlier resolve first; within a generation the turn player
 *  resolves first (8-6-1, 8-6-1-1). */
export interface QueuedEffect {
  controller: PID;
  sourceIid: Iid;
  sourceCardId: string;
  effectIndex: number;
  gen: number;
  /** [On K.O.] resolves from the trash (10-2-17-2) — skip the
   *  source-still-on-field check of 8-1-3-1-3. */
  fromTrash?: boolean;
  /** M5: a scheduled ("at the end of this turn") effect — wherever its card is */
  anyZone?: boolean;
  /** M5: the card the event was about ("that Character") — the effect's first previous target */
  subject?: { owner: PID; iid: Iid };
}

/** The effect currently resolving: activation costs first (8-3-1-1), then
 *  actions in written order (1-3-7). `costs`/`actions` are JSON snapshots so
 *  ifThen can splice its branch inline and choices can resume mid-item. */
export interface RunningEffect {
  controller: PID;
  sourceIid: Iid;
  sourceCardId: string;
  /** Index into compiled.effects; kept for logs/choice context. */
  effectIndex: number;
  /** Unpaid activation-cost items, paid in written order (8-3-1-1). */
  costs: CostItem[];
  costIndex: number;
  actions: Action[];
  actionIndex: number;
  /** Targets chosen by the last selector action — "that card" binding for
   *  `sel.prev` (M3). */
  lastTargets: { owner: PID; iid: Iid }[];
  /** "Choose a cost" (M5): the number named by declareCost */
  declared?: number;
  /** "If the trashed card has a cost of 6 or more" (M5): the cards the last mill trashed */
  lastMilled?: { owner: PID; iid: Iid }[];
  /** "for every DON!! card rested this way" (M5): a count chosen with no card targets */
  lastCount?: number;
  /** M5: damage still to deal by the current dealDamage action */
  damageLeft?: number;
  /** Set while resolving a [Trigger] card: the card belongs to no area
   *  (10-1-5-3) until trashed — unless an action moved it (`moved`). */
  triggerCard?: { iid: Iid; moved: boolean };
  /** M5: a removal action waiting on replacement decisions (8-1-3-4):
   *  declined = "targetIid|sourceIid:effectIndex", replaced = protected targets */
  guard?: { action: Action; targets: { owner: PID; iid: Iid }[]; declined: string[]; replaced: Iid[] };
}

/** What the engine resumes once the effect queue drains. */
export type FlowResume =
  | { at: "toBlockStep" }                  // after Attack Step effects (7-1-1-3 → 7-1-2)
  | { at: "toCounterWindow" }              // after a block / a [Counter] event (7-1-3-2)
  | { at: "damage"; remaining: number }    // resume suspended damage (8-6-2-1)
  | { at: "toEndBattle" }                  // after post-damage effects (8-6-2 → 7-1-5-2)
  | { at: "toBattleCleanup" }              // after end-of-battle effects → 7-1-5-3/4/5
  | { at: "toEndTurn" }                    // after End Phase effects (6-6-1-1/2) → next turn
  | { at: "toRefresh" }                    // M5: after "at the start of your turn" effects (6-2-1) → Refresh / Draw / DON!!
  | { at: "none" };                        // main-phase effect (e.g. [On Play])

/** Effect-resolution bookkeeping. Like `pendingChoice`, this is engine
 *  bookkeeping, NOT event-derived — replay realigns it explicitly
 *  (AUTOSIM_PLAN.md "Decisioni", M0 #4). */
export interface ExecState {
  queue: QueuedEffect[];
  gen: number;
  running: RunningEffect | null;
  /** Popped optional effect awaiting its mayActivate answer (8-1-2). */
  pendingMay: QueuedEffect | null;
  flow: FlowResume;
  /** M5: effects interrupted by a replacement effect, resumed when it ends */
  suspended?: RunningEffect[];
}

/** The engine stops on one of these and waits for a ChoiceResponse intent. */
export type ChoiceRequest =
  | { kind: "mulligan"; player: PID }                        // 5-2-1-6
  | { kind: "blockWindow"; player: PID; blockers: Iid[] }    // 7-1-2
  | { kind: "counterWindow"; player: PID }                   // 7-1-3
  | { kind: "triggerDecision"; player: PID; iid: Iid; cardId: string; effectDamage?: boolean } // 8-6-2-1, 10-1-5 (M5: from "deal 1 damage")
  | { kind: "selectTargets"; player: PID; sourceIid: Iid; actionKind: Action["kind"];
      candidates: { owner: PID; iid: Iid }[]; count: number; upTo: boolean; // 8-4-4
      /** M5 set constraints, checked on the answer */
      totalCostAtMost?: number; totalPowerAtMost?: number; distinctNames?: boolean }
  | { kind: "mayActivate"; player: PID; sourceIid: Iid; sourceCardId: string; effectIndex: number } // 8-1-2
  | { kind: "manualResolve"; player: PID; sourceIid: Iid; text: string }     // plan §1.3 fallback
  // M3 — look-at-deck resolution (8-4-4-2/4, 11-2-1): the controller sees the
  // peeked cards, takes/plays up to takeCount matching ones, and arranges the
  // rest per the card's disposition.
  | { kind: "peekSelect"; player: PID; sourceIid: Iid; cards: Iid[]; eligible: Iid[];
      takeCount: number; mode: "hand" | "play" | "life" | "trash" | "none";
      rest: "topAnyOrder" | "bottomAnyOrder" | "topOrBottomAnyOrder" | "shuffle" | "trash";
      playRested: boolean }
  // M5 — "look at all of your Life cards and place them back in any order":
  // cards top first; toDeckTop of them go to the top of the owner's deck first
  | { kind: "arrangeLife"; player: PID; sourceIid: Iid; lifeOwner: PID; cards: Iid[]; toDeckTop: number }
  // M3 — DON!!−X payment composition (8-3-1-6: from leader area, character
  // area and cost area). Offered only when attached DON make it a real choice.
  | { kind: "payDon"; player: PID; sourceIid: Iid; amount: number }
  // M3 — "draw up to N" and friends (8-4-4-1: 'up to' allows 0).
  | { kind: "chooseNumber"; player: PID; sourceIid: Iid; min: number; max: number; purpose: "draw" | "life" | "declare" | "restDon" | "addDon" | "standDon" }
  // M5 — "Choose one:" (purpose effect) and "X or Y:" costs (purpose cost):
  // the controller picks one of `options`; only `enabled` ones are legal.
  | { kind: "chooseOption"; player: PID; sourceIid: Iid; options: string[]; enabled: boolean[]; purpose: "effect" | "cost" }
  // M5 — "you may [do X] instead" (8-1-3-4): the protected card's owner decides
  | { kind: "mayReplace"; player: PID; sourceIid: Iid; effectIndex: number; targetIid: Iid; battle: boolean; damage?: boolean }; // M5: damage = "If you would take damage"

export interface AutoGameState {
  /** RNG seed; each shuffle derives from `${seed}:${rngUses}` so replays are
   *  deterministic and the reducer itself never needs RNG (shuffle events
   *  carry the resulting order). */
  seed: string;
  rngUses: number;
  order: [PID, PID];       // order[0] goes first (5-2-1-5)
  turn: number;            // global turn counter, 1 = first player's first turn
  turnPlayer: PID;
  phase: "setup" | "main" | "over";
  players: Record<PID, AutoPlayerState>;
  battle: BattleState | null;
  /** Active continuous modifiers (counter values, powerMods, keyword grants,
   *  restrictions). Event-derived; expired by the reducer at rule points. */
  modifiers: Modifier[];
  /** M5 — delayed effects to run at the end of a turn ("trash this Character
   *  at the end of this turn"): queued in that turn's End Phase. */
  scheduled?: { turn: number; controller: PID; sourceIid: Iid; sourceCardId: string; effectIndex: number; subject?: { owner: PID; iid: Iid } }[];
  /** [Once Per Turn] bookkeeping (10-2-13): `${pid}:${iid}:${effectIndex}` →
   *  global turn it resolved on. Entries for an iid are dropped when the card
   *  leaves the field (3-1-6: new card = fresh counter). */
  oncePerTurnUsed: Record<string, number>;
  /** Effect-resolution bookkeeping (not event-derived, like pendingChoice). */
  exec: ExecState | null;
  pendingChoice: ChoiceRequest | null;
  winner: PID | null;
  winReason: string | null;
  /** M5: turn numbers that were extra turns (they break the odd/even ownership) */
  extraTurns?: number[];
  /** M5: "take an extra turn after this one" — this player goes again */
  extraTurn?: PID;
}

/** Effective power: base + given DON ×1000 during the owner's turn (6-5-5-2)
 *  + active powerMod modifiers (counter values 7-1-3-2-1, effect powerMods).
 *  Always recomputed from base values — base power is never mutated. */
/** Base power (4-9): printed, unless an effect set it ("base power becomes
 *  N", M5) — the latest such effect wins. */
export function effectiveBasePower(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number {
  const inst = state.players[owner].instances[iid];
  const set = activeModifiers(db, state).filter((m) => m.kind === "basePower" && m.targetOwner === owner && m.targetIid === iid);
  return set.length > 0 ? (set[set.length - 1].amount ?? 0) : (db(inst.cardId).power ?? 0);
}

export function effectivePower(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number {
  const p = state.players[owner];
  const base = effectiveBasePower(db, state, owner, iid);
  const donBonus = owner === state.turnPlayer ? (p.don.given[iid] ?? 0) * 1000 : 0;
  const modBonus = activeModifiers(db, state)
    .filter((m) => m.kind === "powerMod" && m.targetOwner === owner && m.targetIid === iid)
    .reduce((s, m) => s + (m.amount ?? 0), 0);
  return base + donBonus + modBonus;
}

/** Keywords of a card on the field: compiled keywords (10-1) plus active
 *  keywordGrant modifiers ("gains [Keyword]"). */
export function keywordsOf(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): Set<Keyword> {
  const inst = state.players[owner].instances[iid];
  const kws = new Set<Keyword>(isNegated(state, owner, iid, db) ? [] : db(inst.cardId).compiled?.keywords ?? []);
  for (const m of activeModifiers(db, state)) {
    if (m.kind === "keywordGrant" && m.targetOwner === owner && m.targetIid === iid && m.keyword) {
      kws.add(m.keyword);
    }
  }
  return kws;
}

/** A card's attributes: printed, plus "gains the <Slash> attribute" (stored modifiers, M5). */
export function attributesOf(state: AutoGameState, iid: Iid, card: EngineCard): string[] {
  const gained = state.modifiers.filter((m) => m.kind === "restriction" && m.restriction === "gainsAttribute" && m.targetIid === iid).flatMap((m) => m.attributes ?? []);
  return gained.length ? [...new Set([...(card.attributes ?? []), ...gained])] : card.attributes ?? [];
}

/** Cards from the hand an attack by this card costs (M5, "unless your opponent trashes 2 cards"). */
export function attackTax(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number {
  return activeModifiers(db, state).filter((m) => m.kind === "restriction" && m.restriction === "attackTaxDiscard" && m.targetOwner === owner && m.targetIid === iid)
    .reduce((s, m) => Math.max(s, m.amount ?? 2), 0);
}

/** "this Leader cannot attack your opponent's Characters with a base cost of N or less" (M5). */
export function baseCostLocked(db: CardDb, state: AutoGameState, attackerOwner: PID, attackerIid: Iid, defender: PID, targetIid: Iid): boolean {
  if (!state.players[defender].zones.characterArea.includes(targetIid)) return false;
  const cost = db(state.players[defender].instances[targetIid].cardId).cost ?? 0;
  return activeModifiers(db, state).some((m) => m.kind === "restriction" && m.restriction === "cannotAttackCharactersBaseCostAtMost"
    && m.targetOwner === attackerOwner && m.targetIid === attackerIid && cost <= (m.amount ?? 0));
}

/** "Negate the effect of …" (M5): a stored modifier only, so the continuous
 *  pass can read it without recursion. */
export function isNegated(state: AutoGameState, owner: PID, iid: Iid, db?: CardDb): boolean {
  if (state.modifiers.some((m) => m.kind === "restriction" && m.restriction === "effectsNegated" && m.targetOwner === owner && m.targetIid === iid)) return true;
  return !!db && staticallyNegated(db, state, owner, iid);
}

/** "Your Leader and all of your Characters that do not have a type including
 *  [X] have their effects negated" (M5): a static negateEffect, matched on
 *  card types only (no power / condition reads, so no recursion). */
function staticallyNegated(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): boolean {
  const rules = negationRules(db, state);
  if (rules.length === 0) return false; // the usual case: nothing on the field negates
  const card = db(state.players[owner].instances[iid].cardId);
  for (const { src, sel } of rules) {
    const side = sel.owner === "any" || (sel.owner === "self") === (src === owner);
    const zoneOk = sel.zone === "leaderOrCharacter" ? (iid === state.players[owner].leaderIid || state.players[owner].zones.characterArea.includes(iid))
      : sel.zone === "characterArea" ? state.players[owner].zones.characterArea.includes(iid) : false;
    const f = sel.filter ?? {};
    const typeOk = (!f.typeExcludes || !f.typeExcludes.some((t) => card.types.includes(t)))
      && (!f.typeIncludes || f.typeIncludes.some((t) => card.types.includes(t)));
    if (side && zoneOk && typeOk) return true;
  }
  return false;
}

/** The unconditional static negateEffect actions on the field, with the
 *  player whose card carries them. Asked for every card on every query, but
 *  it only changes when an event changes the field. */
const negationRules = cachedPerVersion((db: CardDb, state: AutoGameState) => {
  const rules: { src: PID; sel: Extract<Action, { kind: "negateEffect" }>["sel"] }[] = [];
  for (const src of state.order) {
    const p = state.players[src];
    for (const s of [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage]) {
      for (const fx of db(p.instances[s].cardId).compiled?.effects ?? []) {
        if (fx.timing !== "static" || fx.conditions?.length) continue;
        for (const a of fx.actions) if (a.kind === "negateEffect") rules.push({ src, sel: a.sel });
      }
    }
  }
  return rules;
});

/** Whether a restriction applies to the card: stored modifiers plus the
 *  continuous effects on the field (M4, continuous.ts). */
export function hasRestriction(db: CardDb, state: AutoGameState, owner: PID, iid: Iid, what: RestrictionKind): boolean {
  return activeModifiers(db, state).some(
    (m) => m.kind === "restriction" && m.targetOwner === owner && m.targetIid === iid && m.restriction === what,
  );
}

/** Effective play cost: base + costMod modifiers, floored at 0 (M3). */
/** The counter value of a card in the hand: a "becomes +N" static wins over the printed one (M5). */
export function effectiveCounter(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number {
  const set = activeModifiers(db, state).filter((m) => m.kind === "counter" && m.targetOwner === owner && m.targetIid === iid);
  if (set.length > 0) return set[set.length - 1].amount ?? 0;
  return db(state.players[owner].instances[iid].cardId).counter ?? 0;
}

export function effectiveCost(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number {
  const inst = state.players[owner].instances[iid];
  const base = db(inst.cardId).cost ?? 0;
  const mod = activeModifiers(db, state)
    .filter((m) => m.kind === "costMod" && m.targetOwner === owner && m.targetIid === iid)
    .reduce((s, m) => s + (m.amount ?? 0), 0);
  const discount = playDiscountFor(db, state, owner, iid);
  return Math.max(0, base + mod - (discount?.amount ?? 0));
}

/** "The next time you play [X] …, the cost will be reduced by N" (M5): the
 *  first such discount that applies to this card of the owner's hand. */
export function playDiscountFor(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): Modifier | null {
  if (!state.players[owner].zones.hand.includes(iid)) return null;
  const card = db(state.players[owner].instances[iid].cardId);
  return state.modifiers.find((m) => m.kind === "playDiscount" && m.targetOwner === owner
    && (!m.filter?.nameIncludes || m.filter.nameIncludes.some((n) => (card.name ?? "").toLowerCase().includes(n.toLowerCase())))
    && (m.filter?.baseCostAtLeast === undefined || (card.cost ?? 0) >= m.filter.baseCostAtLeast)) ?? null;
}

export function opponentOf(state: AutoGameState, player: PID): PID {
  return state.order[0] === player ? state.order[1] : state.order[0];
}

/** Each player's first turn: global turn 1 (first player) and 2 (second). */
/** Whether `targetIid` of `defender` may be chosen as an attack target by
 *  rule effects (M5): "cannot be attacked", "cannot attack any card other than [X]". */
export function attackTargetAllowed(db: CardDb, state: AutoGameState, defender: PID, targetIid: Iid): boolean {
  if (hasRestriction(db, state, defender, targetIid, "cannotBeAttacked")) return false;
  const d = state.players[defender];
  const lures = [d.leaderIid, ...d.zones.characterArea].filter((iid) => hasRestriction(db, state, defender, iid, "onlyAttackTarget"));
  return lures.length === 0 || lures.includes(targetIid);
}

/** How many of its own turns `player` has started (turn 1 = first player's;
 *  M5: extra turns keep the same player). */
export function ownTurnCount(state: AutoGameState, player: PID): number {
  if (!state.extraTurns?.length) return state.order[0] === player ? Math.ceil(state.turn / 2) : Math.floor(state.turn / 2);
  let owner = state.order[0];
  let n = 0;
  for (let t = 1; t <= state.turn; t++) {
    if (t > 1 && !state.extraTurns.includes(t)) owner = owner === state.order[0] ? state.order[1] : state.order[0];
    if (owner === player) n++;
  }
  return n;
}

export function isPlayersFirstTurn(state: AutoGameState, player: PID): boolean {
  if (state.extraTurns?.length) return state.turnPlayer === player && ownTurnCount(state, player) === 1;
  return (state.order[0] === player && state.turn === 1)
      || (state.order[1] === player && state.turn === 2);
}
