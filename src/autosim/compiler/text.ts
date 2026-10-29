/** Reading the printed card text: one segment per ability, the cost colon. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Timing } from "../ir/types";
import type { CatalogCard, OptcgCard } from "./types";

/** The catalog text split into one segment per ability: a new line, or a "["
 *  right after a sentence end (the catalog sometimes glues abilities:
 *  "…Characters.[On Your Opponent's Attack] …"); "•" option lines stay with
 *  the ability that introduces them ("Choose one:"). */
export function textSegments(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[•・-]/.test(l) && lines.length > 0) lines[lines.length - 1] += `\n${l}`;
    else lines.push(l);
  }
  return lines.flatMap((l) => l.split(/(?<=[.)])\s*(?=\[(?!Trigger\]))/)).map((l) => l.trim()).filter(Boolean);
}

/** The segment of the catalog text that carries an ability (for `manual`). */
export function abilityText(card: OptcgCard, cat: CatalogCard | undefined, timing: Timing, nth: number): string {
  const TAGS: Partial<Record<Timing, RegExp>> = {
    onPlay: /\[On Play\]/, whenAttacking: /\[When Attacking\]|When this (Leader|Character) attacks/,
    onKO: /\[On K\.O\.\]|When this Character is K\.O\.'d/, onBlock: /\[On Block\]/,
    counter: /\[Counter\]/, activateMain: /\[Activate: Main\]/, main: /\[Main\]/, endOfYourTurn: /\[End of Your Turn\]/,
    onYourOpponentsAttack: /\[On Your Opponent's Attack\]/, startOfYourTurn: /start of your turn/i,
    whenAttacked: /is attacked/,
    onYourDonReturned: /returned to your DON!! deck/, onKOByEffect: /K\.O\.'d by (your opponent's )?effect/,
    onRested: /becomes rested|is rested by/, onDealDamage: /deals damage/, onLifeZero: /Life cards becomes 0/,
    onCharacterKOd: /Character (with [^,]+ )?is K\.O\.'d|Characters? .*is K\.O\.'d/, onCharacterRemoved: /removed from the field by/,
    onCharacterRestedBy: /rested by your effect/, onYouPlayCharacter: /When you play a Character|is played from your trash|When your opponent plays a Character/,
    onCharacterBounced: /returned to the owner's hand by your effect/,
    onBattlesCharacter: /When this Character battles/,
    onKOInBattle: /battles and K\.O\.'s your opponent's Character/, onHandTrashed: /trashed from your hand by (an|your [^.]*) effect/,
    onLeaderAttacks: /your Leader .*attacks/, onLeaderAttacked: /is attacked/, onTakeDamage: /When you take damage/,
    onLifeRemoved: /removed from your (or your )?opponent's Life/, onYouDealDamage: /When you deal damage to your opponent's Life/,
    onTriggerActivated: /When a \[Trigger\] activates|activates an Event or \[Trigger\]/, afterBattleWithCharacter: /battles your opponent's Character/, onDonGiven: /is given a DON!! card/,
    onDrawOutsideDrawPhase: /draw a card outside of your Draw Phase/, onLifeToHand: /added to your hand from your Life/, onOpponentBlocks: /activates \[Blocker\]|activates a \[Blocker\]|or \[Blocker\]/,
  };
  if (timing === "trigger") {
    const t = cat?.trigger ?? textSegments(`${cat?.effect ?? ""}\n${card.text}`).find((l) => l.includes("[Trigger]"));
    if (t) return t.trim().startsWith("[Trigger]") ? t.trim() : `[Trigger] ${t.trim()}`;
  }
  const text = (cat?.effect && cat.effect !== "-" ? cat.effect : card.text) ?? "";
  const tag = TAGS[timing];
  if (tag) {
    // one ability per segment: a new line, or a "[" right after a sentence end
    // (the catalog sometimes glues abilities: "…Characters.[On Your Opponent's Attack] …")
    const lines = textSegments(text).filter((l) => tag.test(l));
    if (lines[nth] ?? lines[0]) return (lines[nth] ?? lines[0]).trim();
  }
  return text.trim() || `${card.id}: resolve this effect manually`;
}

/** Text before the ability's ":" (its activation cost, 8-3-1). */
export function hasCostColon(text: string): boolean {
  // "Choose one:" introduces options, it is not a cost
  const body = text.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/\b(Choose one|Your opponent chooses one):/gi, "");
  return /:/.test(body);
}
