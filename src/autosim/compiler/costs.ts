/** Leading cost steps (before the ":") → IR CostItems. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { CostItem } from "../ir/types";
import { actionCost } from "./costActions";
import { MODIFIER_KEYS, keysOn, list, num, on } from "./dsl";
import { selectorOf, zoneOf } from "./selectors";
import type { AbilityCtx, Json, OptcgStep } from "./types";

// ─── costs ──────────────────────────────────────────────────────────────────

export const isFull = (step: OptcgStep, k = 0): boolean =>
  list<number>(step.details?.FullTargetsRequired).includes(k);

/** A leading step that is part of the activation cost (before the `:`) →
 *  CostItem[]; null when the step is not cost-shaped. */
export function costOf(step: OptcgStep, a: AbilityCtx, inBranch = false): CostItem[] | null {
  const fx = step.effect ?? {};
  const keys = keysOn(fx).filter((k) => !MODIFIER_KEYS.has(k));
  if (keys.length === 0) return null;
  const out: CostItem[] = [];
  for (const k of keys) {
    const v = fx[k];
    switch (k) {
      case "DonTap": out.push({ kind: "restDon", count: num(v) }); break;
      case "DonMinus":
        // "return 8 of your active DON!! cards:" (M5) — active ones only
        if (on(step.target?.[0]?.ActiveOnly)) out.push({ kind: "action", action: { kind: "returnDonToDeck", who: "self", count: num(v), activeOnly: true } });
        else out.push({ kind: "returnDonToDeck", count: num(v) });
        break;
      case "RestSelf": out.push({ kind: "restSelf" }); break;
      case "TrashSelf": out.push({ kind: "trashSelf" }); break;
      case "TakeTopLife": out.push({ kind: "lifeToHand", count: num(v) }); break;
      case "TakeBottomLife": out.push({ kind: "lifeToHand", count: num(v), bottom: true }); break;
      case "TrashTopLife": out.push({ kind: "trashFromLife", count: num(v) }); break;
      case "TrashCard": case "SendToDeckBottom": case "SendToHand": case "Rest": {
        if (k === "TrashCard" && on(step.target?.[0]?.AutoSelf) && step.target!.length === 1) { out.push({ kind: "trashSelf" }); break; } // "trash this Character:"
        const alt = step.target?.[0]?.OrTarget as Json | undefined;
        if (alt && k === "TrashCard" && zoneOf(alt) !== zoneOf(step.target![0])) {
          // "trash 1 of your {X} type Characters or 1 card from your hand:" (M5) — the payer picks
          const { OrTarget: _o, ...main } = step.target![0];
          const one = (spec: Json): CostItem | null => cardCost({ ...step, target: [spec] }, k, a) ?? actionCost({ ...step, target: [spec] }, k, a, inBranch);
          const x = one(main), y = one({ ...alt, TargetCount: num(alt.TargetCount) || 1 });
          if (!x || !y) return null;
          out.push({ kind: "oneOf", options: [[x], [y]], labels: ["Trash a Character", "Trash a card from your hand"] });
          break;
        }
        const c = cardCost(step, k, a) ?? actionCost(step, k, a, inBranch);
        if (!c) return null;
        out.push(c);
        break;
      }
      default: {
        const c = actionCost(step, k, a, inBranch);
        if (!c) return null;
        out.push(c);
      }
    }
  }
  return out;
}

/** The M2/M3 card-choice cost items (kept as they are: the hand batch and
 *  the board-auto prompts use them); null → try an `action` cost. */
function cardCost(step: OptcgStep, k: string, a: AbilityCtx): CostItem | null {
  let spec = step.target?.[0];
  // "trash 2 cards from your hand:" written without FriendlyOnly — a hand is yours unless the text says otherwise (M5)
  if (spec && !on(spec.FriendlyOnly) && !on(spec.EnemyOnly) && on(spec.HandCard) && keysOn(spec).filter((x) => /Card$|Character$|^Leader$/.test(x) && on(spec![x])).length === 1) {
    spec = { ...spec, FriendlyOnly: 1 };
    step = { ...step, target: [spec, ...(step.target ?? []).slice(1)] };
  }
  if (!spec || !on(spec.FriendlyOnly)) return null;
  const zoneKeys = keysOn(spec).filter((x) => /Card$|Character$|^Leader$/.test(x) && on(spec[x]));
  const alt = spec.OrTarget as Json | undefined;
  if (k === "Rest" && alt && (on(spec.DonAreaCard) || on(alt.DonAreaCard))) {
    // "rest your Leader or 1 of your DON!! cards:" (M5)
    const [donSpec, cardSpec] = on(spec.DonAreaCard) ? [spec, alt] : [alt, spec];
    if (keysOn(cardSpec).some((x) => x === "DonAreaCard")) return null;
    const sel = selectorOf({ ...cardSpec, OrTarget: undefined, FriendlyOnly: 1, TargetCount: num(cardSpec.TargetCount) || 1 }, a, true);
    delete sel.upTo;
    sel.filter = { ...(sel.filter ?? {}), rested: false };
    const don: CostItem = { kind: "restDon", count: num(donSpec.TargetCount) || 1 };
    const card: CostItem = { kind: "action", action: { kind: "restTarget", sel } };
    return { kind: "oneOf", options: [[don], [card]], labels: ["Rest DON!!", "Rest a card"] };
  }
  if (k === "Rest" && on(spec.DonAreaCard) && zoneKeys.length === 1) {
    return { kind: "restDon", count: num(spec.TargetCount) || 1 }; // "rest N of your DON!!:" = ①
  }
  const n = num(spec.TargetCount) || 1;
  if (k === "Rest" && on(spec.DonAreaCard) && n <= 5) {
    // "rest N of your cards:" — any mix of DON!! and Leader / Character /
    // Stage cards (M5): one option per split
    const { DonAreaCard: _don, TargetCount: _n, ...rest } = spec;
    const options: CostItem[][] = [];
    const labels: string[] = [];
    for (let don = n; don >= 0; don--) {
      const cards = n - don;
      const opt: CostItem[] = [];
      if (don > 0) opt.push({ kind: "restDon", count: don });
      if (cards > 0) {
        const sel = selectorOf({ ...rest, TargetCount: cards }, a, true);
        delete sel.upTo;
        sel.filter = { ...(sel.filter ?? {}), rested: false };
        opt.push({ kind: "action", action: { kind: "restTarget", sel } });
      }
      options.push(opt);
      labels.push([don > 0 ? `${don} DON!!` : "", cards > 0 ? `${cards} Leader/Character/Stage card${cards > 1 ? "s" : ""}` : ""].filter(Boolean).join(" + "));
    }
    return { kind: "oneOf", options, labels: labels.map((l) => `Rest ${l}`) };
  }
  const zone = zoneOf(spec);
  const sel = selectorOf(spec, a, true);
  delete sel.upTo;
  if (k === "TrashCard" && zone === "hand") return { kind: "trashFromHand", sel };
  if (k === "SendToDeckBottom" && zone === "hand" && !sel.filter) return { kind: "handToDeckBottom", count: sel.count };
  if (k === "SendToHand" && zone === "characterArea") return { kind: "returnToHand", sel };
  if (k === "Rest" && zone === "characterArea") return { kind: "restFromField", sel };
  if (k === "Rest" && ["leaderOrStage", "characterOrStage", "field", "leader", "stage", "leaderOrCharacter"].includes(zone)) {
    sel.filter = { ...(sel.filter ?? {}), rested: false };
    return { kind: "action", action: { kind: "restTarget", sel } };
  }
  return null;
}

