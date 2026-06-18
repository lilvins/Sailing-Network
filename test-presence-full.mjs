import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const apiCalls = [];
  
  page.on('response', response => {
    const url = response.url();
    if (url.includes('/api/')) {
      const endpoint = url.split('/api/')[1];
      apiCalls.push({
        status: response.status(),
        url: endpoint,
        method: response.request().method()
      });
    }
  });

  console.log("1. Opening app...");
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  
  // Find and click the Friends button (with icon)
  console.log("2. Looking for Friends dock button...");
  const friendsBtn = await page.$('[title="Friends"]');
  
  if (friendsBtn) {
    console.log("3. Found Friends button, clicking...");
    await friendsBtn.click();
    console.log("4. Waiting for page to load...");
    await page.waitForTimeout(2000);
  } else {
    console.log("❌ Friends button not found");
    const buttons = await page.$$('[title]');
    console.log(`   Found ${buttons.length} buttons with titles`);
  }
  
  // Check for presence badges
  const badges = await page.$$('.presence-badge');
  console.log(`\n5. Presence badges found: ${badges.length}`);
  
  // Check for any errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  await page.waitForTimeout(1000);
  
  console.log(`\n6. Console errors: ${errors.length}`);
  errors.forEach(e => console.log(`   ${e}`));
  
  console.log("\n7. API calls made:");
  apiCalls.forEach(call => {
    console.log(`   ${call.method} ${call.status} /api/${call.url}`);
  });
  
  const presenceCall = apiCalls.find(c => c.url.includes('presence'));
  console.log(`\n${presenceCall ? '✓' : '❌'} Presence API called: ${presenceCall ? presenceCall.url : 'NO'}`);
  
  // Screenshot
  await page.screenshot({ path: '/tmp/sailing-friends-page.png' });
  console.log("\n✓ Screenshot: /tmp/sailing-friends-page.png");
  
  await browser.close();
})();
