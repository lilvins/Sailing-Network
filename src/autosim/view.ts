/**
 * What ONE player may see of a game: the server plays a ranked game whole
 * (server/rooms.mjs) and hands each browser only this.
 *
 * Secret for a viewer: the other player's hand, both decks (their order, the
 * viewer's own too) and every face-down Life card. A card in one of those
 * places is shown as a stand-in: its instance id says only where it lies
 * (`seatB~hand~2`) and its card is HIDDEN_CARD. The real instance id must go
 * too: it is the card's place in the decklist (`p2#17`), and copies of one
 * card sit next to each other there.
 *
 * Three things leave the server, all made here:
 *  - `viewOf`: the state as the viewer sees it now. Zones keep their sizes, so
 *    the table and the engine's read-only helpers (legalMoves, powers, costs)
 *    work on it as on any state.
 *  - `redactSetup` / `redactPlay`: the events, one for one. An event names a
 *    card only if the viewer could see that card right before or right after
 *    it (played from the hand: yes; drawn: no), or if the event itself shows
 *    it (a [Trigger], a reveal, the viewer's own look at a deck).
 *  - `resolveIntent`: a move the viewer sent, with its stand-ins turned back
 *    into the real cards. A move that names a card the viewer cannot see by
 *    its real id is refused: guessing ids would be a way to look.
 *
 * Whatever is not listed here as visible stays hidden: a new zone, event or
 * prompt is secret until this file says otherwise.
 */
import { applyEvent, type GameEvent } from "./engine/events";
import { EngineError, type PlayerIntent } from "./engine/intents";
import type { AutoGameState, AutoInstance, ChoiceRequest, Iid, PID } from "./engine/state";

/** The card id of every card the viewer may not see. The card databases know it as a blank card. */
export const HIDDEN_CARD = "HIDDEN";

/** A hidden card named outside a zone (in an event, a modifier): only whose it is. */
export const unseenIid = (owner: PID): Iid => `${owner}~?`;

type HiddenZone = "deck" | "hand" | "life";
const HIDDEN_ZONES: HiddenZone[] = ["deck", "hand", "life"];

/** A real instance id, wherever it stands in a string. createGame (engine.ts) writes them `p1#17` and
 *  `p1#L`, "p1" being whoever plays first: not that player's own id. */
const REAL_IID = /\bp[12]#(?:\d+|L)\b/g;
const ONE_REAL_IID = /^p[12]#(?:\d+|L)$/;
const ownerOfIid = (state: AutoGameState, iid: Iid): PID => state.order[iid.startsWith("p1#") ? 0 : 1];

/** The cards a viewer sees by where they lie: Leaders, Characters, Stages, trashes, their own hand, face-up Life.
 *  A finished game hides nothing (its replay is public). */
function inSight(state: AutoGameState, viewer: PID): Set<Iid> {
  const seen = new Set<Iid>();
  for (const pid of state.order) {
    const p = state.players[pid];
    if (state.phase === "over") { for (const iid of Object.keys(p.instances)) seen.add(iid); continue; }
    seen.add(p.leaderIid);
    for (const iid of p.zones.characterArea) seen.add(iid);
    for (const iid of p.zones.stage) seen.add(iid);
    for (const iid of p.zones.trash) seen.add(iid);
    if (pid === viewer) for (const iid of p.zones.hand) seen.add(iid);
    for (const iid of p.zones.life) if (p.instances[iid].faceUp) seen.add(iid);
  }
  return seen;
}

/** The [Trigger] cards being resolved: revealed, and in no area until they are trashed or played (10-1-5-3). */
function triggerCards(state: AutoGameState): Iid[] {
  return [state.exec?.running, ...(state.exec?.suspended ?? [])].flatMap((r) => (r?.triggerCard && !r.triggerCard.moved ? [r.triggerCard.iid] : []));
}

/** The cards of the viewer's own deck an open prompt asks them to pick among (a search of the deck). */
function searched(state: AutoGameState, viewer: PID): Iid[] {
  const pc = state.pendingChoice;
  if (pc?.kind !== "selectTargets" || pc.player !== viewer) return [];
  const deck = new Set(state.players[viewer].zones.deck);
  return pc.candidates.filter((c) => c.owner === viewer && deck.has(c.iid)).map((c) => c.iid);
}

/** In sight, plus what the moment shows: a [Trigger] card being resolved, and the cards the viewer's
 *  own open prompt lets them look at. */
function seenNow(state: AutoGameState, viewer: PID): Set<Iid> {
  const seen = inSight(state, viewer);
  for (const iid of triggerCards(state)) seen.add(iid);
  const pc = state.pendingChoice;
  if (pc?.player !== viewer) return seen;
  if (pc.kind === "peekSelect" || pc.kind === "arrangeLife") for (const iid of pc.cards) seen.add(iid);
  else if (pc.kind === "triggerDecision") seen.add(pc.iid);
  for (const iid of searched(state, viewer)) seen.add(iid);
  return seen;
}

