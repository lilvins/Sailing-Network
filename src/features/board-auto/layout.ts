import { useSyncExternalStore } from "react";

/**
 * The table's sizes (stage px, 1080 tall). The values here are the real ones;
 * the dev-only LayoutTuner (open the site with ?layout=1) changes them live.
 */
export const LAYOUT_DEFAULTS = {
  /** table cards: leader, characters, stage, Life/Trash/Deck */
  card: 118,
  ownHand: 130,
  topHand: 106,
  /** DON!! in the cost area */
  don: 100,
  /** how far apart the cost-area DON!! cascade */
  donStep: 34,
  /** how much of each given DON!! shows beside its card, in % of a card's width */
  givenFan: 14,
  /** Life cascade step */
  lifeStep: 29,
  /** between table cards */
  gap: 16,
  /** the field column's widest; what is left goes to the side rails */
  fieldMax: 1150,
};

export type LayoutKey = keyof typeof LAYOUT_DEFAULTS;

const STORE_KEY = "sn-layout-tuner";
const tuning = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("layout");

function saved(): Partial<typeof LAYOUT_DEFAULTS> {
  if (!tuning) return {};
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const LAYOUT = { ...LAYOUT_DEFAULTS, ...saved() };
export const layoutTuning = tuning;

const listeners = new Set<() => void>();
let version = 0;

export function setLayout(next: Partial<typeof LAYOUT_DEFAULTS>): void {
  Object.assign(LAYOUT, next);
  version++;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(LAYOUT));
  } catch {
    /* only the reload forgets */
  }
  listeners.forEach((l) => l());
  window.dispatchEvent(new Event("resize")); // the stage refits to the new field width
}

/** Re-render whoever draws from LAYOUT when a slider moves. */
export function useLayoutVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/** The sizes as CSS variables, for the stage root. */
export function layoutVars(): Record<string, string> {
  return {
    "--bacw": `${LAYOUT.card}px`,
    "--baownw": `${LAYOUT.ownHand}px`,
    "--bahw": `${LAYOUT.topHand}px`,
    "--badw": `${LAYOUT.don}px`,
    "--bagap": `${LAYOUT.gap}px`,
    "--bafan": `${LAYOUT.givenFan / 100}`,
  };
}
