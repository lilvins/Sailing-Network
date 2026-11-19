import { useEffect, useState, type FormEvent } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type SiteStats } from "../../lib/api";
import "../home/home.css"; // for the shared .sn vars/atoms
import "./login.css";
import "../account/account.css";

/* The landing/login — the right side is the REAL "Moon and Sea" pixel art
   (public/assets/bg/night-sea, CraftPix via OpenGameArt, OGA-BY 3.0): the
   shared living NightSea scene. Wired to the real backend. */
import { NightSea } from "../home/NightSea";
import { PixelIcon } from "../pixel/PixelIcon";
import { PixelLogoMark } from "../pixel/PixelLogo";

export function LoginPage() {
  const setView = useUiStore((s) => s.setView);
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);

  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [notice, setNotice] = useState("");
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

  const switchMode = (m: "login" | "signup" | "forgot") => {
    setMode(m);
    setErr("");
    setNotice("");
  };

  // dev only: the production build must not contain this password
  const quickLogin = import.meta.env.DEV
    ? async () => {
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
      }
    : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      if (mode === "forgot") {
        const { mail } = await api.forgotPassword(identifier.trim());
        setNotice(mail
          ? "If that account exists, a link to choose a new password is on its way to its email address. It works for one hour."
          : "This server sends no email yet. Ask an admin for a link to choose a new password.");
        return;
      }
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
            <PixelLogoMark size={48} />
            <div className="snlogin-logo-text">
              <span className="snlogin-logo-name">Sailing Network</span>
              <span className="snlogin-logo-tag">One Piece TCG Platform</span>
            </div>
          </div>

          <form className="snlogin-form" onSubmit={submit}>
            {mode !== "signup" ? (
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
            {mode !== "forgot" && <div className="snlogin-group">
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
            </div>}
            {mode === "login" && (
              <button type="button" className="snlogin-forgot" data-act="forgot" onClick={() => switchMode("forgot")}>Forgot your password?</button>
            )}
            {mode === "signup" && (
              <p className="snlogin-consent">
                By joining you accept the <a onClick={() => setView("terms")}>Terms</a> and the <a onClick={() => setView("privacy")}>Privacy</a> page.
              </p>
            )}
            {notice && <div className="acl-ok" data-forgot-notice>{notice}</div>}

            {err && <div className="snlogin-error">{err}</div>}

            <button className="snlogin-btn" type="submit" disabled={busy}>
              <PixelIcon name="arrow" size={12} />
              {busy ? "…" : mode === "login" ? "Set Sail" : mode === "signup" ? "Join the Crew" : "Send me a link"}
            </button>
          </form>

          <div className="snlogin-divider">{mode === "login" ? "new here?" : mode === "signup" ? "already aboard?" : "remembered it?"}</div>

          <div className="snlogin-cta">
            {mode === "login" ? (
              <>
                <button className="snlogin-glass" onClick={() => switchMode("signup")}>
                  Create an account
                </button>
                {quickLogin && (
                  <button className="snlogin-glass highlight" onClick={quickLogin} disabled={busy}>
                    <PixelIcon name="anchor" size={12} />
                    Enter as Test Captain
                  </button>
                )}
              </>
            ) : (
              <button className="snlogin-glass" onClick={() => switchMode("login")}>
                Back to login
              </button>
            )}
          </div>

          <p className="snlogin-foot">
            {mode !== "signup" ? (
              <>
                No account? <a onClick={() => switchMode("signup")}>Join the crew →</a>
              </>
            ) : (
              <>
                Have an account? <a onClick={() => switchMode("login")}>Sign in →</a>
              </>
            )}
          </p>
          <div className="snlogin-links">
            <a data-act="privacy" onClick={() => setView("privacy")}>Privacy</a>
            <a data-act="terms" onClick={() => setView("terms")}>Terms</a>
          </div>
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
        {/* OGA-BY 3.0: the art's credit where people see it */}
        <span className="snlogin-credit">Night sky: <a href="https://opengameart.org/content/moon-and-sea-pixel-art-background" target="_blank" rel="noopener noreferrer">“Moon and Sea”</a> by CraftPix.net (OGA-BY 3.0)</span>
      </main>
    </div>
  );
}
