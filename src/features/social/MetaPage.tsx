import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MetaGridReport } from "../../lib/api";
import { Header, Dock } from "../profiles/ProfilePages";
import { loadCardsById, type Card } from "../cards/cardsDb";
import { MetaFilters, DEFAULT_FILTERS, toQuery, type MetaFilterState } from "./meta/MetaFilters";
import { MatchupGrid } from "./meta/MatchupGrid";
import { BestLists } from "./meta/BestLists";
import "../home/home.css";
import "../profiles/profiles.css";
import "../stats/stats.css";
import "./meta/meta.css";
import { PixelScene } from "../pixel/PixelScene";

/* Meta Analytics — two things only, both under the same filters (format,
   days, Bounty when the game was played):
   1. the leader × leader matchup grid;
   2. best lists: per leader, the decklists with more than 30 ladder games,
      best win rate first.
   Data: /api/meta/report (server/stats/metaReport.mjs). */

export function MetaPage() {
  const [report, setReport] = useState<MetaGridReport | null>(null);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [filters, setFilters] = useState<MetaFilterState | null>(null); // null until the formats are known
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    loadCardsById().then(setCards).catch(() => {});
  }, []);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(false);
    api.metaReport(filters ? toQuery(filters) : toQuery(DEFAULT_FILTERS))
      .then((r) => {
        if (id !== reqId.current) return; // a newer filter change won
        // first load: start on the format played most recently
        if (!filters) { setFilters({ ...DEFAULT_FILTERS, format: r.options.formats[0]?.format || "" }); return; }
        setReport(r);
        setLoading(false);
      })
      .catch(() => { if (id === reqId.current) { setLoading(false); setError(true); } });
  }, [filters]);

  const card = (id: string) => cards?.get(id) || null;
  // two leaders can share a name (two Enels): add the set code where it matters
  const labelOf = useMemo(() => {
    const ids = new Set<string>([...(report?.grid.leaders.map((l) => l.leaderId) || []), ...(report?.bestLists.map((b) => b.leaderId) || [])]);
    const name = (id: string) => cards?.get(id)?.name || id;
    const count = new Map<string, number>();
    ids.forEach((id) => count.set(name(id), (count.get(name(id)) || 0) + 1));
    return (id: string) => ((count.get(name(id)) || 0) > 1 ? `${name(id)} ${id.split("-")[0]}` : name(id));
  }, [report, cards]);

  return (
    <div className="sn snp px">
      <PixelScene kind="sunset" />
      <Header title="Meta Analytics" sub="Matchups and the best lists on the ladder" hero="/assets/bg/sec-meta.png" />
      <div className="snp-body">
        <div className="snp-wrap mt-page">
          <MetaFilters
            value={filters || DEFAULT_FILTERS}
            onChange={setFilters}
            options={report?.options || null}
            totalGames={report && !loading ? report.totalGames : null}
          />

          {error && !report ? (
            <section className="px-window mt-window"><div className="mt-empty">The meta could not be loaded. Try again in a moment.</div></section>
          ) : !report ? (
            <section className="px-window mt-window"><div className="mt-empty">Crunching the meta…</div></section>
          ) : (
            <>
              <section className="px-window mt-window" aria-labelledby="mt-grid-h" style={{ opacity: loading ? 0.6 : 1 }}>
                <div className="mt-h">
                  <h2 id="mt-grid-h">Matchup grid</h2>
                  <span className="mt-sub">leaders with {report.options.gridMinGames}+ games, most played first</span>
                </div>
                <MatchupGrid grid={report.grid} card={card} labelOf={labelOf} />
              </section>

              <section className="px-window mt-window" aria-labelledby="mt-best-h" style={{ opacity: loading ? 0.6 : 1 }}>
                <div className="mt-h">
                  <h2 id="mt-best-h">Best lists</h2>
                  <span className="mt-sub">more than {report.options.bestListMoreThanGames} ladder games, best win rate first</span>
                </div>
                <BestLists bestLists={report.bestLists} moreThan={report.options.bestListMoreThanGames} card={card} labelOf={labelOf} />
              </section>
            </>
          )}
        </div>
      </div>
      <Dock />
    </div>
  );
}
