/**
 * A player's view of a game (view.ts): whole games between the meta decks,
 * played from the views alone, the way two browsers at a ranked table play.
 * After every move, for both players: nothing secret is in the view or in the
 * events, and the view is still a game the table can draw and play from.
 */
import { describe, expect, it } from "vitest";
import { applyIntent, createGame } from "./engine/engine";
import { applyEvent, type GameEvent } from "./engine/events";
import { EngineError, type PlayerIntent } from "./engine/intents";
import { legalMoves } from "./engine/legality";
import type { AutoGameState, Iid, PID } from "./engine/state";
import { randomIntent } from "./ai/random";
import { metaDecks, metaGameConfig, realDb } from "./__bench__/metaGames";
import type { GameConfig } from "./engine/engine";
import { seededRng } from "../lib/rng";
import { HIDDEN_CARD, redactPlay, redactSetup, redactText, resolveIntent, viewOf } from "./view";

/** Seat names that are not the engine's own "p1"/"p2": an instance id is `p1#n` for whoever plays first, whatever their seat. */
const PIDS: PID[] = ["seatA", "seatB"];
const REAL_IID = /\bp[12]#(?:\d+|L)\b/g;
const realIids = (value: unknown): Iid[] => JSON.stringify(value).match(REAL_IID) ?? [];
const seatOf = (pid: PID): PID => (pid === "p1" ? "seatA" : "seatB");
/** Game `game` of the meta decks, at a table whose seats are seatA and seatB (odd games: seatB plays first). */
function tableConfig(game: number): GameConfig {
  const config = metaGameConfig(game);
  return { ...config, firstPlayer: seatOf(config.firstPlayer), players: [{ ...config.players[0], id: "seatA" }, { ...config.players[1], id: "seatB" }] };
}
/** What a browser gets: the JSON of it. */
const sent = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The cards `viewer` sees by where they lie. Written apart from view.ts on purpose. */
function visibleByZone(state: AutoGameState, viewer: PID): Iid[] {
  return PIDS.flatMap((pid) => {
    const p = state.players[pid];
    return [
      p.leaderIid, ...p.zones.characterArea, ...p.zones.stage, ...p.zones.trash,
      ...(pid === viewer ? p.zones.hand : []),
      ...p.zones.life.filter((iid) => p.instances[iid].faceUp),
    ];
  });
}

/** The cards the open prompt, or a [Trigger] being resolved, shows to `viewer`. */
function shownByMoment(state: AutoGameState, viewer: PID): Iid[] {
  const out = [state.exec?.running, ...(state.exec?.suspended ?? [])].flatMap((r) => (r?.triggerCard && !r.triggerCard.moved ? [r.triggerCard.iid] : []));
  const pc = state.pendingChoice;
  if (pc?.player !== viewer) return out;
  if (pc.kind === "peekSelect" || pc.kind === "arrangeLife") out.push(...pc.cards);
  if (pc.kind === "triggerDecision") out.push(pc.iid);
  if (pc.kind === "selectTargets") out.push(...pc.candidates.filter((c) => c.owner === viewer && state.players[viewer].zones.deck.includes(c.iid)).map((c) => c.iid));
  return out;
}

/** The cards hidden from `viewer` right now. */
function secretNow(state: AutoGameState, viewer: PID): Set<Iid> {
  const all = PIDS.flatMap((pid) => Object.keys(state.players[pid].instances));
  const open = new Set([...visibleByZone(state, viewer), ...shownByMoment(state, viewer)]);
  return new Set(all.filter((iid) => !open.has(iid)));
}

interface Seat {
  known: Set<Iid>;
  events: GameEvent[];
  /** Every card this player was ever shown, by this file's own count. */
  everSeen: Set<Iid>;
}

