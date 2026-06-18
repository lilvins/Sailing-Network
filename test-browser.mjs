import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Log all network requests
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log(`${response.status()} ${response.url().split('/api/')[1]}`);
    }
  });

  console.log("Opening app...");
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  
  const title = await page.title();
  console.log(`✓ Page title: ${title}`);
  
  // Check if we're on login page
  const loginButton = await page.$('text=Login');
  console.log(`✓ Login page visible: ${!!loginButton}`);
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/sailing-login.png' });
  console.log("✓ Screenshot: /tmp/sailing-login.png");
  
  await browser.close();
})();
