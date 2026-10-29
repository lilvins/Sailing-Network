// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compileAllOptcg, coverageOf, type CatalogCard, type OptcgCard,
} from "../compiler/fromOptcg";
import categoryEnum from "../compiler/optcg-categories.json";
import { allCompiledCards, getGeneratedCard, generatedCards, generatedReport } from "../data/compiled";
import { validateCompiledSet } from "../ir/validate";
import type { Action, CompiledCard, Effect } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { fitChoice } from "../engine/effects";
import { emit, type GameEvent } from "../engine/events";
import type { PlayerIntent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import type { AutoGameState, CardDb, EngineCard, Iid, PID } from "../engine/state";
import { pump } from "../engine/battle";
import { seededRng } from "../../lib/rng";

/**
 * M5 (AUTOSIM_PLAN.md §8): the batch GENERATED from optcg-ai's card effects by
 * `compiler/fromOptcg.ts`. Same three validation levels as M2 (§6): schema +
 * lint, engine dry-run of every effect, plus: the committed JSON equals a
 * fresh compilation (regenerate with `UPDATE_OPTCG=1 npx vitest run m5`),
 * agreement with the hand-curated ST01/OP01 batch, and full games with the
 * real meta decks.
 */

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
interface RawCard extends CatalogCard {
  name: string; category: EngineCard["category"]; colors: string[]; cost: number | null; power: number | null; attributes: string[];
}
const catalog: RawCard[] = read("../../../public/data/cards.json");
const bundle: { db: Record<string, OptcgCard>; metaDecks: { name: string; leader: string; cards: string[] }[] } = read("../../../public/data/optcg/bundle.json");
const catalogById = new Map(catalog.map((c) => [c.id, c]));

const fresh = compileAllOptcg(bundle.db, catalog, categoryEnum as Record<string, string>);
const FILE = new URL("../data/compiled/generated/optcg.json", import.meta.url);
const REPORT = new URL("../data/compiled/generated/report.json", import.meta.url);

/** Action kinds the engine degrades to manualResolve today (effects.ts). */
const NOT_AUTO = new Set(["endBattle", "manual"]);
function flatActions(actions: Action[]): Action[] {
  return actions.flatMap((a) => [a, ...(a.kind === "ifThen" ? flatActions([...a.then, ...(a.else ?? [])]) : [])]);
}
/** A card whose every effect the engine runs by itself right now (no static
 *  M4 effect, nothing degrading to "resolve manually"). */
function runsFullyAuto(cc: CompiledCard): boolean {
  return cc.effects.every((fx) => fx.timing !== "static" && flatActions(fx.actions).every((a) =>
    !NOT_AUTO.has(a.kind) && !(a.kind === "peekDeck" && a.who !== "self") && !(a.kind === "playFromZone" && a.zone === "revealed")));
}

function reportOf(cards: CompiledCard[]) {
  const counts = coverageOf(cards);
  const inCatalog = cards.filter((c) => catalogById.has(c.cardId));
  const effects = inCatalog.flatMap((c) => c.effects);
  return {
    /** catalog cards the engine plays with no manual step and no inert static */
    fullyAutomaticNow: inCatalog.filter(runsFullyAuto).length,
    effectsInCatalog: effects.length,
    effectsManual: effects.filter((fx) => flatActions(fx.actions).some((a) => a.kind === "manual")).length,
    source: "optcg-ai public/data/optcg/bundle.json (actionV3) → src/autosim/compiler/fromOptcg.ts",
    cards: cards.length,
    inCatalog: inCatalog.length,
    counts: counts.ALL,
    catalogCounts: coverageOf(inCatalog).ALL,
    bySet: counts,
  };
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
if (env.UPDATE_OPTCG) {
  writeFileSync(FILE, JSON.stringify(fresh));
  writeFileSync(REPORT, `${JSON.stringify(reportOf(fresh), null, 1)}\n`);
}

describe("M5 generated batch: drift, structure, lint", () => {
  it.skipIf(!!env.UPDATE_OPTCG)("the committed batch equals a fresh compilation of optcg-ai (regenerate with UPDATE_OPTCG=1)", () => {
    expect(generatedCards()).toEqual(fresh);
    expect(generatedReport()).toEqual(JSON.parse(JSON.stringify(reportOf(fresh))));
  });

  it("every generated card passes schema + semantic lint (§6 a+b)", () => {
    const res = validateCompiledSet(fresh);
    expect(res.failures).toEqual({});
  });

  it("covers every catalog card exactly once (except those optcg-ai has no effect data for)", () => {
    const ids = fresh.map((c) => c.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    const missing = catalog.filter((c) => !getGeneratedCard(c.id));
    for (const c of missing) expect(bundle.db[c.id]?.abilities.length ?? 0, c.id).toBe(0);
    console.log(`[M5] catalog cards without optcg-ai effect data (left to the text fallback): ${missing.length}`);
  });

  it("triage rule holds: 'compiled' implies confidence ≥ 0.75 (§6.5)", () => {
    for (const c of fresh) if (c.classification === "compiled") expect(c.confidence, c.cardId).toBeGreaterThanOrEqual(0.75);
  });

  it("counterValue agrees with the catalog", () => {
    for (const c of fresh) {
      const cat = catalogById.get(c.cardId);
      if (cat) expect(c.counterValue ?? null, c.cardId).toBe(cat.counter ?? null);
    }
  });

  it("reports coverage", () => {
    const rep = reportOf(fresh);
    console.log("[M5] generated coverage (catalog cards):", JSON.stringify(rep.catalogCounts));
    expect(rep.catalogCounts.coveredPct).toBeGreaterThan(50);
  });
});

// ─── agreement with the hand-curated ST01/OP01 batch ────────────────────────

/** Normalize an effect for comparison: drop notes-only fields and sort keys. */
function norm(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(norm);
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x).sort()) {
      const v = (x as Record<string, unknown>)[k];
      if (v === undefined || v === false) continue;
      o[k] = norm(v);
    }
    return o;
  }
  return x;
}
const sameEffects = (a: Effect[], b: Effect[]) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

