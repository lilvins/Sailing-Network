/* Shared number/label formatting for the ladder, profile, statistics and meta
   pages. The numbers themselves come from server/stats. */

/** ฿1.79B / ฿980M */
export function formatBounty(berries: number): string {
  if (Math.abs(berries) >= 1e9) return `฿${(berries / 1e9).toFixed(2)}B`;
  return `฿${Math.round(berries / 1e6)}M`;
}

/** +7M / −12M (Bounty change after one game) */
export function formatBountyDelta(berries: number): string {
  const m = Math.round(berries / 1e6);
  return (m >= 0 ? "+" : "−") + Math.abs(m) + "M";
}

/** 0..100 with one decimal, null when no games */
export const pct = (wins: number, games: number): number | null => (games > 0 ? Math.round((wins / games) * 1000) / 10 : null);

export const showPct = (n: number | null | undefined): string => (n == null ? "—" : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);

/** 95% Wilson interval in %, null when no games. Same formula as server/stats/wilson.mjs. */
export function wilson(wins: number, games: number): [number, number] | null {
  if (!games) return null;
  const z = 1.96;
  const p = wins / games;
  const z2 = z * z;
  const denom = 1 + z2 / games;
  const centre = p + z2 / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games));
  const r = (x: number) => Math.round(x * 1000) / 10;
  return [r(Math.max(0, (centre - margin) / denom)), r(Math.min(1, (centre + margin) / denom))];
}

/** Fewer games than this and a win rate is shown dimmed as "few games". */
export const SMALL_SAMPLE = 10;

/** "2026-10" → "Oct 2026" */
export function seasonLabel(season: string): string {
  const [y, m] = season.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  if (!code) return "";
  try {
    regionNames ??= new Intl.DisplayNames(undefined, { type: "region" });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

/** Countries offered in the profile editor (ISO 3166 alpha-2). */
export const COUNTRIES = [
  "AR", "AU", "AT", "BE", "BR", "CA", "CL", "CN", "CO", "HR", "CZ", "DK", "FI", "FR", "DE", "GR", "HK", "HU", "IN", "ID",
  "IE", "IL", "IT", "JP", "KR", "MY", "MX", "NL", "NZ", "NO", "PE", "PH", "PL", "PT", "RO", "SA", "SG", "ES", "SE", "CH",
  "TW", "TH", "TR", "AE", "GB", "UA", "US", "VN",
];

export function timeAgo(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Badge color per tier id (server/stats/tuning.json). */
export const TIER_COLOR: Record<string, string> = {
  "east-blue": "#6f8db0",
  "grand-line": "#3fa7a0",
  "new-world": "#5fbf6a",
  supernova: "#e6b93f",
  warlord: "#e0803a",
  emperor: "#e05a52",
  "pirate-king": "#ffd36a",
};
