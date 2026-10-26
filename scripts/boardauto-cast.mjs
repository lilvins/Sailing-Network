/* Board Auto: prove the Event "cast" animation + the real-card corner radius.
   Reaches a game, pushes a [Main] Event into the turn player's hand with enough
   DON!! (DEV hook window.__auto.store), taps it, presses PLAY, then captures
   three frames of the cast (rise / hold / fade) in scripts/.shots/.
   Usage: node scripts/boardauto-cast.mjs   (BA_W/BA_H viewport, default 1440×900) */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "scripts/.shots";
mkdirSync(OUT, { recursive: true });
const W = Number(process.env.BA_W ?? 1440);
const H = Number(process.env.BA_H ?? 900);
const EVENT_ID = process.env.BA_EVENT ?? "ST01-016"; // Gum-Gum Jet Pistol-style [Main] Event
const AUTH = `${OUT}/.boardauto-auth.json`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, ...(existsSync(AUTH) ? { storageState: AUTH } : {}) });
await ctx.addInitScript(() => {
  const OrigWS = window.WebSocket;
  // @ts-ignore
  window.WebSocket = class extends OrigWS {
    constructor(url, protocols) {
      if (String(url).includes("localhost:5173")) super("ws://localhost:9");
      else super(url, protocols);
    }
  };
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|vite|ws:\/\/localhost:9/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const shot = (n) => page.screenshot({ path: `${OUT}/boardauto-cast-${n}.png` }).then(() => console.log("  shot:", n));
const act = (a) => page.locator(`[data-act="${a}"]`).first().click({ timeout: 4000 });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const testBtn = page.getByText("Enter as Test Captain");
if (await testBtn.count()) await testBtn.click();
await page.waitForSelector(".hu-mode", { timeout: 15000 });
await ctx.storageState({ path: AUTH });
await page.locator(".hu-mode", { hasText: "Play Auto" }).click();
await page.waitForSelector("[data-deck-key]", { timeout: 15000 });
await page.locator('[data-seat="0"][data-deck-key="demo:ST01-001"]').first().click();
await page.locator('[data-seat="1"][data-deck-key^="demo:OP01-"]').first().click();
await act("start");
await page.waitForSelector('[data-act="roll"]', { timeout: 8000 });
await act("roll");
await page.waitForSelector('[data-act="first"]', { timeout: 8000 });
await act("first");
await page.waitForSelector(".ba-field", { timeout: 8000 });
for (let i = 0; i < 4; i++) {
  const k = await page.evaluate(() => window.__auto.state().game?.pendingChoice?.kind ?? null);
  if (k === "mulligan") { await act("keep"); await page.waitForTimeout(150); } else break;
}
// advance to the turn player's Main Phase if the engine is still in draw/DON
for (let i = 0; i < 6; i++) {
  const ph = await page.evaluate(() => window.__auto.state().game.phase);
  if (ph === "main") break;
  const next = page.locator('[data-act="next"], [data-act="phase"], [data-act="main"]').first();
  if (await next.count()) await next.click().catch(() => {});
  await page.waitForTimeout(150);
}

// force the Event into the turn player's hand + 10 active DON!!
const iid = await page.evaluate((eventId) => {
  const store = window.__auto.store;
  const g = JSON.parse(JSON.stringify(store.getState().game));
  const p = g.players[g.turnPlayer];
  let found = Object.entries(p.instances).find(([, inst]) => inst.cardId === eventId)?.[0];
  if (!found) {
    // not in this deck: retag the first deck card as the Event
    found = p.zones.deck[0];
    p.instances[found].cardId = eventId;
  }
  for (const z of ["deck", "hand", "trash", "life"]) p.zones[z] = p.zones[z].filter((x) => x !== found);
  p.zones.hand.unshift(found);
  p.instances[found].faceUp = true;
  p.don.active = 10; p.don.rested = 0; p.don.deck = 0;
  g.phase = "main"; g.battle = null; g.pendingChoice = null;
  store.setState({ game: g });
  return found;
}, EVENT_ID);
await page.waitForTimeout(300);
await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))));
await shot("before");

// corner radius proof: computed style of a table card
const radius = await page.evaluate(() => {
  const el = document.querySelector(".ba-field .gb-card");
  return el ? getComputedStyle(el).borderRadius : null;
});
console.log("card border-radius:", radius);

await page.locator(`[data-iid="${iid}"]`).first().click({ timeout: 4000 });
await page.waitForTimeout(120);
const playBtn = page.locator(`[data-act="play"][data-iid="${iid}"]`);
if (!(await playBtn.count())) {
  const legal = await page.evaluate(() => window.__auto.state().legal?.playableFromHand);
  console.log("NO PLAY BUTTON — playable:", JSON.stringify(legal));
  await shot("noplay");
  await browser.close();
  process.exit(1);
}
await playBtn.click();
await page.waitForTimeout(190);
await shot("rise");
await page.waitForTimeout(250);
await shot("hold");
await page.waitForTimeout(380);
await shot("fade");
await page.waitForTimeout(400);
const left = await page.evaluate(() => document.querySelectorAll(".ba-fx").length);
const used = await page.evaluate(() => window.__auto.events().filter((e) => e.type === "eventCardUsed").length);
console.log(`eventCardUsed events: ${used}, fx elements left after 1.2s: ${left}`);
await shot("after");
if (errors.length) { console.log("CONSOLE ERRORS:"); for (const e of errors) console.log(" ", e); process.exitCode = 1; }
if (!used || left) process.exitCode = 1;
await browser.close();
