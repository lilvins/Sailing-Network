/**
 * Legal-move summary for the current state — what the UI enables and what a
 * future bot samples from. Mirrors the checks in engine.ts (which remains the
 * enforcement point; this is advisory).
 */
import type { AutoGameState, CardDb, Iid, PID } from "./state";
import { isPlayersFirstTurn, opponentOf } from "./state";

export interface LegalMoves {
  /** Who must act right now (pending choice player, else turn player). */
  actor: PID;
  pendingChoice: AutoGameState["pendingChoice"];
  playableFromHand: { iid: Iid; cost: number; needsReplace: boolean }[];
  canGiveDonTo: Iid[];
  attackers: { iid: Iid; targets: Iid[] }[];
  counterCards: { iid: Iid; amount: number }[]; // during own counter window
  canEndTurn: boolean;
}

export function legalMoves(db: CardDb, state: AutoGameState): LegalMoves {
  const empty = (actor: PID): LegalMoves => ({
    actor, pendingChoice: state.pendingChoice,
    playableFromHand: [], canGiveDonTo: [], attackers: [], counterCards: [], canEndTurn: false,
  });

  if (state.phase === "over") return empty(state.turnPlayer);

  if (state.pendingChoice) {
    const actor = state.pendingChoice.player;
    const res = empty(actor);
    if (state.pendingChoice.kind === "counterWindow") {
      const p = state.players[actor];
      res.counterCards = p.zones.hand
        .map((iid) => ({ iid, card: db(p.instances[iid].cardId) }))
        .filter(({ card }) => card.category === "Character" && (card.counter ?? 0) > 0)
        .map(({ iid, card }) => ({ iid, amount: card.counter! }));
    }
    return res;
  }

  if (state.phase !== "main" || state.battle) return empty(state.turnPlayer);

  const player = state.turnPlayer;
  const p = state.players[player];
  const opp = state.players[opponentOf(state, player)];

  const playableFromHand = p.zones.hand
    .map((iid) => ({ iid, card: db(p.instances[iid].cardId) }))
    .filter(({ card }) => card.category !== "Leader" && (card.cost ?? 0) <= p.don.active)
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
    const targets = [
      opp.leaderIid,
      ...opp.zones.characterArea.filter((iid) => opp.instances[iid].rested),
    ];
    if (targets.length > 0) {
      const candidates = [p.leaderIid, ...p.zones.characterArea];
      for (const iid of candidates) {
        const inst = p.instances[iid];
        if (inst.rested) continue;
        if (iid !== p.leaderIid && inst.playedOnTurn === state.turn) continue; // 3-7-4
        attackers.push({ iid, targets });
      }
    }
  }

  return {
    actor: player,
    pendingChoice: null,
    playableFromHand,
    canGiveDonTo,
    attackers,
    counterCards: [],
    canEndTurn: true,
  };
}
