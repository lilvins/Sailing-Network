import { describe, expect, it } from "vitest";
import { PIXEL_ICONS, PIXEL_ICON_GRID } from "./icons";
import { pixelIconSize } from "./PixelIcon";

describe("pixel icons", () => {
  it.each(Object.entries(PIXEL_ICONS))("%s is a 12x12 grid of # + .", (_name, rows) => {
    expect(rows).toHaveLength(PIXEL_ICON_GRID);
    for (const row of rows) expect(row).toMatch(new RegExp(`^[#+.]{${PIXEL_ICON_GRID}}$`));
    expect(rows.join("")).toMatch(/#/);
  });
  it("snaps sizes to whole art pixels", () => {
    expect(pixelIconSize(12)).toBe(12);
    expect(pixelIconSize(15)).toBe(12);
    expect(pixelIconSize(20)).toBe(24);
    expect(pixelIconSize(4)).toBe(12);
  });
});
