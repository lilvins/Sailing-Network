import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Testing presence badge icons...");
  
  await page.goto('http://localhost:5174');
  await page.click('button:has-text("Enter as Test Captain")');
  await page.waitForTimeout(1500);
  await page.click('[title="Friends"]');
  await page.waitForTimeout(1500);
  
  // Get badge text (emoji)
  const badges = await page.$$eval('.presence-badge', els => {
    return els.map(e => e.innerText || e.textContent);
  });
  
  console.log("Badges found:");
  badges.forEach((b, i) => {
    console.log(`  [${i}] "${b}"`);
  });
  
  // All should be 🟢 (online status)
  const allGreen = badges.every(b => b === '🟢');
  if (allGreen) {
    console.log("\n✓ All badges show 🟢 (online) - correct!");
  } else {
    console.log("\n⚠️ Mixed badge statuses detected");
  }
  
  // Now set presence to in_duel and reload
  console.log("\nChanging own presence to in_duel...");
  await page.evaluate(() => {
    return fetch('/api/me/presence', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_duel' })
    });
  });
  
  // Wait for the presence fetch to pick up the change
  await page.waitForTimeout(3000);
  
  const badgesAfter = await page.$$eval('.presence-badge', els => {
    return els.map(e => e.innerText || e.textContent);
  });
  
  console.log("Badges after status change:");
  badgesAfter.forEach((b, i) => {
    console.log(`  [${i}] "${b}"`);
  });
  
  await browser.close();
})();
