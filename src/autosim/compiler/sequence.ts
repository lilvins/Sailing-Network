/** A run of steps → actions: gates, ForceOpponent, Choices, views, "continue by hand" tails. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Action, Condition, CostItem } from "../ir/types";
import { stepActions } from "./actions";
import { bulletsOf, labelOptions } from "./choiceLabels";
import { stepConditions } from "./conditions";
import { costOf, lifeChoiceCost } from "./costs";
import { Unsupported, VIEW_OPEN, fail, keysOn, list, num, on } from "./dsl";
import type { AbilityCtx, Json, OptcgStep } from "./types";
import { viewActions } from "./views";

/** Merge consecutive "give 1 rested DON!!" on the same target into one action
 *  ("give this Character up to 2 rested DON!!" is written as two steps). */
export function mergeDon(actions: Action[]): Action[] {
  const out: Action[] = [];
  for (const a0 of actions) {
    // "If you do," between the steps of one gift changes nothing: no target, no DON!!
    const act = a0.kind === "ifThen" && !a0.else && a0.if.length === 1 && a0.if[0].kind === "hadTargets"
      && a0.then.length === 1 && a0.then[0].kind === "giveRestedDon" && a0.then[0].sel.prev ? a0.then[0] : a0;
    const prev = out[out.length - 1];
    if (act.kind === "giveRestedDon" && prev?.kind === "giveRestedDon"
      && (act.sel.prev || (act.sel.self && prev.sel.self))) {
      prev.count += act.count;
      continue;
    }
    out.push(act);
  }
  return out;
}

/** Translate steps [i, end) into actions. At the top level, a step the IR
 *  can't express ends the automatic part: what was translated so far runs,
 *  and a `manual` action carries the rest of the ability (8-1-2 "as much as
 *  possible", plan §1.3). */
export function sequence(steps: OptcgStep[], i: number, end: number, a: AbilityCtx): Action[] {
  a.depth++;
  try {
    return sequenceInner(steps, i, end, a);
  } finally {
    a.depth--;
  }
}

export function sequenceInner(steps: OptcgStep[], i: number, end: number, a: AbilityCtx): Action[] {
  const out: Action[] = [];
  const topLevel = a.depth === 1 && a.tailText !== null;
  while (i < end) {
    if (topLevel) {
      const before = out.length;
      try {
        const r = sequenceStep(steps, i, end, a, out);
        if (r === null) return mergeDon(out);
        i = r;
        continue;
      } catch (e) {
        if (!(e instanceof Unsupported) || before === 0) throw e;
        out.length = before;
        out.push({ kind: "manual", text: `Continue by hand (the earlier part already resolved): ${a.tailText}` });
        a.approx.add(`the rest of an ability is resolved by hand (${e.message})`);
        return mergeDon(out);
      }
    }
    const r = sequenceStep(steps, i, end, a, out);
    if (r === null) return mergeDon(out);
    i = r;
  }
  return mergeDon(out);
}

/** One step of a sequence: appends to `out`; returns the next index, or null
 *  when the rest of the sequence was consumed. */
