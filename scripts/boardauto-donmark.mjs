/* One-off: exercises the right-click DON placeholder (visual-only HOLD mark)
   and captures boardauto-don-hold.png + the refreshed deck picker. */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const OUT = "scripts/.shots";
mkdirSync(OUT, { recursive: true });
const AUTH = `${OUT}/.boardauto-auth.json`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(existsSync(AUTH) ? { storageState: AUTH } : {}),
});
await ctx.addInitScript(() => {
  const OrigWS = window.WebSocket;
  window.WebSocket = class extends OrigWS {
    constructor(url, protocols) {
      if (String(url).includes("localhost:5173")) super("ws://localhost:9");
      else super(url, protocols);
    }
  };
});
const page = await ctx.newPage();
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
const testBtn = page.getByText("Enter as Test Captain");
if (await testBtn.count()) await testBtn.click();
await page.waitForSelector(".hu-mode", { timeout: 15000 });
await ctx.storageState({ path: AUTH });
await page.locator(".hu-mode", { hasText: "Play Auto" }).click();
await page.waitForSelector("[data-deck-key]", { timeout: 15000 });
await page.locator('[data-seat="0"][data-deck-key="demo:ST01-001"]').first().click();
await page.locator('[data-seat="1"][data-deck-key^="demo:OP01-"]').first().click();
await page.screenshot({ path: `${OUT}/boardauto-pick.png` });
await page.locator('[data-act="start"]').click();
await page.locator('[data-act="roll"]').click();
await page.locator('[data-act="first"]').click();
await page.locator('[data-act="keep"]').click();
await page.locator('[data-act="keep"]').click();
// pass a couple of turns so the first player has 3 active DON
await page.locator('[data-act="endturn"]').click();
await page.waitForTimeout(150);
await page.locator('[data-act="endturn"]').click();
await page.waitForTimeout(150);
// right-click two active DON of the turn player → HOLD placeholders + hint
const seat = await page.evaluate(() => window.__auto.state().game.turnPlayer);
await page.locator(`[data-don-seat="${seat}"][data-don-index="1"]`).click({ button: "right" });
await page.waitForTimeout(120);
await page.locator(`[data-don-seat="${seat}"][data-don-index="2"]`).click({ button: "right" });
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/boardauto-don-hold.png` });
// toggle one off again
await page.locator(`[data-don-seat="${seat}"][data-don-index="1"]`).click({ button: "right" });
await page.waitForTimeout(100);
const marks = await page.evaluate(() => document.querySelectorAll(".ba-donmark").length);
console.log("marks after toggle-off:", marks, "(expected 1)");
// engine state untouched?
const don = await page.evaluate(() => window.__auto.state().game.players[window.__auto.state().game.turnPlayer].don);
console.log("don state:", JSON.stringify(don));
await browser.close();
console.log("done");
