import { useEffect, useMemo, useState } from "react";
import { api, type MetaLeader } from "../../lib/api";
import { Header, Dock } from "../profiles/ProfilePages";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";

/* Meta analytics — leader popularity + win rate aggregated from the real match
   history (/api/meta). No placeholders. */

export function MetaPage() {
  const [leaders, setLeaders] = useState<MetaLeader[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.meta(), loadCardsById()])
      .then(([{ leaders }, m]) => { setLeaders(leaders); setCards(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const rows = useMemo(
    () =>
      leaders.map((l) => {
        const c = cards?.get(l.leaderId);
        return { ...l, name: c?.name || l.leaderId, color: c ? cardColorHex(c) : "#3a4a5e", image: c?.image || null };
      }),
    [leaders, cards],
  );
  const totalGames = rows.reduce((a, r) => a + r.games, 0);

  return (
    <div className="sn snp">
      <Header
        title="Meta Analytics"
        sub="Leader popularity & win rate"
        hero="/assets/bg/sec-meta.png"
        right={<span className="rk-myrank-v" style={{ fontSize: 14 }}>{totalGames.toLocaleString()} games</span>}
      />
      <div className="snp-body">
        {loading ? (
          <div className="snp-wrap"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Crunching the meta…</div></div>
        ) : rows.length === 0 ? (
          <div className="snp-wrap"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No match data yet.</div></div>
        ) : (
          <div className="snp-wrap">
            <div className="rec-table">
              <div className="rec-head meta-head">
                <span className="ar">#</span>
                <span>Leader</span>
                <span>Meta share</span>
                <span>Win rate</span>
                <span className="ar">Games</span>
              </div>
              {rows.map((r, i) => (
                <div className="rec-row meta-row" key={r.leaderId}>
                  <span className={"rk-rank r" + (i + 1 <= 3 ? i + 1 : "")}>{i + 1}</span>
                  <div className="rec-opp">
                    <LeaderAvatar name={r.name} color={r.color} image={r.image} />
                    <span className="name">{r.name}</span>
                  </div>
                  <span className="meta-share">
                    <span className="meta-bar"><span className="meta-bar-fill" style={{ width: Math.min(100, r.share * 3) + "%", background: r.color }} /></span>
                    <span className="meta-share-num">{r.share}%</span>
                  </span>
                  <span className="rk-wr">
                    <span className="rk-wr-bar">
                      <span className="rk-wr-fill" style={{ width: r.winRate + "%", background: r.winRate >= 50 ? "linear-gradient(90deg,#1f8a5b,#46c98a)" : "linear-gradient(90deg,#9a3b34,#e26a62)" }} />
                    </span>
                    <span className="rk-wr-num">{r.winRate}%</span>
                  </span>
                  <span className="rec-new">{r.games}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <Dock />
    </div>
  );
}
