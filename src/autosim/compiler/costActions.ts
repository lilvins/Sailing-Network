/** Costs (before the ":") that are ordinary actions done in full — the M5
 *  `{ kind: "action" }` cost item — plus two cost shapes optcg-ai spreads
 *  over several steps: "place N cards from your trash at the bottom of your
 *  deck" (a trash view) and "… in any order" (a Choices of orderings).
 *  (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Action, CostItem, Selector } from "../ir/types";
import { stepActions } from "./actions";
import { costAlternativesOf, labelOptions } from "./choiceLabels";
import { MODIFIER_KEYS, Unsupported, keysOn, list, num, on } from "./dsl";
import { filterOf } from "./selectors";
import type { AbilityCtx, Json, OptcgStep } from "./types";

/** Actions that can be a cost: they only touch the payer's own cards. */
const COSTABLE = new Set<Action["kind"]>([
  "koTarget", "returnToDeck", "returnToHand", "discard", "restTarget", "trashTarget", "reveal",
  "giveActiveDon", "giveRestedDon", "powerMod", "mill", "trashLife", "lifeToHand", "returnDonToDeck", "flipLife",
]);

/** One effect key of a cost step → an `action` cost item, or null when it
 *  is not a cost the IR can pay (the ability then goes to "resolve by hand"). */
