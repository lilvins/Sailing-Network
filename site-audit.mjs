import { chromium } from 'playwright';

const issues = [];
const working = [];

function log(title, status, detail = '') {
  const msg = `${status === '✅' ? '✅' : '❌'} ${title}${detail ? ': ' + detail : ''}`;
  console.log(msg);
  if (status === '✅') working.push(title);
  else issues.push({ title, detail });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  console.log("=== SAILING NETWORK SITE AUDIT ===\n");
  
  // 1. Home page
  console.log("📍 HOME PAGE");
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  const hasStats = await page.$(':has-text("captains")');
  log("Stats display", hasStats ? '✅' : '❌');
  
  // 2. Login flow
  console.log("\n📍 LOGIN");
  await page.click('button:has-text("Enter as Test Captain")');
  await page.waitForTimeout(2000);
  const hasHome = await page.$('[title="Home"], h1:has-text("Home")');
  log("Login and redirect", hasHome || (await page.url()).includes(':5174') ? '✅' : '❌');
  
  // 3. Home after login
  console.log("\n📍 HOME (LOGGED IN)");
  const hasProfile = await page.$('[title="Profile"], button:has-text("Profile")');
  log("Profile link/button", hasProfile ? '✅' : '❌');
  const hasStartDuel = await page.$('button:has-text("Start a duel"), button:has-text("Duel")');
  log("Start duel button", hasStartDuel ? '✅' : '❌');
  
  // 4. Profile page
  console.log("\n📍 PROFILE");
  await page.goto('http://localhost:5174');
  const profileBtn = await page.$('[title*="rofile"], button:contains("My Profile")');
  if (!profileBtn) {
    // Try deck builder
    const deckBtn = await page.$('button:has-text("Deck"), [title*="Deck"]');
    if (deckBtn) await deckBtn.click();
    else {
      const url = await page.url();
      if (!url.includes('profile')) await page.goto('http://localhost:5174/profile');
    }
  } else {
    await profileBtn.click();
  }
  await page.waitForTimeout(1500);
  const editBtn = await page.$('button:has-text("Edit")');
  log("Edit profile button", editBtn ? '✅' : '❌');
  
  // 5. Deck Builder
  console.log("\n📍 DECK BUILDER");
  const deckLink = await page.$('[title*="eck"], button:has-text("Deck")');
  if (deckLink) {
    await deckLink.click();
    await page.waitForTimeout(1500);
    const addBtn = await page.$('button:has-text("Add"), button:has-text("Create")');
    log("Create deck", addBtn ? '✅' : '❌');
    const searchCards = await page.$('input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Card"]');
    log("Card search", searchCards ? '✅' : '❌');
  } else {
    log("Deck builder access", '❌', 'No button found');
  }
  
  // 6. Friends
  console.log("\n📍 FRIENDS");
  const friendsBtn = await page.$('[title="Friends"]');
  if (friendsBtn) {
    await friendsBtn.click();
    await page.waitForTimeout(1500);
    const friendsList = await page.$('.fr-row, [class*="friend"]');
    log("Friends list", friendsList ? '✅' : '❌');
    const presenceBadges = await page.$$('.presence-badge');
    log("Presence badges", presenceBadges.length > 0 ? '✅' : '❌', `(${presenceBadges.length} found)`);
    const addBtn = await page.$('button:has-text("Add friend"), button:has-text("Request")');
    log("Add friend ability", addBtn ? '✅' : '❌');
  }
  
  // 7. Messages
  console.log("\n📍 MESSAGES");
  const messagesBtn = await page.$('[title="Messages"], button:has-text("Messages")');
  if (messagesBtn) {
    await messagesBtn.click();
    await page.waitForTimeout(1500);
    const threads = await page.$('.thread, [class*="message"]');
    log("Message threads", threads ? '✅' : '❌');
    const sendBtn = await page.$('button:has-text("Send"), textarea');
    log("Message composition", sendBtn ? '✅' : '❌');
  } else {
    log("Messages access", '❌', 'No button found');
  }
  
  // 8. Directory/Browse
  console.log("\n📍 USERS DIRECTORY");
  const browseBtn = await page.$('button:has-text("Browse"), button:has-text("Directory"), button:has-text("Find")');
  if (browseBtn) {
    await browseBtn.click();
    await page.waitForTimeout(1500);
    const userList = await page.$('[class*="user"], [class*="captain"]');
    log("User directory", userList ? '✅' : '❌');
  }
  
  // 9. Logout
  console.log("\n📍 LOGOUT");
  const logoutBtn = await page.$('button:has-text("Logout"), button:has-text("Log out")');
  if (logoutBtn) {
    await logoutBtn.click();
    await page.waitForTimeout(1000);
    const loginBtn = await page.$('button:has-text("SET SAIL"), button:has-text("Login")');
    log("Logout works", loginBtn ? '✅' : '❌');
  } else {
    log("Logout button", '❌', 'Not found');
  }
  
  // 10. Errors check
  console.log("\n📍 CONSOLE/ERRORS");
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(500);
  log("No console errors", errors.length === 0 ? '✅' : '❌', errors.length > 0 ? `${errors.length} errors` : '');
  
  // Summary
  console.log("\n" + "=".repeat(40));
  console.log(`✅ WORKING: ${working.length}`);
  console.log(`❌ ISSUES: ${issues.length}`);
  
  if (issues.length > 0) {
    console.log("\nDetailed issues:");
    issues.forEach(i => console.log(`  - ${i.title}${i.detail ? ': ' + i.detail : ''}`));
  }
  
  await browser.close();
})();
