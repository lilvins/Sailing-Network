import { describe, expect, it } from "vitest";
import type { Effect } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import type { PlayerIntent as Intent } from "../engine/intents";
import { canPayCost } from "../engine/effects";
import { markStateEdited } from "../engine/stateVersion";
import { effectivePower, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * Meta-deck cards checked against their printed text (ROADMAP_META_AI tappa 8,
 * review of 2026-11-10). Each test plays the card's real compiled effects.
 */

const CARDS: Record<string, EngineCard> = {};
function addCard(id: string, o: Partial<EngineCard> = {}, effects?: Effect[]): void {
  CARDS[id] = {
    id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
    ...(effects ? { compiled: { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects } } : {}),
  } as EngineCard;
}
function addReal(id: string, o: Partial<EngineCard> = {}): void {
  addCard(id, { compiled: getGeneratedCard(id)!, ...o });
}
addCard("L", { category: "Leader", cost: 5, power: 5000 });
addCard("FILLER");
// [Activate: Main] K.O. all of your opponent's Characters.
addCard("KO-ALL", {}, [{ timing: "activateMain", actions: [{ kind: "koTarget", sel: { owner: "opponent", zone: "characterArea", count: 99, chooser: "controller" } }] }]);
addReal("OP15-009", { cost: 1, power: 2000, types: ["East Blue", "Navy"] });
for (let n = 1; n <= 12; n++) addCard(`FILLER-${n}`); // pads the deck to 50 at 4 copies each

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = Object.keys(CARDS).filter((id) => CARDS[id].category !== "Leader").flatMap((id) => Array<string>(4).fill(id)).slice(0, 50);

function newGame(leader = "L"): AutoGameState {
  const config: GameConfig = { seed: "meta-review", firstPlayer: "alice", players: [{ id: "alice", leader, deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  s.turn = 3; // alice's 2nd turn: attacks are legal
  return s;
}
const go = (s: AutoGameState, i: Intent) => applyIntent(db, s, i).state;
/** Moves one copy of a card from a player's deck or hand to a zone and returns it. */
function put(s: AutoGameState, cardId: string, zone: "characterArea" | "hand" | "life" | "trash", pid: PID = "alice"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); markStateEdited(s); return iid; }
  }
  throw new Error(`no ${cardId}`);
}

describe("meta cards follow the printed text (tappa 8)", () => {
  it("OP15-009 Koby: a Character that would be removed stays, the Leader takes −2000", () => {
    let s = newGame();
    const koby = put(s, "OP15-009", "characterArea", "bob");
    const fx = getGeneratedCard("OP15-009")!.effects[0];
    expect(canPayCost(db, s, "bob", koby, fx.cost)).toBe(true);

    s = go(s, { type: "activateMain", player: "alice", iid: put(s, "KO-ALL", "characterArea"), effectIndex: 0 });
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", player: "bob", sourceIid: koby, targetIid: koby });
    s = go(s, { type: "respondReplace", player: "bob", use: true });
    expect(s.players.bob.zones.characterArea).toContain(koby);
    expect(effectivePower(db, s, "bob", s.players.bob.leaderIid)).toBe(3000);
  });
});
