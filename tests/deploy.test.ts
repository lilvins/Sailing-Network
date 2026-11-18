// What production relies on: the settings check (config.mjs) and the site
// served by the API (static.mjs). Run with the unit tests (npm run test:unit).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../server/config.mjs";
import rateLimit from "@fastify/rate-limit";
import { registerStatic } from "../server/static.mjs";
import { limit, registerSecurityHeaders } from "../server/security.mjs";
import { pickEncoding, registerCompression } from "../server/compress.mjs";
import { buildEngine } from "../server/engineBuild.mjs";
import { cardFaceSvg, wrap } from "../server/cardFace.mjs";

const SECRET = "x".repeat(40);
const site = mkdtempSync(join(tmpdir(), "sn-site-"));
const cards = mkdtempSync(join(tmpdir(), "sn-cards-"));
mkdirSync(join(site, "assets"));
mkdirSync(join(site, "cards"));
writeFileSync(join(site, "index.html"), "<!doctype html><title>site</title>");
writeFileSync(join(site, "assets", "app-abc123.js"), "console.log(1)");
const BIG_SCRIPT = "console.log('a line of the site');\n".repeat(400);
writeFileSync(join(site, "assets", "big-abc123.js"), BIG_SCRIPT);
writeFileSync(join(site, "assets", "art-abc123.png"), Buffer.alloc(5000, 7));
writeFileSync(join(site, "cards", "BACK.webp"), "back");
writeFileSync(join(cards, "OP01-001.webp"), "card");
writeFileSync(join(site, "..", "sn-outside.txt"), "outside the site");
afterAll(() => {
  rmSync(site, { recursive: true, force: true });
  rmSync(cards, { recursive: true, force: true });
  rmSync(join(site, "..", "sn-outside.txt"), { force: true });
});

describe("server settings (config.mjs)", () => {
  it("development needs nothing and stays on this computer", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ isProd: false, port: 8787, host: "127.0.0.1", corsOrigin: true, trustProxy: false, staticDir: null });
    expect(loadConfig({ PORT: "5173" }).port).toBe(8787); // PORT is Vite's in dev
  });

  it("production refuses to start without a real COOKIE_SECRET", () => {
    const prod = { NODE_ENV: "production", SN_STATIC_DIR: "off" };
    expect(() => loadConfig(prod)).toThrow(/COOKIE_SECRET/);
    expect(() => loadConfig({ ...prod, COOKIE_SECRET: "short" })).toThrow(/COOKIE_SECRET/);
    expect(() => loadConfig({ ...prod, COOKIE_SECRET: "dev-insecure-secret-change-me" })).toThrow(/COOKIE_SECRET/);
    expect(loadConfig({ ...prod, COOKIE_SECRET: SECRET }).cookieSecret).toBe(SECRET);
  });

  it("production listens on every interface, follows PORT, and allows no other origin by default", () => {
    const c = loadConfig({ NODE_ENV: "production", COOKIE_SECRET: SECRET, SN_STATIC_DIR: "off", PORT: "10000" });
    expect(c).toMatchObject({ host: "0.0.0.0", port: 10000, corsOrigin: false, staticDir: null });
    const listed = loadConfig({ NODE_ENV: "production", COOKIE_SECRET: SECRET, SN_STATIC_DIR: "off", CORS_ORIGINS: "https://a.example, https://b.example" });
    expect(listed.corsOrigin).toEqual(["https://a.example", "https://b.example"]);
  });

  it("production needs the built site unless SN_STATIC_DIR=off", () => {
    const prod = { NODE_ENV: "production", COOKIE_SECRET: SECRET };
    expect(() => loadConfig({ ...prod, SN_STATIC_DIR: join(site, "missing") })).toThrow(/npm run build/);
    expect(loadConfig({ ...prod, SN_STATIC_DIR: site }).staticDir).toBe(site);
    expect(() => loadConfig({ ...prod, SN_STATIC_DIR: site, SN_CARDS_DIR: join(cards, "missing") })).toThrow(/SN_CARDS_DIR/);
  });

  it("SN_RATE_LIMIT: 900 a minute in production, none in development, or the number given", () => {
    const prod = { NODE_ENV: "production", COOKIE_SECRET: SECRET, SN_STATIC_DIR: "off" };
    expect([loadConfig({}).rateLimit, loadConfig(prod).rateLimit, loadConfig({ ...prod, SN_RATE_LIMIT: "0" }).rateLimit, loadConfig({ SN_RATE_LIMIT: "50" }).rateLimit]).toEqual([0, 900, 0, 50]);
    expect(() => loadConfig({ SN_RATE_LIMIT: "many" })).toThrow(/SN_RATE_LIMIT/);
  });

  it("SN_RANKED: closed in production until it says open, open in development", () => {
    const prod = { NODE_ENV: "production", COOKIE_SECRET: SECRET, SN_STATIC_DIR: "off" };
    expect([loadConfig(prod).rankedOpen, loadConfig({ ...prod, SN_RANKED: "open" }).rankedOpen, loadConfig({}).rankedOpen, loadConfig({ SN_RANKED: "closed" }).rankedOpen])
      .toEqual([false, true, true, false]);
    expect(() => loadConfig({ SN_RANKED: "yes" })).toThrow(/SN_RANKED/);
    expect(loadConfig({}).rankedGoneMs).toBe(120000);
    expect(() => loadConfig({ SN_RANKED_GONE_MS: "5" })).toThrow(/SN_RANKED_GONE_MS/);
  });

  it("TRUST_PROXY: off, on, a number of proxies, or their addresses", () => {
    const of = (v) => loadConfig({ TRUST_PROXY: v }).trustProxy;
    expect([of(undefined), of("false"), of("true"), of("1"), of("10.0.0.0/8")]).toEqual([false, false, true, 1, "10.0.0.0/8"]);
  });
});

