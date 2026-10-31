import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../app/authStore";
import "@fontsource/vt323/400.css";
import "./welcome.css";

/**
 * The first-login welcome, in the manner of an RPG text box: one line at a
 * time, typed out with a soft blip per letter. Shown once per IP address
 * (the server keeps a hash of the addresses that have seen it, see
 * server/welcome.mjs); this browser also remembers it, to skip the request.
 * Z / Enter / Space / click: finish the line, then the next one. Esc: skip.
 */
const PAGES = [
  "* Hi, pirate!",
  "* I'm Vins, a game design student.",
  "* Inspired by the legendary Dueling Network, I'm trying to build a place like it for the One Piece TCG...",
  "* ...mostly because I wanted to be one of its users.",
  "* Remember: this is a beta. Every bit of feedback is appreciated!",
];

/** ms per letter, and the longer beat after punctuation */
const TYPE_MS = 34;
const PAUSE_MS = 220;
const SEEN_KEY = "sn-welcome-seen";

function seenHere(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
/** Has this IP already seen it? On any error: yes (never nag twice). */
async function seenByIp(): Promise<boolean> {
  try {
    const r = await fetch("/api/welcome", { credentials: "include" });
    return r.ok ? ((await r.json()) as { seen: boolean }).seen : true;
  } catch { return true; }
}
function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: the server still knows */ }
  void fetch("/api/welcome/seen", { method: "POST", credentials: "include" }).catch(() => {});
}

/** A short square-wave blip, the RPG "voice" (quiet; muted with the ♪ button). */
function useBlip(muted: boolean) {
  const ctx = useRef<AudioContext | null>(null);
  return useCallback(() => {
    if (muted) return;
    try {
      ctx.current ??= new AudioContext();
      const ac = ctx.current;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "square";
      osc.frequency.value = 520 + Math.random() * 40;
      gain.gain.setValueAtTime(0.035, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.05);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.05);
    } catch { /* no audio: silent text */ }
  }, [muted]);
}

export function WelcomeDialog() {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [shown, setShown] = useState(0); // letters of the current page on screen
  const [muted, setMuted] = useState(false);
  const blip = useBlip(muted);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!user || seenHere()) { setOpen(false); return; }
    let alive = true;
    void seenByIp().then((seen) => {
      if (!alive) return;
      if (seen) { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* no storage */ } return; }
      setOpen(true); setPage(0); setShown(0);
    });
    return () => { alive = false; };
  }, [user]);

  const text = PAGES[page] ?? "";
  const done = shown >= text.length;

  // type the current line out, a letter at a time
  useEffect(() => {
    if (!open) return;
    if (reduce) { setShown(text.length); return; }
    if (done) return;
    const ch = text[shown - 1];
    const wait = ch && ".,!?".includes(ch) ? PAUSE_MS : TYPE_MS;
    const t = window.setTimeout(() => {
      setShown((n) => n + 1);
      if (text[shown] && text[shown] !== " " && shown % 2 === 0) blip();
    }, wait);
    return () => window.clearTimeout(t);
  }, [open, shown, text, done, reduce, blip]);

  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  const advance = useCallback(() => {
    if (!done) { setShown(text.length); return; }
    if (page + 1 < PAGES.length) { setPage(page + 1); setShown(0); }
    else close();
  }, [done, text, page, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "z" || e.key === "Z" || e.key === "Enter" || e.key === " ") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, advance, close]);

  if (!open) return null;
  return (
    <div className="wl-veil" data-welcome onClick={advance}>
      <div className="wl-box" role="dialog" aria-label="Welcome" aria-live="polite">
        <img className="wl-face" src="/assets/bg/fx/ship.png" alt="" />
        <p className="wl-text">
          {text.slice(0, shown)}
          <span className="wl-ghost">{text.slice(shown)}</span>
        </p>
        {done && <span className="wl-next" aria-hidden>{page + 1 < PAGES.length ? "▼" : "■"}</span>}
        <div className="wl-tools" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setMuted(!muted)} title={muted ? "Sound on" : "Sound off"}>{muted ? "♪̸" : "♪"}</button>
          <button type="button" onClick={close} title="Skip (Esc)">Skip</button>
        </div>
        <span className="wl-hint">[Z] / click</span>
      </div>
    </div>
  );
}
