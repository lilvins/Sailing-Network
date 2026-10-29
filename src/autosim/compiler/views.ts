/** "Look at / reveal / search" views (StartTopDeck*) → peekDeck / trash picks. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Action, PeekDisposition, Selector } from "../ir/types";
import { stepConditions } from "./conditions";
import { MODIFIER_KEYS, Unsupported, VIEW_CLOSE, fail, keysOn, list, num, on } from "./dsl";
import { sequence } from "./sequence";
import { ZONE_KEYS, filterOf } from "./selectors";
import type { AbilityCtx, Json, OptcgStep } from "./types";

interface CollectedView {
  /** steps that select from the view (TopDeckCard targets) */
  picks: OptcgStep[];
  /** the closing effect key, "topOrBottom" for a top/bottom choice, or null */
  close: string | null;
  /** first step after the view */
  next: number;
}

/** "place them at the top or bottom of the deck": a Choices whose two
 *  branches are single closing steps (one top, one bottom). */
function isTopOrBottomChoice(steps: OptcgStep[], j: number): boolean {
  const opts = list<Json>(steps[j].effect?.Choices);
  const targets = opts.map((o) => (typeof o.JumpToStep === "number" ? o.JumpToStep : j + 1));
  // "place the rest at the top or bottom": TopDeckToDeck* or Send*ToDeck* of all the view's cards
  const closeKey = (st: OptcgStep | undefined): string | null => {
    const keys = keysOn(st?.effect).filter((k) => !MODIFIER_KEYS.has(k));
    if (keys.length !== 1) return null;
    if (keys[0] === "TopDeckToDeckBottom" || keys[0] === "TopDeckToDeckTop") return keys[0];
    const spec = st?.target?.[0];
    if (spec && on(spec.TopDeckCard) && on(spec.AutoAllMatchingTargets)) {
      if (keys[0] === "SendToDeckBottom") return "TopDeckToDeckBottom";
      if (keys[0] === "SendToDeckTop") return "TopDeckToDeckTop";
    }
    return null;
  };
  const closes = targets.map((t) => closeKey(steps[t]));
  return closes.length === 2 && closes.every((c) => c !== null) && new Set(closes).size === 2;
}

/** Walk the steps after the opening one: picks until the view is closed. */
function collectView(steps: OptcgStep[], i: number, end: number, kind: string): CollectedView {
  const picks: OptcgStep[] = [];
  for (let j = i + 1; j < end; j++) {
    const s = steps[j];
    if (Array.isArray(s.effect?.Choices)) {
      if (isTopOrBottomChoice(steps, j)) return { picks, close: "topOrBottom", next: end };
      const one = list<Json>(s.effect?.Choices);
      // a single "confirm the revealed card" button changes nothing
      if (one.length === 1 && (typeof one[0].JumpToStep !== "number" || one[0].JumpToStep === j + 1)) continue;
      fail("Choices inside a view");
    }
    // the same view opened again in a pick step ("StartTopDeck": 5 next to SendToHand) is a marker (M5)
    const keys = keysOn(s.effect).filter((k) => !MODIFIER_KEYS.has(k) && !(k === kind && num(s.effect?.[k]) === num(steps[i].effect?.[kind])));
    // a bare gate after the view ("If the revealed card has the chosen cost, …") ends it (M5)
    if (keys.length === 0 && !s.target && on(s.details?.Required)) return { picks, close: null, next: j };
    const nextStep = steps[j + 1];
    if (keys.length === 0 && s.target?.[0] && on(s.target[0].TopDeckCard) && nextStep && on(nextStep.details?.HasPreviousTargets)) {
      // "reveal 1 card …; if the revealed card is a …, [X]": the check becomes X's condition (M5)
      const { HasPreviousTargets: _h, ...details } = nextStep.details as Json;
      steps[j + 1] = { ...nextStep, details: { ...details, TopDeckMatches: s.target[0] } };
      continue;
    }
    const closing = keys.filter((k) => VIEW_CLOSE.includes(k));
    const other = keys.filter((k) => !VIEW_CLOSE.includes(k));
    if (other.length > 0) {
      if (!s.target?.[0] || !on(s.target[0].TopDeckCard)) return { picks, close: null, next: j }; // no longer reads the view
      picks.push(s);
    }
    if (closing.length > 0) {
      // a deck search closes the view, then shuffles
      if (closing[0] === "CleanUpTopDeck" && kind === "StartTopDeckFromDeck" && on(steps[j + 1]?.effect?.ShuffleDeck)) {
        return { picks, close: "ShuffleDeck", next: j + 2 };
      }
      return { picks, close: closing[0], next: j + 1 };
    }
  }
  return { picks, close: null, next: end };
}

