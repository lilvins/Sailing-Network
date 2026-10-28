// Core data types shared by the rules engine and the AI.
// Everything in GameState is plain JSON so it can be structuredClone'd for rollouts
// and posted to a Web Worker.
//
// Card effects use the optcgwebsim "actionV3" step DSL (see docs/effect-dsl/).

export type Seat = 0 | 1;
export type CardType = 'Leader' | 'Character' | 'Event' | 'Stage';

export type Json = Record<string, any>;

/** One target spec of a step (filters + zones). */
export type TargetSpec = Json;

export interface Step {
  effect?: Json;
  details?: Json;
  target?: TargetSpec[];
  targetOverrides?: TargetSpec[];
}

export interface Ability {
  proc: Json;
  steps: Step[];
}

export interface CardDef {
  id: string;
  name: string;
  /** name + extraNames ("also treat this card's name as ...") */
  names: string[];
  type: CardType;
  colors: number[];
  categories: number[];
  cost: number;
  power: number;
  counter: number;
  life: number;
  /** attribute ids (strikeType + extraStrikeTypes): 0 Strike, 1 Slash, 2 Ranged, 3 Special, 4 Wisdom */
  attributes: number[];
  abilities: Ability[];
  /** Indices of Passive abilities (precomputed). */
  passives: number[];
  text: string;
  /** Effect keys the engine does not implement (filled at load time). */
  unsupported: string[];
}

export type Db = Record<string, CardDef>;

/** When a temporary modifier expires. Turn numbers are global (s.turn). */
export type Expiry =
  | { at: 'battle' }
  | { at: 'end'; turn: number }
  | { at: 'start'; turn: number }
  /** Freeze: cleared at the owner's next Refresh Phase (and skips that refresh). */
  | { at: 'refresh'; seat: Seat };

/**
 * Temporary modifier on a card or player.
 *  power      +value
 *  basePower  base power becomes value (latest wins)
 *  cost       +value
 *  flag       boolean flag named `name` (rush, blocker, cantAttack, silenced, ...)
 *  attr       gains attribute `value`
 */
export interface Mod {
  kind: 'power' | 'basePower' | 'cost' | 'flag' | 'attr';
  name?: string;
  value: number;
  until: Expiry;
}

export interface CardInst {
  uid: number;
  id: string;
  owner: Seat;
  rested: boolean;
  /** DON!! attached to this card. */
  don: number;
  /** Turn on which it entered the field (summoning sickness / FirstTurnOnly). */
  enteredTurn: number;
  /** Ability indices already used this turn ([Once Per Turn]). */
  used: number[];
  mods: Mod[];
  /** Life cards only. */
  faceUp: boolean;
}

export interface PlayerStats {
  /** Highest cost of Events activated this turn. */
  eventMaxCost: number;
  oppCharKOd: boolean;
  lostLife: boolean;
  handTrashedByEffect: boolean;
  battledCharacter: number[];
}

export interface PlayerState {
  name: string;
  leader: CardInst;
  chars: CardInst[];
  stage: CardInst | null;
  hand: CardInst[];
  /** index 0 = top of deck */
  deck: CardInst[];
  /** last element = top life card */
  life: CardInst[];
  trash: CardInst[];
  donDeck: number;
  donActive: number;
  donRested: number;
  /** Player-level effects (cantPlayChars, cantDraw, oppNoBlocker, noOnPlays ...). */
  mods: Mod[];
  stats: PlayerStats;
  extraTurns: number;
}

/** Look-at / search buffer opened by StartTopDeck* keys. */
export interface View {
  owner: Seat;
  viewer: Seat;
  source: 'deck' | 'hand' | 'trash' | 'life';
  cards: number[];
  revealed: boolean;
}

export interface Replacement {
  /** Destination the card would have gone to. */
  move: MoveKind;
  uid: number;
  by: Seat;
  combat: boolean;
}