describe("a card drawn with its text (cardFace.mjs)", () => {
  it("wraps at spaces and keeps the card's own line breaks", () => {
    expect(wrap("Draw 1 card and trash 1 card", 12)).toEqual(["Draw 1 card", "and trash 1", "card"]);
    expect(wrap("[On Play] A\n[Trigger] B", 40)).toEqual(["[On Play] A", "[Trigger] B"]);
  });
});

describe("the site served by the API (static.mjs)", () => {
  const app = Fastify();
  app.get("/api/health", async () => ({ ok: true }));
  registerStatic(app, { dir: site, cardsDir: cards });
  const get = (url, headers) => app.inject({ method: "GET", url, headers });

  it("serves the files of the build with the right type and cache", async () => {
    const index = await get("/");
    expect(index.statusCode).toBe(200);
    expect(index.headers["content-type"]).toMatch(/text\/html/);
    expect(index.headers["cache-control"]).toBe("no-cache");
    const asset = await get("/assets/app-abc123.js");
    expect(asset.headers["content-type"]).toMatch(/javascript/);
    expect(asset.headers["cache-control"]).toMatch(/immutable/);
    const again = await get("/assets/app-abc123.js", { "if-modified-since": asset.headers["last-modified"] });
    expect(again.statusCode).toBe(304);
  });

  it("an address of the app gets index.html, a missing file is a 404", async () => {
    const page = await get("/duel-room/42?x=1");
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<title>site</title>");
    expect((await get("/cards/NOPE-999.webp")).statusCode).toBe(404);
    expect((await get("/assets/old-hash.js")).statusCode).toBe(404);
  });

  it("card images come from the separate folder, then from the build", async () => {
    expect((await get("/cards/OP01-001.webp")).body).toBe("card");
    expect((await get("/cards/BACK.webp")).body).toBe("back");
  });

  it("API routes are untouched: unknown ones stay JSON 404, POST never gets the page", async () => {
    expect((await get("/api/health")).json()).toEqual({ ok: true });
    const unknown = await get("/api/nope");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "Not found" });
    expect((await app.inject({ method: "POST", url: "/duel-room" })).statusCode).toBe(404);
  });

  it("a known card with no picture yet is drawn with its text; an unknown one stays 404", async () => {
    const faces = Fastify();
    const karoo = { id: "OP18-001", name: "Karoo", category: "Leader", colors: '["Red","Blue"]', cost: 4, power: 5000, counter: null,
      types: '["Animal","Alabasta"]', effect: "All of your Characters gain [Rush] & +1000 power.", trigger: null };
    registerStatic(faces, { dir: site, cardsDir: cards, cardFace: async (id) => (id === "OP18-001" ? cardFaceSvg(karoo) : null) });
    const res = await faces.inject({ method: "GET", url: "/cards/OP18-001.webp" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/svg\+xml/);
    expect(res.body).toContain("Karoo");
    expect(res.body).toContain("Life 4 · 5000 power");
    expect(res.body).toContain("[Rush] &amp;"); // escaped for SVG
    expect(res.body).not.toContain(" & ");
    expect((await faces.inject({ method: "GET", url: "/cards/OP18-999.webp" })).statusCode).toBe(404);
    expect((await faces.inject({ method: "GET", url: "/cards/OP01-001.webp" })).body).toBe("card"); // a real file wins
  });

  it("no address reaches a file outside the site", async () => {
    for (const url of ["/../sn-outside.txt", "/..%2fsn-outside.txt", "/..%5csn-outside.txt", "/cards/..%2f..%2fsn-outside.txt", "/%2e%2e/sn-outside.txt"]) {
      const res = await get(url);
      expect(res.body, url).not.toContain("outside the site");
      expect(res.statusCode, url).not.toBe(200);
    }
  });
});