describe("agreement with the hand-curated ST01+OP01 batch", () => {
  it("the generated IR matches the hand compilation on most ST01/OP01 cards", () => {
    let same = 0, kw = 0;
    const diffs: string[] = [];
    for (const hand of allCompiledCards()) {
      const gen = fresh.find((c) => c.cardId === hand.cardId);
      if (!gen) { diffs.push(`${hand.cardId}(no data)`); continue; }
      if ([...hand.keywords].sort().join() === [...gen.keywords].sort().join()) kw++;
      if (sameEffects(hand.effects, gen.effects)) same++;
      else diffs.push(hand.cardId);
    }
    const n = allCompiledCards().length;
    console.log(`[M5] hand vs generated: keywords ${kw}/${n}, effects identical ${same}/${n}; differing: ${diffs.join(" ")}`);
    expect(kw / n).toBeGreaterThan(0.95);
    expect(same / n).toBeGreaterThan(0.5);
  });
});

// ─── §6 level c: dry-run of every generated effect ──────────────────────────

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
    seed: "m5-dry-run",
    players: [{ id: "p1", leader: "DL-A", deck }, { id: "p2", leader: "DL-B", deck }],
    firstPlayer: "p1",
  };
  let { state } = createGame(baseDb, config);
  const run = (i: PlayerIntent) => { state = applyIntent(baseDb, state, i).state; };
  run({ type: "respondMulligan", player: "p1", take: false });
  run({ type: "respondMulligan", player: "p2", take: false });
  const playCheapest = (pid: PID) => {
    const p = state.players[pid];
    const iid = p.zones.hand.find((x) => baseDb(p.instances[x].cardId).category === "Character");
    if (iid && p.don.active >= 1 && p.zones.characterArea.length < 5) run({ type: "playCard", player: pid, iid });
  };
  for (let t = 0; t < 6; t++) {
    playCheapest(state.turnPlayer);
    run({ type: "endTurn", player: state.turnPlayer });
  }
  const p2char = state.players.p2.zones.characterArea[0];
  if (p2char && state.turnPlayer === "p2") {
    run({ type: "attack", player: "p2", attackerIid: p2char, targetIid: state.players.p1.leaderIid });
    run({ type: "passCounter", player: "p1" });
  }
  expect(state.phase).toBe("main");
  return { state, db: (cut) => (id) => (id === cut.id ? cut : baseDb(id)) };
}