/** "add 1 card from the top or bottom of your Life to your hand:" (or
 *  "trash 1 card from the top or bottom of your Life:") — a Choices between
 *  the Top / Bottom variants used as a cost. The payoff either follows both
 *  branches, or is written inside each branch step (then it ends with
 *  EndAfterStep and the first branch step, stripped of the cost, carries it). */
const LIFE_KEYS: Record<string, "take" | "trash"> = {
  TakeTopLife: "take", TakeBottomLife: "take", TrashTopLife: "trash", TrashBottomLife: "trash",
};

export function lifeChoiceCost(steps: OptcgStep[], i: number): { cost: CostItem[]; next: number } | null {
  const opts = list<Json>(steps[i].effect?.Choices);
  if (opts.length !== 2) return null;
  const at = opts.map((o) => (typeof o.JumpToStep === "number" ? o.JumpToStep : i + 1));
  const takes = at.map((j) => steps[j]);
  const lifeKey = (s: OptcgStep | undefined) => keysOn(s?.effect).find((k) => k in LIFE_KEYS);
  const keys = takes.map(lifeKey);
  if (!keys[0] || !keys[1] || LIFE_KEYS[keys[0]] !== LIFE_KEYS[keys[1]]) return null;
  const n = takes.map((s, b) => num(s?.effect?.[keys[b]!]));
  if (n[0] === 0 || n[0] !== n[1]) return null;
  const kind = LIFE_KEYS[keys[0]];
  // "from the top or bottom of your Life": the payer picks (M5)
  const one = (bottom: boolean): CostItem => (kind === "take"
    ? { kind: "lifeToHand", count: n[0], ...(bottom ? { bottom } : {}) }
    : { kind: "trashFromLife", count: n[0], ...(bottom ? { bottom } : {}) });
  const lifeCost: CostItem = { kind: "oneOf", options: [[one(false)], [one(true)]], labels: ["From the top of your Life", "From the bottom of your Life"] };
  const rest = takes.map((s, b) => {
    const effect = { ...(s?.effect ?? {}) } as Json;
    delete effect[keys[b]!];
    return { ...s, effect } as OptcgStep;
  });
  const extra = rest.map((s) => keysOn(s.effect).sort().join("+"));
  if (extra[0] === "" || extra[0] === "RestSelf") {
    if (extra[0] !== extra[1]) return null;
    // the branches carry identical payoffs: continue after the last branch's cost step
    const cost: CostItem[] = [lifeCost];
    if (extra[0] === "RestSelf") cost.unshift({ kind: "restSelf" });
    return { cost, next: Math.max(...at) + 1 };
  }
  // payoff inside each branch step: identical apart from the Top/Bottom key;
  // cost-shaped keys riding in the same step (➀, "rest this") join the cost
  const same = (s: OptcgStep) => {
    const { EndAfterStep: _e, ...details } = (s.details ?? {}) as Json;
    return JSON.stringify({ ...s, InternalDescription: undefined, details: Object.keys(details).length ? details : undefined });
  };
  const first = at[0] < at[1] ? 0 : 1;
  if (same(rest[0]) !== same(rest[1]) || !on(rest[first].details?.EndAfterStep)) return null;
  const cost: CostItem[] = [lifeCost];
  const payoff = { ...rest[first], effect: { ...(rest[first].effect ?? {}) } as Json };
  if (num(payoff.effect.DonTap) > 0) { cost.unshift({ kind: "restDon", count: num(payoff.effect.DonTap) }); delete payoff.effect.DonTap; }
  if (on(payoff.effect.RestSelf)) { cost.unshift({ kind: "restSelf" }); delete payoff.effect.RestSelf; }
  steps[at[first]] = payoff;
  return { cost, next: at[first] };
}