export function sequenceStep(steps: OptcgStep[], i: number, end: number, a: AbilityCtx, out: Action[]): number | null {
  {
    const step = steps[i];
    const fx = step.effect ?? {};
    const conds = prevTargetsCheck(stepConditions(step.details, a, true), out, a);
    const required = on(step.details?.Required);

    if (keysOn(fx).length === 0 && !step.target) {
      // pure gate / landing pad / confirm prompt
      if (conds.length > 0) {
        if (!required) return i + 1; // a gate that only skips itself does nothing
        const rest = sequence(steps, i + 1, end, a);
        if (rest.length > 0) out.push({ kind: "ifThen", if: conds, then: rest });
        return null;
      }
      return i + 1;
    }
    const may = mayPayAt(steps, i, a);
    if (may) {
      const then = sequence(steps, may.next, end, a);
      const act: Action = { kind: "mayPay", cost: may.cost, then, label: may.label };
      out.push(conds.length > 0 ? { kind: "ifThen", if: conds, then: [act] } : act);
      return null;
    }
    if (on(fx.ForceOpponent)) {
      if (keysOn(fx).length > 1 || step.target) fail("ForceOpponent with siblings");
      if (conds.length > 0) {
        const flippedRest = (() => { a.flipped = !a.flipped; try { return sequence(steps, i + 1, end, a); } finally { a.flipped = !a.flipped; } })();
        out.push({ kind: "ifThen", if: conds, then: flippedRest });
        return null;
      }
      a.flipped = !a.flipped;
      return i + 1;
    }
    if (Array.isArray(fx.Choices)) {
      out.push(...choices(steps, i, end, a, conds));
      return null;
    }
    // "Give up to 2 of your Characters … up to 2 rested DON!! cards each" (M5): one gift
    const each = /give up to (\d+) of your [^.]*? up to (\d+) rested DON!! cards? each/i.exec(a.tailText ?? "");
    if (each && keysOn(fx).includes("AttachRestedDon") && keysOn(fx).length === 1 && step.target?.[0]) {
      let j = i;
      while (j < end && keysOn(steps[j].effect).filter((k) => k !== "CopyTargetsAtEnd").join() === "AttachRestedDon") j++;
      const gift = stepActions({ ...step, target: [{ ...step.target[0], TargetCount: Number(each[1]) }], details: { NoCancel: 1 } }, a)[0];
      if (gift?.kind !== "giveRestedDon") return fail("DON!! gift to several cards");
      out.push({ ...gift, sel: { ...gift.sel, count: Number(each[1]), upTo: true }, count: Number(each[2]) });
      return j >= end ? null : j;
    }
    // "play up to 2 … with different card names and a total cost of 9 or less",
    // written as a pick + a second pick checked against the first (M5) → one pick of 2
    // (or 3: "play up to 3 {Admiral} type Characters with different card names")
    const isMore = (st: OptcgStep | undefined) => !!st && keysOn(st.effect).join() === "DeployCharacter" && !!st.target?.[0]
      && on(st.details?.HasPreviousTargets) && (st.target[0].CombinedCostXOrLess !== undefined || on(st.target[0].NoDuplicateNames))
      && num(st.target[0].TargetCount) === 1;
    if (keysOn(fx).join() === "DeployCharacter" && num(step.target?.[0]?.TargetCount) === 1 && i + 1 < end && isMore(steps[i + 1])) {
      let j = i + 1;
      while (j < end && isMore(steps[j]) && !on(steps[j - 1].details?.EndAfterStep)) j++;
      const last = steps[j - 1];
      const { SecondCostOrLessCheckPrevTarget: _c, ...spec } = last.target![0];
      const merged: OptcgStep = { ...last, target: [{ ...spec, TargetCount: j - i }], details: { NoCancel: 1 } };
      out.push(...stepActions(merged, a));
      return on(last.details?.EndAfterStep) || j >= end ? null : j;
    }
    let acts: Action[];
    let next = i + 1;
    // "You may place all cards in your hand at the bottom of your deck in any order. If you do, draw cards equal to the number you placed" (M5)
    if (on(fx.SaveHandSize) && keysOn(fx).length === 1) {
      if (!/place all cards in your hand at the bottom of your deck in any order\. If you do, draw cards equal to the number you placed/i.test(a.tailText ?? "")) fail("SaveHandSize without its text");
      if (!steps.slice(i + 1, end).some((st) => on(st.effect?.DrawSavedCount))) fail("SaveHandSize without its draw");
      out.push({ kind: "chooseOne", options: [[
        { kind: "returnToDeck", where: "bottom", sel: { owner: "self", zone: "hand", count: 99, chooser: "controller" } },
        { kind: "draw", count: 0, countFromPrev: true }], []],
        labels: ["Place your hand at the bottom of your deck and draw as many", "Don't"] });
      return null;
    }
    if (VIEW_OPEN.some((k) => on(fx[k]))) {
      const v = viewActions(steps, i, end, a);
      acts = v.actions; next = v.next;
    } else {
      acts = splitTargets(step, a) ?? stepActions(step, a);
    }
    if (on(step.details?.EndAfterStep)) next = end;
    if (conds.length > 0) {
      if (required) {
        const rest = sequence(steps, next, end, a);
        out.push({ kind: "ifThen", if: conds, then: [...acts, ...rest] });
        return null;
      }
      if (acts.length > 0) out.push({ kind: "ifThen", if: conds, then: acts });
    } else out.push(...acts);
    return next >= end ? null : next;
  }
}

