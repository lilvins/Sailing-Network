// What production relies on: the settings check (config.mjs) and the site
// served by the API (static.mjs). Run with the unit tests (npm run test:unit).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../server/config.mjs";
import { registerStatic } from "../server/static.mjs";
import { cardFaceSvg, wrap } from "../server/cardFace.mjs";

const SECRET = "x".repeat(40);
const site = mkdtempSync(join(tmpdir(), "sn-site-"));
const cards = mkdtempSync(join(tmpdir(), "sn-cards-"));
mkdirSync(join(site, "assets"));
mkdirSync(join(site, "cards"));
writeFileSync(join(site, "index.html"), "<!doctype html><title>site</title>");
writeFileSync(join(site, "assets", "app-abc123.js"), "console.log(1)");
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
