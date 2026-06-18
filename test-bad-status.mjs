import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Testing invalid status rejection...");
  
  await page.goto('http://localhost:5174');
  await page.click('button:has-text("Enter as Test Captain")');
  await page.waitForTimeout(1500);
  
  const badUpdate = await page.evaluate(() => {
    return fetch('/api/me/presence', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'hacking' })
    }).then(r => r.json().then(b => ({ status: r.status, body: b })));
  });
  
  console.log(`Status code: ${badUpdate.status}`);
  console.log(`Response: ${JSON.stringify(badUpdate.body)}`);
  
  if (badUpdate.status === 400 && badUpdate.body.error) {
    console.log("✓ Invalid status properly rejected with 400");
  } else {
    console.log("❌ Expected 400 error");
  }
  
  await browser.close();
})();
