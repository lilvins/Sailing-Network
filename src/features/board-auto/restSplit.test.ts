import { describe, expect, it } from "vitest";
import { applyIntent, createGame, type GameConfig } from "../../autosim/engine/engine";
import type { AutoGameState, CardDb, EngineCard } from "../../autosim/engine/state";
import type { CostItem, Effect, Selector } from "../../autosim/ir/types";
import { restSplitOf } from "./restSplit";

/** A rest cost split between DON!! and cards is answered by what gets clicked. */

const CARDS: Record<string, EngineCard> = {};
function addCard(id: string, effects: Effect[] | null, o: Partial<EngineCard> = {}): void {
  CARDS[id] = {
    id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
    compiled: effects ? { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects } : undefined,
  } as EngineCard;
}
const field = (count: number): Selector => ({ owner: "self", zone: "field", count, chooser: "controller", filter: { rested: false } });
const rest = (don: number, cards: number): CostItem[] => [
  ...(don > 0 ? [{ kind: "restDon", count: don } as CostItem] : []),
  ...(cards > 0 ? [{ kind: "action", action: { kind: "restTarget", sel: field(cards) } } as CostItem] : []),
];
const activate = (cost: CostItem[]): Effect[] => [{ timing: "activateMain", cost, actions: [{ kind: "draw", count: 1 }] }];
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("REST1", activate([{ kind: "oneOf", labels: ["Rest 1 DON!!", "Rest 1 card"], options: [rest(1, 0), rest(0, 1)] }]));
addCard("REST2", activate([{ kind: "oneOf", labels: ["2 DON!!", "1 + 1", "2 cards"], options: [rest(2, 0), rest(1, 1), rest(0, 2)] }]));
addCard("TRASH", activate([{ kind: "oneOf", labels: ["Trash", "Rest"], options: [[{ kind: "trashFromHand", sel: { owner: "self", zone: "hand", count: 1, chooser: "controller" } }], rest(1, 0)] }]));
for (let i = 1; i <= 10; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["REST1", "REST2", "TRASH", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"]
  .flatMap((id) => Array<string>(4).fill(id)).concat("V10", "V10");

function newGame(): AutoGameState {
  const config: GameConfig = { seed: "rest-split", firstPlayer: "alice", players: [{ id: "alice", leader: "L", deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  return applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
}
function put(s: AutoGameState, cardId: string): string {
  const p = s.players.alice;
  const i = p.zones.deck.findIndex((iid) => p.instances[iid].cardId === cardId);
  const [iid] = p.zones.deck.splice(i, 1);
  p.zones.characterArea.push(iid);
  return iid;
}
function asked(cardId: string): { s: AutoGameState; iid: string } {
  let s = newGame();
  s.players.alice.don.active = 3;
  const iid = put(s, cardId);
  s = applyIntent(db, s, { type: "activateMain", player: "alice", iid, effectIndex: 0 }).state;
  return { s, iid };
}

describe("restSplitOf", () => {
  it("clicking a DON!! rests a DON!!, without touching the cards", () => {
    const { s } = asked("REST1");
    const split = restSplitOf(db, s)!;
    expect(split).toMatchObject({ total: 1, donMax: 1, cardMax: 1 });
    const next = applyIntent(db, s, { type: "respondOption", player: "alice", index: split.optionFor(1) }).state;
    expect(next.pendingChoice).toBeNull();
    expect(next.players.alice.don.active).toBe(2);
    expect(next.players.alice.instances[next.players.alice.leaderIid].rested).toBe(false);
  });

  it("clicking the Leader rests the Leader, with no DON!! spent", () => {
    const { s } = asked("REST1");
    const split = restSplitOf(db, s)!;
    const leader = s.players.alice.leaderIid;
    expect(split.candidates.has(leader)).toBe(true);
    let next = applyIntent(db, s, { type: "respondOption", player: "alice", index: split.optionFor(0) }).state;
    expect(next.pendingChoice?.kind).toBe("selectTargets");
    next = applyIntent(db, next, { type: "respondTargets", player: "alice", iids: [leader] }).state;
    expect(next.pendingChoice).toBeNull();
    expect(next.players.alice.instances[leader].rested).toBe(true);
    expect(next.players.alice.don.active).toBe(3);
  });

  it("a mixed cost finds its split from how many DON!! were clicked", () => {
    const split = restSplitOf(db, asked("REST2").s)!;
    expect(split).toMatchObject({ total: 2, donMax: 2, cardMax: 2 });
    expect([split.optionFor(2), split.optionFor(1), split.optionFor(0), split.optionFor(3)]).toEqual([0, 1, 2, -1]);
  });

  it("leaves other alternatives to their buttons", () => {
    const { s } = asked("TRASH");
    expect(s.pendingChoice?.kind).toBe("chooseOption");
    expect(restSplitOf(db, s)).toBeNull();
  });
});
