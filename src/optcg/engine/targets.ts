// Target specs: which cards (or DON!!) a step may choose, and passive affected sets.

import { basePower, cost, hasKeyword, immuneToEffect, power } from './query.js';
import { def, fieldCards, findCard, hasCategory, hasName, opp, totalDon, type Zone } from './state.js';
import { DON_ACTIVE, DON_ATTACHED, DON_RESTED, type Activation, type CardInst, type Db, type GameState, type Seat, type TargetSpec } from './types.js';

const ZONE_KEYS = ['DeployedCharacter', 'Leader', 'StageCard', 'HandCard', 'TopDeckCard', 'TrashCard', 'DeckCard', 'LifeCard'];
const TYPE_IDX: Record<string, number> = { Leader: 0, Character: 1, Event: 2, Stage: 3 };

export interface SpecCtx {
  /** Player from whose perspective FriendlyOnly / EnemyOnly are read. */
  ctl: Seat;
  actor: number;
  prevTargets: number[];
  prevNames: string[];
  savedString: string;
  /** Cards already chosen in this list (for Combined* / Second* / NoDuplicateNames). */
  chosen: number[];
}

export function ctxOf(act: Activation, chosen: number[] = []): SpecCtx {
  return { ctl: act.controller, actor: act.uid, prevTargets: act.prevTargets, prevNames: act.prevNames, savedString: act.savedString, chosen };
}

function zoneOk(spec: TargetSpec, zone: Zone, inView: boolean): boolean {
  if (spec.TopDeckCard && inView) return true;
  if (!ZONE_KEYS.some((k) => spec[k])) return zone === 'chars' || zone === 'leader';
  return (
    (zone === 'chars' && !!spec.DeployedCharacter) ||
    (zone === 'leader' && !!spec.Leader) ||
    (zone === 'stage' && !!spec.StageCard) ||
    (zone === 'hand' && !!spec.HandCard) ||
    (zone === 'trash' && !!spec.TrashCard) ||
    (zone === 'deck' && !!spec.DeckCard) ||
    (zone === 'life' && !!spec.LifeCard)
  );
}

function hasTiming(db: Db, c: CardInst, key: string): boolean {
  return db[c.id].abilities.some((a) => a.proc[key]);
}

