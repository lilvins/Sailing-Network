import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type SiteStats } from "../../lib/api";
import "../home/home.css"; // for the shared .sn vars/atoms
import "./login.css";

/* Ported from Claude design (Sailing Network.html) — the landing/login.
   Wired to the real backend: login + signup against /api/auth/*. */

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  speed: number;
  phase: number;
}

/** Twinkling starfield on a canvas (faithful to the design's vanilla JS). */
function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let stars: Star[] = [];
    let raf = 0;

    const initStars = () => {
      stars = Array.from({ length: 160 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * 0.72,
        r: Math.random() * 1.4 + 0.3,
        a: Math.random(),
        speed: Math.random() * 0.4 + 0.1,
        phase: Math.random() * Math.PI * 2,
      }));
    };
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      initStars();
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.001 * s.speed + s.phase));
        ctx.globalAlpha = s.a * twinkle;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="snlogin-stars" />;
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

  const particles = useMemo(
    () =>
      Array.from({ length: 18 }, () => ({
        left: 20 + Math.random() * 80,
        size: Math.random() * 3 + 1,
        bottom: 100 + Math.random() * 60,
        dur: 3 + Math.random() * 4,
        delay: Math.random() * 6,
      })),
    [],
  );

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
                  ⚓ Enter as Test Captain
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

      {/* RIGHT — animated scene */}
      <main className="snlogin-scene">
        <Starfield />

        <div className="snlogin-grand">GRAND LINE</div>

        <div className="snlogin-scene-label">
          <span className="snlogin-livedot" />
          <span className="pill">Romance Dawn · Demo Season</span>
        </div>

        <div className="snlogin-stat" style={{ top: 60, right: 52 }}>
          <span className="val">{stats ? stats.captains.toLocaleString() : "—"}</span>
          <span className="lbl">Registered captains</span>
        </div>
        <div className="snlogin-stat" style={{ top: 132, right: 52, animationDelay: "-2s" }}>
          <span className="val">{stats ? stats.matches.toLocaleString() : "—"}</span>
          <span className="lbl">Matches logged</span>
        </div>

        <div className="snlogin-hero-glow" />
        <div className="snlogin-hero-frame">
          <div className="snlogin-hero-ph">Your Captain</div>
        </div>

        <div className="snlogin-ship">
          <svg width="260" height="100" viewBox="0 0 260 100" fill="none">
            <path d="M10 72 Q130 95 250 72 L240 82 Q130 106 20 82 Z" fill="#0e1826" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <path d="M18 76 Q130 92 242 76" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <line x1="130" y1="12" x2="130" y2="72" stroke="#1c2c3e" strokeWidth="4" />
            <line x1="80" y1="28" x2="80" y2="72" stroke="#1c2c3e" strokeWidth="3" />
            <path d="M132 14 L166 42 L132 70 Z" fill="rgba(232,237,244,0.88)" />
            <path d="M128 14 L94 42 L128 70 Z" fill="rgba(232,237,244,0.72)" />
            <path d="M82 30 L106 48 L82 66 Z" fill="rgba(232,237,244,0.65)" />
            <path d="M78 30 L54 48 L78 66 Z" fill="rgba(232,237,244,0.5)" />
            <path d="M80 30 Q50 40 20 72 L80 72 Z" fill="rgba(232,237,244,0.30)" />
            <path d="M130 12 L152 4 L130 -4 Z" fill="#e23b32" />
            <circle cx="70" cy="82" r="4" fill="rgba(227,178,76,0.5)" />
            <circle cx="100" cy="86" r="4" fill="rgba(227,178,76,0.5)" />
            <circle cx="130" cy="88" r="4" fill="rgba(227,178,76,0.5)" />
            <circle cx="160" cy="86" r="4" fill="rgba(227,178,76,0.5)" />
            <circle cx="190" cy="82" r="4" fill="rgba(227,178,76,0.5)" />
          </svg>
        </div>

        <div className="snlogin-waves">
          <svg className="snlogin-wave snlogin-wave-1" viewBox="0 0 1440 120" preserveAspectRatio="none" height="120">
            <path d="M0 60 C120 20 240 100 360 60 C480 20 600 100 720 60 C840 20 960 100 1080 60 C1200 20 1320 100 1440 60 L1440 120 L0 120 Z" fill="#0c2035" />
            <path d="M1440 60 C1560 20 1680 100 1800 60 C1920 20 2040 100 2160 60 C2280 20 2400 100 2520 60 C2640 20 2760 100 2880 60 L2880 120 L1440 120 Z" fill="#0c2035" />
          </svg>
          <svg className="snlogin-wave snlogin-wave-2" viewBox="0 0 1440 100" preserveAspectRatio="none" height="100">
            <path d="M0 50 C180 10 360 90 540 50 C720 10 900 90 1080 50 C1260 10 1440 90 1440 50 L1440 100 L0 100 Z" fill="#091826" opacity="0.9" />
            <path d="M1440 50 C1620 10 1800 90 1980 50 C2160 10 2340 90 2520 50 C2700 10 2880 90 2880 50 L2880 100 L1440 100 Z" fill="#091826" opacity="0.9" />
          </svg>
          <svg className="snlogin-wave snlogin-wave-3" viewBox="0 0 1440 80" preserveAspectRatio="none" height="80">
            <path d="M0 40 C240 5 480 75 720 40 C960 5 1200 75 1440 40 L1440 80 L0 80 Z" fill="#08131f" />
            <path d="M1440 40 C1680 5 1920 75 2160 40 C2400 5 2640 75 2880 40 L2880 80 L1440 80 Z" fill="#08131f" />
          </svg>
        </div>

        <svg className="snlogin-compass" viewBox="0 0 90 90" fill="none">
          <circle cx="45" cy="45" r="42" stroke="rgba(227,178,76,0.30)" strokeWidth="1.5" />
          <circle cx="45" cy="45" r="32" stroke="rgba(227,178,76,0.16)" strokeWidth="1" />
          <g stroke="rgba(227,178,76,0.5)" strokeWidth="1.5">
            <line x1="45" y1="5" x2="45" y2="15" />
            <line x1="45" y1="75" x2="45" y2="85" />
            <line x1="5" y1="45" x2="15" y2="45" />
            <line x1="75" y1="45" x2="85" y2="45" />
          </g>
          <path d="M45 14 L49 42 L45 38 L41 42 Z" fill="#e23b32" />
          <path d="M45 76 L41 48 L45 52 L49 48 Z" fill="rgba(232,237,244,0.55)" />
          <path d="M76 45 L48 41 L52 45 L48 49 Z" fill="rgba(232,237,244,0.55)" />
          <path d="M14 45 L42 49 L38 45 L42 41 Z" fill="rgba(232,237,244,0.55)" />
          <circle cx="45" cy="45" r="4" fill="#e3b24c" />
          <circle cx="45" cy="45" r="2" fill="#fff" />
        </svg>

        {particles.map((p, i) => (
          <span
            key={i}
            className="snlogin-particle"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              bottom: p.bottom,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </main>
    </div>
  );
}
