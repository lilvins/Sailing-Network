// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Card } from "../cards/cardsDb";
import { getCompiledCard } from "../../autosim/data/compiled";
import { applyIntent, createGame } from "../../autosim/engine/engine";
import { legalMoves } from "../../autosim/engine/legality";
import { effectivePower, type AutoGameState } from "../../autosim/engine/state";
import type { PlayerIntent } from "../../autosim/engine/intents";
import { deriveCompiled, makeCardDb } from "./compile";

/** Fallback power templates over the REAL catalog (sets not batch-compiled):
 *  how many Event effects run for real now, and one real −N Counter played
 *  through the engine end to end. */

const catalog: Card[] = JSON.parse(readFileSync(new URL("../../../public/data/cards.json", import.meta.url), "utf8"));
const uncompiledEvents = catalog.filter((c) => c.category === "Event" && !getCompiledCard(c.id));

describe("fallback power templates on the real catalog", () => {
  it("automate a large share of uncompiled [Counter] Events, every one structurally sound", () => {
    let counters = 0, automated = 0;
    for (const c of uncompiledEvents) {
      const fx = deriveCompiled(c)?.effects.find((e) => e.timing === "counter");
      if (!fx) continue;
      counters++;
      if (fx.actions[0].kind === "powerMod") {
        automated++;
        const a = fx.actions[0];
        expect(Number.isFinite(a.amount) && a.amount !== 0, c.id).toBe(true);
      }
    }
    console.log(`[Counter] Events outside the batch: ${counters}, power change automated: ${automated}`);
    expect(automated / counters).toBeGreaterThan(0.5);
  });

  it("a real off-batch −N [Counter] lowers the attacker in the engine", () => {
    const debuff = uncompiledEvents.find((c) => {
      const a = deriveCompiled(c)?.effects.find((e) => e.timing === "counter")?.actions[0];
      return a?.kind === "powerMod" && a.amount < 0 && a.sel.zone === "leaderOrCharacter" && (c.cost ?? 0) <= 3;
    });
    expect(debuff, "the catalog has an off-batch −N Counter Event").toBeDefined();
    const pool = catalog.filter((c) => c.set === "OP01" || c.id === debuff!.id);
    const db = makeCardDb(new Map(pool.map((c) => [c.id, c])));
    const chars = pool.filter((c) => c.category === "Character" && c.colors.includes("Red")).map((c) => c.id);
    const deck: string[] = [];
    for (const id of chars) for (let n = 0; n < 4 && deck.length < 50; n++) deck.push(id);
    let { state } = createGame(db, {
      seed: "fallback-debuff",
      players: [{ id: "p1", leader: "OP01-001", deck }, { id: "p2", leader: "OP01-001", deck }],
      firstPlayer: "p1",
    });
    const step = (i: PlayerIntent) => { state = applyIntent(db, state, i).state; };
    for (let n = 0; n < 400 && state.pendingChoice?.kind !== "counterWindow"; n++) {
      const pc = state.pendingChoice;
      if (pc?.kind === "mulligan") { step({ type: "respondMulligan", player: pc.player, take: false }); continue; }
      if (pc?.kind === "blockWindow") { step({ type: "respondBlock", player: pc.player, blockerIid: null }); continue; }
      if (pc) throw new Error(`unexpected ${pc.kind}`);
      const lm = legalMoves(db, state);
      const me = state.players[lm.actor];
      const opp = state.players[lm.actor === "p1" ? "p2" : "p1"];
      const atk = lm.attackers.find((a) => a.iid === me.leaderIid && a.targets.includes(opp.leaderIid));
      step(atk ? { type: "attack", player: lm.actor, attackerIid: atk.iid, targetIid: opp.leaderIid } : { type: "endTurn", player: lm.actor });
    }
    const s: AutoGameState = state;
    const b = s.battle!;
    const d = s.players[b.defenderOwner];
    const iid = d.zones.hand[0];
    d.instances[iid].cardId = debuff!.id;
    d.don.active = Math.max(d.don.active, debuff!.cost ?? 0);
    const before = effectivePower(db, s, b.attackerOwner, b.attackerIid);
    step({ type: "useCounterEvent", player: b.defenderOwner, cardIid: iid });
    const pc = state.pendingChoice;
    expect(pc?.kind).toBe("selectTargets");
    if (pc?.kind !== "selectTargets") return;
    step({ type: "respondTargets", player: pc.player, iids: [b.attackerIid] });
    while (state.pendingChoice?.kind === "manualResolve") step({ type: "ackManual", player: state.pendingChoice.player });
    expect(effectivePower(db, state, b.attackerOwner, b.attackerIid), `${debuff!.id}: ${debuff!.effect}`).toBe(before + (deriveCompiled(debuff!)!.effects.find((e) => e.timing === "counter")!.actions[0] as { amount: number }).amount);
  });
});