interface Hiding {
  /** The secret zones as the viewer gets them: real ids for what they see, stand-ins for the rest. */
  zones: Record<PID, Record<HiddenZone, Iid[]>>;
  toStandIn: Map<Iid, Iid>;
  toReal: Map<Iid, Iid>;
}

function hide(state: AutoGameState, viewer: PID, seen: Set<Iid>): Hiding {
  const h: Hiding = { zones: {}, toStandIn: new Map(), toReal: new Map() };
  // cards being picked out of the viewer's deck are listed first: where they lay in it stays unknown
  const found = new Set(searched(state, viewer));
  for (const pid of state.order) {
    const p = state.players[pid];
    const zones = {} as Record<HiddenZone, Iid[]>;
    for (const zone of HIDDEN_ZONES) {
      let cards = p.zones[zone];
      if (zone === "deck" && pid === viewer && found.size > 0) {
        cards = [...cards.filter((iid) => found.has(iid)).sort(), ...cards.filter((iid) => !found.has(iid))];
      }
      zones[zone] = cards.map((iid, i) => {
        if (seen.has(iid)) return iid;
        const standIn = `${pid}~${zone}~${i}`;
        h.toStandIn.set(iid, standIn);
        h.toReal.set(standIn, iid);
        return standIn;
      });
    }
    h.zones[pid] = zones;
  }
  return h;
}

/** A deep copy with every real instance id passed through `swap`, wherever it stands (values, keys,
 *  inside a longer string). A card id written next to an id that was swapped away goes with it, and
 *  so does the text of a card that is not seen. */
function scrub<T>(value: T, swap: (iid: Iid) => Iid): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(REAL_IID, swap);
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(src)) out[k.replace(REAL_IID, swap)] = walk(x);
    for (const [idKey, cardKey] of [["iid", "cardId"], ["sourceIid", "sourceCardId"]]) {
      if (typeof src[idKey] !== "string" || out[idKey] === src[idKey]) continue;
      if (typeof src[cardKey] === "string") out[cardKey] = HIDDEN_CARD;
      if (idKey === "sourceIid" && typeof src.text === "string") out.text = "";
    }
    return out;
  };
  return walk(value) as T;
}

/** The open prompt as someone who does not answer it gets it: that it is open, for whom, and what is public in it. */
function choiceOfOther(pc: ChoiceRequest, seen: Set<Iid>): ChoiceRequest {
  switch (pc.kind) {
    case "selectTargets": return { ...pc, candidates: pc.candidates.filter((c) => seen.has(c.iid)) };
    case "peekSelect": return { ...pc, eligible: [] };
    case "chooseOption": return { ...pc, enabled: pc.options.map(() => true) };
    default: return pc;
  }
}

const hiddenInstance = (iid: Iid): AutoInstance => ({ iid, cardId: HIDDEN_CARD, rested: false });

/**
 * The game as `viewer` sees it. `known`: the cards this viewer has been shown
 * during the game (redactSetup / redactPlay keep it). Their names stay in
 * `instances`, so the log can still name a card that went back to a hand or a
 * deck; where such a card lies now is as hidden as any other.
 */
export function viewOf(state: AutoGameState, viewer: PID, known: Iterable<Iid> = []): AutoGameState {
  if (state.phase === "over") return { ...state, seed: "", rngUses: 0 };
  const seen = seenNow(state, viewer);
  const h = hide(state, viewer, seen);
  const byRef = (iid: Iid) => (seen.has(iid) ? iid : unseenIid(ownerOfIid(state, iid)));
  const byPlace = (iid: Iid) => (seen.has(iid) ? iid : h.toStandIn.get(iid) ?? unseenIid(ownerOfIid(state, iid)));
  const pc = state.pendingChoice;
  const remembered = new Set(known);

  const view = scrub({ ...state, seed: "", rngUses: 0, players: {}, pendingChoice: null }, byRef) as AutoGameState;
  // the one who answers a prompt needs a handle on each card it offers, hidden ones too (a blind pick)
  view.pendingChoice = !pc ? null : pc.player === viewer ? scrub(pc, byPlace) : scrub(choiceOfOther(pc, seen), byRef);
  for (const pid of state.order) {
    const p = state.players[pid];
    const instances: Record<Iid, AutoInstance> = {};
    for (const [iid, inst] of Object.entries(p.instances)) {
      if (seen.has(iid)) instances[iid] = { ...inst };
      else if (remembered.has(iid)) instances[iid] = { iid, cardId: inst.cardId, rested: false };
    }
    for (const zone of HIDDEN_ZONES) for (const iid of h.zones[pid][zone]) if (h.toReal.has(iid)) instances[iid] = hiddenInstance(iid);
    instances[unseenIid(pid)] = hiddenInstance(unseenIid(pid));
    view.players[pid] = {
      ...scrub({ ...p, zones: {}, instances: {} }, byRef),
      zones: { ...scrub(p.zones, byRef), ...h.zones[pid] },
      instances,
    };
  }
  return view;
}

