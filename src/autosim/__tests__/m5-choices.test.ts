import { describe, expect, it } from "vitest";
import type { Action, CostItem, Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { canPayCost } from "../engine/effects";
import type { AutoGameState, CardDb, EngineCard, PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 choices: "Choose one:" (`chooseOne` → chooseOption / respondOption),
 * "X or Y:" cost alternatives (`oneOf`), and "will not become active in the
 * next Refresh Phase" (restriction `skipNextRefresh`).
 */

const CARDS: Record<string, EngineCard> = {};
const sel = (owner: Selector["owner"], zone: Selector["zone"], count: number, extra: Partial<Selector> = {}): Selector =>
  ({ owner, zone, count, chooser: "controller", ...extra });

function addCard(id: string, effects: Effect[] | null, o: Partial<EngineCard> = {}): void {
  CARDS[id] = {
    id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
    compiled: effects ? { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects } : undefined,
  } as EngineCard;
}
const draw = (n: number): Action => ({ kind: "draw", count: n });
const freeze: Action = {
  kind: "restriction", what: "skipNextRefresh", duration: "untilOwnersNextRefresh",
  sel: sel("opponent", "characterArea", 1, { filter: { rested: true }, upTo: true }),
};
const orCost: CostItem = {
  kind: "oneOf", labels: ["Trash 1 card from your hand", "Rest 1 of your DON!! cards"],
  options: [[{ kind: "trashFromHand", sel: sel("self", "hand", 1) }], [{ kind: "restDon", count: 1 }]],
};

addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("C-CHOOSE", [{ timing: "activateMain", actions: [{ kind: "chooseOne", labels: ["Draw 1 card.", "Draw 2 cards."], options: [[draw(1)], [draw(2)]] }] }]);
addCard("C-ORCOST", [{ timing: "activateMain", cost: [orCost], actions: [freeze] }]);
for (let i = 1; i <= 12; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-CHOOSE", "C-ORCOST", ...Array.from({ length: 10 }, (_, i) => `V${i + 1}`)]
  .flatMap((id) => Array<string>(4).fill(id)).concat("V11", "V12");

function newGame(): AutoGameState {
  const config: GameConfig = {
    seed: "m5choices", firstPlayer: "alice",
    players: [{ id: "alice", leader: "L", deck: DECK }, { id: "bob", leader: "L", deck: DECK }],
  };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}

function put(s: AutoGameState, cardId: string, pid: PID = "alice"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) {
      const [iid] = p.zones[from].splice(i, 1);
      p.zones.characterArea.push(iid);
      return iid;
    }
  }
  throw new Error(`no ${cardId} left`);
}

const act = (s: AutoGameState, iid: string) => applyIntent(db, s, { type: "activateMain", player: "alice", iid, effectIndex: 0 }).state;

describe("M5 Choose one", () => {
  it("asks the controller, runs only the chosen option", () => {
    let s = newGame();
    const c = put(s, "C-CHOOSE");
    const hand = s.players.alice.zones.hand.length;
    s = act(s, c);
    const pc = s.pendingChoice;
    expect(pc?.kind).toBe("chooseOption");
    if (pc?.kind !== "chooseOption") return;
    expect(pc.options).toEqual(["Draw 1 card.", "Draw 2 cards."]);
    expect(() => applyIntent(db, s, { type: "respondOption", player: "bob", index: 1 })).toThrow();
    s = applyIntent(db, s, { type: "respondOption", player: "alice", index: 1 }).state;
    expect(s.players.alice.zones.hand.length).toBe(hand + 2);
    expect(s.pendingChoice).toBeNull();
  });
});

describe("M5 cost alternatives", () => {
  it("payable when either option is; the only payable one is paid without asking", () => {
    let s = newGame();
    const c = put(s, "C-ORCOST");
    const al = s.players.alice;
    al.zones.trash.push(...al.zones.hand.splice(0)); // empty hand
    al.don.active = 0;
    expect(canPayCost(db, s, "alice", c, [orCost])).toBe(false);
    al.don.active = 1;
    expect(canPayCost(db, s, "alice", c, [orCost])).toBe(true);
    s = act(s, c);
    expect(s.pendingChoice).toBeNull(); // only "rest 1 DON" was payable
    expect(s.players.alice.don.active).toBe(0);
  });

  it("with both payable the payer picks, and only that option is paid", () => {
    let s = newGame();
    const c = put(s, "C-ORCOST");
    s.players.alice.don.active = 1;
    const hand = s.players.alice.zones.hand.length;
    expect(hand).toBeGreaterThan(0);
    s = act(s, c);
    const pc = s.pendingChoice;
    expect(pc?.kind === "chooseOption" && pc.purpose === "cost" && pc.enabled).toEqual([true, true]);
    s = applyIntent(db, s, { type: "respondOption", player: "alice", index: 0 }).state;
    expect(s.pendingChoice?.kind).toBe("selectTargets"); // which card to trash
    const pick = s.pendingChoice?.kind === "selectTargets" ? s.pendingChoice.candidates[0].iid : "";
    s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [pick] }).state;
    expect(s.players.alice.zones.trash).toContain(pick);
    expect(s.players.alice.don.active).toBe(1); // the DON!! option was not paid
  });
});

describe("M5 skipNextRefresh", () => {
  it("the frozen Character stays rested through its owner's next Refresh Phase only", () => {
    let s = newGame();
    const c = put(s, "C-ORCOST");
    const target = put(s, "V5", "bob");
    s.players.bob.instances[target].rested = true;
    s.players.alice.don.active = 1;
    s.players.alice.zones.trash.push(...s.players.alice.zones.hand.splice(0));
    s = act(s, c);
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [target] }).state;
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state; // bob's Refresh Phase
    expect(s.turnPlayer).toBe("bob");
    expect(s.players.bob.instances[target].rested).toBe(true);
    expect(s.modifiers.some((m) => m.restriction === "skipNextRefresh")).toBe(false); // used up
    s.players.bob.instances[target].rested = true;
    s = applyIntent(db, s, { type: "endTurn", player: "bob" }).state;
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state; // bob's next Refresh
    expect(s.players.bob.instances[target].rested).toBe(false);
  });
});

describe("M5 compiler: choices", () => {
  it("Shanks OP17-020: \"trash 1 card or rest 1 DON!!:\" → oneOf + skipNextRefresh", () => {
    const fx = getGeneratedCard("OP17-020")!.effects[0];
    expect(fx.cost).toMatchObject([{ kind: "oneOf", options: [[{ kind: "trashFromHand" }], [{ kind: "restDon", count: 1 }]] }]);
    expect(fx.actions).toMatchObject([{ kind: "restriction", what: "skipNextRefresh" }]);
  });

  it("\"Choose one\" labels follow the printed bullets even when the data lists them in another order (EB02-045)", () => {
    const fx = getGeneratedCard("EB02-045")!.effects.find((e) => e.actions.some((a) => a.kind === "chooseOne"))!;
    const ch = fx.actions.find((a) => a.kind === "chooseOne") as Extract<Action, { kind: "chooseOne" }>;
    expect(ch.labels?.[1]).toBe("Draw 1 card.");
    expect(ch.options[1]).toEqual([{ kind: "draw", count: 1 }]);
  });
});
