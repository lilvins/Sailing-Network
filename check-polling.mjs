import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const presenceCalls = [];
  page.on('response', r => {
    if (r.url().includes('friends/presence')) presenceCalls.push(Date.now());
  });

  await page.goto('http://localhost:5174');
  await page.click('button:has-text("Enter as Test Captain")');
  await page.waitForTimeout(1500);
  await page.click('[title="Friends"]');
  
  // Wait 5 seconds - should only call once
  await page.waitForTimeout(5000);

  const rows = await page.$$eval('.fr-row', rows =>
    rows.map(row => ({
      badge: row.querySelector('.presence-badge')?.innerText?.trim() || '?',
      name: row.querySelector('.fr-name')?.innerText?.split('\n')[1]?.trim() || '?'
    }))
  );

  console.log("Friends:");
  rows.forEach(r => console.log(`  ${r.badge}  ${r.name}`));

  console.log(`\npresence calls in 5s: ${presenceCalls.length} (should be 1-2)`);
  if (presenceCalls.length <= 3) {
    console.log("✅ Polling rate OK");
  } else {
    console.log(`❌ Too many calls: ${presenceCalls.length}`);
  }

  const ren = rows.find(r => r.name === 'Ren');
  console.log(`\nRen: ${ren?.badge} ${ren?.badge === '⚫' ? '✅ offline' : '(not offline)'}`);

  await page.screenshot({ path: '/tmp/badge-polling-fixed.png' });
  await browser.close();
})();
