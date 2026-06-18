import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.createBrowserContext?.() ?? browser;
  const page1 = await browser.newPage?.() ? browser : await context.newPage?.();
  const page2 = await browser.newPage?.() ? browser : await context.newPage?.();

  // Simpler approach: use two separate browsers
  const b1 = await chromium.launch();
  const b2 = await chromium.launch();
  const p1 = await b1.newPage();
  const p2 = await b2.newPage();

  console.log("1. Login as wano_ren and set OFFLINE...");
  await p1.goto('http://localhost:5174');
  
  // Manual login form
  const usernameInput = await p1.$('input[type="text"], input[placeholder*="username"], input[placeholder*="email"]');
  if (usernameInput) {
    await usernameInput.fill('wano_ren');
    const pwInput = await p1.$('input[type="password"]');
    await pwInput.fill('test123456');
    await p1.click('button:has-text("SET SAIL"), button:contains("Login")');
  } else {
    // Try the test button
    await p1.click('button:has-text("Enter as Test Captain")');
  }
  
  await p1.waitForTimeout(2000);
  
  console.log("   Setting presence to offline...");
  const setResult = await p1.evaluate(() => {
    return fetch('/api/me/presence', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'offline' })
    }).then(r => r.json());
  });
  console.log(`   ✓ Status is now: ${setResult.status}`);
  
  console.log("\n2. Login as captain in second window...");
  await p2.goto('http://localhost:5174');
  await p2.click('button:has-text("Enter as Test Captain")');
  await p2.waitForTimeout(2000);
  
  console.log("3. Open Friends page...");
  await p2.click('[title="Friends"]');
  await p2.waitForTimeout(1500);
  
  console.log("4. Check badges...");
  const rows = await p2.$$eval('.fr-row', rows => {
    return rows.map(row => {
      const badge = row.querySelector('.presence-badge')?.innerText || '?';
      const nameDiv = row.querySelector('.fr-name');
      const fullText = nameDiv?.innerText || '';
      const name = fullText.split('\n')[1] || fullText.split(' ')[1] || 'unknown';
      return { badge, name: name.trim() };
    });
  });
  
  console.log("   Friends:");
  rows.forEach(r => {
    console.log(`   ${r.badge} ${r.name}`);
  });
  
  const wanoRow = rows.find(r => r.name.includes('Ren') || r.name === 'ren');
  if (wanoRow) {
    console.log(`\n   wano_ren badge: ${wanoRow.badge}`);
    if (wanoRow.badge === '⚫') {
      console.log("   ✅ OFFLINE (⚫) - CORRECT!");
    } else {
      console.log(`   ❌ Expected ⚫, got ${wanoRow.badge}`);
    }
  } else {
    console.log(`\n   ❌ wano_ren not found in friends`);
  }
  
  await p2.screenshot({ path: '/tmp/offline-test.png' });
  console.log("\n✓ Screenshot: /tmp/offline-test.png");
  
  await b1.close();
  await b2.close();
})();
