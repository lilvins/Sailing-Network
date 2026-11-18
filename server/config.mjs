// config.mjs — everything the server reads from the environment, read once
// and checked at start. In production a missing or weak setting stops the
// server with a message, instead of running with a development default.
// The variables are listed in ../.env.example.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_COOKIE_SECRET = "dev-insecure-secret-change-me";
const MIN_SECRET_LENGTH = 32;

/** "https://a.com, https://b.com" → ["https://a.com", "https://b.com"]. Origins are compared exactly as written. */
function listOf(value) {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** TRUST_PROXY → Fastify's trustProxy: unset = false, "true", a number of hops, or a list of proxy addresses. */
function trustProxyOf(value) {
  if (!value || value === "false" || value === "0") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

/** Reads the configuration from `env`. Throws with every problem found, so one start shows them all. */
export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === "production";
  const problems = [];

  // SN_API_PORT wins; PORT only in production (hosts set it). In dev, tools that
  // launch `npm run dev` set PORT for the Vite port, and the API must not take it.
  const port = Number(env.SN_API_PORT || (isProd && env.PORT) || 8787);

  // In dev only this computer reaches the API (Vite proxies to it). In production
  // the server is the site, so it must answer on every network interface.
  const host = env.SN_HOST || (isProd ? "0.0.0.0" : "127.0.0.1");

  const cookieSecret = env.COOKIE_SECRET || (isProd ? "" : DEV_COOKIE_SECRET);
  if (isProd && (cookieSecret.length < MIN_SECRET_LENGTH || cookieSecret === DEV_COOKIE_SECRET)) {
    problems.push(`COOKIE_SECRET must be set to a random string of at least ${MIN_SECRET_LENGTH} characters (node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").`);
  }

  // Which other sites may call the API with the session cookie. In production the
  // server serves the site itself (same origin), so the default is nobody.
  const allowed = listOf(env.CORS_ORIGINS);
  const corsOrigin = allowed.length > 0 ? allowed : !isProd; // dev: reflect the Vite origin

  // The built site (npm run build). SN_STATIC_DIR=off: API only, the site is hosted elsewhere.
  let staticDir = null;
  if (env.SN_STATIC_DIR !== "off" && (isProd || env.SN_STATIC_DIR)) {
    staticDir = resolve(ROOT, env.SN_STATIC_DIR || "dist");
    if (!existsSync(join(staticDir, "index.html"))) {
      problems.push(`No built site in ${staticDir}: run "npm run build" first, or set SN_STATIC_DIR=off to serve the API only.`);
    }
  }

  // Card images kept outside the build (a mounted disk): served as /cards/<file>.
  let cardsDir = null;
  if (env.SN_CARDS_DIR) {
    cardsDir = resolve(ROOT, env.SN_CARDS_DIR);
    if (!existsSync(cardsDir)) problems.push(`SN_CARDS_DIR does not exist: ${cardsDir}`);
  }

  // API requests one visitor may make in a minute, over the routes with no limit of
  // their own. 0 = no such limit: the default in dev, where the tests and the bot
  // ladder all come from this computer.
  const rateLimit = Number(env.SN_RATE_LIMIT ?? (isProd ? 900 : 0));
  if (!Number.isInteger(rateLimit) || rateLimit < 0) problems.push(`SN_RATE_LIMIT must be a whole number, 0 or more: ${env.SN_RATE_LIMIT}`);

  // Ranked: closed until SN_RANKED=open in production (the beta may run without it);
  // open in dev. A player who stops asking for their ranked table for
  // SN_RANKED_GONE_MS has left it, and loses.
  const ranked = env.SN_RANKED ?? (isProd ? "closed" : "open");
  if (ranked !== "open" && ranked !== "closed") problems.push(`SN_RANKED must be "open" or "closed": ${ranked}`);
  const rankedGoneMs = Number(env.SN_RANKED_GONE_MS ?? 120000);
  if (!Number.isInteger(rankedGoneMs) || rankedGoneMs < 1000) problems.push(`SN_RANKED_GONE_MS must be a whole number of milliseconds, 1000 or more: ${env.SN_RANKED_GONE_MS}`);

  // Who runs the site and how to reach them: shown on the Privacy and Terms pages.
  const operator = (env.SN_OPERATOR ?? "").trim();
  const contactEmail = (env.SN_CONTACT_EMAIL ?? "").trim();

  // Email (password reset, address check). Sent through Resend's HTTP API when
  // RESEND_API_KEY and SN_MAIL_FROM are set; with neither, no mail goes out and an
  // admin hands out reset links. SN_MAIL_OUTBOX (never in production) writes each
  // mail to a file instead of sending it: the tests read their links there.
  const mail = { from: (env.SN_MAIL_FROM ?? "").trim(), resendKey: (env.RESEND_API_KEY ?? "").trim(), outbox: (env.SN_MAIL_OUTBOX ?? "").trim() };
  if (!!mail.from !== !!mail.resendKey) problems.push("SN_MAIL_FROM and RESEND_API_KEY go together: set both, or neither.");
  if (isProd && mail.outbox) problems.push("SN_MAIL_OUTBOX is for development and tests only.");
  // The site's own address, for the links inside emails. Never taken from a request
  // in production: a forged Host header would put someone else's site in the mail.
  const publicUrl = (env.SN_PUBLIC_URL ?? (isProd ? "" : "http://localhost:5173")).replace(/\/+$/, "");
  if (isProd && mail.resendKey && !/^https:\/\//.test(publicUrl)) problems.push("SN_PUBLIC_URL must be the site's https address when email is on (the links in the mails use it).");

  if (problems.length > 0) throw new Error(`Configuration:\n- ${problems.join("\n- ")}`);
  return { isProd, port, host, cookieSecret, corsOrigin, trustProxy: trustProxyOf(env.TRUST_PROXY), staticDir, cardsDir, rateLimit, rankedOpen: ranked === "open", rankedGoneMs, operator, contactEmail, mail, publicUrl };
}
