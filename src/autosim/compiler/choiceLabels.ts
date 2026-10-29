/** Labels for "Choose one:" options and "X or Y:" cost alternatives: the
 *  printed bullet / alternative that matches each branch, or optcg-ai's
 *  button text. Display only — the engine never reads them.
 *  (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Action, CostItem } from "../ir/types";

/** A phrase of the printed text that each IR kind normally appears with. */
const HINTS: Partial<Record<string, RegExp>> = {
  draw: /\bdraw/i, koTarget: /K\.O\./, powerMod: /power/i, costMod: /\bcost\b/i, setBasePower: /power/i,
  restTarget: /\brest/i, restFromField: /\brest/i, restDon: /\brest/i, restSelf: /\brest/i,
  standTarget: /active/i, standDon: /active/i,
  discard: /trash/i, trashFromHand: /trash/i, trashTarget: /trash/i, trashSelf: /trash/i, mill: /trash|deck/i,
  returnToHand: /hand/i, returnToDeck: /bottom|top of/i, handToDeckBottom: /bottom/i,
  playFromZone: /\bplay/i, addFromTrashToHand: /trash/i, reveal: /reveal/i, peekDeck: /look at|reveal/i,
  giveRestedDon: /give/i, giveActiveDon: /give/i, attachDonFromDeck: /give|DON/i,
  placeDonInCostArea: /DON!! deck|add/i, returnDonToDeck: /DON!! ?−|return/i,
  grantKeyword: /gains?|\[/i, restriction: /cannot|can't|will not/i,
  lifeToHand: /Life/i, trashLife: /Life/i, trashFromLife: /Life/i, addToLife: /Life/i, lifeToHandCost: /Life/i, flipLife: /face-(up|down)/i,
  negateEffect: /negate|lose/i, redirectAttack: /attack/i,
};

type Item = Action | CostItem;

function kindsOf(items: Item[]): string[] {
  return items.flatMap((x) => {
    if (x.kind === "ifThen" || x.kind === "mayPay") return kindsOf(x.then);
    if (x.kind === "action") return kindsOf([x.action]);
    if (x.kind === "lifeToHand" && !("who" in x)) return ["lifeToHandCost"];
    return [x.kind];
  });
}

const score = (text: string, items: Item[]) => new Set(kindsOf(items).filter((k) => HINTS[k]?.test(text))).size;

function permutations(n: number): number[][] {
  if (n <= 1) return [[0]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

/** Button texts optcg-ai shares across many cards → plain English. */
const BUTTONS: Record<string, string> = {
  "Choice.Deploy": "Play it", "Choice.AddToTopLife": "Add it to the top of your Life",
  "Choice.MoveToTop": "Place it at the top", "Choice.MoveToBottom": "Place it at the bottom",
  "Choice.AddToHand": "Add it to your hand",
  "Choice.TopDeckToBottom": "Place it at the bottom of your deck", "Choice.TopDeckToTop": "Keep it at the top of your deck",
};

/** "Choice.DrawOneCard" → "Draw One Card". */
export function humanize(button: unknown, i: number): string {
  if (typeof button !== "string" || !button.trim()) return `Option ${i + 1}`;
  if (BUTTONS[button]) return BUTTONS[button];
  return button.replace(/^Choice\./, "").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Z])/g, "$1 $2").trim();
}

/** Match each branch to one printed text (best unique assignment where every
 *  branch matches something); otherwise the humanized button texts. */
export function labelOptions(texts: string[], branches: Item[][], buttons: unknown[]): string[] {
  const fallback = branches.map((_, i) => humanize(buttons[i], i));
  if (texts.length !== branches.length || branches.length > 4) return fallback;
  let best = -1;
  let winners: number[][] = [];
  for (const perm of permutations(branches.length)) {
    const scores = perm.map((t, b) => score(texts[t], branches[b]));
    if (scores.some((x) => x === 0)) continue;
    const total = scores.reduce((s, x) => s + x, 0);
    if (total > best) { best = total; winners = [perm]; } else if (total === best) winners.push(perm);
  }
  if (winners.length !== 1) return fallback;
  return winners[0].map((t) => texts[t].trim());
}

/** The "• …" lines of an ability's printed text. */
export const bulletsOf = (text: string): string[] =>
  text.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("•")).map((l) => l.replace(/^•\s*/, ""));

/** "You may trash 1 card from your hand or rest 1 of your DON!! cards:" →
 *  the alternatives of the cost (before the colon), split on " or ". */
export function costAlternativesOf(text: string): string[] {
  const head = text.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").split(":")[0] ?? "";
  return head.replace(/^\s*You may\s*/i, "").split(/\s+or\s+/i).map((s) => s.trim()).filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1));
}
