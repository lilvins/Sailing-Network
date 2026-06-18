import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const checks = [];
  
  console.log("=== SAILING NETWORK AUDIT ===\n");
  
  // Home
  console.log("1️⃣ HOME PAGE");
  await page.goto('http://localhost:5174');
  let ok = await page.isVisible('text=Sailing Network');
  console.log(`   ${ok ? '✅' : '❌'} Title visible`);
  ok = await page.isVisible('text=captains');
  console.log(`   ${ok ? '✅' : '❌'} Stats visible\n`);
  
  // Login
  console.log("2️⃣ LOGIN");
  const testBtn = await page.$('button:has-text("Enter as Test Captain")');
  console.log(`   ${testBtn ? '✅' : '❌'} Test captain button`);
  await testBtn.click();
  await page.waitForTimeout(2000);
  ok = await page.url().then(u => !u.includes('login'));
  console.log(`   ${ok ? '✅' : '❌'} Logged in\n`);
  
  // Home features
  console.log("3️⃣ HOME (LOGGED IN)");
  let btn = await page.$('[title="Duel"]');
  console.log(`   ${btn ? '✅' : '❌'} Duel button in dock`);
  btn = await page.$('button:has-text("Start")');
  console.log(`   ${btn ? '✅' : '❌'} Start game button\n`);
  
  // Deck Builder
  console.log("4️⃣ DECK BUILDER");
  btn = await page.$('a:has-text("Decks"), button:has-text("Decks")');
  if (!btn) btn = await page.$('[title*="eck"]');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(1500);
    let input = await page.$('input[placeholder*="Search"]');
    console.log(`   ✅ Accessible`);
    console.log(`   ${input ? '✅' : '❌'} Card search available\n`);
  } else {
    console.log(`   ❌ Not accessible\n`);
  }
  
  // Friends
  console.log("5️⃣ FRIENDS");
  btn = await page.$('[title="Friends"]');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(1500);
    let badges = await page.$$('.presence-badge');
    console.log(`   ✅ Friends page`);
    console.log(`   ${badges.length > 0 ? '✅' : '❌'} Presence badges (${badges.length} found)`);
    let hasFind = await page.$('button:has-text("Find")');
    console.log(`   ${hasFind ? '✅' : '❌'} Find captains tab\n`);
  } else {
    console.log(`   ❌ Friends not accessible\n`);
  }
  
  // Messages
  console.log("6️⃣ MESSAGES");
  btn = await page.$('[title="Messages"]');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(1500);
    let threads = await page.$$('.thread, [class*="msg"]');
    console.log(`   ✅ Messages page`);
    console.log(`   ${threads.length > 0 ? '✅' : '❌'} Message threads\n`);
  } else {
    console.log(`   ❌ Messages not accessible\n`);
  }
  
  // Profile
  console.log("7️⃣ MY PROFILE");
  btn = await page.$('[title*="rofile"]');
  if (!btn) btn = await page.$('a:has-text("Profile"), button:has-text("Profile")');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(1500);
    let edit = await page.$('button:has-text("Edit")');
    console.log(`   ✅ Profile accessible`);
    console.log(`   ${edit ? '✅' : '❌'} Edit button\n`);
  } else {
    console.log(`   ❌ Profile not accessible\n`);
  }
  
  // Errors
  console.log("8️⃣ ERRORS CHECK");
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(1000);
  console.log(`   ${errors.length === 0 ? '✅' : '❌'} No errors (${errors.length} found)`);
  if (errors.length > 0) {
    errors.slice(0, 3).forEach(e => console.log(`      - ${e.slice(0, 60)}`));
  }
  
  await browser.close();
  console.log("\n" + "=".repeat(40));
})();
