import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  // Inspect what's on the page
  const content = await page.content();
  
  // Look for dock
  if (content.includes('snp-dock')) {
    console.log("✓ Dock class found in HTML");
  } else {
    console.log("❌ Dock class NOT found in HTML");
  }
  
  // Look for buttons
  const btnCount = await page.locator('button').count();
  console.log(`Button count: ${btnCount}`);
  
  // List all buttons with text or title
  const allButtons = await page.$$eval('button', btns => {
    return btns.map(b => ({
      text: b.innerText?.slice(0, 30),
      title: b.title,
      class: b.className
    }));
  });
  
  console.log("\nButtons found:");
  allButtons.forEach((btn, i) => {
    console.log(`  [${i}] text="${btn.text}", title="${btn.title}", class="${btn.class}"`);
  });
  
  // Check the app view
  const appView = await page.$eval('[class*="app"], [data-view]', (el) => el?.className || el?.dataset?.view || 'unknown');
  console.log(`\nApp view/class: ${appView}`);
  
  await browser.close();
})();
