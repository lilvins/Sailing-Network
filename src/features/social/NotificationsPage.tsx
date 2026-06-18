import { useEffect, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { api, type Notification } from "../../lib/api";
import { Header, Dock, Ico, type IconName } from "../profiles/ProfilePages";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";

/* Notifications — unified feed (friend requests/accepts, DMs, system).
   Opening the page marks everything read. */

function relTime(ms: number) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}

const ICON: Record<Notification["type"], IconName> = {
  friend_request: "follow",
  friend_accept: "check",
  message: "chat",
  system: "dot",
};

export function NotificationsPage() {
  const openProfile = useUiStore((s) => s.openProfile);
  const openMessagesWith = useUiStore((s) => s.openMessagesWith);
  const setView = useUiStore((s) => s.setView);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.notifications()
      .then(({ notifications }) => { setItems(notifications); setLoading(false); })
      .catch(() => setLoading(false));
    // mark read shortly after opening so the badge clears
    const t = window.setTimeout(() => { void api.markNotificationsRead().catch(() => {}); }, 600);
    return () => window.clearTimeout(t);
  }, []);

  const act = (n: Notification) => {
    if (!n.ref) return;
    if (n.type === "message") openMessagesWith(n.ref);
    else if (n.type === "friend_request") setView("friends");
    else openProfile(n.ref);
  };

  return (
    <div className="sn snp">
      <Header title="Notifications" sub={loading ? "loading…" : `${items.length} recent`} />
      <div className="snp-body">
        <div className="snp-wrap">
          <div className="fr-list">
            {items.map((n) => (
              <button className={"fr-row notif-row" + (n.read ? "" : " unread")} key={n.id} onClick={() => act(n)}>
                <span className={"notif-ico t-" + n.type}><Ico n={ICON[n.type]} size={16} /></span>
                <div className="fr-main">
                  <div className="fr-name">{n.body}</div>
                  <div className="fr-status">{n.actor ? `@${n.actor.username} · ` : ""}{relTime(n.createdAt)}</div>
                </div>
                {!n.read && <span className="notif-dot" />}
              </button>
            ))}
            {!loading && items.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Nothing yet — friend requests and messages will show up here.</div>
            )}
          </div>
        </div>
      </div>
      <Dock />
    </div>
  );
}
