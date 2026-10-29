import { describe, expect, it } from "vitest";
import type { Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { canPayCost, conditionsMet } from "../engine/effects";
import type { AutoGameState, CardDb, EngineCard, PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 Life: face-up / face-down Life cards, "add up to N from the top of your
 * deck to the top of your Life", "add … to the top/bottom of the Life
 * face-up", "turn N Life cards face-up" (also as a cost), and the conditions
 * on the top Life card.
 */

const CARDS: Record<string, EngineCard> = {};
const sel = (owner: Selector["owner"], zone: Selector["zone"], count: number, extra: Partial<Selector> = {}): Selector =>
  ({ owner, zone, count, chooser: "controller", ...extra });
function addCard(id: string, effects: Effect[] | null): void {
  CARDS[id] = {
    id, category: id === "L" ? "Leader" : "Character", cost: id === "L" ? 5 : 1, power: 2000, counter: 1000,
    colors: ["Red"], types: ["T"], name: id,
    compiled: effects ? { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects } : undefined,
  } as EngineCard;
}
addCard("L", null);
addCard("C-HEAL", [{ timing: "activateMain", actions: [{ kind: "addToLife", sel: sel("self", "deckTop", 1, { upTo: true }) }] }]);
addCard("C-TOLIFE", [{ timing: "activateMain", actions: [{ kind: "addToLife", faceUp: true, sel: sel("opponent", "characterArea", 1, { upTo: true }) }] }]);
addCard("C-FLIPCOST", [{
  timing: "activateMain", cost: [{ kind: "action", action: { kind: "flipLife", who: "self", count: 1, faceUp: true } }],
  actions: [{ kind: "draw", count: 1 }],
}]);
for (let i = 1; i <= 11; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-HEAL", "C-TOLIFE", "C-FLIPCOST", ...Array.from({ length: 9 }, (_, i) => `V${i + 1}`)]
  .flatMap((id) => Array<string>(4).fill(id)).concat("V10", "V11");

function newGame(): AutoGameState {
  const config: GameConfig = {
    seed: "m5life", firstPlayer: "alice",
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
const top = (s: AutoGameState, pid: PID) => s.players[pid].zones.life.at(-1)!;

describe("M5 Life", () => {
  it("\"add up to 1 card from the top of your deck to the top of your Life\" asks how many", () => {
    let s = newGame();
    const c = put(s, "C-HEAL");
    const life = s.players.alice.zones.life.length;
    const deckTop = s.players.alice.zones.deck[0];
    s = act(s, c);
    expect(s.pendingChoice).toMatchObject({ kind: "chooseNumber", purpose: "life", max: 1 });
    s = applyIntent(db, s, { type: "respondNumber", player: "alice", value: 1 }).state;
    expect(s.players.alice.zones.life.length).toBe(life + 1);
    expect(top(s, "alice")).toBe(deckTop);
    expect(s.players.alice.instances[deckTop].faceUp).toBe(false);
  });

  it("an opponent's Character goes to the top of their Life face-up", () => {
    let s = newGame();
    const c = put(s, "C-TOLIFE");
    const victim = put(s, "V1", "bob");
    s = act(s, c);
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [victim] }).state;
    expect(top(s, "bob")).toBe(victim);
    expect(s.players.bob.instances[victim].faceUp).toBe(true);
    expect(s.players.bob.zones.characterArea).not.toContain(victim);
    expect(conditionsMet(db, s, "bob", s.players.bob.leaderIid, [{ kind: "lifeTop", who: "self", faceUp: true }])).toBe(true);
    expect(conditionsMet(db, s, "alice", s.players.alice.leaderIid, [{ kind: "lifeTop", who: "self", faceUp: true }])).toBe(false);
  });

  it("\"turn 1 card from the top of your Life face-up:\" is a cost that can't be paid twice on the same card", () => {
    let s = newGame();
    const c = put(s, "C-FLIPCOST");
    const cost = CARDS["C-FLIPCOST"].compiled!.effects[0].cost;
    expect(canPayCost(db, s, "alice", c, cost)).toBe(true);
    s = act(s, c);
    expect(s.players.alice.instances[top(s, "alice")].faceUp).toBe(true);
    expect(canPayCost(db, s, "alice", c, cost)).toBe(false); // the top card is already face-up
  });

  it("compiler: Nami EB03-053 [On K.O.] pays \"turn 1 Life face-up\"; EB01-050 heals \"up to 1\"", () => {
    const nami = getGeneratedCard("EB03-053")!.effects.find((e) => e.timing === "onKO")!;
    expect(nami.cost).toMatchObject([{ kind: "action", action: { kind: "flipLife", faceUp: true, count: 1 } }]);
    const heal = getGeneratedCard("EB01-050")!.effects[0];
    expect(heal.actions).toMatchObject([{ kind: "addToLife", sel: { zone: "deckTop", count: 1, upTo: true } }]);
  });
});
