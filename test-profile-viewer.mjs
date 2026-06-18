import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();

  console.log("1. Login...");
  await p.goto('http://localhost:5174');
  await p.locator('text=Enter as Test Captain').click();
  await p.waitForTimeout(1500);

  console.log("2. Open Friends...");
  await p.locator('[title="Friends"]').click();
  await p.waitForTimeout(1500);

  console.log("3. Click Profile button on first friend...");
  const profileBtn = await p.locator('.fr-btn:has-text("Profile")').first();
  console.log(`   Button exists: ${!!profileBtn}`);
  
  if (profileBtn) {
    await profileBtn.click();
    console.log("   Clicked");
    await p.waitForTimeout(2000);
    
    console.log("4. Check if ProfileViewer loaded...");
    const title = await p.locator('text=Profile Viewer, h1:has-text("Profile")').isVisible().catch(() => false);
    console.log(`   Title visible: ${title}`);
    
    const username = await p.locator('text=@wano_ren, text=@navigator_mika, text=@redhaired_saki').first().isVisible().catch(() => false);
    console.log(`   Username visible: ${username}`);
    
    const decksSection = await p.locator('text=Decks').isVisible().catch(() => false);
    console.log(`   Decks section: ${decksSection}`);
    
    const bio = await p.locator('text=Profile, text=No bio').isVisible().catch(() => false);
    console.log(`   Bio section: ${bio}`);
    
    await p.screenshot({ path: '/tmp/profile-viewer-test.png' });
    console.log("\n✓ Screenshot: /tmp/profile-viewer-test.png");
  }

  await b.close();
})();
