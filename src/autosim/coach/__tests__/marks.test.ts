import { describe, expect, it } from "vitest";
import type { PID } from "../../engine/state";
import type { Mark } from "../hint";
import { project, type MarkView, type Rect } from "../marks";

const SLOTS: Record<string, Rect> = {
  "p1#0": { x: 100, y: 600, w: 80, h: 112 },
  "p2#0": { x: 100, y: 600, w: 80, h: 112 },
  "p2#1": { x: 0, y: 0, w: 80, h: 112 },
};
const view = (seat: PID): MarkView => ({ seat, width: 1000, height: 800, locate: (m) => SLOTS[m.iid] ?? null });

const mine: Mark = { owner: "p1", iid: "p1#0", role: "source" };
const theirs: Mark = { owner: "p2", iid: "p2#0", role: "target" };

describe("project", () => {
  it("leaves the viewing seat's marks where they are", () => {
    expect(project([mine], view("p1"))[0].rect).toEqual(SLOTS["p1#0"]);
  });

  it("flips the other seat's marks through the centre, keeping the card's size", () => {
    expect(project([theirs], view("p1"))[0].rect).toEqual({ x: 820, y: 88, w: 80, h: 112 });
  });

  it("sends a corner to the opposite corner", () => {
    const corner: Mark = { owner: "p2", iid: "p2#1", role: "victim" };
    expect(project([corner], view("p1"))[0].rect).toEqual({ x: 920, y: 688, w: 80, h: 112 });
  });

  it("swaps the flip when the view changes seat", () => {
    expect(project([mine], view("p2"))[0].rect).toEqual({ x: 820, y: 88, w: 80, h: 112 });
    expect(project([theirs], view("p2"))[0].rect).toEqual(SLOTS["p2#0"]);
  });

  it("keeps owner, iid, role and order", () => {
    const out = project([mine, theirs], view("p1"));
    expect(out.map(({ owner, iid, role }) => ({ owner, iid, role }))).toEqual([mine, theirs]);
  });

  it("drops a mark the layout cannot place", () => {
    const hidden: Mark = { owner: "p1", iid: "p1#9", role: "source" };
    expect(project([hidden, mine], view("p1")).map((m) => m.iid)).toEqual(["p1#0"]);
  });

  it("returns nothing for no marks", () => {
    expect(project([], view("p1"))).toEqual([]);
  });
});
