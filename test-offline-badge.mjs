import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  
  console.log("1. Login as 'Itan' (one of the friends)...");
  await page1.goto('http://localhost:5174');
  await page1.fill('input[type="text"]', 'itan');
  await page1.fill('input[type="password"]', 'test123456');
  await page1.click('button:has-text("SET SAIL")');
  await page1.waitForTimeout(2000);
  
  console.log("2. Set Itan's presence to offline...");
  await page1.evaluate(() => {
    return fetch('/api/me/presence', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'offline' })
    }).then(r => r.json());
  });
  console.log("   ✓ Set to offline");
  
  console.log("\n3. Login as Test Captain in another tab...");
  await page2.goto('http://localhost:5174');
  await page2.click('button:has-text("Enter as Test Captain")');
  await page2.waitForTimeout(2000);
  
  console.log("4. Open Friends page...");
  await page2.click('[title="Friends"]');
  await page2.waitForTimeout(1500);
  
  console.log("5. Check badge for Itan...");
  const badges = await page2.$$eval('.presence-badge', els => {
    return els.map(e => e.innerText || e.textContent);
  });
  
  console.log("   All badges:");
  badges.forEach((b, i) => {
    console.log(`   [${i}] "${b}"`);
  });
  
  // Get the names next to each badge
  const rows = await page2.$$eval('.fr-row', rows => {
    return rows.map(row => {
      const badge = row.querySelector('.presence-badge')?.innerText || 'unknown';
      const name = row.querySelector('.fr-name')?.innerText || 'unknown';
      return { badge, name };
    });
  });
  
  console.log("\n   Friends with badges:");
  rows.forEach(row => {
    console.log(`   ${row.badge} ${row.name}`);
  });
  
  const itanRow = rows.find(r => r.name.includes('Itan'));
  if (itanRow && itanRow.badge === '⚫') {
    console.log("\n✅ Itan shows OFFLINE (⚫) - correct!");
  } else {
    console.log(`\n❌ Expected Itan to show ⚫, got: ${itanRow?.badge}`);
  }
  
  await page2.screenshot({ path: '/tmp/offline-badge.png' });
  console.log("\n✓ Screenshot: /tmp/offline-badge.png");
  
  await browser.close();
})();
