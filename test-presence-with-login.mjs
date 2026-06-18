import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const apiCalls = [];
  
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      apiCalls.push(response.request().method() + ' ' + response.status() + ' ' + response.url().split('/api/')[1]);
    }
  });

  console.log("1. Opening app...");
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  
  console.log("2. Clicking 'Enter as Test Captain'...");
  const testBtn = await page.$('button:has-text("Enter as Test Captain")');
  if (testBtn) {
    await testBtn.click();
    await page.waitForTimeout(2000);
    console.log("   ✓ Clicked");
  } else {
    console.log("   ❌ Button not found!");
    await browser.close();
    process.exit(1);
  }
  
  console.log("3. Clicking Friends button...");
  const friendsBtn = await page.$('[title="Friends"]');
  if (friendsBtn) {
    await friendsBtn.click();
    await page.waitForTimeout(2000);
    console.log("   ✓ Clicked");
  } else {
    console.log("   ❌ Friends button not found!");
  }
  
  console.log("\n4. Checking for presence badges...");
  const badges = await page.$$('.presence-badge');
  console.log(`   Found: ${badges.length} badges`);
  
  console.log("\n5. API calls made:");
  apiCalls.forEach(call => console.log(`   ${call}`));
  
  const presenceCall = apiCalls.find(c => c.includes('presence'));
  console.log(`\n${presenceCall ? '✅' : '❌'} Presence API called`);
  
  if (presenceCall) {
    console.log(`   ${presenceCall}`);
  }
  
  await page.screenshot({ path: '/tmp/sailing-with-presence.png' });
  console.log("\n✓ Screenshot: /tmp/sailing-with-presence.png");
  
  await browser.close();
})();