describe("what protects the server (security.mjs)", () => {
  it("every answer carries the headers: the page, an API route, a 404", async () => {
    const app = Fastify();
    registerSecurityHeaders(app, { isProd: true });
    app.get("/api/health", async () => ({ ok: true }));
    registerStatic(app, { dir: site, cardsDir: cards });
    for (const url of ["/", "/api/health", "/api/nowhere", "/missing.png"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.headers["content-security-policy"], url).toMatch(/default-src 'self'.*frame-ancestors 'none'/);
      expect(res.headers["x-frame-options"], url).toBe("DENY");
      expect(res.headers["x-content-type-options"], url).toBe("nosniff");
      expect(res.headers["strict-transport-security"], url).toMatch(/max-age=\d+/);
    }
    const dev = Fastify();
    registerSecurityHeaders(dev, { isProd: false });
    dev.get("/api/health", async () => ({ ok: true }));
    expect((await dev.inject({ method: "GET", url: "/api/health" })).headers["strict-transport-security"]).toBeUndefined(); // http in dev
  });

  it("the limit for everyone counts API routes together, a route's own limit apart, and never the site's files", async () => {
    const app = Fastify();
    await app.register(rateLimit, { global: true, max: 3, timeWindow: "1 minute" });
    app.get("/api/a", async () => ({ ok: true }));
    app.get("/api/b", async () => ({ ok: true }));
    app.get("/api/own", limit(2, "1 minute"), async () => ({ ok: true }));
    registerStatic(app, { dir: site, cardsDir: cards });
    const status = async (url) => (await app.inject({ method: "GET", url })).statusCode;
    expect([await status("/api/a"), await status("/api/b"), await status("/api/a"), await status("/api/b")]).toEqual([200, 200, 200, 429]);
    expect([await status("/api/own"), await status("/api/own"), await status("/api/own")]).toEqual([200, 200, 429]);
    for (let i = 0; i < 10; i++) expect(await status("/assets/app-abc123.js")).toBe(200);
  });
});

