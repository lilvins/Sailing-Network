/**
 * Legal-move summary for the current state — what the UI enables and what a
 * future bot samples from. Mirrors the checks in engine.ts (which remains the
 * enforcement point; this is advisory).
 */
import type { AutoGameState, CardDb, Iid, PID } from "./state";
import { effectiveCost, hasRestriction, isPlayersFirstTurn, keywordsOf, opponentOf } from "./state";
import { canPayCost, conditionsMet } from "./effects";

export interface LegalMoves {
  /** Who must act right now (pending choice player, else turn player). */
  actor: PID;
  pendingChoice: AutoGameState["pendingChoice"];
  playableFromHand: { iid: Iid; cost: number; needsReplace: boolean }[];
  canGiveDonTo: Iid[];
  attackers: { iid: Iid; targets: Iid[] }[];
  counterCards: { iid: Iid; amount: number }[];   // 7-1-3-2-1, during own counter window
  counterEvents: { iid: Iid; cost: number }[];    // 7-1-3-2-2, during own counter window
  /** [Activate: Main] effects usable right now (10-2-2, M3). */
  activatable: { iid: Iid; effectIndex: number }[];
  canEndTurn: boolean;
}

export function legalMoves(db: CardDb, state: AutoGameState): LegalMoves {
  const empty = (actor: PID): LegalMoves => ({
    actor, pendingChoice: state.pendingChoice,
    playableFromHand: [], canGiveDonTo: [], attackers: [],
    counterCards: [], counterEvents: [], activatable: [], canEndTurn: false,
  });

  if (state.phase === "over") return empty(state.turnPlayer);

  if (state.pendingChoice) {
    const actor = state.pendingChoice.player;
    const res = empty(actor);
    if (state.pendingChoice.kind === "counterWindow") {
      const p = state.players[actor];
      const inHand = p.zones.hand.map((iid) => ({ iid, card: db(p.instances[iid].cardId) }));
      res.counterCards = inHand
        .filter(({ card }) => card.category === "Character" && (card.counter ?? 0) > 0)
        .map(({ iid, card }) => ({ iid, amount: card.counter! }));
      // [Counter] Events: playable if the card cost + DON costs fit (7-1-3-2-2)
      res.counterEvents = inHand
        .filter(({ iid, card }) => {
          if (card.category !== "Event") return false;
          const fx = card.compiled?.effects.find((f) => f.timing === "counter");
          if (!fx) return false;
          if (!conditionsMet(db, state, actor, iid, fx.conditions)) return false;
          const cardCost = effectiveCost(db, state, actor, iid);
          const restDonNeed = (fx.cost ?? []).reduce((s, c) => s + (c.kind === "restDon" ? c.count : 0), 0);
          if (p.don.active < cardCost + restDonNeed) return false;
          return canPayCost(db, state, actor, iid, fx.cost);
        })
        .map(({ iid }) => ({ iid, cost: effectiveCost(db, state, actor, iid) }));
    }
    // blockWindow / triggerDecision / selectTargets / mayActivate /
    // manualResolve / peekSelect / payDon / chooseNumber carry their legal
    // answers inside the choice itself
    return res;
  }

  if (state.phase !== "main" || state.battle) return empty(state.turnPlayer);

  const player = state.turnPlayer;
  const p = state.players[player];
  const opp = state.players[opponentOf(state, player)];

  const playableFromHand = p.zones.hand
    .map((iid) => ({ iid, card: db(p.instances[iid].cardId) }))
    .filter(({ iid, card }) => {
      if (card.category === "Leader" || effectiveCost(db, state, player, iid) > p.don.active) return false;
      if (card.category === "Event") {
        // 10-2-3: only Events with a [Main] effect (or no compiled effects —
        // legacy vanilla fixtures) are playable in the Main Phase, and only if
        // the effect's activation cost is payable (8-3-1-3, mirrors playCard)
        const effects = card.compiled?.effects ?? [];
        if (effects.length === 0) return true;
        const main = effects.find((fx) => fx.timing === "main");
        return !!main
          && conditionsMet(db, state, player, iid, main.conditions)
          && canPayCost(db, state, player, iid, main.cost);
      }
      return true;
    })
    .map(({ iid, card }) => ({
      iid,
      cost: effectiveCost(db, state, player, iid),
      needsReplace:
        (card.category === "Character" && p.zones.characterArea.length >= 5) ||
        (card.category === "Stage" && p.zones.stage.length >= 1),
    }));

  const canGiveDonTo = p.don.active > 0 ? [p.leaderIid, ...p.zones.characterArea] : [];

  const attackers: LegalMoves["attackers"] = [];
  if (!isPlayersFirstTurn(state, player)) {
    const leaderTarget = opp.leaderIid;
    const candidates = [p.leaderIid, ...p.zones.characterArea];
    for (const iid of candidates) {
      const inst = p.instances[iid];
      if (inst.rested) continue;
      if (hasRestriction(state, player, iid, "cannotAttack")) continue;
      // 7-1-1-2 (+ "can also attack active Characters" permission, M3)
      const canHitActive = hasRestriction(state, player, iid, "canAttackActiveCharacters");
      const charTargets = opp.zones.characterArea.filter(
        (t) => opp.instances[t].rested || canHitActive,
      );
      let targets = [leaderTarget, ...charTargets];
      // 3-7-4 summoning sickness; lifted by [Rush] (10-1-1-1) or, for
      // Character targets only, by [Rush: Character] (10-1-6-1)
      if (iid !== p.leaderIid && inst.playedOnTurn === state.turn) {
        const kws = keywordsOf(db, state, player, iid);
        if (kws.has("Rush")) { /* all targets */ }
        else if (kws.has("RushCharacter")) targets = [...charTargets];
        else continue;
      }
      if (targets.length > 0) attackers.push({ iid, targets });
    }
  }

  // [Activate: Main] effects (10-2-2; 6-5-4): conditions met, cost payable,
  // [Once Per Turn] still available (10-2-13-3) — mirrors engine.activateMain
  const activatable: LegalMoves["activatable"] = [];
  for (const iid of [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage]) {
    const compiled = db(p.instances[iid].cardId).compiled;
    if (!compiled) continue;
    compiled.effects.forEach((fx, effectIndex) => {
      if (fx.timing !== "activateMain") return;
      if (fx.oncePerTurn && state.oncePerTurnUsed[`${player}:${iid}:${effectIndex}`] === state.turn) return;
      if (!conditionsMet(db, state, player, iid, fx.conditions)) return;
      if (!canPayCost(db, state, player, iid, fx.cost)) return;
      activatable.push({ iid, effectIndex });
    });
  }

  return {
    actor: player,
    pendingChoice: null,
    playableFromHand,
    canGiveDonTo,
    attackers,
    counterCards: [],
    counterEvents: [],
    activatable,
    canEndTurn: true,
  };
}