/** Target specs that hold two selections (M5): "K.O. up to 1 … with 4000
 *  base power or less and up to 1 … with 3000 base power or less" (two
 *  picks, one after the other), "If you have a Character with a cost of 8 or
 *  more, you may select … with a cost of 6 or less instead". */
function splitTargets(step: OptcgStep, a: AbilityCtx): Action[] | null {
  const spec = step.target?.[0];
  if (!spec || (step.target?.length ?? 0) !== 1) return null;
  const SECOND: Record<string, string> = { SecondOriginalPowerXOrLess: "OriginalPowerXOrLess", SecondOriginalCostOrLess: "OriginalCostOrLess" };
  const second = Object.keys(SECOND).find((k) => spec[k] !== undefined);
  if (second) {
    const primary = SECOND[second];
    if (num(spec.TargetCount) !== 2 || spec[primary] === undefined) fail(`target key ${second}`);
    if (!/up to 1 of your opponent's Characters with [^.]* and up to 1 of your opponent's Characters with/i.test(a.tailText ?? "")) fail(`${second} without its text`);
    const { [second]: v2, ...rest } = spec;
    a.approx.add("the two \"up to 1\" picks are chosen one after the other");
    return [...stepActions({ ...step, target: [{ ...rest, TargetCount: 1 }] }, a),
      ...stepActions({ ...step, target: [{ ...rest, [primary]: v2, TargetCount: 1 }] }, a)];
  }
  if (spec.CostOrLessOverride !== undefined) {
    const { CostOrLessOverride: hi, CostOverrideMyCostXOrMoreExists: need, ...rest } = spec;
    if (need === undefined) fail("CostOrLessOverride without its condition");
    if (!new RegExp(`If you have a Character with a cost of ${num(need)} or more, you may select your opponent's Character with a cost of ${num(hi)} or less instead`, "i").test(a.tailText ?? "")) fail("CostOrLessOverride without its text");
    const low = stepActions({ ...step, target: [rest] }, a);
    const high = stepActions({ ...step, target: [{ ...rest, CostOrLess: hi }] }, a);
    return [{ kind: "ifThen", if: [{ kind: "countInZone", sel: { owner: "self", zone: "characterArea", count: 99, chooser: "controller", filter: { costAtLeast: num(need) } }, atLeast: 1 }],
      then: high, else: low }];
  }
  return null;
}

/** A Choices step (spec B §1.9). Each option jumps to a step and runs to the
 *  first EndAfterStep or the end of the ability. "0 DON / 1 DON"-style pairs
 *  where one branch does nothing = an optional benefit → run the benefit. */