/** Whether a search shows the card it adds to the hand: one taken for what it is ("add up to 1
 *  [type] card") is revealed on the way (rule 11-2-1); "add 1 card to your hand" is not. */
function searchIsOpen(before: AutoGameState): boolean {
  const r = before.exec?.running;
  const action = r?.actions[r.actionIndex];
  if (before.pendingChoice?.kind !== "peekSelect" || action?.kind !== "peekDeck") return false;
  return !!action.then.reveal || Object.keys(action.then.addToHand ?? {}).length > 0;
}

/** The cards an event shows by itself, wherever they lie before and after it. */
function shownBy(e: GameEvent, viewer: PID, openSearch: boolean): Iid[] {
  switch (e.type) {
    case "triggerActivated": case "triggerCardTrashed": case "triggerCardPlayed": return [e.iid];
    case "cardsRevealed": return e.iids;
    case "deckPeeked": return e.player === viewer ? e.iids : [];
    case "lifePeeked": return e.player === viewer ? [e.iid] : [];
    case "peekResolved":
      if (e.player === viewer) return [...e.toHand, ...e.played.map((x) => x.iid), ...e.top, ...e.bottom, ...e.trashed];
      return openSearch ? e.toHand : [];
    default: return [];
  }
}

/** The events that lead from `start` on, as `viewer` gets them: one for each. Changes `start`, adds to `known`. */
function redactFrom(start: AutoGameState, events: GameEvent[], viewer: PID, known: Set<Iid>, openSearch: boolean): GameEvent[] {
  const state = start;
  let seenBefore = inSight(state, viewer);
  // a card shown to both players stays shown while the move goes on: a [Trigger] card until it lands
  // in an area, a revealed card until its deck is shuffled
  const open = new Set<Iid>(triggerCards(state));
  return events.map((e) => {
    applyEvent(state, e);
    const seenAfter = inSight(state, viewer);
    if (e.type === "triggerActivated") open.add(e.iid);
    if (e.type === "cardsRevealed") for (const iid of e.iids) open.add(iid);
    if (e.type === "deckShuffled") for (const iid of e.order) open.delete(iid);
    const shown = new Set([...seenBefore, ...seenAfter, ...open, ...shownBy(e, viewer, openSearch)]);
    if (e.type === "triggerCardTrashed" || e.type === "triggerCardPlayed") open.delete(e.iid);
    seenBefore = seenAfter;
    return scrub(e.type === "gameStarted" ? { ...e, seed: "" } : e, (iid) => {
      if (!shown.has(iid)) return unseenIid(ownerOfIid(state, iid));
      known.add(iid);
      return iid;
    });
  });
}

/** The events of the setup (createGame) for `viewer`. `state` is the game they led to. Adds to `known`. */
export function redactSetup(state: AutoGameState, events: GameEvent[], viewer: PID, known: Set<Iid>): GameEvent[] {
  // the game before its first event: every card in its owner's deck
  const start = structuredClone(state);
  for (const p of Object.values(start.players)) {
    p.zones = { deck: Object.keys(p.instances).filter((iid) => iid !== p.leaderIid), hand: [], trash: [], life: [], characterArea: [], stage: [] };
  }
  const out = redactFrom(start, events, viewer, known, false);
  for (const iid of seenNow(state, viewer)) known.add(iid);
  return out;
}

/** The events of one move for `viewer`, one for each of `events`. `before` and `after` are the game
 *  around the move, as applyIntent took and returned it. Adds to `known`. */
export function redactPlay(before: AutoGameState, events: GameEvent[], after: AutoGameState, viewer: PID, known: Set<Iid>): GameEvent[] {
  const out = redactFrom(structuredClone(before), events, viewer, known, searchIsOpen(before));
  for (const iid of seenNow(after, viewer)) known.add(iid);
  return out;
}

/** A move as `viewer` sent it, ready for the engine: stand-ins become the cards they stand for.
 *  Throws when it names a card the viewer cannot see, or a stand-in that stands for nothing. */
export function resolveIntent(state: AutoGameState, viewer: PID, intent: PlayerIntent): PlayerIntent {
  if (state.phase === "over") return intent;
  const seen = seenNow(state, viewer);
  const h = hide(state, viewer, seen);
  const name = (s: string): string => {
    const card = h.toReal.get(s);
    if (card) return card;
    if (s.includes("~") || (ONE_REAL_IID.test(s) && !seen.has(s))) throw new EngineError("that card is not one you can name");
    return s;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return name(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [name(k), walk(x)]));
  };
  return walk(intent) as PlayerIntent;
}

/** A text about the game (why a move was refused) with the cards `viewer` cannot see taken out of it. */
export function redactText(state: AutoGameState, viewer: PID, text: string): string {
  const seen = seenNow(state, viewer);
  const h = hide(state, viewer, seen);
  return text.replace(REAL_IID, (iid) => (seen.has(iid) ? iid : h.toStandIn.get(iid) ?? unseenIid(ownerOfIid(state, iid))));
}
