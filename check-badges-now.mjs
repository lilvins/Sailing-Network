import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('response', r => {
    if (r.url().includes('presence')) console.log(`  ${r.request().method()} ${r.status()} ${r.url().split('/api/')[1]}`);
  });

  await page.goto('http://localhost:5174');
  await page.click('button:has-text("Enter as Test Captain")');
  await page.waitForTimeout(2000);
  await page.click('[title="Friends"]');
  await page.waitForTimeout(2000);

  const rows = await page.$$eval('.fr-row', rows =>
    rows.map(row => ({
      badge: row.querySelector('.presence-badge')?.innerText?.trim() || '?',
      name: row.querySelector('.fr-name')?.innerText?.replace(/[\n]/g, ' ').trim() || '?'
    }))
  );

  console.log("\nFriends:");
  rows.forEach(r => console.log(`  ${r.badge}  ${r.name}`));

  const ren = rows.find(r => r.name.includes('Ren'));
  console.log(`\nRen badge: ${ren?.badge}`);
  console.log(ren?.badge === '⚫' ? '✅ OFFLINE shown correctly!' : `❌ Expected ⚫, got ${ren?.badge}`);

  await page.screenshot({ path: '/tmp/offline-badge-final.png' });
  await browser.close();
})();
