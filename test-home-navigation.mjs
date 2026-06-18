import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();

  const checks = [];

  await p.goto('http://localhost:5174');
  await p.locator('text=Enter as Test Captain').click();
  await p.waitForTimeout(1500);

  console.log("Testing Home Menu Items:\n");

  // Check each menu button exists
  const menuItems = [
    { label: "Deck Constructor", view: "my-decks" },
    { label: "Profile Viewer", view: "profile-viewer" },
    { label: "Edit Profile", view: "edit-profile" },
    { label: "Rankings", view: "rankings" },
    { label: "Duel Records", view: "records" },
    { label: "Popular Decks", view: "popular-decklists" },
    { label: "My Statistics", view: "statistics" },
  ];

  for (const item of menuItems) {
    const btn = await p.locator(`text=${item.label}`).isVisible().catch(() => false);
    console.log(`  ${btn ? '✅' : '❌'} ${item.label}`);
    checks.push(btn);
  }

  console.log(`\nTotal working: ${checks.filter(Boolean).length}/${checks.length}`);

  // Test one navigation: Deck Constructor
  console.log("\nTesting navigation to Deck Constructor...");
  await p.locator('text=Deck Constructor').click();
  await p.waitForTimeout(1500);
  
  const isDeckPage = await p.locator('text=Deck, text=Builder').isVisible().catch(() => false);
  console.log(`  ${isDeckPage ? '✅' : '❌'} Deck page loaded`);

  await b.close();
})();
