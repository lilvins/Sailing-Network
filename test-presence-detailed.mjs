import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const apiCalls = [];
  const consoleLogs = [];
  
  page.on('response', response => {
    const url = response.url();
    if (url.includes('/api/')) {
      const endpoint = url.split('/api/')[1];
      apiCalls.push({
        status: response.status(),
        url: endpoint,
        method: response.request().method()
      });
      console.log(`${response.request().method()} ${response.status()} /api/${endpoint}`);
    }
  });
  
  page.on('console', msg => {
    if (msg.type() !== 'log') {
      consoleLogs.push(`${msg.type().toUpperCase()}: ${msg.text()}`);
    }
  });

  console.log("Opening http://localhost:5174...");
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  
  await page.waitForTimeout(1000);
  
  // Check if there's a friends link/button
  const friendsLink = await page.$('a:has-text("Friends"), button:has-text("Friends")');
  console.log(`\nFriends link exists: ${!!friendsLink}`);
  
  if (friendsLink) {
    console.log("\nClicking Friends...");
    await friendsLink.click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  
  // Wait a bit more for presence fetch
  await page.waitForTimeout(1500);
  
  console.log("\n=== API Calls ===");
  apiCalls.forEach(call => {
    console.log(`${call.method} ${call.status} /api/${call.url}`);
  });
  
  console.log("\n=== Console Output ===");
  if (consoleLogs.length > 0) {
    consoleLogs.forEach(log => console.log(log));
  } else {
    console.log("(no errors or warnings)");
  }
  
  // Screenshot
  await page.screenshot({ path: '/tmp/sailing-presence-test.png' });
  console.log("\n✓ Screenshot: /tmp/sailing-presence-test.png");
  
  await browser.close();
})();
