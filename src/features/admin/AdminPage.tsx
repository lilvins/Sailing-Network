import { useEffect, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type AuthUser, type Role } from "../../lib/api";
import "../home/home.css";
import "../profiles/profiles.css";
import "./admin.css";

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export function AdminPage() {
  const setView = useUiStore((s) => s.setView);
  const me = useAuthStore((s) => s.user);

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { users } = await api.adminListUsers();
      setUsers(users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setRole = async (u: AuthUser, role: Role) => {
    setBusyId(u.id);
    setError("");
    try {
      await api.adminSetRole(u.id, role);
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, role } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change role");
    } finally {
      setBusyId(null);
    }
  };

  const adminCount = users.filter((u) => u.role === "admin").length;

  return (
    <div className="sn snp adm">
      <header className="snp-head">
        <button className="snp-back" title="Back to Main Menu" onClick={() => setView("home")}>
          <BackIcon />
        </button>
        <div className="snp-head-title">
          <h1>Admin · Users</h1>
          <span className="sn-kicker">{users.length} accounts · {adminCount} admin</span>
        </div>
        <div className="snp-head-r">
          <button className="adm-refresh" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </header>

      <div className="snp-body">
        <div className="snp-wrap">
          {error && <div className="adm-error">{error}</div>}

          {loading ? (
            <div className="adm-loading">Loading accounts…</div>
          ) : (
            <div className="adm-table">
              <div className="adm-row adm-head-row">
                <span>User</span>
                <span>Email</span>
                <span>Role</span>
                <span>Joined</span>
                <span className="adm-col-act">Action</span>
              </div>

              {users.map((u) => {
                const isSelf = me?.id === u.id;
                const isAdmin = u.role === "admin";
                const lastAdmin = isAdmin && adminCount <= 1;
                return (
                  <div className={"adm-row" + (isSelf ? " self" : "")} key={u.id}>
                    <span className="adm-user">
                      <span className="adm-avatar">{(u.displayName || u.username)[0]?.toUpperCase()}</span>
                      <span className="adm-user-txt">
                        <b>{u.displayName}{isSelf && <span className="adm-you">you</span>}</b>
                        <small>@{u.username}</small>
                      </span>
                    </span>
                    <span className="adm-email">{u.email}</span>
                    <span>
                      <span className={"adm-role " + u.role}>{u.role}</span>
                    </span>
                    <span className="adm-joined">{fmtDate(u.createdAt)}</span>
                    <span className="adm-col-act">
                      {isAdmin ? (
                        <button
                          className="adm-btn demote"
                          disabled={busyId === u.id || lastAdmin}
                          title={lastAdmin ? "Can't demote the last admin" : "Demote to user"}
                          onClick={() => setRole(u, "user")}
                        >
                          Make user
                        </button>
                      ) : (
                        <button
                          className="adm-btn promote"
                          disabled={busyId === u.id}
                          onClick={() => setRole(u, "admin")}
                        >
                          Make admin
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