export function choices(steps: OptcgStep[], i: number, end: number, a: AbilityCtx, conds: Condition[]): Action[] {
  const opts = list<Json>(steps[i].effect?.Choices);
  const lastSelBefore = a.lastSel;
  const flippedBefore = a.flipped;
  const branches = opts.map((o) => {
    const start = typeof o.JumpToStep === "number" ? o.JumpToStep : i + 1;
    if (start <= i || start > end) fail("Choices jumping backwards");
    a.lastSel = lastSelBefore;
    a.flipped = flippedBefore; // a ForceOpponent inside one branch does not leak into the next
    return sequence(steps, start, end, a);
  });
  a.flipped = flippedBefore;
  let acts: Action[];
  const nonEmpty = branches.filter((b) => b.length > 0);
  // "Gain 0 / 1 / 2 Life" = "add up to 2 cards from the top of your deck to your Life" (M5)
  const unit = nonEmpty[0]?.[0];
  const sameUnit = !!unit && (unit.kind === "addToLife" || (unit.kind === "draw" && !unit.who))
    && branches.every((b) => b.every((x) => JSON.stringify(x) === JSON.stringify(unit)))
    && new Set(branches.map((b) => b.length)).size === branches.length && branches.some((b) => b.length === 0);
  if (sameUnit) {
    const most = Math.max(...branches.map((b) => b.length));
    const merged: Action = unit.kind === "addToLife" ? { ...unit, sel: { ...unit.sel, count: most, upTo: true } } : { kind: "draw", count: most, upTo: true };
    return conds.length > 0 ? [{ kind: "ifThen", if: conds, then: [merged] }] : [merged];
  }
  // "Set all of your DON!! cards as active" written as a UI shortcut: "less than 10" / "all" (M5)
  const buttons = opts.map((o) => o.ButtonText).join();
  if (buttons === "Choice.LessThan10,Choice.ActiveAll" && /Set all of your DON!! cards as active/i.test(a.tailText ?? "")) acts = branches[0];
  else if (nonEmpty.length === 0) acts = [];
  else if (nonEmpty.length === 1 && branches.length === 2
    && nonEmpty[0].every((x) => x.kind === "placeDonInCostArea" || x.kind === "draw" || x.kind === "standDon")) {
    // "add up to 1 DON!!" / "draw up to 1" as a 0-or-1 choice (M5): the player picks how many
    const single = nonEmpty[0].length === 1 ? nonEmpty[0][0] : null;
    if (single && (single.kind === "placeDonInCostArea" || (single.kind === "draw" && !single.who))) acts = [{ ...single, upTo: true }];
    else {
      acts = nonEmpty[0];
      a.approx.add("an optional \"up to\" benefit is always taken");
    }
  } else if (branches.length === 1) acts = branches[0];
  else {
    acts = [{ kind: "chooseOne", options: branches, labels: labelOptions(bulletsOf(a.tailText ?? ""), branches, opts.map((o) => o.ButtonText)) }];
    // "Your opponent chooses one:" / "Your opponent may X. If they do not, Y" (M5) — written under ForceOpponent
    if (flippedBefore) {
      const c1 = acts[0] as Extract<Action, { kind: "chooseOne" }>;
      const mayNot = /your opponent may [^.]*\. If they do not,/i.test(a.tailText ?? "");
      if (!/your opponent chooses one/i.test(a.tailText ?? "") && !mayNot) fail("Choices made by the opponent");
      c1.chooser = "opponent";
      if (mayNot) {
        // the "may" option needs its payment possible; otherwise the other one happens
        const PAYS = new Set(["trashLife", "lifeToHand", "returnDonToDeck", "discard", "mill", "returnToDeck", "trashTarget"]);
        c1.payable = branches.map((b) => b.length > 0 && PAYS.has(b[0].kind));
        if (c1.payable.filter(Boolean).length !== 1) fail("\"If they do not\": which option is the payment?");
        // labels from the chooser's side: "Trash 1 card from the top of your Life cards" / "Don't"
        const phrase = /your opponent may ([^.]*)\. If they do not,/i.exec(a.tailText ?? "")![1].replace(/\btheir\b/g, "your");
        c1.labels = c1.payable.map((p) => (p ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : "Don't"));
        return acts; // the option's own feasibility replaces the Choices step's conditions
      }
    }
  }
  if (conds.length > 0 && acts.length > 0) {
    // a gated Choices step that is not Required is skipped when the gate
    // fails, and the ability goes on with the next step (M5: "draw 1 card. If
    // you have …, you may … instead of drawing")
    if (!on(steps[i].details?.Required) && i + 1 < end) {
      a.lastSel = lastSelBefore;
      a.flipped = flippedBefore;
      const fallthrough = sequence(steps, i + 1, end, a);
      if (fallthrough.length > 0) return [{ kind: "ifThen", if: conds, then: acts, else: fallthrough }];
    }
    return [{ kind: "ifThen", if: conds, then: acts }];
  }
  return acts;
}

