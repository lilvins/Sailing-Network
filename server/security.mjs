// security.mjs — the headers every answer of the server carries, and the
// shape of a route's own rate limit.
//
// The page is the built site, served from this same origin: scripts, styles,
// fonts, workers and API calls all come from here, card images too (/cards and
// /api/card-art). So the content policy allows this origin and nothing else.
// 'unsafe-inline' is for styles only: React writes style attributes.

const CONTENT_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const HALF_YEAR = 60 * 60 * 24 * 180;

/** The headers, as [name, value] pairs. `isProd`: also tell browsers to keep to https. */
export function securityHeaders({ isProd }) {
  return [
    ["content-security-policy", CONTENT_POLICY],
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["cross-origin-opener-policy", "same-origin"],
    ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()"],
    ...(isProd ? [["strict-transport-security", `max-age=${HALF_YEAR}`]] : []),
  ];
}

/** Every answer gets them: API, files of the site, errors and 404s. */
export function registerSecurityHeaders(app, { isProd }) {
  const headers = securityHeaders({ isProd });
  app.addHook("onRequest", async (_req, reply) => {
    for (const [name, value] of headers) reply.header(name, value);
  });
}

/** A route's own limit, per visitor: `app.post(path, limit(30, "1 minute"), handler)`. */
export const limit = (max, timeWindow) => ({ config: { rateLimit: { max, timeWindow } } });
