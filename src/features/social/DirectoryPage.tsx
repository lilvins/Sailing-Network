import { useEffect, useMemo, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { api, type DirectoryUser } from "../../lib/api";
import { usePresenceStore } from "../../lib/presenceStore";
import { Header, Dock, Ico } from "../profiles/ProfilePages";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { PresenceBadge } from "../profiles/PresenceBadge";
import { loadCardsById, type Card } from "../cards/cardsDb";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";

const winRate = (w: number, l: number) => Math.round((w / Math.max(1, w + l)) * 100);

export function DirectoryPage() {
  const openProfile = useUiStore((s) => s.openProfile);

  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchPresence = usePresenceStore((s) => s.fetch);

  useEffect(() => {
    const load = async () => {
      try {
        const [d, m] = await Promise.all([api.directory(), loadCardsById()]);
        setUsers(d.users);
        setCards(m);
        await fetchPresence();
      } catch {
        setLoading(false);
      }
      setLoading(false);
    };
    void load();
    const interval = setInterval(() => fetchPresence(), 30_000);
    return () => clearInterval(interval);
  }, [fetchPresence]);

  const avatarOf = (u: DirectoryUser) => ({
    color: u.avatarColor || "#7a3030",
    image: u.favoriteLeader ? cards?.get(u.favoriteLeader)?.image : null,
  });

  const rows = useMemo(
    () =>
      users
        .filter((u) => !q || u.displayName.toLowerCase().includes(q.toLowerCase()) || u.username.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses)),
    [users, q],
  );

  return (
    <div className="sn snp">
      <Header title="Player Directory" sub={`${users.length} captain${users.length === 1 ? "" : "s"}`} />
      <div className="snp-body">
        <div className="snp-wrap">
          <div className="rec-toolbar">
            <div className="spacer" />
            <div className="rec-search">
              <Ico n="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search captains…" />
            </div>
          </div>

          <div className="fr-list">
            {loading && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading directory…</div>}
            {!loading && rows.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No captains match your search.</div>}
            {!loading &&
              rows.map((u) => (
                <div className="fr-row" key={u.id}>
                  <LeaderAvatar name={u.displayName} {...avatarOf(u)} />
                  <div className="fr-main">
                    <div className="fr-name">
                      <PresenceBadge userId={u.id} /> {u.displayName}
                      {u.supporter && <span style={{ marginLeft: 6, color: "#ffd98a" }}>★</span>}
                      {u.role === "admin" && <span style={{ marginLeft: 6, color: "#e3b24c" }}>⚓</span>}
                    </div>
                    <div className="fr-status">
                      @{u.username} · {u.deckCount} deck{u.deckCount === 1 ? "" : "s"} · {winRate(u.wins, u.losses)}% WR
                    </div>
                  </div>
                  <div className="fr-actions">
                    <button className="fr-btn" onClick={() => openProfile(u.username)}>
                      <Ico n="follow" size={14} /> Profile
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      <Dock />
    </div>
  );
}
