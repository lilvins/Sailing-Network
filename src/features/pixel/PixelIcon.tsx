import { PIXEL_ICONS, PIXEL_ICON_GRID, type PixelIconName } from "./icons";

export type { PixelIconName };

/** How faded the "+" pixels are (fills, depth). */
const FILL_OPACITY = 0.38;

/** One SVG path per tone: each row's runs of the same tone become one rect. */
function toPaths(rows: readonly string[]): { solid: string; fill: string } {
  let solid = "";
  let fill = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      const rect = `M${x} ${y}h${end - x}v1h${x - end}z`;
      if (c === "#") solid += rect;
      else if (c === "+") fill += rect;
      x = end;
    }
  });
  return { solid, fill };
}

const PATHS = Object.fromEntries(
  Object.entries(PIXEL_ICONS).map(([name, rows]) => [name, toPaths(rows)]),
) as Record<PixelIconName, { solid: string; fill: string }>;

/** Snap to a whole number of screen pixels per art pixel, so edges stay crisp. */
export function pixelIconSize(size: number): number {
  return Math.max(1, Math.round(size / PIXEL_ICON_GRID)) * PIXEL_ICON_GRID;
}

/**
 * A pixel-art icon in the current text colour. `size` is rounded to a
 * multiple of the 12px grid (12, 24, 36…) so every art pixel is whole.
 * Decorative by default; pass `title` when the icon is the only label.
 */
export function PixelIcon({ name, size = 24, title, className, color }: { name: PixelIconName; size?: number; title?: string; className?: string; color?: string }) {
  const s = pixelIconSize(size);
  const { solid, fill } = PATHS[name];
  return (
    <svg
      className={className ? `px-icon ${className}` : "px-icon"}
      width={s}
      height={s}
      viewBox={`0 0 ${PIXEL_ICON_GRID} ${PIXEL_ICON_GRID}`}
      fill="currentColor"
      style={color ? { color } : undefined}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {fill && <path d={fill} opacity={FILL_OPACITY} />}
      {solid && <path d={solid} />}
    </svg>
  );
}