/** Where the cards nobody took end up (PeekDisposition.rest). */
function restOf(close: string | null): PeekDisposition["rest"] {
  switch (close) {
    case "topOrBottom": return "topOrBottomAnyOrder";
    case "TopDeckToDeckBottom": return "bottomAnyOrder";
    case "TrashTopDeck": return "trash";
    case "ShuffleDeck": return "shuffle";
    case null: case "TopDeckToDeckTop": case "CleanUpTopDeck": return "topAnyOrder";
    default: return fail(`view closed by ${close}`);
  }
}

const pickKeys = (p: OptcgStep) => keysOn(p.effect).filter((k) => !MODIFIER_KEYS.has(k) && !VIEW_CLOSE.includes(k) && k !== "StartTopDeck");

/** "Reveal 1 card from the top of your Life cards. If that card is a [Sabo]
 *  with a cost of 5, you may play that card" / "+1000 per 1 cost on the
 *  revealed card" (M5): the card stays in the Life area unless played. */
function lifeTopView(steps: OptcgStep[], i: number, end: number, a: AbilityCtx): { actions: Action[]; next: number } {
  if (a.flipped) fail("Life reveal under ForceOpponent");
  const top: Selector = { owner: "self", zone: "lifeTop", count: 1, chooser: "controller" };
  const actions: Action[] = [{ kind: "reveal", sel: top }];
  let j = i + 1;
  for (; j < end; j++) {
    const s = steps[j];
    const keys = keysOn(s.effect).filter((k) => !MODIFIER_KEYS.has(k));
    const one = list<Json>(s.effect?.Choices);
    if (one.length === 1 && (typeof one[0].JumpToStep !== "number" || one[0].JumpToStep === j + 1)) continue; // "confirm the revealed card"
    if (keys.join() === "CleanUpTopDeck") { j++; break; }
    if (keys.join() === "BuffXPerTopDeckCost" && on(s.target?.[0]?.AutoSelf)) {
      if (!/during this turn per 1 cost on the revealed card/i.test(a.tailText ?? "")) fail("per-cost amount without its text");
      actions.push({ kind: "powerMod", sel: { owner: "self", zone: selfZoneOf(a), count: 1, self: true, chooser: "controller" },
        amount: num(s.effect?.BuffXPerTopDeckCost), duration: "thisTurn", scale: { q: { count: "lifeTopCost", who: "self" }, per: 1 } });
      continue;
    }
    if (keys.join() === "DeployCharacter" && on(s.target?.[0]?.TopDeckCard)) {
      const f = filterOf(s.target![0], a);
      const sel: Selector = { ...top, upTo: true, ...(Object.keys(f).length ? { filter: f } : {}) };
      actions.push({ kind: "playFromZone", zone: "life", free: true, sel });
      a.lastSel = sel;
      continue;
    }
    break;
  }
  return { actions, next: j };
}
const selfZoneOf = (a: AbilityCtx): Selector["zone"] => (a.card.type === "Leader" ? "leader" : "characterArea");

