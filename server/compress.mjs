// compress.mjs — answers are sent compressed to the browsers that ask for it.
//
// Text shrinks a lot: the main script goes from 2.5 MB to about a seventh, the
// card catalog from 1.6 MB to about a tenth. Images, fonts and sounds are
// already compressed and are sent as they are.
//
// Two places use this: the hook below, for what the API answers (built again
// at every request, so compressed quickly), and static.mjs, for the files of
// the site (they never change, so each is compressed once, well, and kept).

import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

const TEXT = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg\+xml)/;
/** Under this size the headers cost more than what compressing saves. */
const MIN_BYTES = 1024;

/** Can a body of this content type shrink? */
export const compressible = (type) => TEXT.test(String(type ?? ""));

/** The encoding to answer with, from the request's Accept-Encoding: "br", "gzip" or null. */
export function pickEncoding(header) {
  const accepted = new Set();
  for (const part of String(header ?? "").toLowerCase().split(",")) {
    const [name, ...params] = part.trim().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (name && !(q && Number(q.slice(2)) === 0)) accepted.add(name.trim());
  }
  return accepted.has("br") ? "br" : accepted.has("gzip") ? "gzip" : null;
}

/** `body` (text or bytes) compressed. `best`: take the time to make it as small as it gets. */
export function pack(body, encoding, best = false) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (encoding === "br") {
    return brotli(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: best ? 10 : 4, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } });
  }
  return gz(bytes, { level: best ? 9 : 6 });
}

/** Compresses what the routes answer (text or bytes; a file being read is left to static.mjs). */
export function registerCompression(app) {
  app.addHook("onSend", async (req, reply, payload) => {
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;
    if (reply.hasHeader("content-encoding") || !compressible(reply.getHeader("content-type"))) return payload;
    if (Buffer.byteLength(payload) < MIN_BYTES) return payload;
    reply.header("vary", "accept-encoding");
    const encoding = pickEncoding(req.headers["accept-encoding"]);
    if (!encoding) return payload;
    const packed = await pack(payload, encoding);
    reply.header("content-encoding", encoding);
    reply.header("content-length", packed.length);
    return packed;
  });
}

export { MIN_BYTES };
