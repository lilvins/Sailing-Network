/**
 * Legal-move summary for the current state — what the UI enables and what a
 * future bot samples from. Mirrors the checks in engine.ts (which remains the
 * enforcement point; this is advisory).
 */
import type { AutoGameState, CardDb, Iid, PID } from "./state";
import { hasRestriction, isPlayersFirstTurn, keywordsOf, opponentOf } from "./state";
import { conditionsMet } from "./effects";

export interface LegalMoves {
  /** Who must act right now (pending choice player, else turn player). */
  actor: PID;
  pendingChoice: AutoGameState["pendingChoice"];
  playableFromHand: { iid: Iid; cost: number; needsReplace: boolean }[];
  canGiveDonTo: Iid[];
  attackers: { iid: Iid; targets: Iid[] }[];
  counterCards: { iid: Iid; amount: number }[];   // 7-1-3-2-1, during own counter window
  counterEvents: { iid: Iid; cost: number }[];    // 7-1-3-2-2, during own counter window
  canEndTurn: boolean;
}

export function legalMoves(db: CardDb, state: AutoGameState): LegalMoves {
  const empty = (actor: PID): LegalMoves => ({
    actor, pendingChoice: state.pendingChoice,
    playableFromHand: [], canGiveDonTo: [], attackers: [],
    counterCards: [], counterEvents: [], canEndTurn: false,
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
          let needDon = card.cost ?? 0;
          for (const c of fx.cost ?? []) {
            if (c.kind === "restDon" || c.kind === "returnDonToDeck") needDon += c.count;
            else return false; // card-choice costs land in M2
          }
          return p.don.active >= needDon;
        })
        .map(({ iid, card }) => ({ iid, cost: card.cost ?? 0 }));
    }
    // blockWindow / triggerDecision / selectTargets / mayActivate /
    // manualResolve carry their legal answers inside the choice itself
    return res;
  }

  if (state.phase !== "main" || state.battle) return empty(state.turnPlayer);

  const player = state.turnPlayer;
  const p = state.players[player];
  const opp = state.players[opponentOf(state, player)];

  const playableFromHand = p.zones.hand
    .map((iid) => ({ iid, card: db(p.instances[iid].cardId) }))
    .filter(({ iid, card }) => {
      if (card.category === "Leader" || (card.cost ?? 0) > p.don.active) return false;
      if (card.category === "Event") {
        // 10-2-3: only Events with a [Main] effect (or no compiled effects —
        // legacy vanilla fixtures) are playable in the Main Phase
        const effects = card.compiled?.effects ?? [];
        if (effects.length === 0) return true;
        const main = effects.find((fx) => fx.timing === "main");
        return !!main && conditionsMet(db, state, player, iid, main.conditions);
      }
      return true;
    })
    .map(({ iid, card }) => ({
      iid,
      cost: card.cost ?? 0,
      needsReplace:
        (card.category === "Character" && p.zones.characterArea.length >= 5) ||
        (card.category === "Stage" && p.zones.stage.length >= 1),
    }));

  const canGiveDonTo = p.don.active > 0 ? [p.leaderIid, ...p.zones.characterArea] : [];

  const attackers: LegalMoves["attackers"] = [];
  if (!isPlayersFirstTurn(state, player)) {
    const leaderTarget = opp.leaderIid;
    const charTargets = opp.zones.characterArea.filter((iid) => opp.instances[iid].rested);
    const candidates = [p.leaderIid, ...p.zones.characterArea];
    for (const iid of candidates) {
      const inst = p.instances[iid];
      if (inst.rested) continue;
      if (hasRestriction(state, player, iid, "cannotAttack")) continue;
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

  return {
    actor: player,
    pendingChoice: null,
    playableFromHand,
    canGiveDonTo,
    attackers,
    counterCards: [],
    counterEvents: [],
    canEndTurn: true,
  };
}
