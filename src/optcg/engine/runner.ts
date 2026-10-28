// Step runner: executes activations on the stack one step at a time, stopping
// whenever a player has to decide something (s.prompt). See docs/effect-dsl/.

import { detailsOk } from './conditions.js';
import { applyStep } from './effects.js';
import { fire, performRemoval } from './moves.js';
import { cost } from './query.js';
import { findCard, opp } from './state.js';
import { candidates, ctxOf, donCandidates, isDonSpec, matchSpec } from './targets.js';
import { DON_ACTIVE, DON_RESTED, type Ability, type Action, type Activation, type Db, type GameState, type Step } from './types.js';

/** Optional debug hook: called for every executed step. */
export const trace: { hook: ((act: Activation, step: Step) => void) | null } = { hook: null };

export function abilityOf(db: Db, act: Activation): Ability | undefined {
  return act.inline ?? db[act.cardId]?.abilities[act.ability];
}

function advanceStep(act: Activation): void {
  if (act.targets[0]?.length) act.prevTargets = [...act.targets[0]];
  act.stepIdx++;
  act.targets = [];
  act.checkedStep = -1;
}

/** End the top activation. `aborted` = ended early (cancel / failed Required). */
export function finish(db: Db, s: GameState, act: Activation, aborted: boolean): void {
  const i = s.stack.lastIndexOf(act);
  if (i >= 0) s.stack.splice(i, 1);
  s.view = null;
  if (!act.effective && act.timing === 'ActivateMain') {
    // Ended without doing anything (declined, or its condition was false): don't offer it again this turn.
    const f = findCard(s, act.uid);
    if (f && !f.inst.used.includes(-1 - act.ability)) f.inst.used.push(-1 - act.ability);
  }
  if (act.replacement && (aborted || !act.executedAny)) {
    const r = act.replacement;
    performRemoval(db, s, r.uid, r.move, r.by, { combat: r.combat, noReplace: true });
  }
  const d = db[act.cardId];
  if (d?.type === 'Event' && (act.timing === 'EventMain' || act.timing === 'Counter') && act.executedAny) {
    const p = s.players[act.owner];
    p.stats.eventMaxCost = Math.max(p.stats.eventMaxCost, d.cost);
    fire(db, s, 'YouActivateEvent', { seats: [act.owner] });
    fire(db, s, 'OppActivatesEvent', { seats: [opp(act.owner)] });
    fire(db, s, 'OppPlaysEvent', { seats: [opp(act.owner)] });
  }
}

function markUsed(db: Db, s: GameState, act: Activation): void {
  if (act.executedAny) return;
  act.executedAny = true;
  const ab = abilityOf(db, act);
  if (!ab?.proc.OncePerTurn) return;
  const f = findCard(s, act.uid);
  if (f && !f.inst.used.includes(act.ability)) f.inst.used.push(act.ability);
}

function targetLists(step: Step): Step['target'] {
  const eff = step.effect ?? {};
  if (Object.keys(eff).some((k) => k.startsWith('StartTopDeck') && k !== 'StartTopDeckFromLife' && eff[k])) return [];
  return step.target ?? [];
}

/** Auto-choose DON for "DON!! −N": rested cost area, then active, then attached. */
function autoDon(mult: Record<number, number>, n: number, ctl: 0 | 1): number[] {
  const order = Object.keys(mult)
    .map(Number)
    .sort((a, b) => rank(a) - rank(b));
  function rank(u: number) {
    if (u === DON_RESTED(ctl)) return 0;
    if (u === DON_ACTIVE(ctl)) return 1;
    return 2;
  }
  const out: number[] = [];
  for (const u of order) for (let k = 0; k < mult[u] && out.length < n; k++) out.push(u);
  return out;
}

