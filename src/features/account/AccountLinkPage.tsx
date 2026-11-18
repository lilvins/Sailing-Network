/**
 * Where a link from an email lands: `/?reset=<token>` (choose a new password)
 * and `/?verify=<token>` (confirm the email address). No account is needed to
 * open it: the token is the proof. App.tsx reads the link and shows this page.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api } from "../../lib/api";
import { NightSea } from "../home/NightSea";
import { PixelLogoMark } from "../pixel/PixelLogo";
import "../home/home.css";
import "../login/login.css";
import "./account.css";

export function AccountLinkPage() {
  const link = useUiStore((s) => s.accountLink);
  const setView = useUiStore((s) => s.setView);
  const signedIn = useAuthStore((s) => !!s.user);
  const refresh = useAuthStore((s) => s.init);

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // the token must not stay in the address bar (history, a shared screen)
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // confirming an address needs nothing from the visitor: do it at once
  useEffect(() => {
    if (link?.kind !== "verify") return;
    let alive = true;
    api.verifyEmail(link.token)
      .then(async () => { await refresh(); if (alive) setDone("Your email address is confirmed."); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "This link could not be used"); });
    return () => { alive = false; };
  }, [link, refresh]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !link) return;
    setBusy(true);
    setError("");
    try {
      await api.resetPassword(link.token, password);
      setDone("Your password is changed. Every device was signed out: sign in with the new one.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password could not be changed");
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    useUiStore.setState({ accountLink: null });
    setView(signedIn ? "home" : "login");
  };

  return (
    <div className="sn snlogin" data-account-link={link?.kind ?? "none"}>
      <aside className="snlogin-login">
        <div className="snlogin-inner">
          <div className="snlogin-logo">
            <PixelLogoMark size={48} />
            <div className="snlogin-logo-text">
              <span className="snlogin-logo-name">Sailing Network</span>
              <span className="snlogin-logo-tag">One Piece TCG Platform</span>
            </div>
          </div>

          {!link ? (
            <p className="acl-text">This link is not complete. Open it again from the email.</p>
          ) : done ? (
            <div className="acl-ok" data-link-done>{done}</div>
          ) : link.kind === "verify" ? (
            error ? <div className="snlogin-error">{error}</div> : <p className="acl-text">Confirming your email address…</p>
          ) : (
            <form className="snlogin-form" onSubmit={submit}>
              <div className="acl-title">Choose a new password</div>
              <div className="snlogin-group">
                <label className="snlogin-label" htmlFor="newsecret">New Secret Log</label>
                <input className="snlogin-input" id="newsecret" type="password" placeholder="min. 8 characters" autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <div className="snlogin-error">{error}</div>}
              <button className="snlogin-btn" type="submit" disabled={busy || password.length < 8}>{busy ? "…" : "Set the password"}</button>
            </form>
          )}

          <div className="snlogin-cta">
            <button className="snlogin-glass" data-act="link-leave" onClick={leave}>{signedIn ? "To the Home" : "To the login"}</button>
          </div>
        </div>
      </aside>
      <main className="snlogin-scene">
        <NightSea />
      </main>
    </div>
  );
}
