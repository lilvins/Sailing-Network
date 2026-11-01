/* The three filters of the Meta Analytics page — format, date range, Bounty
   range — shared by the matchup grid and the best lists. */

import type { MetaGridReport, MetaReportFilters } from "../../../lib/api";
import { formatBounty } from "../../stats/format";

const DAY = 24 * 60 * 60 * 1000;
export const DATE_PRESETS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "all", label: "All" },
  { id: "custom", label: "Custom" },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]["id"];

export interface MetaFilterState {
  /** "" = every format */
  format: string;
  dates: DatePreset;
  /** yyyy-mm-dd, only for dates = "custom" */
  fromDate: string;
  toDate: string;
  /** Berries; null = no bound */
  minBounty: number | null;
  maxBounty: number | null;
}

export const DEFAULT_FILTERS: MetaFilterState = { format: "", dates: "30", fromDate: "", toDate: "", minBounty: null, maxBounty: null };

/** Filter state → API query. Custom dates run from the start of the first day to the end of the last. */
export function toQuery(f: MetaFilterState, now = Date.now()): MetaReportFilters {
  let from: number | null = null;
  let to: number | null = null;
  if (f.dates === "custom") {
    if (f.fromDate) from = new Date(`${f.fromDate}T00:00:00`).getTime();
    if (f.toDate) to = new Date(`${f.toDate}T23:59:59.999`).getTime();
  } else if (f.dates !== "all") {
    from = now - Number(f.dates) * DAY;
  }
  return { format: f.format || undefined, from, to, minBounty: f.minBounty, maxBounty: f.maxBounty };
}

const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function MetaFilters({
  value,
  onChange,
  options,
  totalGames,
}: {
  value: MetaFilterState;
  onChange: (v: MetaFilterState) => void;
  options: MetaGridReport["options"] | null;
  totalGames: number | null;
}) {
  const set = (patch: Partial<MetaFilterState>) => onChange({ ...value, ...patch });
  // tier thresholds are the Bounty steps on offer (East Blue starts at 0, so it is "any")
  const steps = (options?.tiers || []).filter((t) => t.minBounty > 0);
  const today = isoDay(Date.now());
  const first = options?.firstAt ? isoDay(options.firstAt) : undefined;
  const formatLabel = value.format || "All formats";
  const dateLabel = value.dates === "custom"
    ? `${value.fromDate || first || "…"} → ${value.toDate || today}`
    : DATE_PRESETS.find((p) => p.id === value.dates)!.label;
  const bountyLabel = value.minBounty == null && value.maxBounty == null
    ? "every Bounty"
    : `${value.minBounty != null ? formatBounty(value.minBounty) : "any"} – ${value.maxBounty != null ? formatBounty(value.maxBounty) : "any"}`;

  return (
    <section className="px-window mt-window" aria-label="Filters">
      <div className="mt-filters">
        <label className="mt-field">
          <span className="mt-label">Format</span>
          <select className="px-input mt-select" value={value.format} onChange={(e) => set({ format: e.target.value })}>
            <option value="">All formats</option>
            {(options?.formats || []).map((f) => (
              <option key={f.format} value={f.format}>{f.format}</option>
            ))}
          </select>
        </label>

        <div className="mt-field">
          <span className="mt-label">Days</span>
          <div className="mt-row">
            <div className="px-tabs mt-tabs" role="tablist" aria-label="Date range">
              {DATE_PRESETS.map((p) => (
                <button key={p.id} role="tab" aria-selected={value.dates === p.id} className={"px-tab" + (value.dates === p.id ? " on" : "")} onClick={() => set({ dates: p.id })}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {value.dates === "custom" && (
            <div className="mt-row">
              <input type="date" className="px-input mt-date" aria-label="From" value={value.fromDate} min={first} max={value.toDate || today} onChange={(e) => set({ fromDate: e.target.value })} />
              <span className="mt-to" aria-hidden>→</span>
              <input type="date" className="px-input mt-date" aria-label="To" value={value.toDate} min={value.fromDate || first} max={today} onChange={(e) => set({ toDate: e.target.value })} />
            </div>
          )}
        </div>

        <div className="mt-field">
          <span className="mt-label">Bounty when the game was played</span>
          <div className="mt-range">
            <select className="px-input mt-select" aria-label="Lowest Bounty" value={value.minBounty ?? ""} onChange={(e) => set({ minBounty: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">Any</option>
              {steps.map((t) => (
                <option key={t.id} value={t.minBounty} disabled={value.maxBounty != null && t.minBounty >= value.maxBounty}>
                  {formatBounty(t.minBounty)}+ · {t.name}
                </option>
              ))}
            </select>
            <span className="mt-to" aria-hidden>to</span>
            <select className="px-input mt-select" aria-label="Highest Bounty" value={value.maxBounty ?? ""} onChange={(e) => set({ maxBounty: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">Any</option>
              {steps.map((t) => (
                <option key={t.id} value={t.minBounty - 1} disabled={value.minBounty != null && t.minBounty <= value.minBounty}>
                  below {formatBounty(t.minBounty)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button className="px-btn mt-reset" onClick={() => onChange({ ...DEFAULT_FILTERS, format: options?.formats[0]?.format || "" })}>
          Reset
        </button>
      </div>
      <div className="mt-summary" aria-live="polite">
        <b>{totalGames == null ? "…" : totalGames.toLocaleString()} games</b>
        <span>· {formatLabel} · {dateLabel} · {bountyLabel}</span>
      </div>
    </section>
  );
}
