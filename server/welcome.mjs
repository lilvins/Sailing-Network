// The first-visit welcome (src/features/welcome) is shown once per IP:
// the client asks whether this address has seen it and says when it has.
// Only a one-way hash of the address is stored, never the address itself.
import { createHash } from "node:crypto";
import { get, run } from "./db.mjs";

/** The visitor's address: Cloudflare's header when it comes through the
 *  public tunnel, else the forwarded / socket address (local and LAN visits
 *  arrive through the Vite proxy, so they share one address). */
function visitorIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(cf) ? cf[0] : cf) || (typeof fwd === "string" ? fwd.split(",")[0].trim() : "") || req.ip || "";
  return createHash("sha256").update(`sn-welcome:${ip}`).digest("hex");
}

export async function registerWelcome(app) {
  await run(`CREATE TABLE IF NOT EXISTS welcome_seen (ip_hash TEXT PRIMARY KEY, seen_at INTEGER NOT NULL)`);

  app.get("/api/welcome", async (req) => {
    const row = await get(`SELECT 1 FROM welcome_seen WHERE ip_hash = ?`, [visitorIp(req)]);
    return { seen: !!row };
  });

  app.post("/api/welcome/seen", async (req) => {
    await run(`INSERT OR IGNORE INTO welcome_seen (ip_hash, seen_at) VALUES (?, ?)`, [visitorIp(req), Date.now()]);
    return { ok: true };
  });
}
