/** One payoff step → IR Actions: one small builder per actionV3 effect key. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Action, Duration, Keyword, Selector } from "../ir/types";
import { isFull } from "./costs";
import { MODIFIER_KEYS, OWN_TURN_TIMINGS, fail, keysOn, list, num, on } from "./dsl";
import { ZONE_KEYS, selectorOf, selfZone } from "./selectors";
import { ATTRIBUTES } from "./catalogMaps";
import type { AbilityCtx, Json, OptcgStep } from "./types";

export function durationFor(key: string, sel: Selector, a: AbilityCtx): Duration {
  switch (key) {
    case "BuffCombatPower": case "LoseBlockerThisBattle": return "thisBattle";
    case "Freeze": return "untilOwnersNextRefresh";
    case "BuffPowerToOppEnd": case "ChangeCostToOppEnd": case "GainBlockerToOppEnd": case "SetBasePowerToOppEnd":
      return "untilEndOfOpponentsNextTurn";
    case "BuffPowerToOwnersStart": case "GainCombatImmuneToStart":
      if (sel.owner !== "self") fail(`${key} on a non-own card`);
      return "untilStartOfYourNextTurn";
    case "BuffPowerToOwnersEnd": case "SilenceToOwnersEnd": case "CantAttack": case "CantRest":
      // "until the end of the target owner's turn" (spec B §1.13)
      if (sel.owner === "opponent" && OWN_TURN_TIMINGS.has(a.timing)) return "untilEndOfOpponentsNextTurn";
      // on your own card from a [Trigger] / [Counter] (the opponent's turn): "until the end of your next turn"
      if (sel.owner === "self" && (a.timing === "trigger" || a.timing === "counter")) return "untilEndOfYourNextTurn";
      if (sel.owner === "any") fail(`${key} on cards of either side`);
      return "thisTurn";
    default: return "thisTurn";
  }
}

export const KEYWORD_GRANTS: Record<string, Keyword> = {
  GainRush: "Rush", GainDoubleAttack: "DoubleAttack", GainBanish: "Banish", GainUnblockable: "Unblockable",
  GainBlocker: "Blocker", GainBlockerToOppEnd: "Blocker", GainRushCharacters: "RushCharacter",
};
export const RESTRICTIONS: Record<string, Extract<Action, { kind: "restriction" }>["what"]> = {
  CantAttack: "cannotAttack", LoseBlocker: "cannotBlock", LoseBlockerThisBattle: "cannotBlock",
  GainCanAttackActive: "canAttackActiveCharacters", GainImmune: "cannotBeKOd",
  GainCombatImmuneToStart: "cannotBeKOdInBattle",
  Freeze: "skipNextRefresh",
};

/** What a builder knows about the step it is translating. */
interface StepScope {
  key: string;
  value: unknown;
  effect: Json;
  spec: Json | undefined;
  a: AbilityCtx;
  /** The step's selection: the first call prompts; later effect keys of the
   *  same step act on the same cards ("that card", spec B §1.1). */
  sel: () => Selector;
  /** "you" as seen by the current controller (flipped by ForceOpponent). */
  who: () => "self" | "opponent";
}

type Builder = (s: StepScope) => Action | Action[];

const powerLike = (kind: "powerMod" | "costMod" | "setBasePower"): Builder => (s) => {
  const sel = s.sel();
  return { kind, sel, amount: num(s.value), duration: durationFor(s.key, sel, s.a) };
};

/** "+N power for every card trashed / K.O.'d this way" (M5): own cards only —
 *  "give up to 1 … −1000 for every …" picks a target per instance. */
function perPrev(s: StepScope, duration: Duration): Action {
  const sel = s.sel();
  return { kind: "powerMod", sel, amount: num(s.value), duration, perPrevTarget: true };
}

const opponentOfWho = (s: StepScope): "self" | "opponent" => (s.a.flipped ? "self" : "opponent");