function payDonIntent(state: AutoGameState, player: PID, amount: number): PlayerIntent {
  const d = state.players[player].don;
  let left = amount;
  const fromRested = Math.min(left, d.rested); left -= fromRested;
  const fromActive = Math.min(left, d.active); left -= fromActive;
  const fromGiven: Record<string, number> = {};
  for (const [iid, n] of Object.entries(d.given)) {
    if (left <= 0) break;
    const use = Math.min(left, n);
    if (use > 0) { fromGiven[iid] = use; left -= use; }
  }
  return { type: "respondPayDon", player, fromActive, fromRested, fromGiven };
}

function drainChoices(db: CardDb, state: AutoGameState): AutoGameState {
  let guard = 60;
  while (state.pendingChoice && state.phase !== "over" && guard-- > 0) {
    const pc = state.pendingChoice;
    let intent: PlayerIntent;
    switch (pc.kind) {
      case "selectTargets": {
        const n = Math.min(pc.count, pc.candidates.length);
        intent = { type: "respondTargets", player: pc.player, iids: fitChoice(db, state, pc, pc.candidates.slice(0, n).map((c) => c.iid)) };
        break;
      }
      case "mayActivate": intent = { type: "respondMay", player: pc.player, activate: true }; break;
      case "manualResolve": intent = { type: "ackManual", player: pc.player }; break;
      case "peekSelect": {
        const take = pc.eligible.slice(0, pc.takeCount);
        const remaining = pc.cards.filter((iid) => !take.includes(iid));
        intent = {
          type: "respondPeek", player: pc.player, take,
          restTop: pc.rest === "topAnyOrder" || pc.rest === "topOrBottomAnyOrder" ? remaining : [],
          restBottom: pc.rest === "bottomAnyOrder" ? remaining : [],
        };
        break;
      }
      case "payDon": intent = payDonIntent(state, pc.player, pc.amount); break;
      case "chooseNumber": intent = { type: "respondNumber", player: pc.player, value: pc.max }; break;
      case "chooseOption": intent = { type: "respondOption", player: pc.player, index: pc.enabled.indexOf(true) }; break;
      case "mayReplace": intent = { type: "respondReplace", player: pc.player, use: true }; break;
      case "arrangeLife": intent = { type: "respondArrangeLife", player: pc.player, order: pc.cards.slice(pc.toDeckTop), toDeck: pc.cards.slice(0, pc.toDeckTop) }; break;
      default: throw new Error(`unexpected choice in dry-run: ${pc.kind}`);
    }
    state = applyIntent(db, state, intent).state;
  }
  if (guard <= 0) throw new Error("dry-run did not converge");
  return state;
}

function engineCardOf(id: string): EngineCard {
  const raw = catalogById.get(id)!;
  return {
    id: raw.id, category: raw.category, cost: raw.cost, power: raw.power, counter: raw.counter,
    colors: raw.colors, types: raw.types, name: raw.name, attributes: raw.attributes, compiled: getGeneratedCard(raw.id),
    hasEffect: !!raw.effect && raw.effect.trim() !== "" && raw.effect.trim() !== "-",
  };
}

