import cardsJson from "../../../public/data/cards.json";
import metaJson from "../../../public/data/meta-decks.json";
import type { Card } from "../../features/cards/cardsDb";
import { makeCardDb } from "../../features/board-auto/compile";
import { applyIntent, applyIntentInPlace, createGame, type GameConfig } from "../engine/engine";
import type { AutoGameState, CardDb } from "../engine/state";
import { seededRng } from "../../lib/rng";
import { randomIntent } from "../ai/random";

/**
 * Full games between the meta decks of the test account
 * (public/data/meta-decks.json), driven by the seeded random player, with
 * the same card DB board-auto uses. Measures where the time goes and
 * fingerprints each game so a "speed only" change can prove it changed no rule.
 */

/** Safety cap: a random game that has not ended by now is reported, not looped forever. */
const MAX_INTENTS = 4000;

export const realDb: CardDb = makeCardDb(new Map((cardsJson as Card[]).map((c) => [c.id, c])));

interface MetaDeck { leaderId: string; leaderName: string; cards: { id: string; count: number }[] }
export const metaDecks: MetaDeck[] = (metaJson as { decks: MetaDeck[] }).decks;

const expand = (d: MetaDeck) => d.cards.flatMap((c) => Array<string>(c.count).fill(c.id));

/** Game i: deck i against the deck `round` places after it, so every deck plays both seats. */
export function metaGameConfig(i: number, round = 1): GameConfig {
  const a = metaDecks[i % metaDecks.length];
  const b = metaDecks[(i + round) % metaDecks.length];
  return {
    seed: `bench-${i}-${round}`,
    players: [{ id: "p1", leader: a.leaderId, deck: expand(a) }, { id: "p2", leader: b.leaderId, deck: expand(b) }],
    firstPlayer: i % 2 === 0 ? "p1" : "p2",
  };
}

export interface GameRun {
  state: AutoGameState;
  intents: number;
  events: number;
  capped: boolean;
  fingerprint: string;
  /** Milliseconds spent in each part, measured from outside the engine. */
  ms: { create: number; decide: number; apply: number };
}

/**
 * "game": every intent through applyIntent (a copy per intent, like the table).
 * "rollout": applyIntentInPlace on one state, like the bot's simulations.
 */
export type ApplyMode = "game" | "rollout";

export function playRandomGame(config: GameConfig, mode: ApplyMode = "game"): GameRun {
  const apply = mode === "game" ? applyIntent : applyIntentInPlace;
  const rng = seededRng(`driver:${config.seed}`);
  const ms = { create: 0, decide: 0, apply: 0 };
  let t = performance.now();
  const created = createGame(realDb, config);
  ms.create = performance.now() - t;

  let state = created.state;
  let hash = hashEvents(FNV_OFFSET, created.events);
  let intents = 0, events = created.events.length;
  while (state.phase !== "over" && intents < MAX_INTENTS) {
    t = performance.now();
    const intent = randomIntent(realDb, state, rng);
    const mid = performance.now();
    const result = apply(realDb, state, intent);
    ms.decide += mid - t;
    ms.apply += performance.now() - mid;
    state = result.state;
    hash = hashEvents(hash, result.events);
    intents++;
    events += result.events.length;
  }
  const fingerprint = `${(hash >>> 0).toString(16)}:${state.winner ?? "none"}:${state.turn}:${intents}`;
  return { state, intents, events, capped: state.phase !== "over", fingerprint, ms };
}

// FNV-1a over the JSON of every event: any change in what the engine emits changes the hash.
const FNV_OFFSET = 0x811c9dc5;
function hashEvents(h: number, events: unknown[]): number {
  for (const e of events) {
    const s = JSON.stringify(e);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return h;
}