/** Run until a prompt is needed or nothing is left to run. */
export function runStack(db: Db, s: GameState): void {
  for (let guard = 0; guard < 5000; guard++) {
    if (s.prompt || s.winner !== null) return;
    let act = s.stack[s.stack.length - 1];
    if (!act) {
      const next = s.pending.shift();
      if (!next) return;
      s.stack.push(next);
      act = next;
    }
    const ab = abilityOf(db, act);
    if (!ab || act.stepIdx >= ab.steps.length) {
      finish(db, s, act, false);
      continue;
    }
    const step = ab.steps[act.stepIdx];
    const D = step.details ?? {};
    const eff = step.effect ?? {};
    const me = s.players[act.controller];

    // (a) conditions, once when the step is entered
    if (act.checkedStep !== act.stepIdx) {
      act.checkedStep = act.stepIdx;
      let ok = detailsOk(db, s, act, D);
      const freeCost = act.free && act.stepIdx === 0;
      if (ok && eff.DonTap && !freeCost) {
        const need = act.stepIdx === 0 && db[act.cardId]?.type === 'Event' ? 0 : Number(eff.DonTap) || 0;
        if (me.donActive < need) ok = false;
      }
      if (!ok) {
        if (D.Required) finish(db, s, act, true);
        else advanceStep(act);
        continue;
      }
    }

    // (b) "activate this?" confirmation
    if (D.ConfirmAction && act.confirmedStep !== act.stepIdx) {
      s.prompt = { kind: 'confirm', player: act.controller };
      return;
    }

    // (c) declare a number
    if (eff.DeclareCost && act.declaredStep !== act.stepIdx) {
      s.prompt = { kind: 'declare', player: act.controller, options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
      return;
    }

    // (d) branching
    if (Array.isArray(eff.Choices) && eff.Choices.length) {
      if (eff.Choices.length === 1) {
        jump(act, eff.Choices[0].JumpToStep);
        continue;
      }
      s.prompt = { kind: 'choice', player: act.controller, options: eff.Choices.map((c: { ButtonText: string }) => c.ButtonText), cancelable: !D.NoCancel };
      return;
    }

    // (e) targets, one list at a time
    const lists = targetLists(step) ?? [];
    let waiting = false;
    let abort = false;
    while (act.targets.length < lists.length) {
      const k = act.targets.length;
      const spec = lists[k];
      const full = (Array.isArray(D.FullTargetsRequired) && D.FullTargetsRequired.includes(k)) || Number(eff.DonMinus) > 0;
      if (spec.AutoSelf) act.targets.push([act.uid]);
      else if (spec.AutoCopyPreviousTargets) act.targets.push([...act.prevTargets]);
      else if (spec.AutoMainTarget) {
        const extra = Object.keys(spec).some((k) => k !== 'AutoMainTarget');
        const mt = act.mainTarget;
        act.targets.push(mt !== undefined && (!extra || matchSpec(db, s, { ...spec, AutoMainTarget: 0 }, mt, ctxOf(act))) ? [mt] : []);
      }
      else if (isDonSpec(spec)) {
        const mult = donCandidates(s, spec, act.controller);
        const total = Object.values(mult).reduce((a, b) => a + b, 0);
        const donN = Number(eff.DonMinus) || 0;
        if (donN > 0) {
          if (total < donN) {
            abort = true;
            break;
          }
          // "You may DON!! −N": the player can decline the cost.
          if (!D.NoCancel && act.confirmedStep !== act.stepIdx) {
            s.prompt = { kind: 'confirm', player: act.controller };
            waiting = true;
            break;
          }
          act.targets.push(autoDon(mult, donN, act.controller));
          continue;
        }
        if (spec.AutoAllMatchingTargets) {
          act.targets.push(autoDon(mult, total, act.controller));
          continue;
        }
        if (!total) {
          act.targets.push([]);
          continue;
        }
        const count = Math.min(Number(spec.TargetCount) || total, total);
        s.prompt = {
          kind: 'select',
          player: act.controller,
          candidates: Object.keys(mult).map(Number),
          multiplicity: mult,
          chosen: [],
          min: full ? count : 0,
          max: count,
          cancelable: !D.NoCancel && !(full && k > 0),
          list: k,
        };
        waiting = true;
        break;
      } else {
        const C = candidates(db, s, spec, ctxOf(act), step.targetOverrides);
        if (spec.AutoAllMatchingTargets) {
          act.targets.push(C);
          continue;
        }
        let count = Number(spec.TargetCount) || 0;
        if (spec.TargetCountSavedCount) count = act.savedInt;
        if (spec.TargetCountHandOverflow) count = Math.max(0, me.hand.length - spec.TargetCountHandOverflow);
        if (!C.length || (count === 0 && (spec.TargetCountSavedCount || spec.TargetCountHandOverflow))) {
          if (full && D.Required && count !== 0) {
            abort = true;
            break;
          }
          act.targets.push([]);
          continue;
        }
        const max = Math.min(count || C.length, C.length);
        if (full && D.Required && C.length < Math.min(count || 1, 999) && count !== 999 && count !== 10) {
          abort = true;
          break;
        }
        s.prompt = {
          kind: 'select',
          player: act.controller,
          candidates: C,
          multiplicity: {},
          chosen: [],
          min: full ? max : 0,
          max,
          cancelable: !D.NoCancel && !(full && k > 0),
          list: k,
        };
        waiting = true;
        break;
      }
    }
    if (abort) {
      finish(db, s, act, true);
      continue;
    }
    if (waiting) return;
    if (eff.CopyTargetsAtEnd && lists.length && !act.targets[lists.length - 1]?.length) act.targets[lists.length - 1] = [...act.prevTargets];

    // (f) execute
    markUsed(db, s, act);
    trace.hook?.(act, step);
    if (Object.keys(eff).some((k) => eff[k] && !k.startsWith('StartTopDeck') && k !== 'Choices' && k !== 'ForceOpponent')) act.effective = true;
    applyStep(db, s, act, step);
    if (eff.ForceOpponent) {
      if (act.targets[0]?.length) act.prevTargets = [...act.targets[0]];
      act.controller = opp(act.controller);
      act.stepIdx++;
      act.targets = [];
      act.checkedStep = -1;
      continue;
    }
    advanceStep(act);
    if (D.EndAfterStep) finish(db, s, act, false);
  }
  throw new Error('runStack did not settle');
}

function jump(act: Activation, to: number | undefined): void {
  act.stepIdx = to ?? act.stepIdx + 1;
  act.targets = [];
  act.checkedStep = -1;
}

/** Legal answers to an effect prompt (select / choice / confirm / declare). */
export function promptActions(s: GameState): Action[] {
  const pr = s.prompt;
  if (!pr) return [];
  switch (pr.kind) {
    case 'select': {
      const out: Action[] = [];
      if (pr.chosen.length < pr.max)
        for (const u of pr.candidates) {
          const left = u < 0 ? (pr.multiplicity[u] ?? 0) - pr.chosen.filter((x) => x === u).length : pr.chosen.includes(u) ? 0 : 1;
          if (left > 0) out.push({ type: 'pick', uid: u });
        }
      if (pr.chosen.length >= pr.min || !out.length) out.push({ type: 'done' });
      if (pr.cancelable) out.push({ type: 'cancel' });
      return out;
    }
    case 'choice': {
      const out: Action[] = pr.options.map((_, idx) => ({ type: 'choose', idx }));
      if (pr.cancelable) out.push({ type: 'cancel' });
      return out;
    }
    case 'declare':
      return pr.options.map((idx) => ({ type: 'choose', idx }));
    case 'confirm':
      return [{ type: 'confirm', yes: true }, { type: 'confirm', yes: false }];
    default:
      return [];
  }
}

/** Apply an answer to an effect prompt. Returns false if the action is not a prompt answer. */
export function answerPrompt(db: Db, s: GameState, a: Action): boolean {
  const pr = s.prompt;
  const act = s.stack[s.stack.length - 1];
  if (!pr || !act) return false;
  const ab = abilityOf(db, act)!;
  const step = ab.steps[act.stepIdx];
  switch (pr.kind) {
    case 'select': {
      if (a.type === 'cancel') {
        s.prompt = null;
        finish(db, s, act, true);
        return true;
      }
      if (a.type === 'pick') {
        pr.chosen.push(a.uid);
        if (a.uid >= 0) {
          // selection-dependent filters (total cost, different names...) shrink the list
          const spec = (targetLists(step) ?? [])[pr.list];
          pr.candidates = candidates(db, s, spec, ctxOf(act, pr.chosen), step.targetOverrides);
        }
        const more = promptActions(s).some((x) => x.type === 'pick');
        if (pr.chosen.length < pr.max && more) return true;
      } else if (a.type !== 'done') return false;
      act.targets[pr.list] = [...pr.chosen];
      s.prompt = null;
      return true;
    }
    case 'choice':
      if (a.type === 'cancel') {
        s.prompt = null;
        finish(db, s, act, true);
        return true;
      }
      if (a.type !== 'choose') return false;
      s.prompt = null;
      jump(act, step.effect!.Choices[a.idx]?.JumpToStep);
      return true;
    case 'declare':
      if (a.type !== 'choose') return false;
      s.prompt = null;
      act.savedInt = a.idx;
      act.declaredStep = act.stepIdx;
      return true;
    case 'confirm':
      if (a.type !== 'confirm') return false;
      s.prompt = null;
      if (a.yes) act.confirmedStep = act.stepIdx;
      else finish(db, s, act, true);
      return true;
    default:
      return false;
  }
}

export { cost };
