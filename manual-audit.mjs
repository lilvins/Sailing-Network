import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  
  const log = (n, ok, d) => console.log(`   ${ok ? '✅' : '❌'} ${n}${d ? ' - ' + d : ''}`);
  
  console.log("=== AUDIT ===\n");
  
  // HOME
  console.log("📍 HOME");
  await p.goto('http://localhost:5174');
  log("Stats visible", await p.locator('text=captains').isVisible());
  log("Login button", await p.locator('text=SET SAIL').isVisible());
  
  // LOGIN & REDIRECT
  console.log("\n📍 LOGIN");
  await p.locator('text=Enter as Test Captain').click();
  await p.waitForTimeout(2000);
  const url = await p.url();
  log("Logged in (not /login)", !url.includes('login'));
  
  // HOME FEATURES
  console.log("\n📍 HOME (LOGGED IN)");
  log("Start duel button", await p.locator('text=Start').isVisible().catch(() => false));
  const duelDock = await p.locator('[title="Duel"]').isVisible().catch(() => false);
  log("Duel dock button", duelDock);
  
  // DECKS
  console.log("\n📍 DECK BUILDER");
  // Try to find deck link - look at sidebar/nav
  const hasDecks = await p.locator('text=Decks, text=Deck').first().isVisible().catch(() => false);
  log("Decks section visible", hasDecks);
  if (hasDecks) {
    await p.locator('text=Decks, text=Deck').first().click();
    await p.waitForTimeout(1500);
    const search = await p.locator('input[placeholder*="Search"]').isVisible().catch(() => false);
    log("Card search", search);
  }
  
  // FRIENDS
  console.log("\n📍 FRIENDS");
  const friendsBtn = await p.locator('[title="Friends"]').isVisible().catch(() => false);
  log("Friends button", friendsBtn);
  if (friendsBtn) {
    await p.locator('[title="Friends"]').click();
    await p.waitForTimeout(1500);
    const badges = await p.locator('.presence-badge').count();
    log("Presence badges", badges > 0, `${badges} found`);
    const offline = await p.locator('.presence-badge:has-text("⚫")').count();
    log("Offline user visible", offline > 0, offline > 0 ? '(has offline)' : '(all online)');
    const hasTabs = await p.locator('text=Find captains').isVisible().catch(() => false);
    log("Find captains tab", hasTabs);
  }
  
  // MESSAGES
  console.log("\n📍 MESSAGES");
  const msgBtn = await p.locator('[title="Messages"]').isVisible().catch(() => false);
  log("Messages button", msgBtn);
  
  // PROFILE
  console.log("\n📍 PROFILE");
  // Look for profile in home or sidebar
  const profileBtn = await p.locator('text=Profile, text=My Profile').first().isVisible().catch(() => false);
  log("Profile accessible", profileBtn);
  
  // ERRORS
  console.log("\n📍 ERRORS");
  const errors = [];
  p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await p.waitForTimeout(1000);
  log("No console errors", errors.length === 0, errors.length > 0 ? `${errors.length}` : '');
  
  await b.close();
})();
