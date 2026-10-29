import { describe, expect, it } from "vitest";
import type { Action, Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { effectivePower, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 "Then, you may [X]. If you do, [Y]": X is paid like a cost, only when it
 * can be paid in full; "If you do," after an "up to" action checks it picked
 * a card; Life from the bottom.
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
const draw2: Action = { kind: "draw", count: 2 };
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
// [Activate: Main] Draw 1 card. Then, you may rest 1 of your DON!!. If you do, draw 2 cards.
addCard("C-MAY", [{ timing: "activateMain", actions: [{ kind: "draw", count: 1 }, { kind: "mayPay", cost: [{ kind: "restDon", count: 1 }], then: [draw2], label: "Rest 1 DON!!" }] }]);
// [Activate: Main] Play up to 1 V1 from your hand. If you do, draw 2 cards.
addCard("C-IFDO", [{ timing: "activateMain", actions: [
  { kind: "playFromZone", zone: "hand", free: true, sel: sel("self", "hand", 1, { upTo: true, filter: { nameIncludes: ["V1"] } }) },
  { kind: "ifThen", if: [{ kind: "hadTargets" }], then: [draw2] }] }]);
// [Activate: Main] Add 1 card from the bottom of your Life to your hand.
addCard("C-BOT", [{ timing: "activateMain", actions: [{ kind: "lifeToHand", who: "self", count: 1, bottom: true }] }]);
// [Activate: Main] Your opponent may trash 1 card from the top of their Life cards. If they do not, their Leader −2000.
addCard("C-ORELSE", [{ timing: "activateMain", actions: [{ kind: "chooseOne", chooser: "opponent", payable: [true, false], labels: ["Trash 1 Life", "Don't"],
  options: [[{ kind: "trashLife", who: "opponent", count: 1 }], [{ kind: "powerMod", sel: sel("opponent", "leader", 1), amount: -2000, duration: "thisTurn" }]] }] }]);
for (let i = 1; i <= 11; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-MAY", "C-IFDO", "C-BOT", "C-ORELSE", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"]
  .flatMap((id) => Array<string>(4).fill(id)).concat("V10", "V11");
function newGame(): AutoGameState {
  const config: GameConfig = { seed: "m5may", firstPlayer: "alice", players: [{ id: "alice", leader: "L", deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones.characterArea.push(iid); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
const act = (s: AutoGameState, iid: string) => applyIntent(db, s, { type: "activateMain", player: "alice", iid, effectIndex: 0 }).state;

describe("M5 mayPay / if you do", () => {
  it("paying runs the follow-up, declining skips it, unpayable is not offered", () => {
    let s = newGame();
    s.players.alice.don.active = 1;
    const hand = s.players.alice.zones.hand.length;
    s = act(s, put(s, "C-MAY"));
    expect(s.pendingChoice).toMatchObject({ kind: "chooseOption", options: ["Rest 1 DON!!", "Don't"] });
    s = applyIntent(db, s, { type: "respondOption", player: "alice", index: 0 }).state;
    expect(s.players.alice.don.active).toBe(0);
    expect(s.players.alice.zones.hand.length).toBe(hand + 3);

    let t = newGame();
    t.players.alice.don.active = 1;
    const h2 = t.players.alice.zones.hand.length;
    t = act(t, put(t, "C-MAY"));
    t = applyIntent(db, t, { type: "respondOption", player: "alice", index: 1 }).state;
    expect(t.players.alice.don.active).toBe(1);
    expect(t.players.alice.zones.hand.length).toBe(h2 + 1);

    let u = newGame();
    u.players.alice.don.active = 0;
    const h3 = u.players.alice.zones.hand.length;
    u = act(u, put(u, "C-MAY"));
    expect(u.pendingChoice).toBeNull();
    expect(u.players.alice.zones.hand.length).toBe(h3 + 1);
  });

  it("\"If you do,\" after an \"up to\" play only follows when a card was played", () => {
    let s = newGame();
    // no V1 in hand → nothing played → no draw
    const p = s.players.alice;
    p.zones.deck.push(...p.zones.hand.filter((iid) => p.instances[iid].cardId === "V1"));
    p.zones.hand = p.zones.hand.filter((iid) => p.instances[iid].cardId !== "V1");
    const hand = p.zones.hand.length;
    s = act(s, put(s, "C-IFDO"));
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [] }).state;
    expect(s.players.alice.zones.hand.length).toBe(hand);
  });

  it("Life from the bottom", () => {
    let s = newGame();
    const life = s.players.alice.zones.life;
    const bottom = life[0];
    s = act(s, put(s, "C-BOT"));
    expect(s.players.alice.zones.hand).toContain(bottom);
  });
});

describe("M5 \"your opponent may X. If they do not, Y\"", () => {
  it("the opponent chooses; with no Life the penalty happens without asking", () => {
    let s = newGame();
    s = act(s, put(s, "C-ORELSE"));
    expect(s.pendingChoice).toMatchObject({ kind: "chooseOption", player: "bob", enabled: [true, true] });
    const life = s.players.bob.zones.life.length;
    s = applyIntent(db, s, { type: "respondOption", player: "bob", index: 0 }).state;
    expect(s.players.bob.zones.life.length).toBe(life - 1);

    let t = newGame();
    t.players.bob.zones.life = [];
    t = act(t, put(t, "C-ORELSE"));
    expect(t.pendingChoice).toBeNull();
    expect(effectivePower(db, t, "bob", t.players.bob.leaderIid)).toBe(3000);
  });
});

describe("M5 compiler: mayPay", () => {
  it("OP12-018: \"Then, you may rest 1 of your DON!! cards. If you do, …\"", () => {
    const fx = getGeneratedCard("OP12-018")!.effects[0];
    expect(fx.actions[1]).toMatchObject({ kind: "mayPay", cost: [{ kind: "restDon", count: 1 }] });
  });
  it("OP11-035: the text (rest 1 DON!!) wins over the data (also trash 1)", () => {
    const fx = getGeneratedCard("OP11-035")!.effects.find((e) => e.timing === "onKOByEffect")!;
    expect(fx.actions[0]).toMatchObject({ kind: "mayPay", cost: [{ kind: "restDon", count: 1 }] });
  });
  it("OP09-103: \"If you do, draw 1\" after the play", () => {
    const fx = getGeneratedCard("OP09-103")!.effects.find((e) => e.timing === "onPlay")!;
    expect(fx.actions[1]).toMatchObject({ kind: "ifThen", if: [{ kind: "hadTargets" }] });
  });
});