const BUILDERS: Record<string, Builder> = {
  DrawCards: (s) => (s.who() === "opponent" ? { kind: "draw", count: num(s.value), who: "opponent" } : { kind: "draw", count: num(s.value) }),
  KOCard: (s) => {
    const sel = s.sel();
    if (!sel.prev && sel.zone !== "characterArea" && sel.zone !== "stage" && sel.zone !== "characterOrStage") fail("K.O. outside the Character area");
    return { kind: "koTarget", sel };
  },
  BuffPower: powerLike("powerMod"),
  BuffCombatXPerPrevTargets: (s) => perPrev(s, "thisBattle"),
  BuffXPerPrevTargets: (s) => perPrev(s, "thisTurn"),
  BuffXPerGivenDon: (s) => {
    if (!/for every DON!! card given to that Character/i.test(s.a.tailText ?? "")) fail("per-DON amount without its text");
    return { kind: "powerMod", sel: s.sel(), amount: num(s.value), duration: "thisTurn", perGivenDon: true };
  },
  BuffCombatPower: powerLike("powerMod"),
  BuffPowerToOppEnd: powerLike("powerMod"),
  BuffPowerToOwnersStart: powerLike("powerMod"),
  BuffPowerToOwnersEnd: powerLike("powerMod"),
  ChangeCost: powerLike("costMod"),
  ChangeCostToOppEnd: powerLike("costMod"),
  SetBasePower: powerLike("setBasePower"),
  SetBasePowerToOppEnd: powerLike("setBasePower"),
  Rest: (s) => {
    if (s.spec && on(s.spec.DonAreaCard)) return restDonOrCards(s);
    return { kind: "restTarget", sel: s.sel() };
  },
  RestSelf: (s) => ({ kind: "restTarget", sel: { owner: s.who(), zone: selfZone(s.a.card), count: 1, self: true, chooser: "controller" } }),
  Activate: (s) => {
    if (!s.spec || !on(s.spec.DonAreaCard)) return { kind: "standTarget", sel: s.sel() };
    if (keysOn(s.spec).some((x) => ZONE_KEYS.has(x) && x !== "DonAreaCard")) fail("Activate DON!! or cards");
    // "set up to N of your DON!! cards as active" (M5): the player picks how many; "all" stays all
    const all = on(s.spec.AutoAllMatchingTargets) || !/set up to \d+ of your DON!!/i.test(s.a.tailText ?? "");
    return { kind: "standDon", count: num(s.spec.TargetCount) || (all ? 10 : 1), ...(all ? {} : { upTo: true }) };
  },
  TrashCard: (s) => {
    const spec = s.spec;
    if (spec && on(spec.AutoSelf)) return { kind: "trashTarget", sel: { owner: s.who(), zone: selfZone(s.a.card), count: 1, self: true, chooser: "controller" } };
    if (spec && !on(spec.HandCard) && (on(spec.DeployedCharacter) || on(spec.StageCard)) && !on(spec.Leader)) {
      return { kind: "trashTarget", sel: s.sel() }; // field → trash, not a K.O. (M5)
    }
    if (!spec || !on(spec.HandCard) || keysOn(spec).some((x) => ZONE_KEYS.has(x) && x !== "HandCard")) fail("trash from a zone other than the hand");
    const sel = s.sel();
    if (sel.owner === "opponent" && sel.chooser === "controller") fail("trash from the opponent's hand chosen by you");
    if (sel.owner === "any") fail("trash from either hand");
    if (spec!.TargetCountHandOverflow !== undefined) {
      // "trash cards from your hand until you have N cards in your hand" (M5)
      delete sel.upTo;
      return { kind: "discard", who: sel.owner as "self" | "opponent", sel, keepInHand: num(spec!.TargetCountHandOverflow) };
    }
    return { kind: "discard", who: sel.owner as "self" | "opponent", sel };
  },
  SendToHand: (s) => {
    const sel = s.sel();
    if (sel.zone === "trash") return { kind: "addFromTrashToHand", sel };
    if (sel.zone === "characterArea" || sel.zone === "leaderOrCharacter" || sel.zone === "stage" || sel.prev) return { kind: "returnToHand", sel };
    return fail(`add to hand from ${sel.zone}`);
  },
  SendToDeckBottom: (s) => returnToDeck(s, "bottom"),
  SendToDeckTop: (s) => returnToDeck(s, "top"),
  DeployCharacter: (s) => {
    const sel = s.sel();
    if (sel.zone !== "hand" && sel.zone !== "trash") return fail(`play from ${sel.zone}`);
    return { kind: "playFromZone", zone: sel.zone, sel, free: true, ...(on(s.effect.DeploysRested) ? { rested: true } : {}) };
  },
  DeploySelf: (s) => {
    const rested = on(s.effect.DeploysRested) ? { rested: true } : {};
    if (s.a.timing === "trigger") return { kind: "playFromZone", zone: "hand", free: true, sel: { owner: "self", zone: "hand", count: 1, self: true, chooser: "controller" }, ...rested };
    // "play this Character card from your trash / hand" (M5)
    const m = /play this (?:Character )?card from your (trash|hand)/i.exec(s.a.tailText ?? "");
    const zone = m ? (m[1].toLowerCase() as "trash" | "hand") : s.a.timing === "onKO" ? "trash" : fail("play this card: from where?");
    return { kind: "playFromZone", zone, free: true, sel: { owner: "self", zone, count: 1, self: true, chooser: "controller" }, ...rested };
  },
  AttachRestedDon: (s) => {
    // "give up to N rested DON!! to 1 of your …": the "up to" is the DON count
    const sel = s.sel();
    delete sel.upTo;
    // "give … to its owner's Leader or 1 of their Characters" after taking the opponent's DON!! (M5)
    if (sel.owner === "any" && /to its owner's Leader/i.test(s.a.tailText ?? "") && /your opponent's rested DON/i.test(s.a.tailText ?? "")) sel.owner = "opponent";
    return { kind: "giveRestedDon", sel, count: 1 };
  },
  OppTrashRandom: (s) => {
    // "your opponent trashes 1 card from their hand" / (flipped) "your opponent
    // chooses 1 card from your hand; trash that card"
    const owner = opponentOfWho(s);
    if (!s.a.flipped) s.a.approx.add("a random discard is chosen by the controller");
    return { kind: "discard", who: owner, sel: { owner, zone: "hand", count: num(s.value), chooser: s.a.flipped ? "opponent" : "controller" } };
  },
  AttachActiveDon: (s) => {
    const sel = s.sel();
    delete sel.upTo;
    if (sel.owner === "any" && /to its owner's Leader/i.test(s.a.tailText ?? "") && /your opponent's rested DON/i.test(s.a.tailText ?? "")) sel.owner = "opponent";
    return { kind: "giveActiveDon", sel, count: num(s.value) || 1 };
  },
  RevealCard: (s) => {
    const sel = s.sel();
    if (sel.zone !== "hand") fail(`reveal from ${sel.zone}`);
    return { kind: "reveal", sel };
  },
  CantPlayAnyCharactersToField: (s) => playLock(s, 0),
  CantPlayAnyCardsFromHand: (s) => {
    if (!/you cannot play cards from your hand during this turn/i.test(s.a.tailText ?? "")) fail("hand play lock without its text");
    return { kind: "restriction", what: "cannotPlayFromHand", duration: "thisTurn", sel: { owner: s.who(), zone: "leader", count: 1, chooser: "controller" } };
  },
  CantPlayOriginalCostOrMore: (s) => playLock(s, num(s.value)),
  QueueUpEndOfTurnAction: () => ({ kind: "scheduleEndOfTurn", effectIndex: -1 }), // bound to the card's QueuedEndOfTurn ability
  TurnEndActivateDon: (s) => {
    return { kind: "scheduleEndOfTurn", effectIndex: -1, actions: [{ kind: "standDon", count: num(s.value) || 1, upTo: true }] };
  },
  HealEndOfTurn: (s) => ({ kind: "scheduleEndOfTurn", effectIndex: -1, actions: [{ kind: "addToLife", sel: { owner: s.who(), zone: "deckTop", count: num(s.value) || 1, chooser: "controller" } }] }),
  CantDrawFromEffects: (s) => {
    if (!/during this turn/i.test(s.a.tailText ?? "")) fail("draw lock beyond this turn");
    return { kind: "restriction", what: "cannotDrawByOwnEffects", duration: "thisTurn", sel: { owner: s.who(), zone: "leader", count: 1, chooser: "controller" } };
  },
  NoTakeLifeToTurnStart: (s) => {
    if (!/during this turn/i.test(s.a.tailText ?? "")) fail("Life lock beyond this turn");
    return { kind: "restriction", what: "cannotTakeLifeByOwnEffects", duration: "thisTurn", sel: { owner: s.who(), zone: "leader", count: 1, chooser: "controller" } };
  },
  Freeze: (s) => {
    const spec = s.spec;
    if (!spec || !on(spec.DonAreaCard)) return keywordOrRestriction(s);
    // "up to 2 of your opponent's rested cards will not become active …" — DON!! cards among them (M5)
    const who: "self" | "opponent" = ownerOfSpec(spec, s);
    const n = num(spec.TargetCount) || 1;
    if (n > 3) fail("freeze DON!! or cards, more than 3");
    const { DonAreaCard: _d, TargetCount: _n, ...rest } = spec;
    const options: Action[][] = [];
    const labels: string[] = [];
    for (let don = n; don >= 0; don--) {
      const cards = n - don;
      const opt: Action[] = [];
      if (don > 0) opt.push({ kind: "freezeDon", who, count: don });
      if (cards > 0) {
        const sel = selectorOf({ ...rest, TargetCount: cards }, s.a, false);
        opt.push({ kind: "restriction", sel, what: "skipNextRefresh", duration: "untilOwnersNextRefresh" });
      }
      options.push(opt);
      labels.push(`${[don > 0 ? `${don} DON!!` : "", cards > 0 ? `${cards} card${cards > 1 ? "s" : ""}` : ""].filter(Boolean).join(" + ")}`);
    }
    return { kind: "chooseOne", options, labels };
  },
  CantRest: (s) => {
    const sel = s.sel();
    return { kind: "restriction", sel, what: "cannotBeRested", duration: durationFor("CantRest", sel, s.a) };
  },
  PeekOppLife: (s) => ({ kind: "peekLife", who: opponentOfWho(s) }),
  PeekSelfLife: (s) => ({ kind: "peekLife", who: s.who() }),
  SendOppTopLifeToBot: (s) => ({ kind: "lifeTopToBottom", who: opponentOfWho(s) }),
  SendTopLifeToBot: (s) => ({ kind: "lifeTopToBottom", who: s.who() }),
  GainRestedDon: (s) => ({ kind: "placeDonInCostArea", count: num(s.value), rested: true }),
  GainActiveDon: (s) => ({ kind: "placeDonInCostArea", count: num(s.value) }),
  MillDeck: (s) => ({ kind: "mill", who: s.who(), count: num(s.value) }),
  // "Trash the same number of cards from the top of your deck as you did from your hand." (M5)
  MillForXPreviousTargets: (s) => {
    if (!/Trash the same number of cards from the top of your deck as you did from your hand/i.test(s.a.tailText ?? "")) fail("mill-as-many without its text");
    return { kind: "mill", who: s.who(), count: 0, countFromPrev: true };
  },
  // "Then, if that Character has a cost of N or less, K.O. it." (M5)
  KOIfCostXOrLess: (s) => {
    const sel = s.sel();
    if (!sel.prev || !new RegExp(`if that Character has a cost of ${num(s.value)} or less, K\\.O\\. it`, "i").test(s.a.tailText ?? "")) fail("conditional K.O. without its text");
    return { kind: "koTarget", sel: { ...sel, filter: { ...(sel.filter ?? {}), costAtMost: num(s.value) } } };
  },
  // "the next time you play a {Land of Wano} type Character card with a cost of 3 or more from your hand during this turn, the cost will be reduced by 1" (M5)
  NextWanoPlayCostReduce: (s) => {
    const m = /the next time you play a \{([^}]+)\} type Character card with a cost of (\d+) or more from your hand during this turn, the cost will be reduced by (\d+)/i.exec(s.a.tailText ?? "");
    if (!m) fail("next-play discount without its text");
    return { kind: "nextPlayDiscount", filter: { category: ["Character"], typeIncludes: [m![1]], baseCostAtLeast: Number(m![2]) }, amount: Number(m![3]) };
  },
  Heal: (s) => {
    // "add up to N cards from the top of your deck to the top of your Life"
    const upTo = /add up to \d+ cards? from the top of (your|their|the owner's) deck/i.test(s.a.tailText ?? "");
    return { kind: "addToLife", sel: { owner: s.who(), zone: "deckTop", count: num(s.value), chooser: "controller", ...(upTo ? { upTo: true } : {}) } };
  },
  SendToBottomLife: (s) => lifeFromCards(s, true),
  FlipTopLifeUp: (s) => ({ kind: "flipLife", who: s.who(), count: num(s.value) || 1, faceUp: true }),
  FlipTopLifeDown: (s) => ({ kind: "flipLife", who: s.who(), count: num(s.value) || 1, faceUp: false }),
  FlipLifeDown: (s) => ({ kind: "flipLife", who: s.who(), count: 99, faceUp: false }),
  TakeTopLife: (s) => ({ kind: "lifeToHand", who: s.who(), count: num(s.value) }),
  TakeBottomLife: (s) => ({ kind: "lifeToHand", who: s.who(), count: num(s.value), bottom: true }),
  OppTakeLife: (s) => ({ kind: "lifeToHand", who: opponentOfWho(s), count: num(s.value) }),
  TrashTopLife: (s) => ({ kind: "trashLife", who: s.who(), count: num(s.value) }),
  TrashOppLife: (s) => ({ kind: "trashLife", who: opponentOfWho(s), count: num(s.value) }),
  DonMinus: (s) => ({ kind: "returnDonToDeck", who: s.who(), count: num(s.value), ...(on(s.spec?.ActiveOnly) ? { activeOnly: true } : {}) }),
  SendToTopLife: (s) => lifeFromCards(s, false),
  Silence: (s) => negate(s),
  SilenceToOwnersEnd: (s) => negate(s),
  BecomeDefenderCharacter: (s) => ({ kind: "redirectAttack", sel: s.sel() }),
  EndCombat: () => ({ kind: "endBattle" }),
  // "place it at the top or bottom of your deck" after a 1-card reveal (M5)
  TopDeckToDeckBottom: (s) => ({ kind: "returnToDeck", where: "bottom", sel: { owner: s.who(), zone: "deckTop", count: 1, chooser: "controller" } }),
  TopDeckToDeckTop: () => [],
  DeclareCost: () => ({ kind: "declareCost" }),
  WinTheGame: () => ({ kind: "winGame" }),
  DealDamage: (s) => {
    if (!/deal \d+ damage to your opponent/i.test(s.a.tailText ?? "")) fail("damage to whom?");
    const dmg: Action = { kind: "dealDamage", who: opponentOfWho(s), count: num(s.value) || 1 };
    // "If your opponent has 1 Life card, deal 1 damage" — the data lacks the condition; the text wins
    const m = /If your opponent has (\d+) Life cards?, deal/i.exec(s.a.tailText ?? "");
    if (m) return { kind: "ifThen", if: [{ kind: "lifeAtMost", who: "opponent", count: Number(m[1]) }, { kind: "lifeAtLeast", who: "opponent", count: Number(m[1]) }], then: [dmg] };
    return dmg;
  },
  TakeAnotherTurn: () => ({ kind: "takeExtraTurn" }),
  // "none of the selected Characters can attack unless your opponent trashes 2 cards from their hand whenever they attack" (M5)
  GainConfusion: (s) => {
    const n = num(s.value);
    if (!new RegExp(`Until the end of your opponent's next turn, none of the selected Characters can attack unless your opponent trashes ${n} cards from their hand whenever they attack`, "i").test(s.a.tailText ?? "")) fail("attack tax without its text");
    return { kind: "restriction", what: "attackTaxDiscard", amount: n, duration: "untilEndOfOpponentsNextTurn", sel: { ...s.sel(), upTo: undefined } as Selector };
  },
  // "your opponent rests 1 of their active DON!! cards at the start of their next Main Phase" (M5)
  QueueUpOppMainPhaseAction: (s) => {
    const m = /your opponent rests (\d+) of their active DON!! cards? at the start of their next Main Phase/i.exec(s.a.tailText ?? "");
    if (!m) fail("next-Main-Phase rest without its text");
    return { kind: "restriction", what: "restDonAtMainStart", amount: Number(m![1]), duration: "untilEndOfOpponentsNextTurn",
      sel: { owner: opponentOfWho(s), zone: "leader", count: 1, chooser: "controller" } };
  },
  // "… gains [Rush: Character] and the <Slash> attribute during this turn" (M5)
  GainStrikeTypes: (s) => {
    const attrs = list<number>(s.value).map((t) => ATTRIBUTES[t] ?? fail(`attribute ${t}`));
    if (!new RegExp(`and the [＜<]${attrs[0]}[＞>] attribute during this turn`, "i").test(s.a.tailText ?? "")) fail("attribute gain without its text");
    return { kind: "restriction", sel: s.sel(), what: "gainsAttribute", attributes: attrs, duration: "thisTurn" };
  },
  // "[End of Your Turn] Trash all your face-up Life cards." (M5)
  TrashAllFaceUpLife: (s) => {
    if (!/Trash all your face-up Life cards/i.test(s.a.tailText ?? "")) fail("face-up Life trash without its text");
    return { kind: "trashLife", who: s.who(), count: 99, faceUpOnly: true };
  },
  // "return DON!! cards from your field to your DON!! deck until you have the same number of DON!! cards on your field as your opponent" (M5)
  DonMinusToOppCount: (s) => {
    if (!/return DON!! cards from your field to your DON!! deck until you have the same number of DON!! cards on your field as your opponent/i.test(s.a.tailText ?? "")) fail("DON!! down to the opponent's without its text");
    s.a.approx.add("the given DON!! cards returned are taken in field order");
    return { kind: "returnDonToDeck", who: s.who(), count: 0, downToOpponent: true };
  },
  // "Then, at the end of this battle, place this Character at the bottom of the owner's deck." (M5)
  EndOfBattleToDeckBottom: (s) => {
    if (!/at the end of this battle, place this Character at the bottom of the owner's deck/i.test(s.a.tailText ?? "")) fail("end-of-battle bottom without its text");
    return { kind: "restriction", what: "toDeckBottomAtEndOfBattle", duration: "thisBattle", sel: { owner: s.who(), zone: "characterArea", count: 1, self: true, chooser: "controller" } };
  },
  // "Your opponent's [On Play] effects are negated until the end of your opponent's next turn." (M5)
  OppNoOnPlayToTurnEnd: (s) => {
    if (!/Your opponent's \[On Play\] effects are negated until the end of your opponent's next turn/i.test(s.a.tailText ?? "")) fail("On Play lock without its text");
    return { kind: "restriction", what: "onPlaysNegated", duration: "untilEndOfOpponentsNextTurn", sel: { owner: opponentOfWho(s), zone: "leader", count: 1, chooser: "controller" } };
  },
  // "set all of your {FILM} type Characters as active at the end of this turn" (M5)
  ActivateAllFilmCharsEndOfTurn: (s) => {
    if (!/set all of your \{FILM\} type Characters as active at the end of this turn/i.test(s.a.tailText ?? "")) fail("FILM stand without its text");
    return { kind: "scheduleEndOfTurn", effectIndex: -1, actions: [{ kind: "standTarget",
      sel: { owner: "self", zone: "characterArea", count: 99, chooser: "controller", filter: { typeIncludes: ["FILM"], rested: true } } }] };
  },
  // "Select your Leader and 1 Character. Swap the base power of the selected cards with each other during this battle." (M5)
  SwapBasePowerWithLeader: (s) => {
    if (!/Select your Leader and 1 Character\. Swap the base power of the selected cards with each other during this battle/i.test(s.a.tailText ?? "")) fail("swap with the Leader without its text");
    const sel = s.sel();
    delete sel.upTo;
    return { kind: "swapBasePower", sel, duration: "thisBattle", withLeader: true };
  },
  // "Then, you take 1 damage." (M5)
  TakeDamage: (s) => {
    if (!new RegExp(`you take ${num(s.value) || 1} damage`, "i").test(s.a.tailText ?? "")) fail("damage taken without its text");
    return { kind: "dealDamage", who: s.who(), count: num(s.value) || 1 };
  },
  // "Give up to N (total) of your currently given DON!! cards to 1 of your Characters" (M5)
  TransferDon: (s) => {
    const step = s.a.currentStep;
    const dest = step?.target?.[1];
    if (!dest || !on(s.spec?.AttachedDon)) fail("given DON!! to where?");
    const n = num(s.spec?.TargetCount) || 1;
    const from: Selector = { owner: "self", zone: "leaderOrCharacter", count: n, upTo: true, chooser: "controller", filter: { donGivenAtLeast: 1 } };
    const to = selectorOf(dest, s.a, true);
    delete to.upTo;
    return [{ kind: "select", sel: from }, { kind: "moveGivenDon", sel: to, count: n }];
  },
  // "None of your Characters can be K.O.'d by (your opponent's) effects until …" (M5)
  AllCharsEffectImmune: (s) => {
    const t = s.a.tailText ?? "";
    const m = /None of your Characters can be K\.O\.'d by (your opponent's )?effects until (the start of your next turn|the end of your opponent's next turn)/i.exec(t);
    if (!m) fail("immunity without its text");
    return { kind: "restriction", sel: { owner: s.who(), zone: "characterArea", count: 99, chooser: "controller" },
      what: m![1] ? "cannotBeKOdByOpponent" : "cannotBeKOd",
      duration: /start of your next turn/i.test(m![2]) ? "untilStartOfYourNextTurn" : "untilEndOfOpponentsNextTurn" };
  },
  HideOppHand: () => [], // closes the reveal (UI)
  // "your opponent … reveals their hand" (M5): every card of that hand
  RevealOppHand: (s) => {
    if (!/reveals their hand|reveal(s)? (your opponent's|their) hand/i.test(s.a.tailText ?? "")) fail("hand reveal without its text");
    return { kind: "reveal", sel: { owner: opponentOfWho(s), zone: "hand", count: 99, chooser: "controller" } };
  },
  // "you cannot attack a Leader during this turn" (M5): on your Leader
  FieldCantAttackLeader: (s) => {
    if (!/you cannot attack a Leader during this turn/i.test(s.a.tailText ?? "")) fail("leader-attack lock without its text");
    return { kind: "restriction", sel: { owner: s.who(), zone: "leader", count: 1, chooser: "controller" }, what: "noLeaderAttacks", duration: "thisTurn" };
  },
  // "place any number of … from your trash at the bottom of your deck … This Character gains +1000 power for every 3 cards placed" (M5)
  InfiniteReturnToDeck: (s) => {
    const sel = { ...s.sel(), count: 99, upTo: true };
    const out: Action[] = [{ kind: "returnToDeck", where: "bottom", sel }];
    const every = num((s.effect as Json).BuffSelf1KPerXTargets);
    if (every) {
      if (!/\+1000 power during this turn for every (\d+) cards placed/i.test(s.a.tailText ?? "")) fail("per-N buff without its text");
      out.push({ kind: "powerMod", sel: { owner: s.who(), zone: selfZone(s.a.card), count: 1, self: true, chooser: "controller" }, amount: 1000, duration: "thisTurn", perPrevTarget: true, perPrevEvery: every });
    }
    return out;
  },
  BuffSelf1KPerXTargets: (s) => {
    if (!on((s.effect as Json).InfiniteReturnToDeck)) fail("per-N buff alone");
    return []; // built by InfiniteReturnToDeck, after the cards are placed
  },
  // "Look at 1 card from the top of your opponent's deck" — written as flip up / flip down (M5)
  PeekOppTopDeckFlip: (s) => {
    if (s.a.peekFlipOpen) { s.a.peekFlipOpen = false; return []; }
    s.a.peekFlipOpen = true;
    return { kind: "peekDeck", who: opponentOfWho(s), count: 1, then: { rest: "topAnyOrder" } };
  },
  EffectImmune: (s) => {
    const t = s.a.tailText ?? "";
    const m = /(?:cannot|can) be K\.O\.'d by (your opponent's )?effects (until the end of your opponent's next turn|until the start of your next turn|during this turn)/i.exec(t);
    if (!m) fail("immunity without its text");
    return { kind: "restriction", sel: s.sel(), what: m![1] ? "cannotBeKOdByOpponent" : "cannotBeKOd",
      duration: /opponent's next turn/i.test(m![2]) ? "untilEndOfOpponentsNextTurn" : /start of your next turn/i.test(m![2]) ? "untilStartOfYourNextTurn" : "thisTurn" };
  },
  SwapBasePower: (s) => {
    const sel = s.sel();
    if (sel.count !== 2) fail("swap the base power of how many?");
    delete sel.upTo;
    return { kind: "swapBasePower", sel, duration: "thisTurn" };
  },
  OppNoBlockerThisTurn: (s) => ({ kind: "restriction", what: "noBlockers", duration: "thisTurn", sel: { owner: opponentOfWho(s), zone: "leader", count: 1, chooser: "controller" } }),
  SetPowerToZero: (s) => ({ kind: "powerMod", sel: s.sel(), amount: 0, toZero: true, duration: durationFor("BuffPower", s.sel(), s.a) }),
  CantActivateDonToTurnEnd: (s) => {
    if (!/you cannot set DON!! cards as active using Character effects during this turn/i.test(s.a.tailText ?? "")) fail("DON!! lock without its text");
    return { kind: "restriction", what: "cannotStandDonByCharacters", duration: "thisTurn", sel: { owner: s.who(), zone: "leader", count: 1, chooser: "controller" } };
  },
  TrashLifeTo: (s) => {
    const m = /until you have (\d+) Life cards?/i.exec(s.a.tailText ?? "");
    if (!m) fail("trash Life down to how many?");
    return { kind: "trashLife", who: s.who(), count: 0, untilLeft: Number(m![1]) };
  },
  RosinanteLeader: (s) => {
    const m = /The next time you play \[([^\]]+)\] with a cost of (\d+) or more from your hand during this turn, the cost will be reduced by (\d+)/i.exec(s.a.tailText ?? "");
    if (!m) fail("next-play discount without its text");
    return { kind: "nextPlayDiscount", filter: { nameIncludes: [m![1]], baseCostAtLeast: Number(m![2]) }, amount: Number(m![3]) };
  },
  SetBasePowerToZero: (s) => ({ kind: "setBasePower", sel: s.sel(), amount: 0, duration: durationFor("SetBasePower", s.sel(), s.a) }),
  // "place the Character played by this effect at the bottom of the owner's deck at the end of this turn" (M5)
  GainEphemeral: (s) => {
    const sel = s.sel();
    if (!sel.prev) fail("end-of-turn removal of which card?");
    if (!/at the bottom of the owner's deck at the end of this turn/i.test(s.a.tailText ?? "")) fail("GainEphemeral without its text");
    return { kind: "scheduleEndOfTurn", effectIndex: -1, aboutPrev: true,
      actions: [{ kind: "returnToDeck", where: "bottom", sel: { owner: sel.owner, zone: "characterArea", count: 1, prev: true, chooser: "controller" } }] };
  },
  ActivateMainOfCard: (s) => {
    const sel = s.sel();
    if (sel.zone !== "hand" && sel.zone !== "trash") fail(`activate an Event from ${sel.zone}`);
    if (sel.count !== 1 || !sel.filter?.category?.every((c) => c === "Event")) fail("activate a card that is not an Event");
    return { kind: "activateEvent", sel };
  },
  CleanUpTopDeck: () => [], // the view already closed (a 1-card reveal stays on top)
  MatchOpponentPowerUntilTurnEnd: (s) => matchPower(s, s.sel(), "thisTurn"),
  MatchLeaderToBasePowerUntilTurnEnd: (s) => matchPower(s, { owner: opponentOfWho(s), zone: "leader", count: 1, chooser: "controller" }, "thisTurn"),
  MatchLeaderToBasePowerUntilTurnStart: (s) => matchPower(s, { owner: opponentOfWho(s), zone: "leader", count: 1, chooser: "controller" }, "untilStartOfYourNextTurn"),
  ShuffleDeck: (s) => ({ kind: "shuffleDeck", who: s.who() }),
  ShuffleHandIntoDeck: (s) => ({ kind: "shuffleHandIntoDeck", who: s.who(), redraw: true }),
  TrashSelf: (s) => ({ kind: "trashTarget", sel: { owner: s.who(), zone: selfZone(s.a.card), count: 1, self: true, chooser: "controller" } }),
};

/** "This Character's base power becomes the same as [the selected Character's
 *  / your opponent's Leader's] power" (M5): select it, then copy its power. */
function matchPower(s: StepScope, target: Selector, duration: Duration): Action[] {
  if (target.prev || target.self) fail("power to match: of which card?");
  const self: Selector = { owner: s.who(), zone: selfZone(s.a.card), count: 1, self: true, chooser: "controller" };
  return [{ kind: "select", sel: target }, { kind: "setBasePower", sel: self, amount: 0, duration, amountFromPrev: true }];
}

/** "rest up to N of your opponent's DON!! cards (or Characters …)" (M5): DON!!
 *  alone → restDon; mixed → choose one per split of N. */
function restDonOrCards(s: StepScope): Action {
  const spec = s.spec as Json;
  const who: "self" | "opponent" = ownerOfSpec(spec, s);
  const n = num(spec.TargetCount) || 1;
  const others = keysOn(spec).filter((k) => ZONE_KEYS.has(k) && k !== "DonAreaCard");
  if (n >= 10) {
    // "you may rest any number of your DON!! cards" (M5): the player picks how many
    if (others.length === 0 && who === "self" && /rest any number of your DON!!/i.test(s.a.tailText ?? "")) return { kind: "restDon", who, count: 99, upTo: true };
    fail("rest any number of DON!!");
  }
  if (others.length === 0) return { kind: "restDon", who, count: n };
  if (n > 3) fail("rest DON!! or cards, more than 3");
  const { DonAreaCard: _d, TargetCount: _n, ...rest } = spec;
  const options: Action[][] = [];
  const labels: string[] = [];
  for (let don = n; don >= 0; don--) {
    const cards = n - don;
    const opt: Action[] = [];
    if (don > 0) opt.push({ kind: "restDon", who, count: don });
    if (cards > 0) opt.push({ kind: "restTarget", sel: selectorOf({ ...rest, TargetCount: cards }, s.a, false) });
    options.push(opt);
    labels.push(`Rest ${[don > 0 ? `${don} DON!!` : "", cards > 0 ? `${cards} card${cards > 1 ? "s" : ""}` : ""].filter(Boolean).join(" + ")}`);
  }
  return { kind: "chooseOne", options, labels };
}

/** "you cannot play Character cards (with a base cost of N or more) during
 *  this turn" → a restriction on your own Leader (M5). */
function playLock(s: StepScope, amount: number): Action {
  if (!/during this turn/i.test(s.a.tailText ?? "")) fail("play lock beyond this turn");
  return { kind: "restriction", what: "cannotPlayCharacters", amount, duration: "thisTurn",
    sel: { owner: s.who(), zone: "leader", count: 1, chooser: "controller" } };
}

const ownerOfSpec = (spec: Json, s: StepScope): "self" | "opponent" => {
  const enemy = on(spec.EnemyOnly);
  return enemy !== s.a.flipped ? "opponent" : "self";
};

/** "add … to the top / bottom of the (owner's) Life cards (face-up)": from the
 *  field or the hand (M5). */
function lifeFromCards(s: StepScope, bottom: boolean): Action {
  const sel = s.sel();
  if (!sel.prev && sel.zone !== "characterArea" && sel.zone !== "hand") fail(`add to Life from ${sel.zone}`);
  return { kind: "addToLife", sel, ...(on(s.effect.ForcedFaceUp) ? { faceUp: true } : {}), ...(bottom ? { bottom: true } : {}) };
}

function returnToDeck(s: StepScope, where: "top" | "bottom"): Action {
  const sel = s.sel();
  if (!sel.prev && !["characterArea", "stage", "hand", "trash"].includes(sel.zone)) fail(`place at deck ${s.key} from ${sel.zone}`);
  return { kind: "returnToDeck", sel, where };
}

function negate(s: StepScope): Action {
  const sel = s.sel();
  return { kind: "negateEffect", sel, scope: "all", duration: durationFor(s.key, sel, s.a) };
}

function keywordOrRestriction(s: StepScope): Action {
  if (!(s.key in KEYWORD_GRANTS) && !(s.key in RESTRICTIONS)) return fail(`effect ${s.key}`);
  const sel = s.sel();
  if (s.key in KEYWORD_GRANTS) {
    return { kind: "grantKeyword", sel, keyword: KEYWORD_GRANTS[s.key], duration: durationFor(s.key, sel, s.a) };
  }
  // "cannot activate [Blocker]" only matters on Blockers
  if ((s.key === "LoseBlocker" || s.key === "LoseBlockerThisBattle") && !sel.prev && !sel.self) {
    sel.filter = { ...(sel.filter ?? {}), hasKeyword: "Blocker" };
  }
  return { kind: "restriction", sel, what: RESTRICTIONS[s.key], duration: durationFor(s.key, sel, s.a) };
}

/** "up to 1 … cost X or less and up to 1 … cost Y or less" (SecondCostOrLess,
 *  TargetCount 2) = two selections in a row. Null when the step isn't one. */
function splitSecondCost(step: OptcgStep, keys: string[]): [OptcgStep, OptcgStep] | null {
  const spec = step.target?.[0];
  if (!spec || !on(spec.SecondCostOrLess) || num(spec.TargetCount) !== 2 || keys.length !== 1) return null;
  if (on(spec.SecondCostOrLessCheckPrevTarget)) return null;
  const { SecondCostOrLess: y, ...rest } = spec;
  return [
    { ...step, target: [{ ...rest, TargetCount: 1 }] },
    { ...step, target: [{ ...rest, TargetCount: 1, CostOrLess: y }] },
  ];
}

/** The actions of one (non-view, non-Choices) step, in the order of its keys. */
export function stepActions(step: OptcgStep, a: AbilityCtx): Action[] {
  const effect = step.effect ?? {};
  const keys = keysOn(effect).filter((k) => !MODIFIER_KEYS.has(k));
  // "Select up to 1 …" — a target step with no effect: "the selected card" later (M5)
  if (keys.length === 0) return step.target?.[0] ? [{ kind: "select", sel: selectorOf(step.target[0], a, isFull(step)) }] : [];
  const split = splitSecondCost(step, keys);
  if (split) return [...stepActions(split[0], a), ...stepActions(split[1], a)];

  const spec = step.target?.[0];
  const full = isFull(step);
  let firstSel: Selector | null = null;
  const sel = (): Selector => {
    if (firstSel) return { owner: firstSel.owner, zone: firstSel.zone, count: firstSel.count, prev: true, chooser: firstSel.chooser };
    firstSel = selectorOf(spec, a, full);
    return firstSel;
  };
  const who = (): "self" | "opponent" => (a.flipped ? "opponent" : "self");
  a.currentStep = step;
  return keys.map((key) => {
    const scope: StepScope = { key, value: effect[key], effect, spec, a, sel, who };
    return (BUILDERS[key] ?? keywordOrRestriction)(scope);
  }).flat();
}