describe("M5 §6c: engine dry-run of every generated effect", () => {
  const base = dryRunBase();
  const failures: string[] = [];
  let ran = 0;
  it("every non-static effect of every catalog card executes without throwing", () => {
    for (const cc of fresh) {
      if (!catalogById.has(cc.cardId)) continue;
      const cut = engineCardOf(cc.cardId);
      const db = base.db(cut);
      cc.effects.forEach((fx, effectIndex) => {
        if (fx.timing === "static") return;
        ran++;
        try {
          let state = structuredClone(base.state);
          const log: GameEvent[] = [];
          const controller: PID = "p1";
          const p = state.players[controller];
          const sourceIid: Iid = p.zones.characterArea[0] ?? p.leaderIid;
          state.exec = { queue: [], gen: 1, running: null, pendingMay: null, flow: { at: "none" } };
          if (fx.timing === "trigger") {
            const top = p.zones.life[p.zones.life.length - 1];
            state.players[controller].instances[top].cardId = cut.id;
            emit(state, log, { type: "triggerActivated", player: controller, iid: top, cardId: cut.id });
            state.exec.running = {
              controller, sourceIid: top, sourceCardId: cut.id, effectIndex,
              costs: fx.cost ? [...fx.cost] : [], costIndex: 0,
              actions: [...fx.actions], actionIndex: 0, lastTargets: [],
              triggerCard: { iid: top, moved: false },
            };
          } else {
            state.exec.running = {
              controller, sourceIid, sourceCardId: cut.id, effectIndex,
              costs: fx.cost ? [...fx.cost] : [], costIndex: 0,
              actions: [...fx.actions], actionIndex: 0, lastTargets: [],
            };
          }
          pump(db, state, log);
          state = drainChoices(db, state);
          if (state.exec !== null) throw new Error("exec left dangling");
          if (JSON.stringify(JSON.parse(JSON.stringify(state))) !== JSON.stringify(state)) throw new Error("state not serializable");
        } catch (e) {
          failures.push(`${cc.cardId}[${effectIndex}] ${(e as Error).message}`);
        }
      });
    }
    console.log(`[M5] dry-run: ${ran} effects executed, ${failures.length} failures`);
    expect(failures).toEqual([]);
  });
});

// ─── playability: full games with the real meta decks ───────────────────────

const realDb: CardDb = (id) => {
  if (!catalogById.has(id)) throw new Error(`unknown card ${id}`);
  return engineCardOf(id);
};

