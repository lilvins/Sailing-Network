import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  
  console.log("Capturing screenshots...\n");
  
  // Home
  await p.goto('http://localhost:5174');
  await p.screenshot({ path: '/tmp/1-home.png' });
  console.log("✓ Home");
  
  // Login
  await p.locator('text=Enter as Test Captain').click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/2-home-logged-in.png' });
  console.log("✓ Home (logged in)");
  
  // Friends
  await p.locator('[title="Friends"]').click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/3-friends.png' });
  console.log("✓ Friends");
  
  // Messages
  await p.locator('[title="Messages"]').click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/4-messages.png' });
  console.log("✓ Messages");
  
  await b.close();
})();
