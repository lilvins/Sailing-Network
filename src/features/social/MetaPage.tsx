import { useEffect, useMemo, useState } from "react";
import { api, type MetaReport } from "../../lib/api";
import { Header, Dock } from "../profiles/ProfilePages";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import { WinRate, WinRateBar } from "../stats/StatBits";
import { MatchupMatrix } from "../stats/MatchupMatrix";
import { showPct } from "../stats/format";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";
import "../stats/stats.css";
import { PixelScene } from "../pixel/PixelScene";

/* Meta analytics — per leader: play rate (and its change vs the week before),
   win rate with sample size and 95% range, opponent-adjusted win rate,
   first/second split, distinct players; then a leader × leader matrix.
   Data: /api/meta?days= (server/stats). */

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 0, label: "All time" },
];
type SortKey = "share" | "winRate" | "adjusted";

export function MetaPage() {
  const [report, setReport] = useState<MetaReport | null>(null);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<SortKey>("share");
  const [showSmall, setShowSmall] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCardsById().then(setCards).catch(() => {});
  }, []);
  useEffect(() => {
    setLoading(true);
    api.meta(days).then((r) => { setReport(r); setLoading(false); }).catch(() => setLoading(false));
  }, [days]);

  const card = (id: string) => cards?.get(id) || null;
  const nameOf = (id: string) => card(id)?.name || id;
  // two leaders can share a name (e.g. two Enels): add the set code so the matrix stays readable
  const labelOf = useMemo(() => {
    const ids = report?.leaders.map((l) => l.leaderId) || [];
    const count = new Map<string, number>();
    ids.forEach((id) => count.set(nameOf(id), (count.get(nameOf(id)) || 0) + 1));
    return (id: string) => ((count.get(nameOf(id)) || 0) > 1 ? `${nameOf(id)} ${id.split("-")[0]}` : nameOf(id));
  }, [report, cards]);

  const rows = useMemo(() => {
    const list = (report?.leaders || []).filter((l) => showSmall || l.enough);
    const val = (l: (typeof list)[number]) => (sort === "share" ? l.share : sort === "winRate" ? l.winRate ?? 0 : l.adjustedWinRate ?? 0);
    return [...list].sort((a, b) => val(b) - val(a));
  }, [report, sort, showSmall]);
  const hidden = (report?.leaders.length || 0) - (report?.leaders.filter((l) => l.enough).length || 0);
  const maxShare = Math.max(1, ...rows.map((r) => r.share));

  return (
    <div className="sn snp px">
      <PixelScene kind="sunset" />
      <Header
        title="Meta Analytics"
        sub="Play rate, win rate & matchups"
        hero="/assets/bg/sec-meta.png"
        right={<span className="rk-myrank-v" style={{ fontSize: 14 }}>{report ? `${report.totalGames.toLocaleString()} games` : ""}</span>}
      />
      <div className="snp-body">
        <div className="snp-wrap">
          <div className="rec-toolbar">
            <div className="sx-seg" role="group" aria-label="Time window">
              {WINDOWS.map((w) => (
                <button key={w.days} className={days === w.days ? "on" : ""} onClick={() => setDays(w.days)}>{w.label}</button>
              ))}
            </div>
            <div className="sx-seg" role="group" aria-label="Sort by">
              <button className={sort === "share" ? "on" : ""} onClick={() => setSort("share")}>Most played</button>
              <button className={sort === "winRate" ? "on" : ""} onClick={() => setSort("winRate")}>Win rate</button>
              <button className={sort === "adjusted" ? "on" : ""} onClick={() => setSort("adjusted")}>Adjusted</button>
            </div>
            <div className="spacer" />
            {hidden > 0 && (
              <label className="sx-note meta2-small">
                <input type="checkbox" checked={showSmall} onChange={(e) => setShowSmall(e.target.checked)} />
                Show {hidden} leader{hidden === 1 ? "" : "s"} under {report?.minGames} games
              </label>
            )}
          </div>

          {loading && !report ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Crunching the meta…</div>
          ) : !report || report.totalGames === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No games in this window.</div>
          ) : (
            <>
              <div className="rec-table" style={{ opacity: loading ? 0.6 : 1 }}>
                <div className="rec-head meta2-row">
                  <span className="ar">#</span>
                  <span>Leader</span>
                  <span>Play rate</span>
                  <span>Win rate</span>
                  <span title="Win rate vs each opponent, weighted by how often that opponent is played">Adjusted</span>
                  <span className="ar">1st</span>
                  <span className="ar">2nd</span>
                  <span className="ar">Players</span>
                </div>
                {rows.map((r, i) => {
                  const c = card(r.leaderId);
                  const color = c ? cardColorHex(c) : "#3a4a5e";
                  return (
                    <div className={"rec-row meta2-row" + (r.enough ? "" : " meta2-thin")} key={r.leaderId}>
                      <span className="rk-rank">{i + 1}</span>
                      <div className="rec-opp">
                        <LeaderAvatar name={nameOf(r.leaderId)} color={color} image={c?.image} size={40} />
                        <span className="rk2-name">
                          <span className="name">{nameOf(r.leaderId)}</span>
                          <small>{r.leaderId} · {r.games.toLocaleString()} games</small>
                        </span>
                      </div>
                      <span className="meta-share">
                        <span className="meta-bar"><span className="meta-bar-fill" style={{ width: (r.share / maxShare) * 100 + "%", background: color }} /></span>
                        <span className="meta2-sharenum">
                          {r.share}%
                          {days !== 0 && r.shareDelta !== 0 && (
                            <small className={"sx-delta " + (r.shareDelta > 0 ? "up" : "down")}>{r.shareDelta > 0 ? "▲" : "▼"}{Math.abs(r.shareDelta)}</small>
                          )}
                        </span>
                      </span>
                      <span className="meta2-wr">
                        <WinRate rate={r.winRate} games={r.games} ci={r.ci} />
                        <WinRateBar rate={r.winRate} ci={r.ci} />
                      </span>
                      <span className="sx-wr"><b>{showPct(r.adjustedWinRate)}</b></span>
                      <span className="ar"><WinRate rate={r.winRate1} games={r.games1} colored={false} /></span>
                      <span className="ar"><WinRate rate={r.winRate2} games={r.games2} colored={false} /></span>
                      <span className="ar mono rk2-muted">{r.players}</span>
                    </div>
                  );
                })}
              </div>
              <p className="sx-note meta2-foot">
                Win rate bars show the 95% range: the wider the band, the less the number means yet. Faded numbers rest on fewer than 10 games.
                {days !== 0 && " ▲▼ = play-rate change vs the 7 days before."}
              </p>

              <div className="so-card" style={{ marginTop: 18 }}>
                <div className="so-card-h">Matchup matrix <span className="sx-note" style={{ marginLeft: "auto" }}>top {report.matrix.leaders.length} leaders with {report.minGames}+ games</span></div>
                <div style={{ padding: 16 }}>
                  <MatchupMatrix matrix={report.matrix} nameOf={labelOf} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <Dock />
    </div>
  );
}
