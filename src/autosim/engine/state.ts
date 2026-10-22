/**
 * AUTOSIM engine state — fully JSON-serializable (AUTOSIM_PLAN.md §1, §4).
 * The state is derivable by folding `applyEvent` (events.ts) over the event
 * log; the engine (engine.ts) is the only writer and always goes through
 * events. Rule references ("7-1-2-1") point at
 * docs/rules/op_comprehensive_rules_v1.2.0.txt.
 */

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

/** A battle in progress (7-1). M0: no [Blocker]/effects — the block window
 *  auto-resolves; the structure still models every step. */
export interface BattleState {
  attackerOwner: PID;
  attackerIid: Iid;
  defenderOwner: PID;
  /** The current target instance (leader or a rested character). A [Blocker]
   *  redirect (M1) swaps this. */
  targetIid: Iid;
  step: "block" | "counter" | "damage" | "ended";
  /** thisBattle power mods (counters in M0). Expire at 7-1-5-3/4. */
  mods: { iid: Iid; amount: number }[];
}

/** The engine stops on one of these and waits for a ChoiceResponse intent. */
export type ChoiceRequest =
  | { kind: "mulligan"; player: PID }                        // 5-2-1-6
  | { kind: "blockWindow"; player: PID; blockers: Iid[] }    // 7-1-2 (M1 — emitted only if blockers exist)
  | { kind: "counterWindow"; player: PID };                  // 7-1-3

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
  pendingChoice: ChoiceRequest | null;
  winner: PID | null;
  winReason: string | null;
}

/** Effective power (M0): base + given DON ×1000 during the owner's turn
 *  (6-5-5-2) + thisBattle mods (counter values). */
export function effectivePower(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number {
  const p = state.players[owner];
  const inst = p.instances[iid];
  const base = db(inst.cardId).power ?? 0;
  const donBonus = owner === state.turnPlayer ? (p.don.given[iid] ?? 0) * 1000 : 0;
  const battleBonus = state.battle
    ? state.battle.mods.filter((m) => m.iid === iid).reduce((s, m) => s + m.amount, 0)
    : 0;
  return base + donBonus + battleBonus;
}

export function opponentOf(state: AutoGameState, player: PID): PID {
  return state.order[0] === player ? state.order[1] : state.order[0];
}

/** Each player's first turn: global turn 1 (first player) and 2 (second). */
export function isPlayersFirstTurn(state: AutoGameState, player: PID): boolean {
  return (state.order[0] === player && state.turn === 1)
      || (state.order[1] === player && state.turn === 2);
}
