// static.mjs — serves the built site (dist) from the API server, so one
// process is the whole product in production. In dev Vite does this job.
//
// Any GET that is not an API route lands here: a file of the build is sent as
// it is; an address with no file behind it (a page of the app) gets index.html
// and the app shows the right page; a missing file with an extension is a 404
// (a missing image must not come back as an HTML page).

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json",
};

const YEAR = 60 * 60 * 24 * 365;
const WEEK = 60 * 60 * 24 * 7;

/** How long a browser may keep a file without asking again. */
function cacheControl(urlPath) {
  if (urlPath.startsWith("/assets/")) return `public, max-age=${YEAR}, immutable`; // Vite puts a content hash in the name
  if (urlPath.startsWith("/cards/")) return `public, max-age=${WEEK}`;
  if (urlPath.endsWith(".html")) return "no-cache"; // index.html names the current assets: always fresh
  return "public, max-age=3600";
}

/** The file `urlPath` names inside `root`, or null if the address tries to leave it. */
function fileIn(root, urlPath) {
  const full = resolve(root, `.${urlPath}`);
  return full === root || full.startsWith(root + sep) ? full : null;
}

async function fileStat(path) {
  try {
    const s = await stat(path);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/**
 * Registers the site on `app`. `dir` is the build folder; `cardsDir`, when
 * given, is where /cards/<file> is read from instead of dir/cards.
 */
export function registerStatic(app, { dir, cardsDir }) {
  const root = resolve(dir);
  const cardsRoot = cardsDir ? resolve(cardsDir) : null;

  async function send(reply, req, path, s, urlPath) {
    const modified = s.mtime.toUTCString();
    reply.header("cache-control", cacheControl(urlPath));
    reply.header("last-modified", modified);
    reply.header("x-content-type-options", "nosniff");
    if (req.headers["if-modified-since"] === modified) return reply.code(304).send();
    reply.type(TYPES[extname(path).toLowerCase()] ?? "application/octet-stream");
    reply.header("content-length", s.size);
    if (req.method === "HEAD") return reply.send();
    return reply.send(createReadStream(path));
  }

  app.setNotFoundHandler(async (req, reply) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split("?")[0]);
    } catch {
      return reply.code(400).send({ error: "Bad request" });
    }
    const isApi = urlPath === "/api" || urlPath.startsWith("/api/");
    if (isApi || (req.method !== "GET" && req.method !== "HEAD") || urlPath.includes("\0")) {
      return reply.code(404).send({ error: "Not found" });
    }

    // /cards/<file> from the separate images folder, when there is one
    const fromCards = cardsRoot && urlPath.startsWith("/cards/") ? fileIn(cardsRoot, urlPath.slice("/cards".length)) : null;
    const path = fromCards ?? fileIn(root, urlPath);
    if (!path) return reply.code(404).send({ error: "Not found" });

    const s = await fileStat(path);
    if (s) return send(reply, req, path, s, urlPath);
    // a card image may still be in the build even with a separate folder (the 4 card backs)
    if (fromCards) {
      const inBuild = fileIn(root, urlPath);
      const sb = inBuild ? await fileStat(inBuild) : null;
      if (sb) return send(reply, req, inBuild, sb, urlPath);
    }
    if (extname(urlPath) !== "") return reply.code(404).send({ error: "Not found" });

    // a page of the app: the app itself reads the address
    const index = join(root, "index.html");
    const si = await fileStat(index);
    if (!si) return reply.code(404).send({ error: "Not found" });
    return send(reply, req, index, si, "/index.html");
  });
}