describe("answers are sent compressed (compress.mjs)", () => {
  it("the browser's Accept-Encoding picks brotli, then gzip, then nothing", () => {
    expect([pickEncoding("gzip, deflate, br"), pickEncoding("gzip, deflate"), pickEncoding("br;q=0, gzip"), pickEncoding("identity"), pickEncoding(undefined)])
      .toEqual(["br", "gzip", "gzip", null, null]);
  });

  it("a script of the site travels compressed and unpacks to the same file", async () => {
    const app = Fastify();
    registerStatic(app, { dir: site, cardsDir: cards });
    const get = (url, encoding) => app.inject({ method: "GET", url, headers: encoding ? { "accept-encoding": encoding } : {} });

    const br = await get("/assets/big-abc123.js", "gzip, br");
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers.vary).toBe("accept-encoding");
    expect(br.rawPayload.length).toBeLessThan(BIG_SCRIPT.length / 10);
    expect(Number(br.headers["content-length"])).toBe(br.rawPayload.length);
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(BIG_SCRIPT);

    const gz = await get("/assets/big-abc123.js", "gzip");
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gz.rawPayload).toString()).toBe(BIG_SCRIPT);

    const plain = await get("/assets/big-abc123.js");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body).toBe(BIG_SCRIPT);
  });

  it("a small file and an image are sent as they are", async () => {
    const app = Fastify();
    registerStatic(app, { dir: site, cardsDir: cards });
    const get = (url) => app.inject({ method: "GET", url, headers: { "accept-encoding": "gzip, br" } });
    const small = await get("/assets/app-abc123.js");
    expect([small.headers["content-encoding"], small.body]).toEqual([undefined, "console.log(1)"]);
    const image = await get("/assets/art-abc123.png");
    expect([image.headers["content-encoding"], image.rawPayload.length]).toEqual([undefined, 5000]);
  });

  it("what a route answers is compressed too, when it is big enough", async () => {
    const app = Fastify();
    registerCompression(app);
    const cardsList = { cards: Array.from({ length: 200 }, (_, i) => ({ id: `OP01-${i}`, name: "A card of the catalog" })) };
    app.get("/api/cards", async () => cardsList);
    app.get("/api/health", async () => ({ ok: true }));
    const big = await app.inject({ method: "GET", url: "/api/cards", headers: { "accept-encoding": "br" } });
    expect(big.headers["content-encoding"]).toBe("br");
    expect(JSON.parse(brotliDecompressSync(big.rawPayload).toString())).toEqual(cardsList);
    const small = await app.inject({ method: "GET", url: "/api/health", headers: { "accept-encoding": "br" } });
    expect([small.headers["content-encoding"], small.json()]).toEqual([undefined, { ok: true }]);
    const none = await app.inject({ method: "GET", url: "/api/cards" });
    expect([none.headers["content-encoding"], none.json()]).toEqual([undefined, cardsList]);
  });
});

describe("the rules engine as the server runs it (engineBuild.mjs)", () => {
  it("builds into one module that deals a game and refuses an illegal move", async () => {
    const out = await buildEngine(join(site, "..", `sn-engine-test-${process.pid}`, "engine.mjs"));
    const engine = await import(/* @vite-ignore */ pathToFileURL(out).href);
    const card = (id: string, category: string) => ({
      id, name: id, category, colors: ["Red"], cost: category === "Leader" ? 5 : 1, power: 5000, counter: null,
      types: [], attributes: [], effect: "-", trigger: null, rarity: "C", set: "TST",
    });
    const cardsById = new Map([card("TST-001", "Leader"), ...Array.from({ length: 13 }, (_, i) => card(`TST-${100 + i}`, "Character"))].map((c) => [c.id, c]));
    const db = engine.makeCardDb(cardsById);
    const deck = Array.from({ length: 50 }, (_, i) => `TST-${100 + (i % 13)}`);
    const player = (id: string) => ({ id, leader: "TST-001", deck });
    const game = engine.createGame(db, { seed: "test", firstPlayer: "seatA", players: [player("seatA"), player("seatB")] });
    expect(game.state.pendingChoice).toMatchObject({ kind: "mulligan", player: "seatA" });
    expect(() => engine.applyIntent(db, game.state, { type: "endTurn", player: "seatA" })).toThrow();
    const over = engine.applyIntent(db, game.state, { type: "concede", player: "seatA" });
    expect([over.state.phase, over.state.winner]).toEqual(["over", "seatB"]);
    rmSync(join(site, "..", `sn-engine-test-${process.pid}`), { recursive: true, force: true });
  });

  it("the bundle inside the build is the server's, not a file of the site", async () => {
    mkdirSync(join(site, "_server"), { recursive: true });
    writeFileSync(join(site, "_server", "engine.mjs"), "export {}");
    const app = Fastify();
    registerStatic(app, { dir: site, cardsDir: cards });
    expect((await app.inject({ method: "GET", url: "/_server/engine.mjs" })).statusCode).toBe(404);
  });
});