/** Top N of a deck (or the whole deck for a search) → one peekDeck. */
function deckPeek(steps: OptcgStep[], i: number, kind: string, view: CollectedView, a: AbilityCtx): Action {
  const open = steps[i].effect ?? {};
  if (kind === "StartTopDeckOpp" && a.flipped) fail("opponent view under ForceOpponent");
  if (kind === "StartTopDeckFromDeck" && view.close !== "ShuffleDeck") fail("deck search without a shuffle");
  const then: PeekDisposition = { rest: restOf(view.close) };
  let reveal = on(open.RevealTopDeckToOpponent);
  for (const p of view.picks) {
    const keys = pickKeys(p);
    const spec = p.target?.[0] as Json;
    if (keysOn(spec).some((k) => ZONE_KEYS.has(k) && k !== "TopDeckCard" && !(k === "DeckCard" && kind === "StartTopDeckFromDeck"))) fail("pick from the view and another zone");
    const f = filterOf(spec, a);
    const n = num(spec.TargetCount) || 1;
    if (keys.length !== 1) fail(`view pick ${keys.join("+")}`);
    if (keys[0] === "SendToHand") {
      if (then.addToHand) fail("two add-to-hand picks");
      then.addToHand = f; then.addCount = n;
      if (!on(p.effect?.DrawIsHidden)) reveal = true;
    } else if (keys[0] === "SendToTopLife") {
      if (then.toLife) fail("two add-to-Life picks");
      then.toLife = f; then.lifeCount = n;
      if (on(p.effect?.ForcedFaceUp)) then.lifeFaceUp = true;
    } else if (keys[0] === "DeployCharacter") {
      if (then.play) fail("two play picks");
      then.play = f; then.playCount = n;
      if (on(p.effect?.DeploysRested)) then.playRested = true;
    } else fail(`view pick ${keys[0]}`);
  }
  if (reveal) then.reveal = true;
  if (kind === "StartTopDeckFromDeck") {
    // search the whole deck (50 = more than any deck holds), then shuffle;
    // the view filter of the opening step narrows what may be taken
    const vf = filterOf(steps[i].target?.[0] ?? {}, a);
    if (then.addToHand) then.addToHand = { ...vf, ...then.addToHand };
    if (then.play) then.play = { ...vf, ...then.play };
  }
  const who = kind === "StartTopDeckOpp" || a.flipped ? "opponent" : "self";
  return { kind: "peekDeck", who, count: kind === "StartTopDeckFromDeck" ? 50 : num(open[kind]), then };
}

/** "Add / play up to N … from your trash" → one action per pick. */
function trashPicks(steps: OptcgStep[], i: number, view: CollectedView, a: AbilityCtx): Action[] {
  if (view.close !== null && view.close !== "CleanUpTopDeck") fail(`trash view closed by ${view.close}`);
  const base = filterOf(steps[i].target?.[0] ?? {}, a);
  const actions: Action[] = [];
  for (const p of view.picks) {
    const keys = pickKeys(p);
    const spec = p.target?.[0] as Json;
    if (keys.length !== 1) fail(`trash pick ${keys.join("+")}`);
    const f = { ...base, ...filterOf(spec, a) };
    const raw = num(spec.TargetCount);
    const sel: Selector = { owner: a.flipped ? "opponent" : "self", zone: "trash", count: raw === 0 || raw >= 10 ? 99 : raw, upTo: true, chooser: a.flipped ? "opponent" : "controller" };
    if (Object.keys(f).length > 0) sel.filter = f;
    if (keys[0] === "SendToHand") actions.push({ kind: "addFromTrashToHand", sel });
    else if (keys[0] === "DeployCharacter") actions.push({ kind: "playFromZone", zone: "trash", sel, free: true, ...(on(p.effect?.DeploysRested) ? { rested: true } : {}) });
    else if (keys[0] === "SendToDeckBottom" || keys[0] === "SendToDeckTop") actions.push({ kind: "returnToDeck", sel, where: keys[0] === "SendToDeckTop" ? "top" : "bottom" });
    else if (keys[0] === "SendToTopLife") actions.push({ kind: "addToLife", sel, ...(on(p.effect?.ForcedFaceUp) ? { faceUp: true } : {}) });
    else fail(`trash pick ${keys[0]}`);
    a.lastSel = sel;
  }
  if (actions.length === 0) fail("trash view without a pick");
  return actions;
}

/** A trash "view" is just "from your trash": rewrite every TopDeckCard target
 *  after the opening step into a TrashCard target carrying the view's filter,
 *  then compile the rest of the ability as ordinary steps (M5 — selections,
 *  Choices with "that card", …). Same array length, so jumps stay valid. */
