/** "Under the rules of this game …" / "… according to the rules": deck
 *  construction and game-rule changes printed on a card → CompiledCard.rules
 *  (M5). Read from the printed text, which is what the rule says; the
 *  optcg-ai abilities that carry them are skipped by fromOptcg.ts.
 *  (optcg-ai → AUTOSIM compiler, see README.md) */
import type { CardRules, SelectorFilter } from "../ir/types";
import type { CompileContext, OptcgAbility } from "./types";

/** optcg-ai ability shapes that only restate a rule handled here. */
export function isRuleAbility(ab: OptcgAbility, rules: CardRules): boolean {
  const keys = Object.keys(ab.proc ?? {});
  const fx = ab.steps.flatMap((s) => Object.keys(s.effect ?? {}));
  if (keys.length === 0 && ab.steps.length === 0) return Object.keys(rules).length > 0;
  if (keys.includes("StartOfGame")) return !!rules.startOfGamePlay;
  if (fx.length === 1 && fx[0] === "DonDeckOverride") return rules.donDeck !== undefined;
  if (fx.length === 1 && fx[0] === "WinsByDeckout") return !!rules.winsOnDeckOut;
  // the deck-out rule: a marker ability and the end-of-turn defeat optcg-ai queues for it
  if (keys.join() === "DeckOut" && ab.steps.length === 0) return !!rules.deckOutLosesAtEndOfTurn;
  if (keys.join() === "QueuedEndOfTurn" && fx.join() === "LoseTheGame") return !!rules.deckOutLosesAtEndOfTurn;
  return false;
}

/** The rules a card's printed text sets. */
export function rulesOf(text: string, ctx: CompileContext): CardRules {
  const r: CardRules = {};
  if (/you may have any number of this card in your deck/i.test(text)) r.anyCopies = true;
  const also = /also treat this card's name as ((?:\[[^\]]+\](?:,? and |, )?)+)/i.exec(text);
  if (also) r.alsoNames = [...also[1].matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  const don = /your DON!! deck consists of (\d+) cards/i.exec(text);
  if (don) r.donDeck = Number(don[1]);
  if (/when your deck is reduced to 0, you win the game instead of losing/i.test(text)) r.winsOnDeckOut = true;
  if (/you do not lose when your deck has 0 cards\. You lose at the end of the turn in which your deck becomes 0 cards/i.test(text)) r.deckOutLosesAtEndOfTurn = true;
  const ban = /you cannot include (Events|cards) with a cost of (\d+) or more in your deck/i.exec(text);
  if (ban) r.deckBan = { ...(ban[1] === "Events" ? { category: ["Event"] } : {}), costAtLeast: Number(ban[2]) } as SelectorFilter;
  const only = /you can only include \{([^}]+)\} type cards in your deck/i.exec(text);
  if (only) r.deckOnly = { typeIncludes: [only[1]] };
  const start = /at the start of the game, play up to 1 \{([^}]+)\} type Stage card from your deck/i.exec(text);
  if (start) r.startOfGamePlay = { category: ["Stage"], typeIncludes: [start[1]] };
  void ctx;
  return r;
}
