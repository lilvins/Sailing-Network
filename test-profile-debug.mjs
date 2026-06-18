import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();

  const logs = [];
  const errors = [];
  p.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'log') logs.push(m.text());
  });

  await p.goto('http://localhost:5174');
  await p.locator('text=Enter as Test Captain').click();
  await p.waitForTimeout(1500);
  
  await p.locator('[title="Friends"]').click();
  await p.waitForTimeout(1500);

  // Click first Profile button
  const profileBtns = await p.locator('.fr-btn:has-text("Profile")');
  console.log(`Profile buttons found: ${await profileBtns.count()}`);
  
  if (await profileBtns.count() > 0) {
    // Get the friend name before clicking
    const friendNameEl = await p.locator('.fr-name').first();
    const friendName = await friendNameEl.innerText();
    console.log(`Clicking profile for friend: ${friendName}`);
    
    await profileBtns.first().click();
    await p.waitForTimeout(2000);
    
    // Check the profile viewer
    const select = await p.locator('select').inputValue();
    console.log(`Profile select value: ${select}`);
    
    const displayedName = await p.locator('.pv-username, [class*="username"]').first().innerText().catch(() => 'not found');
    console.log(`Displayed name: ${displayedName}`);
  }

  console.log(`\nConsole errors: ${errors.length}`);
  errors.forEach(e => console.log(`  - ${e.slice(0, 80)}`));

  await b.close();
})();
