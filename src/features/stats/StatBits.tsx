/* Small display pieces shared by the stats pages: tier badge, country tag,
   win-rate cell (value + sample size + 95% interval). */

import type { Tier } from "../../lib/api";
import { TIER_COLOR, countryName, showPct, SMALL_SAMPLE } from "./format";
import "./stats.css";

export function TierBadge({ tier, provisional }: { tier: Tier | null | undefined; provisional?: boolean }) {
  if (!tier) return null;
  return (
    <span className="sx-tier" style={{ ["--tier" as string]: TIER_COLOR[tier.id] || "#9aa0a8" }} title={provisional ? "Provisional: still placing" : tier.name}>
      <span className="sx-tier-dot" />
      {tier.name}
      {provisional && <span className="sx-prov">?</span>}
    </span>
  );
}

export function CountryTag({ code }: { code: string }) {
  if (!code) return null;
  return <span className="sx-country" title={countryName(code)}>{code}</span>;
}

/**
 * A win rate the honest way: the number, how many games it rests on, and the
 * 95% range on hover. Fewer than SMALL_SAMPLE games is dimmed.
 */
export function WinRate({ rate, games, ci, colored = true }: { rate: number | null; games: number; ci?: [number, number] | null; colored?: boolean }) {
  const small = games < SMALL_SAMPLE;
  const tone = !colored || rate == null ? "" : rate >= 50 ? " good" : " bad";
  const title = rate == null
    ? "No games"
    : `${showPct(rate)} over ${games} game${games === 1 ? "" : "s"}` + (ci ? ` · 95% range ${showPct(ci[0])}–${showPct(ci[1])}` : "") + (small ? " · few games" : "");
  return (
    <span className={"sx-wr" + tone + (small ? " small" : "")} title={title}>
      <b>{showPct(rate)}</b>
      <small>n={games}</small>
    </span>
  );
}

/** Thin horizontal bar of a win rate with its 95% range as a band and a 50% tick. */
export function WinRateBar({ rate, ci }: { rate: number | null; ci?: [number, number] | null }) {
  if (rate == null) return <span className="sx-wrbar" />;
  return (
    <span className="sx-wrbar" title={ci ? `95% range ${showPct(ci[0])}–${showPct(ci[1])}` : undefined}>
      {ci && <span className="sx-wrbar-ci" style={{ left: ci[0] + "%", width: Math.max(1, ci[1] - ci[0]) + "%" }} />}
      <span className={"sx-wrbar-dot" + (rate >= 50 ? " good" : " bad")} style={{ left: rate + "%" }} />
      <span className="sx-wrbar-mid" />
    </span>
  );
}