/** Does card `uid` satisfy `spec` (ignoring selection count)? */
export function matchSpec(db: Db, s: GameState, spec: TargetSpec, uid: number, x: SpecCtx, overrides: TargetSpec[] = []): boolean {
  const f = findCard(s, uid);
  if (!f) return false;
  const inView = !!s.view?.cards.includes(uid);
  if (!zoneOk(spec, f.zone, inView)) return overrides.some((o) => matchSpec(db, s, o, uid, x));
  if (spec.FriendlyOnly && f.owner !== x.ctl) return false;
  if (spec.EnemyOnly && f.owner === x.ctl) return false;
  if (spec.DeckCard && f.owner !== x.ctl) return false;
  if (spec.NotSelf && uid === x.actor) return false;
  if (spec.OnlySelf && uid !== x.actor) return overrides.some((o) => matchSpec(db, s, o, uid, x));
  if (spec.RequirePreviousTargets && !x.prevTargets.includes(uid)) return false;
  if (spec.NoUsingPreviousTargets && x.prevTargets.includes(uid)) return false;
  const d = def(db, f.inst);
  const onField = f.zone === 'chars' || f.zone === 'leader' || f.zone === 'stage';
  const curCost = onField || f.zone === 'hand' ? cost(db, s, uid) : d.cost;
  const curPower = onField ? power(db, s, uid) : d.power;
  const me = s.players[x.ctl];
  const them = s.players[opp(x.ctl)];

  // filters that overrides cannot bypass
  let costCap = spec.CostOrLess;
  if (spec.CostOrLessOverride && me.chars.some((c) => cost(db, s, c.uid) >= (spec.CostOverrideMyCostXOrMoreExists ?? 0))) costCap = spec.CostOrLessOverride;
  if (costCap && curCost > costCap) return false;
  if (spec.NotNames?.length && hasName(d, spec.NotNames)) return false;
  if (spec.NoDuplicateNames) {
    const taken = [...x.chosen, ...x.prevTargets].map((u) => findCard(s, u)).filter((y) => y && y.inst.uid !== uid).map((y) => db[y!.inst.id].name);
    if ([...taken, ...x.prevNames].includes(d.name)) return false;
  }
  if (spec.ActiveOnly && f.inst.rested) return false;
  if (spec.RestedOnly && !f.inst.rested) return false;

  // overrides ("... or [Name]" / "... or an Event") skip the remaining trait filters
  const bypass =
    (spec.NameOverrides?.length && hasName(d, spec.NameOverrides)) ||
    (spec.ColoredEventOverrides?.length && d.type === 'Event' && d.colors.some((k) => spec.ColoredEventOverrides.includes(k))) ||
    (spec.StrikeTypeOverrides?.length && d.attributes.some((a) => spec.StrikeTypeOverrides.includes(a))) ||
    (spec.StageOverrides && d.type === 'Stage');
  if (!bypass) {
    if (spec.OnlyTypes?.length && !spec.OnlyTypes.includes(TYPE_IDX[d.type])) return overrides.some((o) => matchSpec(db, s, o, uid, x));
    if (spec.OnlyCategories?.length) {
      const ok = spec.RequireAllCategories ? spec.OnlyCategories.every((k: number) => d.categories.includes(k)) : hasCategory(d, spec.OnlyCategories);
      if (!ok) return overrides.some((o) => matchSpec(db, s, o, uid, x));
    }
    if (spec.OnlyNames?.length && !hasName(d, spec.OnlyNames)) return overrides.some((o) => matchSpec(db, s, o, uid, x));
    if (spec.OnlyColors?.length && !d.colors.some((k) => spec.OnlyColors.includes(k))) return false;
    if (spec.OnlyStrikeTypes?.length && !d.attributes.some((a) => spec.OnlyStrikeTypes.includes(a))) return false;
    if (spec.PowerXOrLess && curPower > spec.PowerXOrLess) return false;
    if (spec.PowerXOrMore && curPower < spec.PowerXOrMore) return false;
    if (spec.PowerZero && curPower > 0) return false;
    const bp = onField ? basePower(db, s, uid) : d.power;
    if (spec.OriginalPowerXOrLess && bp > spec.OriginalPowerXOrLess) return false;
    if (spec.OriginalPowerXOrMore && bp < spec.OriginalPowerXOrMore) return false;
    if (spec.BasePowerZero && bp > 0) return false;
    if (spec.CostDonOrLess && !(d.type === 'Event' && spec.ColoredEventOverrides) && curCost > totalDon(me)) return false;
  }
  if (spec.CostOrMore && curCost < spec.CostOrMore) return false;
  if (spec.OriginalCostOrLess && d.cost > spec.OriginalCostOrLess) return false;
  if (spec.OriginalCostOrMore && d.cost < spec.OriginalCostOrMore) return false;
  if (spec.CostZero && curCost !== 0) return false;
  if (spec.CostOppLifeOrLess && curCost > them.life.length) return false;
  if (spec.CostMyLifeOrLess && curCost > me.life.length) return false;
  if (spec.CostCombinedLifeOrLess && curCost > me.life.length + them.life.length) return false;
  if (spec.CostOppDonOrLess && curCost > totalDon(them)) return false;
  if (spec.GivenDon && f.inst.don < spec.GivenDon) return false;
  if (spec.CostEqualGivenDon && f.inst.don !== curCost) return false;
  if (spec.HasTrigger && !hasTiming(db, f.inst, 'Trigger')) return false;
  if (spec.HasActivateMain && !hasTiming(db, f.inst, 'ActivateMain')) return false;
  if (spec.HasNoOnAttack && hasTiming(db, f.inst, 'OnAttack')) return false;
  if (spec.HasNoOnPlay && hasTiming(db, f.inst, 'OnPlay')) return false;
  if (spec.HasNoEffects && d.abilities.length > 0) return false;
  if (spec.HasBlocker && !hasKeyword(db, s, uid, 'Blocker')) return false;
  if (spec.NotBlocker && hasKeyword(db, s, uid, 'Blocker')) return false;
  if (spec.FaceUp && !f.inst.faceUp) return false;
  if (spec.WillBeRemoved && immuneToEffect(db, s, uid, x.ctl, 'remove', x.actor)) return false;
  if (spec.NameMatchesSaved && !d.names.includes(x.savedString)) return false;
  if (spec.DifferentColorFromPrevTarget) {
    const pc = x.prevTargets.flatMap((u) => {
      const p = findCard(s, u);
      return p ? db[p.inst.id].colors : [];
    });
    if (d.colors.some((k) => pc.includes(k))) return false;
  }
  // selection-dependent caps
  const picked = [...x.chosen, ...(spec.SecondCostOrLessCheckPrevTarget ? x.prevTargets : [])]
    .filter((u) => u !== uid)
    .map((u) => findCard(s, u))
    .filter((y): y is NonNullable<typeof y> => !!y);
  if (spec.CombinedCostXOrLess) {
    const sum = picked.reduce((t, y) => t + db[y.inst.id].cost, 0);
    if (sum + curCost > spec.CombinedCostXOrLess) return false;
  }
  if (spec.CombinedPowerXOrLess) {
    const sum = picked.reduce((t, y) => t + power(db, s, y.inst.uid), 0);
    if (sum + curPower > spec.CombinedPowerXOrLess) return false;
  }
  if (spec.SecondCostOrLess && picked.some((y) => cost(db, s, y.inst.uid) > spec.SecondCostOrLess) && curCost > spec.SecondCostOrLess) return false;
  if (spec.SecondOriginalCostOrLess && picked.some((y) => db[y.inst.id].cost > spec.SecondOriginalCostOrLess) && d.cost > spec.SecondOriginalCostOrLess) return false;
  if (spec.SecondOriginalPowerXOrLess && picked.some((y) => db[y.inst.id].power > spec.SecondOriginalPowerXOrLess) && d.power > spec.SecondOriginalPowerXOrLess) return false;
  return true;
}

