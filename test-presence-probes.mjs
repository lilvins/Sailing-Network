import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("🔍 Probe 1: Verify /me/presence endpoint returns valid structure");
  
  // Get a valid session first
  const testLogin = await page.context().addCookies([
    { name: 'sn_session', value: 'test', url: 'http://localhost:5174', httpOnly: true }
  ]).catch(() => {});
  
  // Actually, let's login properly
  await page.goto('http://localhost:5174');
  await page.click('button:has-text("Enter as Test Captain")');
  await page.waitForTimeout(1500);
  
  // Now test the GET endpoint directly
  const presenceResp = await page.evaluate(() => {
    return fetch('/api/me/presence').then(r => r.json());
  });
  
  console.log(`   Response: ${JSON.stringify(presenceResp)}`);
  
  if (presenceResp.status && presenceResp.lastSeen && presenceResp.updatedAt) {
    console.log("   ✓ Structure is valid (has status, lastSeen, updatedAt)");
  } else {
    console.log("   ❌ Missing fields:", { presenceResp });
  }
  
  console.log("\n🔍 Probe 2: Verify presence updates after PATCH");
  
  const beforeUpdate = new Date().getTime();
  await page.evaluate(() => {
    return fetch('/api/me/presence', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_duel' })
    }).then(r => r.json());
  });
  
  const afterUpdate = await page.evaluate(() => {
    return fetch('/api/me/presence').then(r => r.json());
  });
  
  console.log(`   After PATCH in_duel: status = ${afterUpdate.status}`);
  if (afterUpdate.status === 'in_duel') {
    console.log("   ✓ Presence updated successfully");
  } else {
    console.log("   ❌ Presence not updated");
  }
  
  console.log("\n🔍 Probe 3: Verify friends/presence returns dict of user_id -> presence");
  
  const friendsPresence = await page.evaluate(() => {
    return fetch('/api/friends/presence').then(r => r.json());
  });
  
  console.log(`   Response type: ${typeof friendsPresence}`);
  console.log(`   Keys: ${Object.keys(friendsPresence).length} friend(s)`);
  
  const sample = Object.entries(friendsPresence)[0];
  if (sample) {
    const [userId, presence] = sample;
    console.log(`   Sample: ${userId} -> ${JSON.stringify(presence)}`);
    if (presence.status && presence.lastSeen !== undefined) {
      console.log("   ✓ Structure correct");
    } else {
      console.log("   ❌ Missing fields");
    }
  }
  
  console.log("\n🔍 Probe 4: Verify invalid status is rejected");
  
  const badUpdate = await page.evaluate(() => {
    return fetch('/api/me/presence', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'hacking' })
    }).then(r => ({ status: r.status, body: r.text() })).then(p => p.text().then(b => ({ ...p, body: b })));
  });
  
  if (badUpdate.status === 400) {
    console.log(`   ✓ Bad status rejected (400): ${badUpdate.body}`);
  } else {
    console.log(`   ❌ Expected 400, got ${badUpdate.status}`);
  }
  
  await browser.close();
  console.log("\n✅ All probes complete");
})();
