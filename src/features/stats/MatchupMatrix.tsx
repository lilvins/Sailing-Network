/* Leader × leader win-rate grid. Row leader's win rate vs the column leader.
   Diverging color: red below 50%, neutral gray at 50%, green above, full
   strength at ±20 points. Cells with few games are dimmed; n is in every cell. */

import type { MetaReport } from "../../lib/api";
import { SMALL_SAMPLE, showPct } from "./format";
import "./stats.css";

const NEUTRAL = [58, 61, 68];
const RED = [184, 68, 63];
const GREEN = [47, 154, 94];

function cellColor(wr: number): string {
  const t = Math.max(-1, Math.min(1, (wr - 50) / 20));
  const to = t < 0 ? RED : GREEN;
  const k = Math.abs(t);
  const c = NEUTRAL.map((n, i) => Math.round(n + (to[i] - n) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function MatchupMatrix({ matrix, nameOf }: { matrix: MetaReport["matrix"]; nameOf: (id: string) => string }) {
  if (matrix.leaders.length < 2) return <div className="sx-chart-empty">Not enough leaders with data for a matrix yet.</div>;
  return (
    <div>
      <div className="sx-mx-wrap">
        <table className="sx-mx">
          <thead>
            <tr>
              <th />
              {matrix.leaders.map((id) => (
                <th key={id} className="col" scope="col"><span>{nameOf(id)}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.leaders.map((row, r) => (
              <tr key={row}>
                <th className="row" scope="row">{nameOf(row)}</th>
                {matrix.cells[r].map((c, k) => {
                  const col = matrix.leaders[k];
                  if (row === col) {
                    return <td key={col} className="mirror" title="Mirror match">{c ? <small>n={c.games}</small> : "—"}</td>;
                  }
                  if (!c || c.winRate == null) return <td key={col} className="empty" title="No games">—</td>;
                  const title = `${nameOf(row)} vs ${nameOf(col)}: ${showPct(c.winRate)} over ${c.games} games` + (c.ci ? ` · 95% range ${showPct(c.ci[0])}–${showPct(c.ci[1])}` : "");
                  return (
                    <td key={col} className={c.games < SMALL_SAMPLE ? "small" : ""} style={{ background: cellColor(c.winRate) }} title={title}>
                      {Math.round(c.winRate)}
                      <small>n={c.games}</small>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sx-mx-key">
        <span>Row leader's win rate vs column leader</span>
        <span>30%</span><span className="sx-mx-ramp" /><span>70%</span>
        <span>· faded = fewer than {SMALL_SAMPLE} games · hover a cell for the 95% range</span>
      </div>
    </div>
  );
}
