// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCompiledCard } from "../data/compiled";
import { applyIntent, createGame } from "../engine/engine";
import { legalMoves } from "../engine/legality";
import { effectivePower, type AutoGameState, type CardDb, type EngineCard } from "../engine/state";
import type { PlayerIntent } from "../engine/intents";

/**
 * Regression (playtest 2026-10-27): a [Counter] Event that gives the
 * OPPONENT's Leader/Character −2000 (OP01-028 Green Star Rafflesia) "did not
 * work". Real card, real compiled IR, real engine: the attacker must lose
 * 2000 power for the battle and the damage step must use the lowered value.
 */

interface RawCard {
  id: string; name: string; category: EngineCard["category"]; colors: string[];
  cost: number | null; power: number | null; counter: number | null;
  types: string[]; effect: string | null; trigger: string | null; set: string;
}
const raw: RawCard[] = JSON.parse(readFileSync(new URL("../../../public/data/cards.json", import.meta.url), "utf8"));
const byId = new Map(raw.filter((c) => c.set === "ST01" || c.set === "OP01").map((c) => [c.id, c]));
const db: CardDb = (id) => {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown card ${id}`);
  return { id: c.id, category: c.category, cost: c.cost, power: c.power, counter: c.counter, colors: c.colors, types: c.types, name: c.name, compiled: getCompiledCard(c.id) };
};

function deckOf(leaderId: string): string[] {
  const leader = byId.get(leaderId)!;
  const pool = [...byId.values()].filter((c) => c.category === "Character" && c.colors.some((x) => leader.colors.includes(x)));
  const deck: string[] = [];
  for (const c of pool) for (let n = 0; n < 4 && deck.length < 50; n++) deck.push(c.id);
  return deck;
}

/** Play until the first Counter Step against an attack on a LEADER. */
function toFirstCounterWindow(): AutoGameState {
  let { state } = createGame(db, {
    seed: "counter-debuff",
    players: [
      { id: "p1", leader: "OP01-001", deck: deckOf("OP01-001") },
      { id: "p2", leader: "OP01-001", deck: deckOf("OP01-001") },
    ],
    firstPlayer: "p1",
  });
  const step = (i: PlayerIntent) => { state = applyIntent(db, state, i).state; };
  for (let n = 0; n < 400; n++) {
    const pc = state.pendingChoice;
    if (pc?.kind === "counterWindow") return state;
    if (pc?.kind === "mulligan") { step({ type: "respondMulligan", player: pc.player, take: false }); continue; }
    if (pc?.kind === "blockWindow") { step({ type: "respondBlock", player: pc.player, blockerIid: null }); continue; }
    if (pc?.kind === "triggerDecision") { step({ type: "respondTrigger", player: pc.player, activate: false }); continue; }
    if (pc?.kind === "mayActivate") { step({ type: "respondMay", player: pc.player, activate: false }); continue; }
    if (pc) throw new Error(`unexpected choice ${pc.kind}`);
    const lm = legalMoves(db, state);
    const p = state.players[lm.actor];
    const atk = lm.attackers.find((a) => a.iid === p.leaderIid);
    const opp = state.players[lm.actor === "p1" ? "p2" : "p1"];
    if (atk && atk.targets.includes(opp.leaderIid)) step({ type: "attack", player: lm.actor, attackerIid: atk.iid, targetIid: opp.leaderIid });
    else step({ type: "endTurn", player: lm.actor });
  }
  throw new Error("no counter window reached");
}

describe("OP01-028 [Counter] −2000 to an opponent's Leader/Character", () => {
  it("lowers the attacker's power for the battle", () => {
    let state = toFirstCounterWindow();
    const battle = state.battle!;
    const def = battle.defenderOwner;
    const att = battle.attackerOwner;
    // put the Event in the defender's hand and give them the DON to pay it
    const d = state.players[def];
    const iid = d.zones.hand[0];
    d.instances[iid].cardId = "OP01-028";
    d.don.active = Math.max(d.don.active, 3);
    const before = effectivePower(db, state, att, battle.attackerIid);

    const lm = legalMoves(db, state);
    expect(lm.counterEvents.map((c) => c.iid), "OP01-028 must be usable in the Counter Step").toContain(iid);

    const step = (i: PlayerIntent) => { state = applyIntent(db, state, i).state; };
    step({ type: "useCounterEvent", player: def, cardIid: iid });

    const pc = state.pendingChoice;
    expect(pc?.kind, "the −2000 asks the defender to pick the target").toBe("selectTargets");
    if (pc?.kind !== "selectTargets") return;
    expect(pc.player).toBe(def);
    expect(pc.candidates.map((c) => c.iid), "the attacker is a legal target").toContain(battle.attackerIid);
    step({ type: "respondTargets", player: def, iids: [battle.attackerIid] });

    const after = effectivePower(db, state, att, battle.attackerIid);
    expect(after, `attacker power ${before} → ${after}`).toBe(before - 2000);
  });
});