/** Adds what the events of one move showed `viewer`: a card in sight after any of them, or shown by the event itself. */
function noteSeen(seat: Seat, viewer: PID, before: AutoGameState, events: GameEvent[], after: AutoGameState): void {
  const state = structuredClone(before);
  for (const e of events) {
    applyEvent(state, e);
    if (state.phase !== "over") for (const iid of visibleByZone(state, viewer)) seat.everSeen.add(iid);
    if (e.type === "triggerActivated") seat.everSeen.add(e.iid);
    if (e.type === "cardsRevealed") for (const iid of e.iids) seat.everSeen.add(iid);
    if (e.type === "deckPeeked" && e.player === viewer) for (const iid of e.iids) seat.everSeen.add(iid);
    if (e.type === "lifePeeked" && e.player === viewer) seat.everSeen.add(e.iid);
    if (e.type === "peekResolved") for (const iid of e.toHand) seat.everSeen.add(iid);
  }
  for (const iid of shownByMoment(after, viewer)) seat.everSeen.add(iid);
}

/** Everything a view must hold to, for one player at one moment of the game. */
function checkView(state: AutoGameState, viewer: PID, seat: Seat, seed: string): void {
  const view = sent(viewOf(state, viewer, seat.known));
  const where = `turn ${state.turn}, ${viewer}, prompt ${state.pendingChoice?.kind ?? "none"}`;
  expect(JSON.stringify(view), where).not.toContain(seed);

  for (const pid of PIDS) {
    const real = state.players[pid], shown = view.players[pid];
    // every zone keeps its size, and every card in a zone can be drawn
    for (const zone of Object.keys(real.zones) as (keyof typeof real.zones)[]) {
      expect(shown.zones[zone].length, `${where}: ${pid} ${zone}`).toBe(real.zones[zone].length);
      for (const iid of shown.zones[zone]) expect(shown.instances[iid], `${where}: ${pid} ${zone} ${iid}`).toBeDefined();
    }
    for (const [iid, inst] of Object.entries(shown.instances)) {
      if (real.instances[iid]) {
        // a card with a face: this player was shown it at some point, and it is that card
        expect(seat.everSeen.has(iid), `${where}: ${iid} was never shown`).toBe(true);
        expect(inst.cardId).toBe(real.instances[iid].cardId);
      } else expect(inst.cardId, `${where}: stand-in ${iid}`).toBe(HIDDEN_CARD);
    }
  }

  // outside the list of cards once seen, the view names no card that is hidden now
  const secret = secretNow(state, viewer);
  const places = { ...view, players: Object.fromEntries(Object.entries(view.players).map(([pid, p]) => [pid, { ...p, instances: null }])) };
  expect(realIids(places).filter((iid) => secret.has(iid)), where).toEqual([]);

  // the table works on a view as on a game: the moves of the one who must act are the same
  const actual = legalMoves(realDb, state);
  if (actual.actor === viewer) {
    const mine = legalMoves(realDb, view);
    expect({ ...mine, pendingChoice: null }, where).toEqual({ ...actual, pendingChoice: null });
  }
}

/** The events one move sent to `viewer`. */
function checkEvents(redacted: GameEvent[], events: GameEvent[], viewer: PID, seat: Seat, seed: string): void {
  expect(redacted.map((e) => e.type)).toEqual(events.map((e) => e.type));
  expect(JSON.stringify(redacted)).not.toContain(seed);
  const revealed = new Set(events.flatMap((e) => (e.type === "cardsRevealed" ? e.iids : [])));
  redacted.forEach((e, i) => {
    for (const iid of realIids(e)) expect(seat.everSeen.has(iid), `${e.type} names ${iid}, never shown to ${viewer}`).toBe(true);
    // cards that go from one secret place to another stay unnamed, even ones this player saw before:
    // the order of a deck (their own too), the Life cards dealt, what the other player draws
    if (e.type === "deckShuffled" || e.type === "lifeDealt" || (e.type === "cardsDrawn" && e.player !== viewer)) {
      expect(realIids(e).filter((iid) => !revealed.has(iid)), `${e.type} of ${e.player}, sent to ${viewer}`).toEqual([]);
    }
    const original = events[i];
    if (original.type === "cardsDrawn" && e.type === "cardsDrawn") expect(e.iids.length).toBe(original.iids.length);
  });
}

interface Played { plays: number; state: AutoGameState; seats: Record<PID, Seat> }