function playMetaGame(seed: string, config: GameConfig): AutoGameState {
  const rng = seededRng(`m5:${seed}`);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  let { state } = createGame(realDb, config);
  let steps = 0;
  const step = (intent: PlayerIntent) => { state = applyIntent(realDb, state, intent).state; };
  while (state.phase !== "over" && steps++ < 3000) {
    const pc = state.pendingChoice;
    if (pc) {
      switch (pc.kind) {
        case "mulligan": step({ type: "respondMulligan", player: pc.player, take: rng() < 0.3 }); break;
        case "blockWindow": step({ type: "respondBlock", player: pc.player, blockerIid: rng() < 0.5 && pc.blockers.length ? pick(pc.blockers) : null }); break;
        case "counterWindow": {
          const lm = legalMoves(realDb, state);
          const moves: PlayerIntent[] = [{ type: "passCounter", player: pc.player }];
          if (state.battle) for (const c of lm.counterCards) moves.push({ type: "useCounter", player: pc.player, cardIid: c.iid, targetIid: state.battle.targetIid });
          for (const e of lm.counterEvents) moves.push({ type: "useCounterEvent", player: pc.player, cardIid: e.iid });
          step(pick(moves));
          break;
        }
        case "triggerDecision": step({ type: "respondTrigger", player: pc.player, activate: rng() < 0.5 }); break;
        case "selectTargets": {
          const n = Math.min(pc.count, pc.candidates.length);
          const take = pc.upTo ? Math.floor(rng() * (n + 1)) : n;
          step({ type: "respondTargets", player: pc.player, iids: fitChoice(realDb, state, pc, pc.candidates.slice(0, take).map((c) => c.iid)) });
          break;
        }
        case "mayActivate": step({ type: "respondMay", player: pc.player, activate: rng() < 0.7 }); break;
        case "manualResolve": step({ type: "ackManual", player: pc.player }); break;
        case "peekSelect": {
          const take = rng() < 0.8 ? pc.eligible.slice(0, pc.takeCount) : [];
          const remaining = pc.cards.filter((iid) => !take.includes(iid));
          step({
            type: "respondPeek", player: pc.player, take,
            restTop: pc.rest === "topAnyOrder" || pc.rest === "topOrBottomAnyOrder" ? remaining : [],
            restBottom: pc.rest === "bottomAnyOrder" ? remaining : [],
          });
          break;
        }
        case "payDon": step(payDonIntent(state, pc.player, pc.amount)); break;
        case "chooseNumber": step({ type: "respondNumber", player: pc.player, value: Math.floor(rng() * (pc.max - pc.min + 1)) + pc.min }); break;
        case "mayReplace": step({ type: "respondReplace", player: pc.player, use: rng() < 0.5 }); break;
        case "arrangeLife": {
          const shuffled = [...pc.cards].sort(() => rng() - 0.5);
          step({ type: "respondArrangeLife", player: pc.player, order: shuffled.slice(pc.toDeckTop), toDeck: shuffled.slice(0, pc.toDeckTop) });
          break;
        }
        case "chooseOption": {
          const legal = pc.enabled.flatMap((ok, i) => (ok ? [i] : []));
          step({ type: "respondOption", player: pc.player, index: legal[Math.floor(rng() * legal.length)] });
          break;
        }
        default: throw new Error(`unhandled choice ${(pc as { kind: string }).kind}`);
      }
      continue;
    }
    const lm = legalMoves(realDb, state);
    const moves: PlayerIntent[] = [{ type: "endTurn", player: lm.actor }];
    for (const pl of lm.playableFromHand) if (!pl.needsReplace) moves.push({ type: "playCard", player: lm.actor, iid: pl.iid });
    for (const t of lm.canGiveDonTo) moves.push({ type: "giveDon", player: lm.actor, targetIid: t });
    for (const x of lm.attackers) for (const t of x.targets) moves.push({ type: "attack", player: lm.actor, attackerIid: x.iid, targetIid: t });
    for (const x of lm.activatable) moves.push({ type: "activateMain", player: lm.actor, iid: x.iid, effectIndex: x.effectIndex });
    step(pick(moves));
  }
  expect(state.phase, `meta game did not terminate (seed=${seed}, turn=${state.turn})`).toBe("over");
  return state;
}

describe("M5 exit: the real meta decks play to a result with the generated IR", () => {
  const legal = (d: { cards: string[] }) => {
    const n = new Map<string, number>();
    for (const id of d.cards) n.set(id, (n.get(id) ?? 0) + 1);
    // 5-1-2-3, except "you may have any number of this card in your deck" (M5)
    return d.cards.length === 50 && [...n.entries()].every(([id, x]) => x <= 4 || !!getGeneratedCard(id)?.rules?.anyCopies);
  };
  const playable = bundle.metaDecks.filter((d) => legal(d) && [d.leader, ...d.cards].every((id) => catalogById.has(id)));
  it("there are meta decks fully inside the catalog", () => {
    console.log(`[M5] meta decks inside the catalog: ${playable.map((d) => d.name).join(", ")}`);
    expect(playable.length).toBeGreaterThanOrEqual(4);
  });
  for (let i = 0; i + 1 < playable.length; i += 2) {
    const a = playable[i], b = playable[i + 1];
    it(`${a.name} vs ${b.name} (2 seeds)`, () => {
      for (const seed of [`${i}-a`, `${i}-b`]) {
        const end = playMetaGame(seed, {
          seed,
          players: [{ id: "p1", leader: a.leader, deck: a.cards }, { id: "p2", leader: b.leader, deck: b.cards }],
          firstPlayer: "p1",
        });
        expect(end.winner === "p1" || end.winner === "p2").toBe(true);
      }
    });
  }
});