/** Effect keys that read as a payment in "you may [X]. If you do, …". */
const PAYMENT_KEYS = new Set(["DonTap", "DonMinus", "TrashCard", "TakeTopLife", "TakeBottomLife", "TrashTopLife",
  "TrashSelf", "RestSelf", "Rest", "SendToDeckBottom", "SendToHand"]);

/** How each payment is worded, to check the data against the text. */
const PAYMENT_TEXT: Partial<Record<CostItem["kind"], RegExp>> = {
  restDon: /\brest\b[^.]*DON/i, returnDonToDeck: /DON!! ?(?:card)?s? (?:from your field )?to your DON!! deck|DON!! ?−/i,
  trashFromHand: /\btrash\b[^.]*\bhand\b/i, lifeToHand: /\bLife\b/i, trashFromLife: /\bLife\b/i,
  trashSelf: /\btrash this\b/i, restSelf: /\brest this\b/i, handToDeckBottom: /\bhand\b[^.]*\bdeck\b|\bdeck\b[^.]*\bhand\b/i,
};

/** "you may [X]. If you do, [Y]" phrases of the ability text, in order. */
const mayPhrases = (text: string | null): string[] =>
  [...(text ?? "").matchAll(/\byou may ([^.]*?)\.\s*If you do,/gi)].map((m) => m[1]);

/** A Required step that pays for the rest of the ability, matched to the
 *  next unused "you may X. If you do," phrase (M5) → its cost; null = not one. */
function mayPayAt(steps: OptcgStep[], i: number, a: AbilityCtx): { cost: CostItem[]; next: number; label: string } | null {
  const step = steps[i];
  const isChoices = Array.isArray(step.effect?.Choices);
  if ((!on(step.details?.Required) && !isChoices) || on(step.details?.ConfirmAction)) return null;
  const phrases = mayPhrases(a.tailText);
  const used = a.mayUsed ?? 0;
  if (used >= phrases.length) return null;
  let read: { cost: CostItem[]; next: number } | null = null;
  if (isChoices) {
    const steps2 = steps.slice();
    read = lifeChoiceCost(steps2, i);
    if (read && steps2[read.next] !== steps[read.next]) return null; // payoff folded into a branch step
  } else {
    const keys = keysOn(step.effect);
    if (keys.length === 0 || !keys.every((k) => PAYMENT_KEYS.has(k))) return null;
    const c = costOf(step, a, true);
    if (c) read = { cost: c, next: i + 1 };
  }
  if (!read || read.next >= steps.length) return null;
  const p = phrases[used];
  // the printed text wins: a payment the phrase doesn't name is dropped
  const named = read.cost.filter((c) => !PAYMENT_TEXT[c.kind] || PAYMENT_TEXT[c.kind]!.test(p));
  if (named.length === 0) return null;
  if (named.length < read.cost.length) a.approx.add("the effect data adds a payment the text does not have (the text is followed)");
  read.cost = named;
  a.mayUsed = used + 1;
  return { ...read, label: p.charAt(0).toUpperCase() + p.slice(1) };
}

/** "If you do," (HasPreviousTargets) is checked against the action just
 *  before it; without one in this run of steps it can't be tracked. */
function prevTargetsCheck(conds: Condition[], out: Action[], a: AbilityCtx): Condition[] {
  if (!conds.some((c) => c.kind === "hadTargets")) return conds;
  const last = out[out.length - 1];
  if (last && "sel" in last && !last.sel.prev) return conds;
  a.approx.add("\"if you do\" after an optional step is not tracked (the follow-up always runs)");
  return conds.filter((c) => c.kind !== "hadTargets");
}
