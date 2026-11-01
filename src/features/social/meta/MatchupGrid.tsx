/* Leader × leader matchup grid: each cell is the ROW leader's win rate
   against the COLUMN leader, with the games behind it. Diverging colour:
   red below 50%, walnut at 50%, green above, full strength at ±20 points.
   Hovering a cell lights its row and column and spells the cell out. */

import { useState } from "react";
import type { MetaGridReport } from "../../../lib/api";
import type { Card } from "../../cards/cardsDb";
import { cardColorHex } from "../../cards/cardsDb";
import { LeaderAvatar } from "../../cards/LeaderAvatar";
import { SMALL_SAMPLE, showPct } from "../../stats/format";

const NEUTRAL = [58, 43, 37]; // --px-walnut-3
const RED = [176, 52, 44];
const GREEN = [52, 140, 98];

function cellColor(wr: number): string {
  const t = Math.max(-1, Math.min(1, (wr - 50) / 20));
  const to = t < 0 ? RED : GREEN;
  const k = Math.abs(t);
  const c = NEUTRAL.map((n, i) => Math.round(n + (to[i] - n) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function MatchupGrid({ grid, card, labelOf }: { grid: MetaGridReport["grid"]; card: (id: string) => Card | null; labelOf: (id: string) => string }) {
  const [hot, setHot] = useState<{ r: number; c: number } | null>(null);
  const ids = grid.leaders.map((l) => l.leaderId);
  if (ids.length < 2) return <div className="mt-empty">Not enough games under these filters for a grid yet.</div>;

  const color = (id: string) => { const c = card(id); return c ? cardColorHex(c) : "#3a2b25"; };
  const hc = hot ? grid.cells[hot.r][hot.c] : null;

  return (
    <>
      <div className="mt-grid-scroll" onMouseLeave={() => setHot(null)}>
        <table className="mt-grid">
          <thead>
            <tr>
              <th className="mt-corner" scope="col">Row vs<br />column</th>
              {grid.leaders.map((l, c) => (
                <th key={l.leaderId} scope="col" className={hot?.c === c ? "hot" : ""} title={`${labelOf(l.leaderId)} · ${l.games} games · ${showPct(l.winRate)}`}>
                  <div className="mt-colh">
                    <LeaderAvatar name={labelOf(l.leaderId)} color={color(l.leaderId)} image={card(l.leaderId)?.image} size={34} />
                    <small>{l.leaderId.split("-")[0]}</small>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.leaders.map((row, r) => (
              <tr key={row.leaderId} className={hot?.r === r ? "hot" : ""}>
                <th scope="row" className="mt-rowh">
                  <div className="mt-rowh-in">
                    <span className="mt-rowh-art"><LeaderAvatar name={labelOf(row.leaderId)} color={color(row.leaderId)} image={card(row.leaderId)?.image} size={32} /></span>
                    <span>
                      <b title={row.leaderId}>{labelOf(row.leaderId)}</b>
                      <small>{showPct(row.winRate)} · {row.games.toLocaleString()} g</small>
                    </span>
                  </div>
                </th>
                {grid.cells[r].map((cell, c) => {
                  const isHot = hot?.r === r && hot?.c === c;
                  const enter = () => setHot({ r, c });
                  if (r === c) {
                    return (
                      <td key={c} className={"mt-cell mirror" + (isHot ? " hot" : "")} onMouseEnter={enter} onClick={enter}>
                        <small>mirror</small>
                      </td>
                    );
                  }
                  if (!cell || cell.winRate == null) {
                    return <td key={c} className={"mt-cell none" + (isHot ? " hot" : "")} onMouseEnter={enter} onClick={enter}>—</td>;
                  }
                  return (
                    <td
                      key={c}
                      className={"mt-cell" + (cell.games < SMALL_SAMPLE ? " small" : "") + (isHot ? " hot" : "")}
                      style={{ background: cellColor(cell.winRate) }}
                      onMouseEnter={enter}
                      onClick={enter}
                      title={`${labelOf(row.leaderId)} vs ${labelOf(ids[c])}: ${showPct(cell.winRate)} over ${cell.games} games`}
                    >
                      <b>{Math.round(cell.winRate)}%</b>
                      <small>{cell.games}</small>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-tip" aria-live="polite">
        {hot && hot.r !== hot.c && hc && hc.winRate != null ? (
          <>
            <b>{labelOf(ids[hot.r])}</b> vs <b>{labelOf(ids[hot.c])}</b>: {showPct(hc.winRate)} over {hc.games} games
            {hc.ci && ` · 95% range ${showPct(hc.ci[0])}–${showPct(hc.ci[1])}`}
            {hc.games < SMALL_SAMPLE && " · few games"}
          </>
        ) : hot && hot.r !== hot.c ? (
          <><b>{labelOf(ids[hot.r])}</b> vs <b>{labelOf(ids[hot.c])}</b>: no games under these filters</>
        ) : (
          "Point at a cell (or tap it) to read it."
        )}
      </div>
      <div className="mt-key">
        <span>Win rate of the row leader</span>
        <span>30%</span>
        <span className="mt-ramp" style={{ background: `linear-gradient(90deg, ${cellColor(30)}, ${cellColor(50)} 50%, ${cellColor(70)})` }} />
        <span>70%</span>
        <span>· small number = games · faded = under {SMALL_SAMPLE} games</span>
      </div>
    </>
  );
}
