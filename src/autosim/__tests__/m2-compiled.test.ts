// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import goldenCards from "../data/golden/golden-cards.json";
import coverageReport from "../data/compiled/coverage-report.json";
import { allCompiledCards, coverage, getCompiledCard } from "../data/compiled";
import { validateCompiledSet } from "../ir/validate";
import type { Action, CompiledCard, Effect } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { emit, type GameEvent } from "../engine/events";
import type { PlayerIntent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import type { AutoGameState, CardDb, EngineCard, Iid, PID } from "../engine/state";
import { pump } from "../engine/battle";
import { seededRng } from "../../lib/rng";

/**
 * M2 test suite (AUTOSIM_PLAN.md §6, §8 M2): the ST01+OP01 compiled batch.
 * Validation levels of §6: (a) schema/structure, (b) semantic lint — both via
 * validateCompiledSet — and (c) dry-run: every effect of every card is
 * instantiated in a synthetic game and executed by the engine without
 * throwing. Plus: coverage ≥80%, golden set (real cards, hand-verified) must
 * structurally equal the pipeline output, and full games with real decks.
 */

// ─── the real card pool (ST01 + OP01) ────────────────────────────────────────

interface RawCard {
  id: string; name: string; category: EngineCard["category"]; colors: string[];
  cost: number | null; power: number | null; counter: number | null;
  types: string[]; effect: string | null; trigger: string | null; set: string;
}

const rawCards: RawCard[] = JSON.parse(
  readFileSync(new URL("../../../public/data/cards.json", import.meta.url), "utf8"),
);
const POOL = rawCards.filter((c) => c.set === "ST01" || c.set === "OP01");
const poolById = new Map(POOL.map((c) => [c.id, c]));

/** Real-card EngineCard db (compiled IR wired via getCompiledCard). */
function engineCardOf(raw: RawCard): EngineCard {
  return {
    id: raw.id, category: raw.category, cost: raw.cost, power: raw.power,
    counter: raw.counter, colors: raw.colors, types: raw.types, name: raw.name,
    compiled: getCompiledCard(raw.id),
  };
}
const realDb: CardDb = (id) => {
  const raw = poolById.get(id);
  if (!raw) throw new Error(`unknown card ${id}`);
  return engineCardOf(raw);
};

// ─── §6 levels a+b: schema + semantic lint ───────────────────────────────────

describe("M2 batch: structure and lint", () => {
  it("every compiled card passes schema + semantic lint (§6 a+b)", () => {
    const res = validateCompiledSet(allCompiledCards());
    expect(res.failures).toEqual({});
    expect(res.ok).toBe(true);
  });

  it("covers every ST01+OP01 card exactly once", () => {
    const ids = allCompiledCards().map((c) => c.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(POOL.map((c) => c.id).sort());
  });

  it("counterValue and vanilla classification agree with the card DB", () => {
    for (const cc of allCompiledCards()) {
      const raw = poolById.get(cc.cardId)!;
      expect(cc.counterValue ?? null, `${cc.cardId} counterValue`).toBe(raw.counter ?? null);
      const hasText = !!raw.effect && raw.effect !== "-";
      if (cc.classification === "vanilla") {
        expect(hasText || !!raw.trigger, `${cc.cardId} marked vanilla but has text`).toBe(false);
      }
      // a [Trigger] on the physical card must appear in the IR unless the card
      // is partial/unsupported (where it may be the missing part)
      if (raw.trigger && !["partial", "unsupported"].includes(cc.classification)) {
        expect(
          cc.effects.some((fx) => fx.timing === "trigger"),
          `${cc.cardId} has trigger text but no trigger effect`,
        ).toBe(true);
      }
    }
  });

  it("triage rule holds: classification 'compiled' implies confidence ≥ 0.75 (§6.5)", () => {
    for (const cc of allCompiledCards()) {
      if (["compiled", "vanilla", "keyword-only"].includes(cc.classification)) {
        expect(cc.confidence, cc.cardId).toBeGreaterThanOrEqual(0.75);
      } else {
        expect(cc.confidence, cc.cardId).toBeLessThanOrEqual(0.74);
      }
    }
  });
});

// ─── M2 exit: coverage ≥ 80% + report integrity ──────────────────────────────

const TIER1 = new Set<Action["kind"]>([
  "powerMod", "koTarget", "draw", "restTarget", "standTarget", "discard",
  "grantKeyword", "restriction", "manual",
]);
function flatActions(actions: Action[]): Action[] {
  return actions.flatMap((a) => [
    a,
    ...(a.kind === "ifThen" ? flatActions([...a.then, ...(a.else ?? [])]) : []),
    ...(a.kind === "chooseOne" ? flatActions(a.options.flat()) : []),
  ]);
}
function beyondTier1(cc: CompiledCard): string[] {
  const kinds = new Set<string>();
  for (const fx of cc.effects) {
    if (fx.timing === "static") kinds.add("static(M4)");
    for (const a of flatActions(fx.actions)) {
      if (!TIER1.has(a.kind) || a.kind === "ifThen") kinds.add(a.kind);
      const sel = (a as { sel?: { prev?: boolean } }).sel;
      if (sel?.prev) kinds.add("prev-selector");
    }
    for (const c of fx.cost ?? []) {
      if (["trashFromHand", "trashSelf", "trashFromLife", "lifeToHand"].includes(c.kind)) kinds.add(`cost:${c.kind}`);
    }
  }
  return [...kinds].sort();
}

describe("M2 exit: coverage", () => {
  it("≥80% of ST01+OP01 is vanilla/keyword-only/compiled (playable with full IR semantics)", () => {
    const rows = coverage();
    expect(rows.ALL.total).toBe(138);
    expect(rows.ALL.coveredPct).toBeGreaterThanOrEqual(80);
    expect(rows.ST01.coveredPct).toBe(100);
  });

  it("coverage-report.json matches a recomputation (it can never drift)", () => {
    expect(coverageReport.counts).toEqual(coverage());
    const compiledOnly = allCompiledCards().filter((c) => c.classification === "compiled");
    expect(coverageReport.fullyTier1Executable).toBe(compiledOnly.filter((c) => beyondTier1(c).length === 0).length);
    expect(coverageReport.compiledButDegradingToManual).toEqual(
      compiledOnly.filter((c) => beyondTier1(c).length > 0).map((c) => ({ cardId: c.cardId, needs: beyondTier1(c) })),
    );
    expect(coverageReport.notCompiled).toEqual(
      allCompiledCards()
        .filter((c) => c.classification === "partial" || c.classification === "unsupported")
        .map((c) => ({ cardId: c.cardId, classification: c.classification, reason: c.notes ?? "" })),
    );
  });
});

// ─── golden set: real cards, hand-verified (§6.4) ────────────────────────────

describe("golden set (real ST01/OP01 cards)", () => {
  const realGolden = (goldenCards as CompiledCard[]).filter((g) => !g.cardId.startsWith("TEST-"));

  it("has at least 15 real representative cards", () => {
    expect(realGolden.length).toBeGreaterThanOrEqual(15);
  });

  it("the pipeline output structurally equals every golden entry", () => {
    for (const g of realGolden) {
      expect(getCompiledCard(g.cardId), g.cardId).toEqual(g);
    }
  });
});

// ─── §6 level c: engine dry-run of every effect ──────────────────────────────

/** Build a legit mid-game state with boards, DON and rested targets on both
 *  sides, using a synthetic vanilla pool (the card under test is injected). */
function dryRunBase(): { state: AutoGameState; db: (cut: EngineCard) => CardDb } {
  const CARDS: Record<string, EngineCard> = {
    "DL-A": { id: "DL-A", category: "Leader", cost: 4, power: 5000, counter: null, colors: ["Red"], types: ["Dry"] },
    "DL-B": { id: "DL-B", category: "Leader", cost: 4, power: 5000, counter: null, colors: ["Red", "Blue"], types: ["Dry"] },
  };
  for (let i = 1; i <= 13; i++) {
    const id = `DV-${String(i).padStart(2, "0")}`;
    CARDS[id] = { id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["Dry"] };
  }
  const deck = [
    ...Array.from({ length: 12 }, (_, i) => `DV-${String(i + 1).padStart(2, "0")}`).flatMap((id) => Array<string>(4).fill(id)),
    "DV-13", "DV-13",
  ];
  const baseDb: CardDb = (id) => {
    const c = CARDS[id];
    if (!c) throw new Error(`unknown dry-run card ${id}`);
    return c;
  };
  const config: GameConfig = {
    seed: "m2-dry-run",
    players: [
      { id: "p1", leader: "DL-A", deck },
      { id: "p2", leader: "DL-B", deck },
    ],
    firstPlayer: "p1",
  };
  let { state } = createGame(baseDb, config);
  const run = (i: PlayerIntent) => { state = applyIntent(baseDb, state, i).state; };
  run({ type: "respondMulligan", player: "p1", take: false });
  run({ type: "respondMulligan", player: "p2", take: false });
  // a few turns: both sides develop a board, p2 gets a RESTED character
  const playCheapest = (pid: PID) => {
    const p = state.players[pid];
    const iid = p.zones.hand.find((x) => baseDb(p.instances[x].cardId).category === "Character");
    if (iid && p.don.active >= 1 && p.zones.characterArea.length < 5) run({ type: "playCard", player: pid, iid });
  };
  for (let t = 0; t < 6; t++) {
    playCheapest(state.turnPlayer);
    run({ type: "endTurn", player: state.turnPlayer });
  }
  // rest one of p2's characters (a legal koTarget/restTarget/standTarget target)
  const p2char = state.players.p2.zones.characterArea[0];
  if (p2char && state.turnPlayer === "p2") {
    run({ type: "attack", player: "p2", attackerIid: p2char, targetIid: state.players.p1.leaderIid });
    run({ type: "passCounter", player: "p1" });
    if (state.pendingChoice?.kind === "triggerDecision") throw new Error("unexpected trigger in dry-run base");
  }
  expect(state.phase).toBe("main");
  // db factory: alias the card-under-test id into the pool
  const mkDb = (cut: EngineCard): CardDb => (id) => (id === cut.id ? cut : baseDb(id));
  return { state, db: mkDb };
}

/** Auto-answer every ChoiceRequest until resolution finishes. */
function drainChoices(db: CardDb, state: AutoGameState): AutoGameState {
  let guard = 40;
  while (state.pendingChoice && state.phase !== "over" && guard-- > 0) {
    const pc = state.pendingChoice;
    let intent: PlayerIntent;
    switch (pc.kind) {
      case "selectTargets": {
        const n = Math.min(pc.count, pc.candidates.length);
        intent = { type: "respondTargets", player: pc.player, iids: pc.candidates.slice(0, n).map((c) => c.iid) };
        break;
      }
      case "mayActivate": intent = { type: "respondMay", player: pc.player, activate: true }; break;
      case "manualResolve": intent = { type: "ackManual", player: pc.player }; break;
      default: throw new Error(`unexpected choice in dry-run: ${pc.kind}`);
    }
    state = applyIntent(db, state, intent).state;
  }
  if (guard <= 0) throw new Error("dry-run did not converge");
  return state;
}

describe("M2 §6c: engine dry-run of every compiled effect", () => {
  const base = dryRunBase();

  for (const cc of allCompiledCards()) {
    const runnable = cc.effects
      .map((fx, i) => [fx, i] as [Effect, number])
      .filter(([fx]) => fx.timing !== "static"); // statics are continuous (M4) — nothing to pump
    if (runnable.length === 0) continue;

    it(`${cc.cardId} (${cc.classification}): every effect executes without throwing`, () => {
      const raw = poolById.get(cc.cardId)!;
      const cut = engineCardOf(raw);
      const db = base.db(cut);
      for (const [fx, effectIndex] of runnable) {
        let state = structuredClone(base.state);
        const log: GameEvent[] = [];
        const controller: PID = "p1";
        const p = state.players[controller];
        let sourceIid: Iid = p.zones.characterArea[0] ?? p.leaderIid;
        state.exec = { queue: [], gen: 1, running: null, pendingMay: null, flow: { at: "none" } };
        if (fx.timing === "trigger") {
          // mirror resolveTriggerDecision: the card leaves Life (10-1-5-3)
          const top = p.zones.life[p.zones.life.length - 1];
          // alias the life card to the card under test and activate it
          state.players[controller].instances[top].cardId = cut.id;
          emit(state, log, { type: "triggerActivated", player: controller, iid: top, cardId: cut.id });
          sourceIid = top;
          state.exec.running = {
            controller, sourceIid: top, sourceCardId: cut.id, effectIndex, actionIndex: 0,
            triggerCard: { iid: top, moved: false },
          };
        } else {
          state.exec.running = { controller, sourceIid, sourceCardId: cut.id, effectIndex, actionIndex: 0 };
        }
        pump(db, state, log);
        state = drainChoices(db, state);
        expect(state.exec, `${cc.cardId} effect[${effectIndex}] left exec dangling`).toBeNull();
        // the state stays JSON-serializable after the effect
        expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      }
    });
  }
});

// ─── playability: full games with real ST01/OP01 decks ───────────────────────

function legalRealDeck(leaderId: string, preferredSet: "ST01" | "OP01"): string[] {
  const leader = poolById.get(leaderId)!;
  const ok = (c: RawCard) =>
    c.category !== "Leader" && c.colors.some((col) => leader.colors.includes(col));
  const pool = [
    ...POOL.filter((c) => c.set === preferredSet && ok(c)),
    ...POOL.filter((c) => c.set !== preferredSet && ok(c)),
  ];
  const deck: string[] = [];
  for (const c of pool) {
    for (let n = 0; n < 4 && deck.length < 50; n++) deck.push(c.id);
    if (deck.length >= 50) break;
  }
  if (deck.length !== 50) throw new Error("could not build a legal real deck");
  return deck;
}

/** Seeded random driver over legalMoves + generic choice answers. */
function playRealGame(seed: string, config: GameConfig): AutoGameState {
  const rng = seededRng(`m2:${seed}`);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  let { state } = createGame(realDb, config);
  let steps = 0;
  const step = (intent: PlayerIntent) => { state = applyIntent(realDb, state, intent).state; };

  while (state.phase !== "over" && steps++ < 1500) {
    const pc = state.pendingChoice;
    if (pc) {
      switch (pc.kind) {
        case "mulligan": step({ type: "respondMulligan", player: pc.player, take: rng() < 0.3 }); break;
        case "blockWindow": step({ type: "respondBlock", player: pc.player, blockerIid: rng() < 0.5 && pc.blockers.length ? pick(pc.blockers) : null }); break;
        case "counterWindow": {
          const lm = legalMoves(realDb, state);
          const moves: PlayerIntent[] = [{ type: "passCounter", player: pc.player }];
          if (state.battle) {
            for (const c of lm.counterCards) moves.push({ type: "useCounter", player: pc.player, cardIid: c.iid, targetIid: state.battle.targetIid });
          }
          for (const e of lm.counterEvents) moves.push({ type: "useCounterEvent", player: pc.player, cardIid: e.iid });
          step(pick(moves));
          break;
        }
        case "triggerDecision": step({ type: "respondTrigger", player: pc.player, activate: rng() < 0.5 }); break;
        case "selectTargets": {
          const n = Math.min(pc.count, pc.candidates.length);
          const take = pc.upTo ? Math.floor(rng() * (n + 1)) : n;
          step({ type: "respondTargets", player: pc.player, iids: pc.candidates.slice(0, take).map((c) => c.iid) });
          break;
        }
        case "mayActivate": step({ type: "respondMay", player: pc.player, activate: rng() < 0.7 }); break;
        case "manualResolve": step({ type: "ackManual", player: pc.player }); break;
      }
      continue;
    }
    const lm = legalMoves(realDb, state);
    const moves: PlayerIntent[] = [{ type: "endTurn", player: lm.actor }];
    for (const pl of lm.playableFromHand) {
      if (pl.needsReplace) continue; // keep the driver simple
      moves.push({ type: "playCard", player: lm.actor, iid: pl.iid });
    }
    for (const t of lm.canGiveDonTo) moves.push({ type: "giveDon", player: lm.actor, targetIid: t });
    for (const a of lm.attackers) for (const t of a.targets) moves.push({ type: "attack", player: lm.actor, attackerIid: a.iid, targetIid: t });
    step(pick(moves));
  }
  expect(state.phase, `real-deck game did not terminate (seed=${seed}, turn=${state.turn})`).toBe("over");
  return state;
}

describe("M2 exit: real decks are playable end-to-end", () => {
  it("ST01 starter mirror plays to a result (3 seeds)", () => {
    const deck = legalRealDeck("ST01-001", "ST01");
    for (const seed of ["st-a", "st-b", "st-c"]) {
      const end = playRealGame(seed, {
        seed,
        players: [
          { id: "p1", leader: "ST01-001", deck },
          { id: "p2", leader: "ST01-001", deck },
        ],
        firstPlayer: "p1",
      });
      expect(end.winner === "p1" || end.winner === "p2").toBe(true);
    }
  });

  it("OP01 decks (red Zoro vs green Law-colors) play to a result (2 seeds)", () => {
    const deckA = legalRealDeck("OP01-001", "OP01");
    const deckB = legalRealDeck("OP01-002", "OP01");
    for (const seed of ["op-a", "op-b"]) {
      const end = playRealGame(seed, {
        seed,
        players: [
          { id: "p1", leader: "OP01-001", deck: deckA },
          { id: "p2", leader: "OP01-002", deck: deckB },
        ],
        firstPlayer: "p2",
      });
      expect(end.winner === "p1" || end.winner === "p2").toBe(true);
    }
  });
});