function trashAsZone(steps: OptcgStep[], i: number, end: number, a: AbilityCtx, opponents = false): Action[] {
  const viewSpec = { ...(steps[i].target?.[0] ?? {}) } as Json;
  delete viewSpec.TrashCard;
  const rewritten = steps.map((st, j): OptcgStep => {
    if (j <= i) return st;
    const effect = { ...(st.effect ?? {}) } as Json;
    for (const k of VIEW_CLOSE) delete effect[k];
    const target = st.target?.map((spec) => (on(spec.TopDeckCard)
      ? (() => {
        const { TopDeckCard: _t, FriendlyOnly: _f, EnemyOnly: _e, ...rest } = spec;
        return { ...viewSpec, ...rest, TrashCard: 1, ...(opponents ? { EnemyOnly: 1 } : { FriendlyOnly: 1 }) } as Json;
      })()
      : spec));
    return { ...st, effect, ...(target ? { target } : {}) };
  });
  return sequence(rewritten, i + 1, end, a);
}

/** "Look at N / reveal N" views (spec B §1.6) → one peekDeck / trash action. */
export function viewActions(steps: OptcgStep[], i: number, end: number, a: AbilityCtx): { actions: Action[]; next: number } {
  const openKeys = keysOn(steps[i].effect).filter((k) => !MODIFIER_KEYS.has(k));
  if (openKeys.sort().join() === "StartTopDeck,StartTopDeckFromLife" && num(steps[i].effect?.StartTopDeck) === 1) return lifeTopView(steps, i, end, a);
  if (openKeys.length !== 1) fail(`view step with ${openKeys.join("+")}`);
  const kind = openKeys[0];
  // "place up to 1 card from your opponent's trash at the bottom of the owner's deck" (M5): the trash as a zone
  if (kind === "StartTopDeckFromOppTrash") {
    if (a.flipped) fail("opponent's trash under ForceOpponent");
    const vs = { ...(steps[i].target?.[0] ?? {}) } as Json;
    delete vs.EnemyOnly;
    steps = steps.map((st, j) => (j === i ? { ...st, target: [vs] } : st));
    return { actions: trashAsZone(steps, i, end, a, true), next: end };
  }
  if (kind === "StartTopDeckFromTrash") {
    const lastSelBefore = a.lastSel;
    try {
      const view = collectView(steps, i, end, kind);
      for (const p of view.picks) {
        if (stepConditions(p.details, a).length > 0) fail("conditional pick inside a view");
      }
      return { actions: trashPicks(steps, i, view, a), next: view.next };
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      a.lastSel = lastSelBefore;
      return { actions: trashAsZone(steps, i, end, a), next: end };
    }
  }
  const view = collectView(steps, i, end, kind);
  for (const p of view.picks) {
    if (stepConditions(p.details, a).length > 0) fail("conditional pick inside a view");
    if (p.effect?.Choices) fail("Choices inside a view");
  }
  if (kind === "StartTopDeck" || kind === "StartTopDeckOpp" || kind === "StartTopDeckFromDeck") {
    return { actions: [deckPeek(steps, i, kind, view, a)], next: view.next };
  }
  if (kind === "StartTopDeckFromLifeAll" || kind === "StartTopDeckFromOppLifeAll") {
    // "look at all of your (opponent's) Life cards [; place 1 at the top of your
    // deck] and place them back in any order" (M5)
    if (view.close !== "TopDeckToLife" && view.close !== "TopDeckToOppLife") fail(`Life view closed by ${view.close}`);
    let toDeckTop = 0;
    for (const p of view.picks) {
      if (pickKeys(p).join() !== "SendToDeckTop" || !on(p.details?.FullTargetsRequired ? 1 : 0)) fail(`Life view pick ${pickKeys(p).join("+")}`);
      toDeckTop += num(p.target?.[0]?.TargetCount) || 1;
    }
    const opp = kind === "StartTopDeckFromOppLifeAll";
    const who = opp !== a.flipped ? "opponent" : "self";
    if (toDeckTop > 0 && who !== "self") fail("opponent's Life to the deck");
    return { actions: [{ kind: "arrangeLife", who, ...(toDeckTop ? { toDeckTop } : {}) }], next: view.next };
  }
  return fail(`view ${kind}`);
}
