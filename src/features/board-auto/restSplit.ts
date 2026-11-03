import { actionCandidates } from "../../autosim/engine/effects";
import type { AutoGameState, CardDb, Iid } from "../../autosim/engine/state";

/** "Rest 1 of your cards:" and its kin: a cost the payer can split between
 *  DON!! and Leader / Character / Stage cards. The engine asks which split as
 *  an option; on the table the clicks say it, so no menu is needed. */
export interface RestSplit {
  /** How many things to rest in all. */
  total: number;
  /** The most DON!! / cards a payable split allows. */
  donMax: number;
  cardMax: number;
  /** The cards that can be rested for it. */
  candidates: Set<Iid>;
  /** The option to answer for this many DON!!, -1 when no payable split has it. */
  optionFor: (don: number) => number;
}

export function restSplitOf(db: CardDb, game: AutoGameState): RestSplit | null {
  const pc = game.pendingChoice;
  const r = game.exec?.running;
  if (pc?.kind !== "chooseOption" || pc.purpose !== "cost" || !r) return null;
  const item = r.costs[r.costIndex];
  if (item?.kind !== "oneOf") return null;

  const splits: { index: number; don: number; cards: number }[] = [];
  const candidates = new Set<Iid>();
  for (const [index, option] of item.options.entries()) {
    let don = 0;
    let cards = 0;
    for (const c of option) {
      if (c.kind === "restDon") don += c.count;
      else if (c.kind === "action" && c.action.kind === "restTarget") {
        cards += c.action.sel.count;
        if (pc.enabled[index]) {
          for (const t of actionCandidates(db, game, r.controller, r.sourceIid, c.action)) {
            if (!game.players[t.owner].instances[t.iid].rested) candidates.add(t.iid);
          }
        }
      } else return null; // another kind of cost: its buttons say it better
    }
    if (pc.enabled[index]) splits.push({ index, don, cards });
  }
  if (splits.length === 0 || splits.some((s) => s.don + s.cards !== splits[0].don + splits[0].cards)) return null;
  return {
    total: splits[0].don + splits[0].cards,
    donMax: Math.max(...splits.map((s) => s.don)),
    cardMax: Math.max(...splits.map((s) => s.cards)),
    candidates,
    optionFor: (don) => splits.find((s) => s.don === don)?.index ?? -1,
  };
}
