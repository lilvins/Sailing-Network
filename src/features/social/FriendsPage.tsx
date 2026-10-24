import { useEffect, useMemo, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type DirectoryUser, type Friendship } from "../../lib/api";
import { usePresenceStore } from "../../lib/presenceStore";
import { Header, Dock, Ico } from "../profiles/ProfilePages";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { PresenceBadge } from "../profiles/PresenceBadge";
import { loadCardsById, type Card } from "../cards/cardsDb";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";

/* Friends — real data: accepted friends, incoming requests, outgoing requests,
   plus a "Find captains" tab to send requests to any captain on the network. */

const winRate = (w: number, l: number) => Math.round((w / Math.max(1, w + l)) * 100);

type TabId = "friends" | "incoming" | "outgoing" | "find";

export function FriendsPage() {
  const me = useAuthStore((s) => s.user);
  const openProfile = useUiStore((s) => s.openProfile);
  const openMessagesWith = useUiStore((s) => s.openMessagesWith);

  const [friends, setFriends] = useState<Friendship[]>([]);
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [tab, setTab] = useState<TabId>("friends");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const fetchPresence = usePresenceStore((s) => s.fetch);

  const reload = async () => {
    const [f, d] = await Promise.all([api.myFriends(), api.directory()]);
    setFriends(f.friends);
    setDir(d.users);
    await fetchPresence();
  };
  useEffect(() => {
    void reload().catch(() => {});
    loadCardsById().then(setCards).catch(() => {});
    const interval = setInterval(() => fetchPresence(), 30_000);
    return () => clearInterval(interval);
  }, []);

  // resolve a captain's avatar (leader art + colour) by username
  const avatarOf = (username: string) => {
    const u = dir.find((d) => d.username === username);
    return { color: u?.avatarColor || "#7a3030", image: u?.favoriteLeader ? cards?.get(u.favoriteLeader)?.image : null };
  };

  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(""), 1800); };

  const accepted = useMemo(() => friends.filter((f) => f.status === "accepted"), [friends]);
  const incoming = useMemo(() => friends.filter((f) => f.status === "pending" && f.role === "incoming"), [friends]);
  const outgoing = useMemo(() => friends.filter((f) => f.status === "pending" && f.role === "outgoing"), [friends]);

  // captains you don't already have a friendship with — for the "Find" tab
  const knownIds = useMemo(() => new Set(friends.map((f) => f.user.id)), [friends]);
  const findable = useMemo(
    () => dir.filter((u) => u.username !== me?.username && !knownIds.has(u.id)),
    [dir, knownIds, me],
  );

  const search = (q: string, items: { username: string; displayName: string }[]) =>
    !q ? items : items.filter((u) => u.displayName.toLowerCase().includes(q.toLowerCase()) || u.username.toLowerCase().includes(q.toLowerCase()));

  const respond = async (id: string, action: "accept" | "decline" | "remove") => {
    setBusy(id);
    try { await api.respondFriend(id, action); await reload(); flash(action === "accept" ? "Friend added" : action === "decline" ? "Request declined" : "Removed"); }
    catch (e) { flash(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  };
  const requestFriend = async (username: string) => {
    setBusy(username);
    try { await api.sendFriendRequest(username); await reload(); flash("Request sent"); }
    catch (e) { flash(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  };

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "friends",  label: "Friends",  count: accepted.length },
    { id: "incoming", label: "Requests", count: incoming.length },
    { id: "outgoing", label: "Outgoing", count: outgoing.length },
    { id: "find",     label: "Find captains" },
  ];

  return (
    <div className="sn snp">
      <Header
        title="Friends"
        sub={`${accepted.length} friend${accepted.length === 1 ? "" : "s"}${incoming.length ? ` · ${incoming.length} pending` : ""}`}
        hero="/assets/bg/sec-friends.png"
        heroSlim
      />
      <div className="snp-body">
        <div className="snp-wrap">
          <div className="rec-toolbar">
            <div className="fr-tabs">
              {tabs.map((t) => (
                <button key={t.id} className={"fr-tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
                  {t.label}{t.count != null && t.count > 0 ? ` (${t.count})` : ""}
                </button>
              ))}
            </div>
            <div className="spacer" />
            <div className="rec-search">
              <Ico n="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "find" ? "Find a captain to add…" : "Filter…"} />
            </div>
          </div>

          {tab === "friends" && (
            <div className="fr-list">
              {search(q, accepted.map((f) => ({ username: f.user.username, displayName: f.user.displayName, f }))).map((row: any) => {
                const f: Friendship = row.f;
                const u = dir.find((d) => d.id === f.user.id);
                return (
                  <div className="fr-row" key={f.id}>
                    <LeaderAvatar name={f.user.displayName} {...avatarOf(f.user.username)} size={48} />
                    <div className="fr-main">
                      <div className="fr-name"><PresenceBadge userId={f.user.id} /> {f.user.displayName}{u?.supporter && <span style={{ marginLeft: 6, color: "#ffd98a" }}>★</span>}</div>
                      <div className="fr-status">@{f.user.username}{u ? ` · ${u.deckCount} decks · ${winRate(u.wins, u.losses)}% WR` : ""}</div>
                    </div>
                    <div className="fr-actions">
                      <button className="fr-btn" onClick={() => openProfile(f.user.username)}><Ico n="follow" size={14} /> Profile</button>
                      <button className="fr-btn" onClick={() => openMessagesWith(f.user.username)}><Ico n="chat" size={14} /> Message</button>
                      <button className="fr-btn" disabled={busy === f.id} onClick={() => respond(f.id, "remove")}>Remove</button>
                    </div>
                  </div>
                );
              })}
              {accepted.length === 0 && (
                <div className="snp-empty">
                  <img src="/assets/bg/avatar-moon.png" alt="" />
                  No friends yet. Try the "Find captains" tab.
                </div>
              )}
            </div>
          )}

          {tab === "incoming" && (
            <div className="fr-list">
              {incoming.map((f) => (
                <div className="fr-row" key={f.id}>
                  <LeaderAvatar name={f.user.displayName} {...avatarOf(f.user.username)} size={48} />
                  <div className="fr-main">
                    <div className="fr-name"><PresenceBadge userId={f.user.id} /> {f.user.displayName}</div>
                    <div className="fr-status">@{f.user.username} · wants to be friends</div>
                  </div>
                  <div className="fr-actions">
                    <button className="fr-btn primary" disabled={busy === f.id} onClick={() => respond(f.id, "accept")}>Accept</button>
                    <button className="fr-btn" disabled={busy === f.id} onClick={() => respond(f.id, "decline")}>Decline</button>
                  </div>
                </div>
              ))}
              {incoming.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No pending requests.</div>}
            </div>
          )}

          {tab === "outgoing" && (
            <div className="fr-list">
              {outgoing.map((f) => (
                <div className="fr-row" key={f.id}>
                  <LeaderAvatar name={f.user.displayName} {...avatarOf(f.user.username)} size={48} />
                  <div className="fr-main">
                    <div className="fr-name"><PresenceBadge userId={f.user.id} /> {f.user.displayName}</div>
                    <div className="fr-status">@{f.user.username} · waiting for response</div>
                  </div>
                  <div className="fr-actions">
                    <button className="fr-btn" disabled={busy === f.id} onClick={() => respond(f.id, "remove")}>Cancel</button>
                  </div>
                </div>
              ))}
              {outgoing.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No outgoing requests.</div>}
            </div>
          )}

          {tab === "find" && (
            <div className="fr-list">
              {search(q, findable).map((u) => (
                <div className="fr-row" key={(u as DirectoryUser).id}>
                  <LeaderAvatar name={u.displayName} {...avatarOf(u.username)} size={48} />
                  <div className="fr-main">
                    <div className="fr-name"><PresenceBadge userId={(u as DirectoryUser).id} /> {u.displayName}{(u as DirectoryUser).supporter && <span style={{ marginLeft: 6, color: "#ffd98a" }}>★</span>}</div>
                    <div className="fr-status">@{u.username} · {(u as DirectoryUser).deckCount} decks · {winRate((u as DirectoryUser).wins, (u as DirectoryUser).losses)}% WR</div>
                  </div>
                  <div className="fr-actions">
                    <button className="fr-btn" onClick={() => openProfile(u.username)}><Ico n="follow" size={14} /> Profile</button>
                    <button className="fr-btn primary" disabled={busy === u.username} onClick={() => requestFriend(u.username)}>
                      <Ico n="plus" size={14} /> Add friend
                    </button>
                  </div>
                </div>
              ))}
              {findable.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>You already know everyone on the network 👋</div>}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 30, left: "50%", transform: "translateX(-50%)", padding: "10px 18px", borderRadius: 999, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--card-border)", boxShadow: "var(--shadow-2)", zIndex: 200, fontWeight: 600 }}>{toast}</div>
      )}

      <Dock />
    </div>
  );
}
