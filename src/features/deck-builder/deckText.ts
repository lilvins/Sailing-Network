/** Reads a pasted decklist, one card per line, the leader being the Leader
 *  card among them. `NxCODE` (`1xOP13-001`) is the OPTCGSim .deck format and
 *  what "Copy decklist" writes; lists from other sites also work: `4 CODE`,
 *  `CODE x4`, `4 Name CODE`, `4 Name (CODE)`, a CODE alone = 1 copy. */

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
  /** The `errors` that are only a line nobody could read or an unknown card:
   *  when they are all there is, the rest of the list is still good. */
  lineErrors: string[];
}

const MAX_COPIES = 4;
const MAIN_SIZE = 50;
const CODE = String.raw`[A-Z]+\d*-\d+`;
// "4 XX99-999" before "4xXX99-999": the X of a code must not be read as "times"
const EXACT = [new RegExp(String.raw`^(\d+)\s+(${CODE})$`, "i"), new RegExp(String.raw`^(\d+)\s*[x×]\s*(${CODE})$`, "i")];
const CODE_IN_LINE = new RegExp(`(?<![A-Z0-9-])(${CODE})(?![A-Z0-9-])`, "i");
const COPIES_FIRST = /^[x×]?\s*(\d+)(?:\s*[x×])?(?=\s|$)/i;
const COPIES_LAST = /[x×]\s*(\d+)$/i;

/** One line → how many copies of which code, or null if there is no code in it. */
function readLine(line: string): { count: number; id: string } | null {
  for (const re of EXACT) {
    const m = re.exec(line);
    if (m) return { count: Number(m[1]), id: m[2].toUpperCase() };
  }
  const found = CODE_IN_LINE.exec(line);
  if (!found) return null;
  const rest = `${line.slice(0, found.index)} ${line.slice(found.index + found[0].length)}`.trim();
  const copies = COPIES_FIRST.exec(rest) ?? COPIES_LAST.exec(rest);
  return { count: copies ? Number(copies[1]) : 1, id: found[1].toUpperCase() };
}

export function parseDeckText(text: string, lookup: (id: string) => DeckTextCard | undefined): ParsedDeck {
  const errors: string[] = [];
  const lineErrors: string[] = [];
  const counts = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const read = readLine(line);
    if (!read) {
      lineErrors.push(`Can't read "${line}": write it like 4xOP01-001`);
      continue;
    }
    if (!lookup(read.id)) lineErrors.push(`Unknown card: ${read.id}`);
    else counts.set(read.id, (counts.get(read.id) ?? 0) + read.count);
  }
  errors.push(...lineErrors);

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
  return { leaderId, cards, errors, lineErrors };
}
