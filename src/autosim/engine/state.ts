/**
 * AUTOSIM engine state — fully JSON-serializable (AUTOSIM_PLAN.md §1, §4).
 * The state is derivable by folding `applyEvent` (events.ts) over the event
 * log; the engine (engine.ts) is the only writer and always goes through
 * events. Rule references ("7-1-2-1") point at
 * docs/rules/op_comprehensive_rules_v1.2.0.txt.
 */
import type { Action, CompiledCard, Duration, Keyword } from "../ir/types";

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
  /** M1+: compiled IR for the card (keywords + effects). Absent = vanilla. */
  compiled?: CompiledCard;
}
export type CardDb = (cardId: string) => EngineCard;

export interface AutoInstance {
  iid: Iid;
  cardId: string;
  rested: boolean;
  /** Turn the card entered the character area — summoning sickness (3-7-4). */
  playedOnTurn?: number;
}

/** DON!! are 10 identical cards — modeled as counters, not instances.
 *  `given` maps a Leader/Character iid to the number of DON!! given to it
 *  (given DON are neither active nor rested, 4-4-2). */
export interface DonState {
  deck: number;
  active: number;
  rested: number;
  given: Record<Iid, number>;
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
}

export type RestrictionKind =
  | "cannotAttack" | "cannotBeKOd" | "cannotBlock" | "cannotBeAttacked" | "mustAttackIfAble";

/** A continuous modifier produced by a resolved one-shot effect (plan §4):
 *  recalculated over base values — base power is never mutated. Durations
 *  expire at the exact rule points (thisBattle 7-1-5-3/4, thisTurn 6-6-1-3,
 *  untilStartOfYourNextTurn 6-2-1) inside the event reducer. */
export interface Modifier {
  source: Iid;
  /** Player whose effect created the modifier (expiry ordering 7-1-5-3/4). */
  controller: PID;
  kind: "powerMod" | "keywordGrant" | "restriction";
  targetOwner: PID;
  targetIid: Iid;
  amount?: number;            // powerMod
  keyword?: Keyword;          // keywordGrant
  restriction?: RestrictionKind;
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
}

/** The effect currently resolving, action by action (1-3-7 written order). */
export interface RunningEffect {
  controller: PID;
  sourceIid: Iid;
  sourceCardId: string;
  /** Index into compiled.effects; -1 for synthetic effects (counter values). */
  effectIndex: number;
  actionIndex: number;
  /** Set while resolving a [Trigger] card: the card belongs to no area
   *  (10-1-5-3) until trashed — unless an action moved it (`moved`). */
  triggerCard?: { iid: Iid; moved: boolean };
}

/** What the engine resumes once the effect queue drains. */
export type FlowResume =
  | { at: "toBlockStep" }                  // after Attack Step effects (7-1-1-3 → 7-1-2)
  | { at: "toCounterWindow" }              // after a block / a [Counter] event (7-1-3-2)
  | { at: "damage"; remaining: number }    // resume suspended damage (8-6-2-1)
  | { at: "toEndBattle" }                  // after post-damage effects (8-6-2 → 7-1-5)
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
}

/** The engine stops on one of these and waits for a ChoiceResponse intent. */
export type ChoiceRequest =
  | { kind: "mulligan"; player: PID }                        // 5-2-1-6
  | { kind: "blockWindow"; player: PID; blockers: Iid[] }    // 7-1-2
  | { kind: "counterWindow"; player: PID }                   // 7-1-3
  | { kind: "triggerDecision"; player: PID; iid: Iid; cardId: string } // 8-6-2-1, 10-1-5
  | { kind: "selectTargets"; player: PID; sourceIid: Iid; actionKind: Action["kind"];
      candidates: { owner: PID; iid: Iid }[]; count: number; upTo: boolean } // 8-4-4
  | { kind: "mayActivate"; player: PID; sourceIid: Iid; sourceCardId: string; effectIndex: number } // 8-1-2
  | { kind: "manualResolve"; player: PID; sourceIid: Iid; text: string };    // plan §1.3 fallback

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
  /** [Once Per Turn] bookkeeping (10-2-13): `${pid}:${iid}:${effectIndex}` →
   *  global turn it resolved on. Entries for an iid are dropped when the card
   *  leaves the field (3-1-6: new card = fresh counter). */
  oncePerTurnUsed: Record<string, number>;
  /** Effect-resolution bookkeeping (not event-derived, like pendingChoice). */
  exec: ExecState | null;
  pendingChoice: ChoiceRequest | null;
  winner: PID | null;
  winReason: string | null;
}

/** Effective power: base + given DON ×1000 during the owner's turn (6-5-5-2)
 *  + active powerMod modifiers (counter values 7-1-3-2-1, effect powerMods).
 *  Always recomputed from base values — base power is never mutated. */
export function effectivePower(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number {
  const p = state.players[owner];
  const inst = p.instances[iid];
  const base = db(inst.cardId).power ?? 0;
  const donBonus = owner === state.turnPlayer ? (p.don.given[iid] ?? 0) * 1000 : 0;
  const modBonus = state.modifiers
    .filter((m) => m.kind === "powerMod" && m.targetOwner === owner && m.targetIid === iid)
    .reduce((s, m) => s + (m.amount ?? 0), 0);
  return base + donBonus + modBonus;
}

/** Keywords of a card on the field: compiled keywords (10-1) plus active
 *  keywordGrant modifiers ("gains [Keyword]"). */
export function keywordsOf(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): Set<Keyword> {
  const inst = state.players[owner].instances[iid];
  const kws = new Set<Keyword>(db(inst.cardId).compiled?.keywords ?? []);
  for (const m of state.modifiers) {
    if (m.kind === "keywordGrant" && m.targetOwner === owner && m.targetIid === iid && m.keyword) {
      kws.add(m.keyword);
    }
  }
  return kws;
}

/** Whether an active restriction modifier applies to the card. M1 enforces
 *  cannotAttack and cannotBlock; other kinds are stored but unenforced (M4). */
export function hasRestriction(state: AutoGameState, owner: PID, iid: Iid, what: RestrictionKind): boolean {
  return state.modifiers.some(
    (m) => m.kind === "restriction" && m.targetOwner === owner && m.targetIid === iid && m.restriction === what,
  );
}

export function opponentOf(state: AutoGameState, player: PID): PID {
  return state.order[0] === player ? state.order[1] : state.order[0];
}

/** Each player's first turn: global turn 1 (first player) and 2 (second). */
export function isPlayersFirstTurn(state: AutoGameState, player: PID): boolean {
  return (state.order[0] === player && state.turn === 1)
      || (state.order[1] === player && state.turn === 2);
}