/** Game `game` of the meta decks: each move is chosen from the mover's own view, then given to the engine. */
function playFromViews(game: number, maxPlays: number): Played {
  const config = tableConfig(game);
  const rng = seededRng(`view-test:${config.seed}`);
  const made = createGame(realDb, config);
  let state = made.state;
  const seats: Record<PID, Seat> = {};
  for (const pid of PIDS) {
    const seat: Seat = { known: new Set(), events: [], everSeen: new Set([...visibleByZone(state, pid), ...shownByMoment(state, pid)]) };
    seat.events = redactSetup(state, made.events, pid, seat.known);
    checkEvents(seat.events, made.events, pid, seat, config.seed);
    checkView(state, pid, seat, config.seed);
    seats[pid] = seat;
  }
  let plays = 0;
  while (state.phase !== "over" && plays < maxPlays) {
    const actor = legalMoves(realDb, state).actor;
    const view = sent(viewOf(state, actor, seats[actor].known));
    const intent = resolveIntent(state, actor, sent(randomIntent(realDb, view, rng)));
    const r = applyIntent(realDb, state, intent);
    for (const pid of PIDS) {
      const seat = seats[pid];
      noteSeen(seat, pid, state, r.events, r.state);
      const redacted = sent(redactPlay(state, r.events, r.state, pid, seat.known));
      checkEvents(redacted, r.events, pid, seat, config.seed);
      seat.events.push(...redacted);
      if (r.state.phase !== "over") checkView(r.state, pid, seat, config.seed);
    }
    state = r.state;
    plays += 1;
  }
  return { plays, state, seats };
}

describe("a player's view of a game", () => {
  for (let game = 0; game < metaDecks.length; game++) {
    it(`meta game ${game}: played from the views, nothing secret leaves`, () => {
      const { plays } = playFromViews(game, 600);
      expect(plays).toBeGreaterThan(20);
    });
  }

  it("the opening: the other hand, both decks and the Life cards are stand-ins", () => {
    const { state } = createGame(realDb, tableConfig(1));
    const view = viewOf(state, "seatA");
    expect(view.seed).toBe("");
    expect(view.players.seatA.zones.hand).toEqual(state.players.seatA.zones.hand);
    for (const [pid, zone] of [["seatB", "hand"], ["seatA", "deck"], ["seatB", "deck"]] as const) {
      expect(view.players[pid].zones[zone]).toEqual(state.players[pid].zones[zone].map((_, i) => `${pid}~${zone}~${i}`));
    }
    // the only cards of the other player with a face: the Leader (and a Stage a Leader rule put in play)
    const faces = Object.values(view.players.seatB.instances).filter((i) => i.cardId !== HIDDEN_CARD).map((i) => i.iid);
    expect(faces.sort()).toEqual([state.players.seatB.leaderIid, ...state.players.seatB.zones.stage].sort());
  });

  it("a move cannot name a hidden card by its real id, nor a stand-in for nothing", () => {
    const { state } = createGame(realDb, tableConfig(1));
    const theirs = state.players.seatB.zones.hand[0];
    const leader = state.players.seatB.leaderIid;
    const guess: PlayerIntent = { type: "respondTargets", player: "seatA", iids: [theirs] };
    expect(() => resolveIntent(state, "seatA", guess)).toThrow(EngineError);
    expect(() => resolveIntent(state, "seatA", { type: "respondTargets", player: "seatA", iids: ["seatB~hand~99"] })).toThrow(EngineError);
    // a stand-in is the card at that place; a card in sight is itself
    expect(resolveIntent(state, "seatA", { type: "respondTargets", player: "seatA", iids: ["seatB~hand~0", leader] }))
      .toEqual({ type: "respondTargets", player: "seatA", iids: [theirs, leader] });
    expect(redactText(state, "seatA", `illegal target ${theirs}`)).toBe("illegal target seatB~hand~0");
  });

  it("a finished game hides nothing", () => {
    const { state } = createGame(realDb, tableConfig(1));
    const over = applyIntent(realDb, state, { type: "concede", player: "seatA" }).state;
    const view = viewOf(over, "seatB");
    expect(view.players).toEqual(over.players);
    expect(view.seed).toBe("");
  });
});
