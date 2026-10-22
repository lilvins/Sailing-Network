import { useEffect, useState, type FormEvent } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type SiteStats } from "../../lib/api";
import "../home/home.css"; // for the shared .sn vars/atoms
import "./login.css";

/* The landing/login — the right side is the REAL "Moon and Sea" pixel art
   (public/assets/bg/night-sea, CraftPix via OpenGameArt, OGA-BY 3.0),
   layered PNGs with slow functional drift. Wired to the real backend. */

/** Layered pixel-art scene: base sky+sea, moon, drifting clouds, shimmering
    moon reflections. All real PNGs — nothing drawn in markup. */
function NightSea() {
  return (
    <div className="nsea" aria-hidden="true">
      <div className="nsea-layer nsea-base" />
      <div className="nsea-layer nsea-moon" />
      <div className="nsea-layer nsea-clouds" />
      <div className="nsea-layer nsea-refl" />
    </div>
  );
}

export function LoginPage() {
  const setView = useUiStore((s) => s.setView);
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState(""); // login: email or username
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    api.siteStats().then(setStats).catch(() => {});
  }, []);

  const switchMode = (m: "login" | "signup") => {
    setMode(m);
    setErr("");
  };

  const quickLogin = async () => {
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      await login("captain", "captain123");
      setView("home");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test login failed");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(identifier.trim(), password);
      } else {
        await signup({ email: email.trim(), username: username.trim(), password });
      }
      setView("home");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sn snlogin">
      {/* LEFT — login */}
      <aside className="snlogin-login">
        <div className="snlogin-inner">
          <div className="snlogin-logo">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="rgba(227,178,76,0.6)" strokeWidth="1.5" />
              <circle cx="24" cy="24" r="4" fill="#e3b24c" />
              <path d="M24 5 L27 21 L24 19 L21 21 Z" fill="#e23b32" />
              <path d="M24 43 L21 27 L24 29 L27 27 Z" fill="#e8edf4" opacity=".7" />
              <path d="M5 24 L21 21 L19 24 L21 27 Z" fill="#e8edf4" opacity=".7" />
              <path d="M43 24 L27 27 L29 24 L27 21 Z" fill="#e8edf4" opacity=".7" />
              <circle cx="24" cy="24" r="1.5" fill="#fff" />
            </svg>
            <div className="snlogin-logo-text">
              <span className="snlogin-logo-name">Sailing Network</span>
              <span className="snlogin-logo-tag">One Piece TCG Platform</span>
            </div>
          </div>

          <form className="snlogin-form" onSubmit={submit}>
            {mode === "login" ? (
              <div className="snlogin-group">
                <label className="snlogin-label" htmlFor="navid">
                  Navigator ID
                </label>
                <input
                  className="snlogin-input"
                  id="navid"
                  type="text"
                  placeholder="email or username"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="snlogin-group">
                  <label className="snlogin-label" htmlFor="email">
                    Navigator ID (email)
                  </label>
                  <input
                    className="snlogin-input"
                    id="email"
                    type="email"
                    placeholder="pirate@grandline.net"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="snlogin-group">
                  <label className="snlogin-label" htmlFor="username">
                    Crew Name (username)
                  </label>
                  <input
                    className="snlogin-input"
                    id="username"
                    type="text"
                    placeholder="straw_hat_luffy"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="snlogin-group">
              <label className="snlogin-label" htmlFor="secret">
                Secret Log
              </label>
              <input
                className="snlogin-input"
                id="secret"
                type="password"
                placeholder={mode === "signup" ? "min. 8 characters" : "••••••••"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {err && <div className="snlogin-error">{err}</div>}

            <button className="snlogin-btn" type="submit" disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="rgba(255,255,255,0.2)" />
                <path d="M8 12h8M13 9l3 3-3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {busy ? "…" : mode === "login" ? "Set Sail" : "Join the Crew"}
            </button>
          </form>

          <div className="snlogin-divider">{mode === "login" ? "new here?" : "already aboard?"}</div>

          <div className="snlogin-cta">
            {mode === "login" ? (
              <>
                <button className="snlogin-glass" onClick={() => switchMode("signup")}>
                  Create an account
                </button>
                <button className="snlogin-glass highlight" onClick={quickLogin} disabled={busy}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 8a3 3 0 100-6 3 3 0 000 6zM12 8v13M5 12H2a10 10 0 0020 0h-3" />
                  </svg>
                  Enter as Test Captain
                </button>
              </>
            ) : (
              <button className="snlogin-glass" onClick={() => switchMode("login")}>
                Back to login
              </button>
            )}
          </div>

          <p className="snlogin-foot">
            {mode === "login" ? (
              <>
                No account? <a onClick={() => switchMode("signup")}>Join the crew →</a>
              </>
            ) : (
              <>
                Have an account? <a onClick={() => switchMode("login")}>Sign in →</a>
              </>
            )}
          </p>
        </div>
      </aside>

      {/* RIGHT — the real pixel-art night sea */}
      <main className="snlogin-scene">
        <NightSea />

        <div className="snlogin-scene-label">
          <span className="snlogin-livedot" />
          <span className="pill">Romance Dawn · Demo Season</span>
        </div>

        <div className="snlogin-stat" style={{ top: 60, right: 52 }}>
          <span className="val">{stats ? stats.captains.toLocaleString() : "—"}</span>
          <span className="lbl">Registered captains</span>
        </div>
        <div className="snlogin-stat" style={{ top: 132, right: 52 }}>
          <span className="val">{stats ? stats.matches.toLocaleString() : "—"}</span>
          <span className="lbl">Matches logged</span>
        </div>
      </main>
    </div>
  );
}
