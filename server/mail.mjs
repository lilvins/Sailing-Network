// mail.mjs — the few emails the site sends: a link to set a new password, a
// link to prove an email address is one's own.
//
// Sent through Resend's HTTP API (no dependency: one fetch) when the server has
// RESEND_API_KEY and SN_MAIL_FROM. Without them nothing is sent: `configured`
// is false, the pages say so, and an admin can hand out a reset link instead.
// With SN_MAIL_OUTBOX (development and tests) each mail is written to that
// file, one JSON object per line, instead of being sent.

import { appendFileSync } from "node:fs";

export function makeMailer({ from, resendKey, outbox }) {
  const configured = !!(outbox || (from && resendKey));

  /** Sends one mail. True when it left (or was written to the outbox). Never throws. */
  async function send({ to, subject, text }) {
    if (outbox) {
      appendFileSync(outbox, JSON.stringify({ to, subject, text }) + "\n");
      return true;
    }
    if (!configured) return false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!res.ok) console.error(`[mail] not sent (${res.status}): ${subject}`);
      return res.ok;
    } catch (err) {
      console.error(`[mail] not sent: ${err.message}`);
      return false;
    }
  }

  return { configured, send };
}
