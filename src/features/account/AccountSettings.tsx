/**
 * The account box of Edit Profile: is the email address confirmed, a new
 * password, the captains one blocked, and the way out (deleting the account).
 */
import { useEffect, useState } from "react";
import { useAuthStore } from "../../app/authStore";
import { useUiStore } from "../../app/uiStore";
import { api, type BlockedUser } from "../../lib/api";
import "./account.css";

type Note = { text: string; bad?: boolean } | null;
const failed = (e: unknown, fallback: string): Note => ({ text: e instanceof Error ? e.message : fallback, bad: true });

export function AccountSettings() {
  const me = useAuthStore((s) => s.user);
  const refresh = useAuthStore((s) => s.init);
  const setView = useUiStore((s) => s.setView);

  const [mailNote, setMailNote] = useState<Note>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [passNote, setPassNote] = useState<Note>(null);
  const [blocks, setBlocks] = useState<BlockedUser[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [leavePass, setLeavePass] = useState("");
  const [leaveNote, setLeaveNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.myBlocks().then((r) => setBlocks(r.blocks)).catch(() => {});
  }, []);

  if (!me) return null;

  const sendLink = async () => {
    setMailNote(null);
    try {
      const r = await api.sendVerification();
      if (r.verified) { await refresh(); return; }
      setMailNote(r.sent ? { text: `A link is on its way to ${me.email}. It works for one day.` } : { text: "This server sends no email yet, so the address cannot be confirmed for now.", bad: true });
    } catch (e) {
      setMailNote(failed(e, "The link could not be sent"));
    }
  };

  const changePassword = async () => {
    if (busy) return;
    setBusy(true);
    setPassNote(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setPassNote({ text: "Password changed. Your other devices were signed out." });
    } catch (e) {
      setPassNote(failed(e, "The password could not be changed"));
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (username: string) => {
    try {
      await api.unblock(username);
      setBlocks((list) => list.filter((b) => b.username !== username));
    } catch { /* stays in the list: try again */ }
  };

  const deleteAccount = async () => {
    if (busy) return;
    setBusy(true);
    setLeaveNote(null);
    try {
      await api.deleteAccount(leavePass);
      useAuthStore.setState({ user: null });
      setView("login");
    } catch (e) {
      setLeaveNote(failed(e, "The account could not be deleted"));
      setBusy(false);
    }
  };

  return (
    <div className="acc" data-account-settings>
      <div className="acc-sec">
        <h3>Email</h3>
        <div className="acc-line"><b>{me.email}</b> · {me.emailVerified ? "confirmed" : "not confirmed yet"}</div>
        {!me.emailVerified && <button className="acc-btn" data-act="send-verify" onClick={() => void sendLink()}>Send me the link</button>}
        {mailNote && <div className={"acc-msg" + (mailNote.bad ? " bad" : "")}>{mailNote.text}</div>}
      </div>

      <div className="acc-sec">
        <h3>Password</h3>
        <input className="acc-input" type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className="acc-input" type="password" autoComplete="new-password" placeholder="New password (min. 8 characters)" value={next} onChange={(e) => setNext(e.target.value)} />
        <button className="acc-btn" data-act="change-password" disabled={busy || !current || next.length < 8} onClick={() => void changePassword()}>Change password</button>
        {passNote && <div className={"acc-msg" + (passNote.bad ? " bad" : "")}>{passNote.text}</div>}
      </div>

      <div className="acc-sec">
        <h3>Blocked captains</h3>
        {blocks.length === 0 && <div className="acc-line">Nobody. Block a captain from their profile or from a conversation: they can no longer write to you.</div>}
        {blocks.map((b) => (
          <div className="acc-blocked" key={b.username}>
            <span>{b.displayName} <small>@{b.username}</small></span>
            <button className="acc-btn" onClick={() => void unblock(b.username)}>Unblock</button>
          </div>
        ))}
      </div>

      <div className="acc-sec">
        <h3>Delete account</h3>
        {!leaving ? (
          <button className="acc-btn danger" data-act="delete-account" onClick={() => setLeaving(true)}>Delete my account…</button>
        ) : (
          <>
            <div className="acc-line">
              This deletes your account, profile, decks, messages, chat lines and friends, for good. Other players keep their
              own record of the games they played with you, without your name.
            </div>
            <input className="acc-input" type="password" autoComplete="current-password" placeholder="Your password, to confirm" value={leavePass} onChange={(e) => setLeavePass(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="acc-btn" onClick={() => { setLeaving(false); setLeavePass(""); setLeaveNote(null); }}>Keep my account</button>
              <button className="acc-btn danger" data-act="delete-account-confirm" disabled={busy || !leavePass} onClick={() => void deleteAccount()}>Delete it for good</button>
            </div>
            {leaveNote && <div className={"acc-msg" + (leaveNote.bad ? " bad" : "")}>{leaveNote.text}</div>}
          </>
        )}
      </div>
    </div>
  );
}
