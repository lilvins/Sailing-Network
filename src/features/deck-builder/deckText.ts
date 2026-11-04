/** Reads a decklist written like an OPTCGSim .deck file: one `NxCODE` per line
 *  (`1xOP13-001`), the leader being the Leader card among them. Same format as
 *  the Deck Constructor's "Copy decklist". */

export interface DeckTextCard {
  /** "L" = Leader. */
  t: string;
  cols: string[];
}

export interface ParsedDeck {
  leaderId: string | null;
  /** cardId -> copies, without the leader. */
  cards: Record<string, number>;
  /** What stops this list from loading; empty = it can load. */
  errors: string[];
}

const MAX_COPIES = 4;
const MAIN_SIZE = 50;
const LINE = /^(\d+)\s*x\s*([A-Z0-9]+-\d+)$/i;

export function parseDeckText(text: string, lookup: (id: string) => DeckTextCard | undefined): ParsedDeck {
  const errors: string[] = [];
  const counts = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m) {
      errors.push(`Can't read "${line}": write it like 4xOP01-001`);
      continue;
    }
    const id = m[2].toUpperCase();
    if (!lookup(id)) errors.push(`Unknown card: ${id}`);
    else counts.set(id, (counts.get(id) ?? 0) + Number(m[1]));
  }

  const leaders = [...counts.keys()].filter((id) => lookup(id)!.t === "L");
  if (leaders.length === 0) errors.push("No Leader in the list");
  if (leaders.length > 1) errors.push(`More than one Leader: ${leaders.join(", ")}`);
  const leaderId = leaders.length === 1 ? leaders[0] : null;
  if (leaderId && counts.get(leaderId) !== 1) errors.push(`The Leader must be 1 copy: ${leaderId}`);

  const allowed = leaderId ? lookup(leaderId)!.cols : null;
  const cards: Record<string, number> = {};
  let total = 0;
  for (const [id, count] of counts) {
    if (lookup(id)!.t === "L") continue;
    if (count < 1) errors.push(`${id}: 0 copies`);
    if (count > MAX_COPIES) errors.push(`${id}: ${count} copies, the maximum is ${MAX_COPIES}`);
    if (allowed && !lookup(id)!.cols.every((c) => allowed.includes(c))) errors.push(`${id} is not in the Leader's colors`);
    cards[id] = count;
    total += count;
  }
  if (total > MAIN_SIZE) errors.push(`${total} cards: the maximum is ${MAIN_SIZE}`);
  return { leaderId, cards, errors };
}
