/**
 * Coach marks on screen — carry hint.ts's seat-relative Marks to the board.
 *
 * A layout is the same for both seats, seen from the seat that owns the card:
 * `locate` answers in that frame, and a card of the seat NOT being viewed is
 * reflected through the centre of the field (the opponent's half is a table
 * turned 180°). Rects from the DOM are already on screen, so they must not
 * pass through here: they would flip twice.
 *
 * Pure: no DOM, no store, no I/O.
 */
import type { PID } from "../engine/state";
import type { Mark } from "./hint";

export type Rect = { x: number; y: number; w: number; h: number };

export type MarkView = {
  /** The seat at the bottom of the screen. */
  seat: PID;
  width: number;
  height: number;
  /** The card's rect with its owner at the bottom; null when it is not on the board. */
  locate: (mark: Mark) => Rect | null;
};

export type ScreenMark = Mark & { rect: Rect };

/** Marks in screen coordinates, in order; a mark with nowhere to go is dropped. */
export function project(marks: Mark[], view: MarkView): ScreenMark[] {
  const out: ScreenMark[] = [];
  for (const mark of marks) {
    const r = view.locate(mark);
    if (!r) continue;
    const rect = mark.owner === view.seat ? r : { x: view.width - r.x - r.w, y: view.height - r.y - r.h, w: r.w, h: r.h };
    out.push({ ...mark, rect });
  }
  return out;
}
