import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const apiCalls = [];
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      apiCalls.push({
        status: response.status(),
        url: response.url().split('/api/')[1]
      });
    }
  });

  console.log("1. Opening app...");
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  
  // Check if logged in (no login button = already logged in)
  const hasLoginButton = await page.$('text=/login|sign ?in/i') !== null;
  console.log(`   Login page: ${hasLoginButton}`);
  
  if (!hasLoginButton) {
    console.log("2. Already logged in! Navigating to Friends page...");
    
    // Try to navigate to friends
    const friendsLink = await page.$('a:has-text("Friends")');
    if (friendsLink) {
      await friendsLink.click();
      await page.waitForLoadState('networkidle');
      console.log("   Clicked Friends");
    }
    
    // Check for presence badges
    const badges = await page.$$('.presence-badge');
    console.log(`✓ Presence badges found: ${badges.length}`);
    
    // Check console for errors
    const logs = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        logs.push(msg.text());
      }
    });
    
    await page.waitForTimeout(2000);
    
    if (logs.length > 0) {
      console.log("⚠️ Console errors:");
      logs.forEach(log => console.log(`   ${log}`));
    } else {
      console.log("✓ No console errors");
    }
  }
  
  // Screenshot
  await page.screenshot({ path: '/tmp/sailing-logged-in.png' });
  console.log("✓ Screenshot: /tmp/sailing-logged-in.png");
  
  console.log("\nAPI calls made:");
  apiCalls.forEach(call => console.log(`  ${call.status} /api/${call.url}`));
  
  await browser.close();
})();
