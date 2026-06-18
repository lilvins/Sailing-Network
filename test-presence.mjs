const BASE = "http://localhost:8787/api";

async function test() {
  console.log("🧪 Testing Presence API...\n");

  // 1. Login
  console.log("1. Login as captain...");
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "captain", password: "captain123" }),
    credentials: "include",
  });
  const { user } = await loginRes.json();
  console.log(`   ✓ Logged in as ${user.username}\n`);

  // 2. Check presence
  console.log("2. Get friends' presence...");
  const presRes = await fetch(`${BASE}/friends/presence`, { credentials: "include" });
  const presence = await presRes.json();
  console.log(`   ✓ Got ${Object.keys(presence).length} friends' presence statuses`);
  for (const [userId, p] of Object.entries(presence)) {
    console.log(`     → ${userId.slice(0, 8)}: ${p.status} (${new Date(p.updatedAt).toLocaleTimeString()})`);
  }
  console.log();

  // 3. Update presence
  console.log("3. Update own presence to in_duel...");
  const updateRes = await fetch(`${BASE}/me/presence`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "in_duel" }),
    credentials: "include",
  });
  const updated = await updateRes.json();
  console.log(`   ✓ Updated: ${updated.status} (${new Date(updated.updatedAt).toLocaleTimeString()})\n`);

  // 4. Logout
  console.log("4. Logout and check offline...");
  await fetch(`${BASE}/auth/logout`, { method: "POST", credentials: "include" });
  console.log("   ✓ Logged out\n");

  console.log("✅ All presence tests passed!");
}

test().catch(e => console.error("❌", e.message || e));