export type MoveKind = 'ko' | 'trash' | 'bounce' | 'deckBottom' | 'deckTop' | 'topLife' | 'bottomLife' | 'rest' | 'damage';

/** A running (or queued) ability. */
export interface Activation {
  uid: number;
  cardId: string;
  ability: number;
  owner: Seat;
  controller: Seat;
  timing: string;
  stepIdx: number;
  targets: number[][];
  prevTargets: number[];
  prevNames: string[];
  savedInt: number;
  savedString: string;
  mainTarget?: number;
  /** Activated by another effect: the Event cost step (step 0) is skipped. */
  free: boolean;
  checkedStep: number;
  confirmedStep: number;
  declaredStep: number;
  executedAny: boolean;
  /** A step with a real effect (not just opening a view / branching) has run. */
  effective?: boolean;
  replacement?: Replacement;
  /** For abilities added by our own data patches (not part of the card). */
  inline?: Ability;
}

/** DON!! are not cards: selections refer to them with pseudo uids. */
export const DON_ACTIVE = (seat: Seat) => -1 - seat * 2; // -1 / -3
export const DON_RESTED = (seat: Seat) => -2 - seat * 2; // -2 / -4
export const DON_ATTACHED = (uid: number) => -1000 - uid;

export type Prompt =
  | { kind: 'mulligan'; player: Seat }
  | { kind: 'block'; player: Seat }
  | { kind: 'counter'; player: Seat }
  | { kind: 'trigger'; player: Seat; uid: number }
  | {
      kind: 'select';
      player: Seat;
      /** Candidate uids (DON groups use pseudo uids, see DON_*). */
      candidates: number[];
      /** How many times each pseudo-uid DON group may be picked. */
      multiplicity: Record<number, number>;
      chosen: number[];
      min: number;
      max: number;
      cancelable: boolean;
      list: number;
    }
  | { kind: 'choice'; player: Seat; options: string[]; cancelable: boolean }
  | { kind: 'confirm'; player: Seat }
  | { kind: 'declare'; player: Seat; options: number[] };

export interface Battle {
  attacker: number;
  target: number;
  attackerOwner: Seat;
  step: 'attack' | 'block' | 'counter' | 'damage' | 'end';
  blocked: boolean;
  counterDone: boolean;
  hit: boolean | null;
  damageLeft: number;
}

export interface GameState {
  players: [PlayerState, PlayerState];
  /** Global turn counter, 1 = first player's first turn. */
  turn: number;
  active: Seat;
  first: Seat;
  phase: 'setup' | 'main' | 'end' | 'over';
  battle: Battle | null;
  prompt: Prompt | null;
  /** Running abilities; last = executing. */
  stack: Activation[];
  /** Triggered abilities waiting to run (turn player's first). */
  pending: Activation[];
  /** Delayed actions for the end of the current turn. */
  endOfTurn: Activation[];
  /** Delayed actions for the start of a player's next main phase. */
  startOfMain: { seat: Seat; act: Activation }[];
  view: View | null;
  ending: boolean;
  winner: Seat | null;
  nextUid: number;
  rng: number;
}

export type Action =
  | { type: 'mulligan'; redraw: boolean }
  | { type: 'play'; uid: number }
  | { type: 'attachDon'; target: number; n: number }
  | { type: 'activate'; uid: number; ability: number }
  | { type: 'attack'; attacker: number; target: number }
  | { type: 'endTurn' }
  | { type: 'block'; blocker: number | null }
  | { type: 'counter'; uid: number | null }
  | { type: 'trigger'; use: boolean }
  | { type: 'pick'; uid: number }
  | { type: 'done' }
  | { type: 'cancel' }
  | { type: 'choose'; idx: number }
  | { type: 'confirm'; yes: boolean };

export interface DeckList {
  name: string;
  leader: string;
  /** 50 card ids, one entry per copy. */
  cards: string[];
}
