/** Small helpers to read the actionV3 JSON (flags, numbers, lists) and the shared key sets. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Timing } from "../ir/types";
import type { Json } from "./types";

// ─── small helpers ──────────────────────────────────────────────────────────

export class Unsupported extends Error {}
export const fail = (why: string): never => { throw new Unsupported(why); };

export const on = (v: unknown): boolean => v === true || (typeof v === "number" && v !== 0);
export const num = (v: unknown): number => (typeof v === "number" ? v : v === true ? 1 : 0);
export const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const keysOn = (o: Json | undefined): string[] => Object.keys(o ?? {}).filter((k) => {
  const v = (o as Json)[k];
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v !== "" : on(v) || (typeof v === "object" && v !== null);
});

/** Effect keys that only modify a sibling key (spec B §1.1). */
export const MODIFIER_KEYS = new Set([
  "ForcedFaceUp", "DeploysRested", "NoLog", "DrawIsHidden", "AddToLifeIsHidden",
  "RevealTopDeckToOpponent", "LeaveLifeInPosition",
]);
/** Step-control `details` keys (no condition semantics). */
export const CONTROL_KEYS = new Set([
  "NoCancel", "Required", "FullTargetsRequired", "EndAfterStep", "ConfirmAction",
  "SearchingDeck", "CanUseOnPlays",
]);
export const VIEW_OPEN = ["StartTopDeck", "StartTopDeckOpp", "StartTopDeckFromTrash", "StartTopDeckFromHand",
  "StartTopDeckFromDeck", "StartTopDeckFromLifeAll", "StartTopDeckFromOppTrash", "StartTopDeckFromOppLifeAll",
  "StartTopDeckFromLife"];
export const VIEW_CLOSE = ["TopDeckToDeckBottom", "TopDeckToDeckTop", "TrashTopDeck", "ShuffleDeck", "CleanUpTopDeck",
  "TopDeckToLife", "TopDeckToOppLife"];

/** Timings that happen during the controller's own turn (for "until the end
 *  of the owner's turn" durations). */
export const OWN_TURN_TIMINGS = new Set<Timing>(["onPlay", "activateMain", "main", "whenAttacking", "endOfYourTurn"]);
