/* Identity verification shots — login, hub, directory, friends, popular
   at 1440x900 and 390x844. Usage: node scripts/identity-shots.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "scripts/.shots";
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];

async function run(browser, { width, height, tag }) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[${tag}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`[${tag}] pageerror: ${err.message}`));

  const shot = (name) => page.screenshot({ path: `${OUT}/identity-${name}-${tag}.png` });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot("login");

  await page.getByText("Enter as Test Captain").click();
  await page.waitForSelector(".sn-hub", { timeout: 10000 });
  await page.waitForTimeout(1600); // let gauges/leaderboard/meta land
  await shot("home");

  // Directory
  await page.getByRole("button", { name: /Directory/ }).first().click();
  await page.waitForSelector(".snp", { timeout: 10000 });
  await page.waitForTimeout(1200);
  await shot("directory");

  // back home, then Friends via the Crew panel link
  await page.locator(".snp-back").first().click();
  await page.waitForSelector(".sn-hub", { timeout: 10000 });
  await page.locator(".hu-rail .hu-sec-link").first().click();
  await page.waitForSelector(".snp", { timeout: 10000 });
  await page.waitForTimeout(1200);
  await shot("friends");

  // back home, then Popular Decks
  await page.locator(".snp-back").first().click();
  await page.waitForSelector(".sn-hub", { timeout: 10000 });
  await page.getByRole("button", { name: /Popular Decks/ }).first().click();
  await page.waitForSelector(".snp", { timeout: 10000 });
  await page.waitForTimeout(1400);
  await shot("popular");

  await ctx.close();
}

const browser = await chromium.launch();
await run(browser, { width: 1440, height: 900, tag: "desktop" });
await run(browser, { width: 390, height: 844, tag: "mobile" });
await browser.close();

if (consoleErrors.length) {
  console.log("CONSOLE ERRORS:");
  for (const e of consoleErrors) console.log(" -", e);
  process.exitCode = 1;
} else {
  console.log("done, zero console errors");
}
