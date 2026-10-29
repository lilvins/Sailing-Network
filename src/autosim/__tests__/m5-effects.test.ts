import { describe, expect, it } from "vitest";
import type { Action, Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { legalMoves } from "../engine/legality";
import { effectivePower, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 single effects: rest DON!!, "cannot be rested", "… at the end of this
 * turn" (scheduled delayed effects), "you cannot play Characters this turn",
 * "+N for every card trashed", "play this card from your trash".
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
const am = (actions: Action[]): Effect[] => [{ timing: "activateMain", actions }];
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("C-RESTDON", am([{ kind: "restDon", who: "opponent", count: 2 }]));
addCard("C-NOREST", am([{ kind: "restriction", what: "cannotBeRested", duration: "untilEndOfOpponentsNextTurn", sel: sel("opponent", "characterArea", 1) }]));
addCard("C-LATER", [
  { timing: "activateMain", actions: [{ kind: "powerMod", sel: sel("self", "characterArea", 1, { self: true }), amount: 2000, duration: "thisTurn" }, { kind: "scheduleEndOfTurn", effectIndex: 1 }] },
  { timing: "delayed", actions: [{ kind: "trashTarget", sel: sel("self", "characterArea", 1, { self: true }) }] },
]);
addCard("C-LOCK", am([{ kind: "restriction", what: "cannotPlayCharacters", amount: 5, duration: "thisTurn", sel: sel("self", "leader", 1) }]));
addCard("C-PER", am([
  { kind: "discard", who: "self", sel: sel("self", "hand", 99, { upTo: true }) },
  { kind: "powerMod", sel: sel("self", "characterArea", 1, { self: true }), amount: 1000, duration: "thisTurn", perPrevTarget: true },
]));
addCard("C-BIG", null, { cost: 6 });
addCard("C-SMALL", null, { cost: 2 });
for (let i = 1; i <= 5; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-RESTDON", "C-NOREST", "C-LATER", "C-LOCK", "C-PER", "C-BIG", "C-SMALL", "V1", "V2", "V3", "V4", "V5"]
  .flatMap((id) => Array<string>(4).fill(id)).concat("V1", "V2").slice(0, 48);
function newGame(): AutoGameState {
  for (let i = 6; i <= 7; i++) addCard(`V${i}`, null);
  const deck = [...DECK, "V6", "V7"];
  const config: GameConfig = { seed: "m5fx", firstPlayer: "alice", players: [{ id: "alice", leader: "L", deck }, { id: "bob", leader: "L", deck }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice", zone: "characterArea" | "hand" | "trash" = "characterArea"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand", "trash"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
const act = (s: AutoGameState, iid: string) => applyIntent(db, s, { type: "activateMain", player: "alice", iid, effectIndex: 0 }).state;

describe("M5 effects", () => {
  it("rest up to 2 of your opponent's DON!!", () => {
    let s = newGame();
    s.players.bob.don.active = 3;
    s = act(s, put(s, "C-RESTDON"));
    expect(s.players.bob.don).toMatchObject({ active: 1, rested: 2 });
  });

  it("\"cannot be rested\": no attack, no block, no rest by effects", () => {
    let s = newGame();
    const target = put(s, "V1", "bob");
    s = act(s, put(s, "C-NOREST"));
    expect(s.modifiers.some((m) => m.restriction === "cannotBeRested" && m.targetIid === target)).toBe(true);
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    const attackers = legalMoves(db, s).attackers.map((a) => a.iid);
    expect(attackers).not.toContain(target);
  });

  it("\"… then trash this Character at the end of this turn\" runs in this turn's End Phase", () => {
    let s = newGame();
    const c = put(s, "C-LATER");
    s = act(s, c);
    expect(effectivePower(db, s, "alice", c)).toBe(4000);
    expect(s.scheduled).toHaveLength(1);
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(s.players.alice.zones.trash).toContain(c);
    expect(s.scheduled).toHaveLength(0);
  });

  it("\"you cannot play Characters with a base cost of 5 or more during this turn\"", () => {
    let s = newGame();
    const big = put(s, "C-BIG", "alice", "hand"), small = put(s, "C-SMALL", "alice", "hand");
    s.players.alice.don.active = 8;
    s = act(s, put(s, "C-LOCK"));
    const playable = legalMoves(db, s).playableFromHand.map((x) => x.iid);
    expect(playable).toContain(small);
    expect(playable).not.toContain(big);
    expect(() => applyIntent(db, s, { type: "playCard", player: "alice", iid: big })).toThrow();
  });

  it("\"+1000 for every card trashed\"", () => {
    let s = newGame();
    const c = put(s, "C-PER");
    s = act(s, c);
    expect(s.pendingChoice?.kind).toBe("selectTargets");
    const pc = s.pendingChoice!;
    const two = pc.kind === "selectTargets" ? pc.candidates.slice(0, 2).map((x) => x.iid) : [];
    s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: two }).state;
    expect(effectivePower(db, s, "alice", c)).toBe(2000 + 2 * 1000);
  });
});

describe("M5 compiler: effects", () => {
  it("OP03-005: +2000, then trash this Character at the end of this turn", () => {
    const fx = getGeneratedCard("OP03-005")!.effects;
    const am = fx.find((e) => e.timing === "activateMain")!;
    const sched = am.actions.find((a) => a.kind === "scheduleEndOfTurn") as Extract<Action, { kind: "scheduleEndOfTurn" }>;
    expect(fx[sched.effectIndex].timing).toBe("delayed");
  });

  it("OP02-018 [On K.O.]: play this Character card from your trash rested", () => {
    const fx = getGeneratedCard("OP02-018")!.effects.find((e) => e.timing === "onKO")!;
    expect(JSON.stringify(fx.actions)).toContain('"zone":"trash"');
    expect(JSON.stringify(fx.actions)).toContain('"self":true');
  });
});