/** All card uids anywhere that could be checked against a spec. */
function pool(s: GameState, spec: TargetSpec): CardInst[] {
  const out: CardInst[] = [];
  for (const p of s.players) {
    out.push(...fieldCards(p));
    if (spec.HandCard) out.push(...p.hand);
    if (spec.TrashCard) out.push(...p.trash);
    if (spec.DeckCard) out.push(...p.deck);
    if (spec.LifeCard) out.push(...p.life);
  }
  if (spec.TopDeckCard && s.view) {
    for (const u of s.view.cards) {
      const f = findCard(s, u);
      if (f && !out.includes(f.inst)) out.push(f.inst);
    }
  }
  return out;
}

export function isDonSpec(spec: TargetSpec): boolean {
  return !!(spec.DonAreaCard || spec.AttachedDon) && !ZONE_KEYS.some((k) => spec[k]);
}

/** DON!! pseudo-uid candidates with how many can be picked from each group. */
export function donCandidates(s: GameState, spec: TargetSpec, ctl: Seat): Record<number, number> {
  const out: Record<number, number> = {};
  for (const seat of [0, 1] as Seat[]) {
    if (spec.FriendlyOnly && seat !== ctl) continue;
    if (spec.EnemyOnly && seat === ctl) continue;
    const p = s.players[seat];
    if (spec.DonAreaCard) {
      if (!spec.RestedOnly && p.donActive) out[DON_ACTIVE(seat)] = p.donActive;
      if (!spec.ActiveOnly && p.donRested) out[DON_RESTED(seat)] = p.donRested;
    }
    if (spec.AttachedDon) for (const c of [p.leader, ...p.chars]) if (c.don) out[DON_ATTACHED(c.uid)] = c.don;
  }
  return out;
}

export function candidates(db: Db, s: GameState, spec: TargetSpec, x: SpecCtx, overrides: TargetSpec[] = []): number[] {
  const all = new Map<number, CardInst>();
  for (const c of pool(s, spec)) all.set(c.uid, c);
  for (const o of overrides) for (const c of pool(s, o)) all.set(c.uid, c);
  const out: number[] = [];
  for (const c of all.values()) {
    if (x.chosen.includes(c.uid)) continue;
    if (matchSpec(db, s, spec, c.uid, x, overrides)) out.push(c.uid);
  }
  return out;
}
