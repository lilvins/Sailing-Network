/**
 * Human-readable rendering of the AUTOSIM GameEvent log (grammar rule #9).
 * Pure formatting — card names come from the catalog, player names from the
 * seat setup; secret information (hands, face-down life) is NOT leaked for
 * events that keep it secret in play (hotseat shows hands anyway, but the log
 * should read like a referee's record).
 */
import type { GameEvent } from "../../autosim/engine/events";
import type { AutoGameState, Iid, PID } from "../../autosim/engine/state";
import type { Card } from "../cards/cardsDb";

export interface LogLine {
  text: string;
  kind: "turn" | "battle" | "effect" | "system" | "danger";
}

function makeNamer(game: AutoGameState | null, cards: Map<string, Card> | null) {
  return (iid: Iid): string => {
    if (!game) return iid;
    for (const p of Object.values(game.players)) {
      const inst = p.instances[iid];
      if (inst) return cards?.get(inst.cardId)?.name ?? inst.cardId;
    }
    return iid;
  };
}

export function fmtEvent(
  e: GameEvent,
  game: AutoGameState | null,
  cards: Map<string, Card> | null,
  seatName: (pid: PID) => string,
): LogLine | null {
  const n = makeNamer(game, cards);
  switch (e.type) {
    case "gameStarted":
      return { text: `Game started — ${seatName(e.order[0])} goes first.`, kind: "system" };
    case "deckShuffled":
      return { text: `${seatName(e.player)} shuffles their deck.`, kind: "system" };
    case "cardsDrawn":
      return { text: `${seatName(e.player)} draws ${e.iids.length} card${e.iids.length === 1 ? "" : "s"}.`, kind: "system" };
    case "mulliganResolved":
      return { text: `${seatName(e.player)} ${e.taken ? "takes the mulligan (new 5)" : "keeps their hand"}.`, kind: "system" };
    case "lifeDealt":
      return { text: `${seatName(e.player)} sets ${e.iids.length} Life.`, kind: "system" };
    case "turnStarted":
      return { text: `— TURN ${e.turn} · ${seatName(e.player)} —`, kind: "turn" };
    case "givenDonReturned":
      return { text: `${seatName(e.player)}: ${e.count} given DON!! return (rested).`, kind: "system" };
    case "allStood":
      return { text: `${seatName(e.player)} stands everything.`, kind: "system" };
    case "donPlaced":
      return { text: `${seatName(e.player)} places ${e.count} DON!! (active).`, kind: "system" };
    case "turnEnded":
      return { text: `${seatName(e.player)} ends turn ${e.turn}.`, kind: "system" };
    case "cardPlayed":
      return { text: `${seatName(e.player)} plays ${n(e.iid)} (−${e.donRested} DON!!).`, kind: "effect" };
    case "characterTrashedByRule":
      return { text: `${seatName(e.player)} trashes ${n(e.iid)} (area full).`, kind: "effect" };
    case "eventCardUsed":
      return { text: `${seatName(e.player)} uses ${n(e.iid)}${e.donRested ? ` (−${e.donRested} DON!!)` : ""}.`, kind: "effect" };
    case "donGiven":
      return { text: `${seatName(e.player)} gives 1 DON!! to ${n(e.targetIid)}.`, kind: "system" };
    case "attackDeclared":
      return { text: `${n(e.attackerIid)} attacks ${n(e.targetIid)}!`, kind: "battle" };
    case "attackStepEnded":
      return null;
    case "blockWindowResolved":
      return e.blockerIid
        ? { text: `${n(e.blockerIid)} blocks!`, kind: "battle" }
        : { text: "No block.", kind: "battle" };
    case "counterApplied":
      return { text: `${seatName(e.player)} counters with ${n(e.cardIid)}: +${e.amount} to ${n(e.targetIid)}.`, kind: "battle" };
    case "counterWindowClosed":
      return { text: "Counters end.", kind: "battle" };
    case "battleWon":
      return { text: `${n(e.attackerIid)} wins the battle vs ${n(e.targetIid)}.`, kind: "battle" };
    case "battleLost":
      return { text: `${n(e.attackerIid)} loses the battle vs ${n(e.targetIid)}.`, kind: "battle" };
    case "lifeCardToHand":
      return { text: `${seatName(e.player)} takes 1 damage — a Life card goes to hand.`, kind: "danger" };
    case "lifeCardTrashed":
      return { text: `${seatName(e.player)}'s Life card is BANISHED to the trash.`, kind: "danger" };
    case "characterKOd":
      return { text: `${n(e.iid)} is K.O.'d.`, kind: "danger" };
    case "battleEnded":
      return { text: "End of the battle.", kind: "battle" };
    case "effectActivated":
      return { text: `${seatName(e.player)} activates ${n(e.sourceIid)} [${e.timing}].`, kind: "effect" };
    case "effectDeclined":
      return { text: `${seatName(e.player)} declines ${n(e.sourceIid)}'s optional effect.`, kind: "effect" };
    case "costPaid": {
      const bits: string[] = [];
      if (e.restDon) bits.push(`rests ${e.restDon} DON!!`);
      if (e.returnDon) bits.push(`returns ${e.returnDon} DON!! to the deck`);
      return bits.length ? { text: `${seatName(e.player)} ${bits.join(" and ")} (cost).`, kind: "effect" } : null;
    }
    case "modifierAdded":
      return null; // the power chips show it live
    case "cardRested":
      return { text: `${n(e.iid)} is rested.`, kind: "effect" };
    case "cardStood":
      return { text: `${n(e.iid)} stands.`, kind: "effect" };
    case "cardsDiscarded":
      return { text: `${seatName(e.player)} discards ${e.iids.map(n).join(", ")}.`, kind: "effect" };
    case "manualResolved":
      return { text: `${seatName(e.player)} resolves ${n(e.sourceIid)} manually.`, kind: "effect" };
    // M3 — tier-2 executor
    case "deckPeeked":
      return { text: `${seatName(e.player)} looks at the top ${e.iids.length} card${e.iids.length === 1 ? "" : "s"} of their deck.`, kind: "effect" };
    case "peekResolved": {
      const bits: string[] = [];
      if (e.toHand.length) bits.push(`adds ${e.toHand.map(n).join(", ")} to hand`);
      if (e.played.length) bits.push(`plays ${e.played.map((x) => n(x.iid) + (x.rested ? " (rested)" : "")).join(", ")}`);
      if (e.top.length) bits.push(`${e.top.length} on top`);
      if (e.bottom.length) bits.push(`${e.bottom.length} to the bottom`);
      if (e.trashed.length) bits.push(`${e.trashed.length} trashed`);
      return { text: `${seatName(e.player)} ${bits.join(", ") || "takes nothing"}.`, kind: "effect" };
    }
    case "playedFromZone":
      return { text: `${seatName(e.player)} plays ${n(e.iid)} from ${e.from}${e.rested ? " (rested)" : ""} by effect.`, kind: "effect" };
    case "returnedToHand":
      return { text: `${n(e.iid)} returns to ${seatName(e.player)}'s hand.`, kind: "effect" };
    case "returnedToDeck":
      return { text: `${seatName(e.player)} puts ${n(e.iid)} ${e.where === "top" ? "on top of" : "at the bottom of"} their deck (from ${e.from}).`, kind: "effect" };
    case "milled":
      return { text: `${seatName(e.player)} trashes ${e.iids.length} card${e.iids.length === 1 ? "" : "s"} from the top of their deck.`, kind: "effect" };
    case "trashToHand":
      return { text: `${seatName(e.player)} returns ${n(e.iid)} from the trash to hand.`, kind: "effect" };
    case "donAdded":
      return { text: `${seatName(e.player)} adds ${e.count} DON!! from the DON!! deck (${e.rested ? "rested" : "active"}).`, kind: "effect" };
    case "donGivenFromRested":
      return { text: `${seatName(e.player)} gives ${e.count} rested DON!! to ${n(e.targetIid)}.`, kind: "effect" };
    case "donStood":
      return { text: `${seatName(e.player)} sets ${e.count} DON!! as active.`, kind: "effect" };
    case "donPaid": {
      const parts: string[] = [];
      if (e.fromActive) parts.push(`${e.fromActive} active`);
      if (e.fromRested) parts.push(`${e.fromRested} rested`);
      for (const [iid, c] of Object.entries(e.fromGiven)) if (c) parts.push(`${c} from ${n(iid)}`);
      return { text: `${seatName(e.player)} returns DON!! to the deck (${parts.join(", ") || "none"}).`, kind: "effect" };
    }
    case "triggerActivated":
      return { text: `${seatName(e.player)} activates the [Trigger] of ${n(e.iid)}!`, kind: "danger" };
    case "triggerCardTrashed":
      return { text: `${n(e.iid)} is trashed after its [Trigger].`, kind: "effect" };
    case "triggerCardPlayed":
      return { text: `${n(e.iid)} enters play from the [Trigger]!`, kind: "effect" };
    case "gameEnded":
      return { text: `GAME — ${seatName(e.winner)} wins (${e.reason}).`, kind: "turn" };
    default:
      return null;
  }
}
