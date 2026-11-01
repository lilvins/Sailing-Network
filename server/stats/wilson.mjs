// wilson.mjs — 95% Wilson score interval for a win rate.
// Better than "WR ± 1.96·sqrt(p(1-p)/n)" on small samples: it never leaves
// [0,1] and doesn't claim 0% or 100% certainty after 3 games.

const Z = 1.96;

/** @returns {{lo:number, hi:number}} as fractions 0..1 ({lo:0,hi:1} when n=0) */
export function wilson(wins, games) {
  if (!games) return { lo: 0, hi: 1 };
  const p = wins / games;
  const z2 = Z * Z;
  const denom = 1 + z2 / games;
  const centre = p + z2 / (2 * games);
  const margin = Z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games));
  return { lo: Math.max(0, (centre - margin) / denom), hi: Math.min(1, (centre + margin) / denom) };
}
