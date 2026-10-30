import type { PlayerIntent } from "../../autosim/engine/intents";
import type { AutoGameState, Iid, PID } from "../../autosim/engine/state";
import type { Thought } from "../../autosim/ai/pro";
import type { Card } from "../cards/cardsDb";

/**
 * Coach mode: the move an AI seat is about to make, shown before it is played,
 * with the candidates it compared (mean rollout value, rollouts). Plain text
 * for the panel next to the AI controls; no rules logic.
 */
export interface AiPlan {
  pid: PID;
  intent: PlayerIntent;
  text: string;
  candidates: { text: string; mean: number; rollouts: number }[];
}

export function makePlan(game: AutoGameState, cards: Map<string, Card> | null, pid: PID, intent: PlayerIntent, thoughts: Thought[]): AiPlan {
  const say = (i: PlayerIntent) => describeIntent(game, cards, i);
  return { pid, intent, text: say(intent), candidates: thoughts.map((t) => ({ text: say(t.intent), mean: Math.round(t.mean), rollouts: t.rollouts })) };
}

export function describeIntent(game: AutoGameState, cards: Map<string, Card> | null, it: PlayerIntent): string {
  const n = (iid: Iid | null | undefined) => (iid ? nameOf(game, cards, iid) : "—");
  switch (it.type) {
    case "playCard": return `Play ${n(it.iid)}${it.replaceIid ? ` (replacing ${n(it.replaceIid)})` : ""}`;
    case "attack": return `Attack: ${n(it.attackerIid)} → ${n(it.targetIid)}`;
    case "giveDon": return `DON!! → ${n(it.targetIid)}`;
    case "activateMain": return `Activate ${n(it.iid)}`;
    case "endTurn": return "End turn";
    case "respondBlock": return it.blockerIid ? `Block with ${n(it.blockerIid)}` : "No block";
    case "useCounter": return `Counter ${n(it.cardIid)} on ${n(it.targetIid)}`;
    case "passCounter": return "No counter";
    case "respondTrigger": return it.activate ? "Use the Trigger" : "Skip the Trigger";
    case "respondMay": return it.activate ? "Yes (optional effect)" : "No (optional effect)";
    case "respondReplace": return it.use ? "Use the replacement" : "No replacement";
    case "respondMulligan": return it.take ? "Mulligan" : "Keep the hand";
    case "respondTargets": return `Targets: ${it.iids.map(n).join(", ") || "none"}`;
    case "respondPeek": return `Take: ${it.take.map(n).join(", ") || "nothing"}`;
    default: return it.type;
  }
}

function nameOf(game: AutoGameState, cards: Map<string, Card> | null, iid: Iid): string {
  for (const p of Object.values(game.players)) {
    const inst = p.instances[iid];
    if (inst) return cards?.get(inst.cardId)?.name ?? inst.cardId;
  }
  return iid;
}
