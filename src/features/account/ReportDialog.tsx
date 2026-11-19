/**
 * Telling the admins about a player: who, about what, and why.
 * The words the report is about are copied on the server from the message
 * itself (`messageId`), so a reporter cannot change them.
 */
import { useState } from "react";
import { api, type ReportKind } from "../../lib/api";
import "./account.css";

export interface ReportTarget {
  username: string;
  displayName: string;
  kind: ReportKind;
  /** The message reported, for a chat line or a private message. */
  messageId?: string;
  /** Shown in the window, so the reporter sees what they are sending. */
  quote?: string;
}

export function ReportDialog({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (busy || reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      await api.report({ username: target.username, kind: target.kind, reason: reason.trim(), messageId: target.messageId });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report could not be sent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rep-veil" role="dialog" aria-modal="true" aria-label={`Report ${target.displayName}`} data-report-dialog>
      <div className="rep">
        <h3>Report {target.displayName}</h3>
        {target.quote && <div className="rep-quote">{target.quote}</div>}
        {sent ? (
          <>
            <p className="acc-msg">Sent. The admins will read it. You can also block this captain so they cannot write to you.</p>
            <div className="rep-btns"><button className="acc-btn" data-act="report-close" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <>
            <textarea className="acc-input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)}
              placeholder="What happened? The admins read this." autoFocus />
            {error && <p className="acc-msg bad" role="alert">{error}</p>}
            <div className="rep-btns">
              <button className="acc-btn" onClick={onClose}>Cancel</button>
              <button className="acc-btn danger" data-act="report-send" disabled={busy || reason.trim().length < 3} onClick={() => void send()}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
