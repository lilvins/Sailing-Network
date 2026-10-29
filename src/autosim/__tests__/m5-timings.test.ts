import { describe, expect, it } from "vitest";
import type { Action, Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import type { AutoGameState, CardDb, EngineCard, PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 event timings: "when DON!! on your field are returned to your DON!!
 * deck" (count / whose effect), "when this Character is K.O.'d by your
 * opponent's effect", "when this Character becomes rested".
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
const draw: Action = { kind: "draw", count: 1 };
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("C-DONMINUS2", [{ timing: "activateMain", cost: [{ kind: "returnDonToDeck", count: 2 }], actions: [{ kind: "draw", count: 1 }] }]);
addCard("C-WATCH2", [{ timing: "onYourDonReturned", react: { minCount: 2 }, actions: [draw] }]);
addCard("C-WATCH3", [{ timing: "onYourDonReturned", react: { minCount: 3 }, actions: [draw] }]);
addCard("C-KO", [{ timing: "activateMain", actions: [{ kind: "koTarget", sel: sel("opponent", "characterArea", 1) }] }]);
addCard("C-REVENGE", [{ timing: "onKOByEffect", react: { by: "opponent" }, actions: [{ kind: "addToLife", sel: sel("self", "deckTop", 1) }] }]);
addCard("C-RESTER", [{ timing: "activateMain", actions: [{ kind: "restTarget", sel: sel("self", "characterArea", 1, { filter: { excludeSelf: true } }) }] }]);
addCard("C-ONREST", [{ timing: "onRested", actions: [draw] }]);
addCard("C-MOURN", [{ timing: "onCharacterKOd", react: { whose: "yours", filter: { category: ["Character"] } }, actions: [draw] }]);
for (let i = 1; i <= 6; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-DONMINUS2", "C-WATCH2", "C-WATCH3", "C-KO", "C-REVENGE", "C-RESTER", "C-ONREST", "C-MOURN", "V1", "V2", "V3", "V4"]
  .flatMap((id) => Array<string>(4).fill(id)).concat("V6", "V6");
function newGame(): AutoGameState {
  const config: GameConfig = { seed: "m5tim", firstPlayer: "alice", players: [{ id: "alice", leader: "L", deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
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

describe("M5 event timings", () => {
  it("\"when 2 or more DON!! are returned\" fires for 2, not the 3-or-more one", () => {
    let s = newGame();
    s.players.alice.don.active = 3;
    s.players.alice.don.deck = 7;
    put(s, "C-WATCH2"); put(s, "C-WATCH3");
    const hand = s.players.alice.zones.hand.length;
    s = act(s, put(s, "C-DONMINUS2"));
    expect(s.players.alice.zones.hand.length).toBe(hand + 1 + 1); // its own draw + WATCH2
  });

  it("\"when this Character is K.O.'d by your opponent's effect\"", () => {
    let s = newGame();
    const victim = put(s, "C-REVENGE", "bob");
    const life = s.players.bob.zones.life.length;
    s = act(s, put(s, "C-KO"));
    expect(s.players.bob.zones.trash).toContain(victim);
    expect(s.players.bob.zones.life.length).toBe(life + 1);
  });

  it("\"when this Character becomes rested\" by an effect", () => {
    let s = newGame();
    put(s, "C-ONREST");
    const hand = s.players.alice.zones.hand.length;
    s = act(s, put(s, "C-RESTER"));
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
  });
});

describe("M5 watching timings", () => {
  it("\"when your Character is K.O.'d\" watches its owner's side only", () => {
    let s = newGame();
    put(s, "C-MOURN", "bob");
    put(s, "V1", "bob");
    const bobHand = s.players.bob.zones.hand.length;
    s = act(s, put(s, "C-KO"));
    if (s.pendingChoice?.kind === "selectTargets") {
      const v = s.pendingChoice.candidates.find((c) => s.players.bob.instances[c.iid].cardId === "V1")!.iid;
      s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [v] }).state;
    }
    expect(s.players.bob.zones.hand.length).toBe(bobHand + 1);
  });
});

describe("M5 compiler: event timings", () => {
  it("OP09-061: [Your Turn] when 2 or more DON!! are returned", () => {
    const fx = getGeneratedCard("OP09-061")!.effects.find((e) => e.timing === "onYourDonReturned")!;
    expect(fx.react).toEqual({ minCount: 2 });
  });
  it("EB03-033: \"by your effect\" follows the text", () => {
    const fx = getGeneratedCard("EB03-033")!.effects.find((e) => e.timing === "onYourDonReturned")!;
    expect(fx.react).toEqual({ by: "you" });
  });
  it("OP03-047: when this Character's attack deals damage", () => {
    expect(getGeneratedCard("OP03-047")!.effects.some((e) => e.timing === "onDealDamage")).toBe(true);
  });
});
