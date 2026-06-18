// pw-board-new.mjs — visual test for the new 3-column board
import { chromium } from "playwright";

const BASE = "http://localhost:5175";
const pw = await chromium.launch({ headless: false, slowMo: 180 });
const ctx = await pw.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(BASE);
await page.waitForTimeout(1500);

// If login page, fill credentials
const loginInput = page.locator('input[type="password"]');
if (await loginInput.count() > 0) {
  const identifierInput = page.locator('input[type="text"], input[type="email"]').first();
  await identifierInput.fill("captain");
  await loginInput.fill("captain123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
}

console.log("On page, looking for Play — Board");

// Click Play — Board
const boardLink = page.locator("text=Play — Board").first();
if (await boardLink.isVisible().catch(() => false)) {
  await boardLink.click();
} else {
  // Try clicking by aria or any button containing "Board"
  await page.locator("button:has-text('Board'), a:has-text('Board')").first().click();
}
await page.waitForTimeout(1000);

await page.screenshot({ path: "pw-board-new-1-modal.png" });
console.log("Screenshot 1");

// Try starting a game
const deckRows = page.locator(".deck-row");
const count = await deckRows.count();
console.log(`Deck rows: ${count}`);

if (count === 0) {
  // No decks - show what we see
  await page.screenshot({ path: "pw-board-new-0-debug.png" });
  const html = await page.content();
  console.log("Page title:", await page.title());
  console.log("Has ng-panel:", html.includes("ng-panel"));
  console.log("Has board-3col:", html.includes("board-3col"));
  await pw.close();
  process.exit(0);
}

await deckRows.first().click();
await page.waitForTimeout(300);
await page.locator(".btn-primary").last().click();
await page.waitForTimeout(1200);

await page.screenshot({ path: "pw-board-new-2-active.png" });
console.log("Screenshot 2: active board");

const cols = {
  board3col:   await page.locator(".board-3col").count(),
  colLeft:     await page.locator(".col-left").count(),
  colCenter:   await page.locator(".col-center").count(),
  colRight:    await page.locator(".col-right").count(),
  matFrame:    await page.locator(".mat-frame").count(),
  handFan:     await page.locator(".hand-fan").count(),
  gameLog:     await page.locator(".game-log").count(),
  ctrlPanel:   await page.locator(".board-ctrl-panel").count(),
  charBand:    await page.locator(".char-band").count(),
  midBand:     await page.locator(".mid-band").count(),
  costZone:    await page.locator(".cost-zone").count(),
  handCards:   await page.locator(".hand-fan .card-img").count(),
  handBacks:   await page.locator(".hand-fan .card-back").count(),
};
console.log("Layout:", JSON.stringify(cols, null, 2));

// Draw DON!!
const donBtn = page.locator(".ctrl-btn.success").first();
if (await donBtn.isEnabled().catch(() => false)) {
  await donBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "pw-board-new-3-don.png" });
  console.log("Screenshot 3: after DON!! draw");
  const inCost = await page.locator(".cost-row .don-face").count();
  console.log(`DON!! face-up in cost: ${inCost}`);
}

// Right-click first hand card
const hCard = page.locator(".hand-fan .g-card").first();
if (await hCard.count() > 0) {
  await hCard.click({ button: "right" });
  await page.waitForTimeout(300);
  const ctxCount = await page.locator(".ctx-menu").count();
  console.log(`Context menu: ${ctxCount > 0}`);
  await page.screenshot({ path: "pw-board-new-4-ctx.png" });
}

await pw.close();
console.log("Done.");