export function actionCost(step: OptcgStep, key: string, a: AbilityCtx, inBranch = false): CostItem | null {
  // a NoCancel step comes after the payment (optcgwebsim: no going back once
  // the cost is paid) — it is the payoff, not the cost; ordering branches mark
  // their later cost steps NoCancel too
  if (a.flipped || (!inBranch && on(step.details?.NoCancel))) return null;
  const effect: Json = { [key]: (step.effect as Json)[key] };
  for (const k of keysOn(step.effect)) if (MODIFIER_KEYS.has(k)) effect[k] = (step.effect as Json)[k];
  let acts: Action[];
  try {
    acts = stepActions({ ...step, effect, details: { ...(step.details ?? {}), FullTargetsRequired: [0] } }, a);
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
  if (acts.length !== 1 || !COSTABLE.has(acts[0].kind)) return null;
  const act = acts[0];
  if ("who" in act && act.who !== "self") return null;
  if ("sel" in act) {
    const sel: Selector = act.sel;
    // "place 1 Stage … at the bottom of the owner's deck:" may take either player's card (M5)
    const anyOwner = sel.owner === "any" && act.kind === "returnToDeck" && /the owner's deck/i.test(a.tailText ?? "");
    // "give 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters:" (M5)
    const oppDon = act.kind === "giveRestedDon" && sel.owner === "opponent";
    if (sel.prev || sel.chooser !== "controller" || (!sel.self && sel.owner !== "self" && !anyOwner && !oppDon)) return null;
    delete sel.upTo;
    if (act.kind === "powerMod" && act.amount >= 0) return null; // a cost is a downside
    if (act.kind === "restTarget" && !sel.self) sel.filter = { ...(sel.filter ?? {}), rested: false };
  }
  return { kind: "action", action: act };
}

/** "place N cards (with …) from your trash at the bottom of your deck:" — a
 *  trash view whose first picks send N cards to the deck bottom. When the
 *  view goes on with payoff picks ("play … from your trash"), the opening
 *  step is copied over the last cost pick so the payoff re-opens the view
 *  with the original step indices (Choices jumps stay valid). */
export function trashViewCost(steps: OptcgStep[], i: number, a: AbilityCtx): { cost: CostItem; riders?: CostItem[]; next: number } | null {
  if (a.flipped || !on(steps[i].effect?.StartTopDeckFromTrash)) return null;
  // "rest this Character and place 2 cards from your trash at the bottom of your deck:" — the rest rides along (M5)
  const riders: CostItem[] = [];
  const isReturn = (s: OptcgStep | undefined) => !!s && keysOn(s.effect).filter((k) => k !== "RestSelf").join() === "SendToDeckBottom" && on(s.target?.[0]?.TopDeckCard);
  let j = i + 1;
  // a bare "N or more cards in the view" gate before the picks (M5)
  while (j < steps.length && keysOn(steps[j].effect).length === 0 && !steps[j].target && on(steps[j].details?.Required)) j++;
  if (!isReturn(steps[j])) return null;
  const n = num(steps[j].details?.TopDeckCountOrMore) || num(steps[j].target?.[0]?.TargetCount) || 1;
  let taken = 0;
  while (isReturn(steps[j]) && taken < n) {
    if (on(steps[j].effect?.RestSelf) && riders.length === 0) riders.push({ kind: "restSelf" });
    taken += num(steps[j].target?.[0]?.TargetCount) || 1; j++;
  }
  if (taken !== n) return null;
  const spec = { ...(steps[i].target?.[0] ?? {}) } as Json;
  delete spec.TrashCard;
  const filter = filterOf(spec, a);
  const sel: Selector = { owner: "self", zone: "trash", count: n, chooser: "controller", ...(Object.keys(filter).length > 0 ? { filter } : {}) };
  const cost: CostItem = { kind: "action", action: { kind: "returnToDeck", sel, where: "bottom" } };
  const r = riders.length > 0 ? { riders } : {};
  if (on(steps[j]?.effect?.CleanUpTopDeck)) return { cost, ...r, next: j + 1 };
  if (!on(steps[j]?.target?.[0]?.TopDeckCard)) return { cost, ...r, next: j };
  steps[j - 1] = steps[i]; // the payoff still reads the trash view: re-open it
  return { cost, ...r, next: j - 1 };
}

/** "place this card and 1 card from your hand at the bottom of your deck in
 *  any order:" — a Choices whose branches pay the same cost items in a
 *  different order. Pays branch 0's order; continues after it. */
export function orderChoiceCost(
  steps: OptcgStep[], i: number, a: AbilityCtx, costOf: (st: OptcgStep) => CostItem[] | null,
): { cost: CostItem[]; next: number } | null {
  const opts = list<Json>(steps[i].effect?.Choices);
  if (opts.length < 2 || opts.some((o) => typeof o.JumpToStep !== "number")) return null;
  const branch = (from: number) => {
    const cost: CostItem[] = [];
    let j = from;
    for (; j < steps.length; j++) {
      const c = costOf(steps[j]);
      if (!c) break;
      cost.push(...c);
    }
    return { cost, next: j };
  };
  const starts = opts.map((o) => o.JumpToStep as number);
  const branches = starts.map(branch);
  // the first branch's payoff must end the ability before the next branch
  const nextStart = Math.min(...starts.filter((x) => x > starts[0]), steps.length);
  if (nextStart < steps.length && !steps.slice(branches[0].next, nextStart).some((st) => on(st.details?.EndAfterStep))) return null;
  const key = (c: CostItem[]) => c.map((x) => JSON.stringify(x)).sort().join("|");
  if (branches[0].cost.length < 2 || branches.some((b) => key(b.cost) !== key(branches[0].cost))) return null;
  a.approx.add("\"in any order\": the cost is paid in the first listed order");
  return branches[0];
}

/** "trash 1 card from your hand or rest 1 of your DON!!:" — a Choices whose
 *  branches pay different costs, then run the same payoff (written once per
 *  branch, each ending with EndAfterStep) → one `oneOf` cost item. */
export function alternativeCost(
  steps: OptcgStep[], i: number, text: string, costOf: (st: OptcgStep) => CostItem[] | null,
): { cost: CostItem[]; next: number } | null {
  const opts = list<Json>(steps[i].effect?.Choices);
  if (opts.length < 2 || opts.some((o) => typeof o.JumpToStep !== "number" || (o.JumpToStep as number) <= i)) return null;
  const branches = opts.map((o) => {
    const cost: CostItem[] = [];
    let j = o.JumpToStep as number;
    for (; j < steps.length; j++) {
      const c = costOf(steps[j]);
      if (!c) break;
      cost.push(...c);
    }
    let k = j;
    while (k < steps.length && !on(steps[k].details?.EndAfterStep)) k++;
    const payoff = JSON.stringify(steps.slice(j, k + 1).map((st) => ({ ...st, InternalDescription: undefined })));
    return { cost, next: j, payoff };
  });
  if (branches.some((b) => b.cost.length === 0 || b.payoff !== branches[0].payoff)) return null;
  const options = branches.map((b) => b.cost);
  const labels = labelOptions(costAlternativesOf(text), options, opts.map((o) => o.ButtonText));
  return { cost: [{ kind: "oneOf", options, labels }], next: branches[0].next };
}
