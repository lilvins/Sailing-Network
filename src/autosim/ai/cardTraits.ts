import type { CardDb } from "../engine/state";

/**
 * What a card does, read from its compiled IR (so it works for every card,
 * not a hand-written list).
 *
 * Removal: playing it (On Play of a Character, [Main] or
 * [Counter] of an Event) takes an opponent's Character off the field — K.O.,
 * back to hand or deck, trash. A removal in hand is worth the best target it
 * still has (teoria-del-vantaggio.md §3.8).
 *
 * Counter event: an Event whose [Counter] gives power to your own Leader or
 * Characters; in hand it defends like a printed counter (Demon Aura +3000).
 *
 * Card flow: its On Play draws or looks at the deck for a card (Kin'emon,
 * Perona, Otama): it digs for the curve, so it opens a hand well.
 *
 * Lasting effect: something that keeps working while the Character is on the
 * field (static, When Attacking, Activate: Main, On K.O., end of turn…). An
 * On Play has already given its value when the card came down (§3.4).
 */
const REMOVAL_KINDS = new Set(["koTarget", "returnToHand", "returnToDeck", "trashTarget"]);
const SPENT_ON_PLAY = new Set(["onPlay", "main", "counter"]);

/** Timings that fire once, when the card arrives (or from Life), and are then spent. */
const ONE_SHOT = new Set(["onPlay", "main", "counter", "trigger"]);

const removalCache = new Map<string, boolean>();
const counterEventCache = new Map<string, number>();
const flowCache = new Map<string, boolean>();
const lastingCache = new Map<string, boolean>();

export function isRemoval(db: CardDb, cardId: string): boolean {
  let hit = removalCache.get(cardId);
  if (hit === undefined) {
    const effects = db(cardId).compiled?.effects ?? [];
    hit = effects.some((e) => SPENT_ON_PLAY.has(e.timing) && removesOpponentCharacter(e.actions));
    removalCache.set(cardId, hit);
  }
  return hit;
}

/** The first power boost of the card's own [Counter] effect (the unconditional part), 0 if none. */
export function counterEventPower(db: CardDb, cardId: string): number {
  let hit = counterEventCache.get(cardId);
  if (hit === undefined) {
    const counter = (db(cardId).compiled?.effects ?? []).find((e) => e.timing === "counter");
    const boost = counter?.actions.find((a) => a.kind === "powerMod" && a.sel.owner === "self");
    hit = boost && boost.kind === "powerMod" ? Math.max(0, boost.amount) : 0;
    counterEventCache.set(cardId, hit);
  }
  return hit;
}

export function isCardFlow(db: CardDb, cardId: string): boolean {
  let hit = flowCache.get(cardId);
  if (hit === undefined) {
    const onPlay = (db(cardId).compiled?.effects ?? []).filter((e) => e.timing === "onPlay");
    hit = onPlay.some((e) => hasKind(e.actions, FLOW_KINDS));
    flowCache.set(cardId, hit);
  }
  return hit;
}
const FLOW_KINDS = new Set(["draw", "peekDeck"]);

function hasKind(node: unknown, kinds: Set<string>): boolean {
  if (Array.isArray(node)) return node.some((n) => hasKind(n, kinds));
  if (!node || typeof node !== "object") return false;
  const o = node as { kind?: string; who?: string };
  if (o.kind && kinds.has(o.kind) && o.who !== "opponent") return true;
  return Object.values(node).some((n) => hasKind(n, kinds));
}

export function hasLastingEffect(db: CardDb, cardId: string): boolean {
  let hit = lastingCache.get(cardId);
  if (hit === undefined) {
    hit = (db(cardId).compiled?.effects ?? []).some((e) => !ONE_SHOT.has(e.timing));
    lastingCache.set(cardId, hit);
  }
  return hit;
}

/** Any action, however deep (choices, conditions, costs), that removes an opponent's Character. */
function removesOpponentCharacter(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(removesOpponentCharacter);
  if (!node || typeof node !== "object") return false;
  const o = node as { kind?: string; sel?: { owner?: string; zone?: string } };
  if (o.kind && REMOVAL_KINDS.has(o.kind) && o.sel?.owner !== "self" && o.sel?.zone === "characterArea") return true;
  return Object.values(node).some(removesOpponentCharacter);
}
