/* Board Auto verification: plays a REAL hotseat game on the AUTOSIM board by
   driving the UI with Playwright, reading the engine state through the dev
   hook (window.__auto.state()). Captures scripts/.shots/boardauto-*.png at the
   key moments: pick, roll, mulligan, main, DON dial, attack arrow, block,
   counter, trigger reveal, manual resolve, game over.
   Usage: node scripts/boardauto-shots.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "scripts/.shots";
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const taken = new Set();
async function shot(name, force = false) {
  if (taken.has(name) && !force) return;
  taken.add(name);
  await page.screenshot({ path: `${OUT}/boardauto-${name}.png` });
  console.log("  shot:", name);
}

const snap = () =>
  page.evaluate(() => {
    const s = window.__auto?.state();
    if (!s) return null;
    const g = s.game;
    const per = (f) => (g ? Object.fromEntries(Object.entries(g.players).map(([k, p]) => [k, f(p)])) : null);
    return {
      stage: s.stage,
      phase: g?.phase ?? null,
      turn: g?.turn ?? 0,
      turnPlayer: g?.turnPlayer ?? null,
      pending: g?.pendingChoice ?? null,
      battle: g?.battle ?? null,
      winner: g?.winner ?? null,
      winReason: g?.winReason ?? null,
      don: per((p) => p.don),
      chars: per((p) => p.zones.characterArea),
      leaders: per((p) => p.leaderIid),
      life: per((p) => p.zones.life.length),
      handSizes: per((p) => p.zones.hand.length),
      legal: s.legal,
    };
  });

async function clickIid(iid) {
  await page.locator(`[data-iid="${iid}"]`).first().click({ timeout: 4000 });
}
async function clickAct(act) {
  await page.locator(`[data-act="${act}"]`).first().click({ timeout: 4000 });
}

// ── reach the board ───────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const testBtn = page.getByText("Enter as Test Captain");
if (await testBtn.count()) await testBtn.click();
await page.waitForSelector(".sn-hub", { timeout: 15000 });
await page.locator(".hu-mode", { hasText: "Play Auto" }).click();
await page.waitForSelector(".ba-root", { timeout: 15000 });
await page.waitForSelector("[data-deck-key]", { timeout: 15000 });

// pick the first demo deck for both seats
await page.locator('[data-seat="0"][data-deck-key^="demo:"]').first().click();
await page.locator('[data-seat="1"][data-deck-key^="demo:"]').nth(1).click();
await shot("pick");
await clickAct("start");

// roll + choose first
await page.waitForSelector('[data-act="roll"]', { timeout: 8000 });
await clickAct("roll");
await page.waitForSelector('[data-act="first"]', { timeout: 8000 });
await shot("roll");
await clickAct("first");
await page.waitForSelector(".ba-field", { timeout: 8000 });

// ── game driver ───────────────────────────────────────────────────────────────
const flags = {
  blocked: false,
  counterValue: false,
  counterEvent: false,
  triggerActivated: false,
  triggerDeclined: false,
  donGivenTurn: 0,
  playedTurnCount: 0,
  lastTurnSeen: 0,
};

let guard = 900;
let lastSig = "";
let stuck = 0;

while (guard-- > 0) {
  const s = await snap();
  if (!s || s.stage !== "play") break;
  if (s.phase === "over") {
    await shot("gameover");
    console.log(`GAME OVER — winner ${s.winner} (${s.winReason}) on turn ${s.turn}`);
    break;
  }

  const sig = JSON.stringify([s.turn, s.phase, s.pending?.kind, s.battle?.step, s.don, s.handSizes, flags]);
  stuck = sig === lastSig ? stuck + 1 : 0;
  lastSig = sig;
  if (stuck > 12) {
    await shot("stuck", true);
    console.log("STUCK at:", JSON.stringify(s.pending ?? s.phase));
    break;
  }

  const p = s.pending;
  if (p) {
    if (p.kind === "mulligan") {
      await shot("mulligan");
      await clickAct("keep");
    } else if (p.kind === "blockWindow") {
      await shot("block-window");
      if (!flags.blocked && p.blockers.length > 0) {
        flags.blocked = true;
        await clickIid(p.blockers[0]);
        await page.waitForTimeout(120);
        await shot("blocked", true);
      } else {
        await clickAct("noblock");
      }
    } else if (p.kind === "counterWindow") {
      await shot("counter-window");
      const cc = s.legal?.counterCards ?? [];
      const ce = s.legal?.counterEvents ?? [];
      if (!flags.counterValue && cc.length > 0) {
        flags.counterValue = true;
        await clickIid(cc[0].iid);
        await page.waitForTimeout(120);
        await shot("counter-applied", true);
      } else if (!flags.counterEvent && ce.length > 0) {
        flags.counterEvent = true;
        await clickIid(ce[0].iid);
      } else {
        await clickAct("endcounters");
      }
    } else if (p.kind === "triggerDecision") {
      await shot("trigger-reveal");
      // BA_DECLINE=1 declines the first trigger instead (covers both paths)
      if (!flags.triggerActivated && !process.env.BA_DECLINE) {
        flags.triggerActivated = true;
        await clickAct("trigger-activate");
      } else {
        flags.triggerDeclined = true;
        await clickAct("trigger-decline");
        await page.waitForTimeout(120);
        await shot("trigger-declined");
      }
    } else if (p.kind === "manualResolve") {
      await shot("manual-resolve");
      await clickAct("manual-done");
    } else if (p.kind === "mayActivate") {
      await clickAct("may-yes");
    } else if (p.kind === "selectTargets") {
      const max = Math.min(p.count, p.candidates.length);
      for (let i = 0; i < max; i++) await clickIid(p.candidates[i].iid);
      await clickAct("confirm-targets");
    }
    await page.waitForTimeout(140);
    continue;
  }

  if (s.phase !== "main" || s.battle) {
    await page.waitForTimeout(160);
    continue;
  }

  // ── main phase for the turn player ──
  const me = s.turnPlayer;
  const opp = Object.keys(s.leaders).find((k) => k !== me);
  if (s.turn !== flags.lastTurnSeen) {
    flags.lastTurnSeen = s.turn;
    flags.playedTurnCount = 0;
  }

  // 1. play a character (max 2 per turn to keep DON for attacks)
  const playable = (s.legal?.playableFromHand ?? []).filter((x) => !x.needsReplace);
  if (playable.length > 0 && flags.playedTurnCount < 2 && (s.chars[me]?.length ?? 0) < 5) {
    flags.playedTurnCount++;
    await clickIid(playable[0].iid);
    await page.waitForTimeout(140);
    if (s.turn <= 3) await shot("main");
    continue;
  }

  // 2. give 2 DON!! to the leader once per turn (dial)
  if (flags.donGivenTurn !== s.turn && (s.don[me]?.active ?? 0) >= 3 && s.turn >= 3) {
    flags.donGivenTurn = s.turn;
    const n = 2;
    await page.locator(`[data-don-seat="${me}"][data-don-index="${n}"]`).first().click();
    await page.waitForTimeout(120);
    await shot("don-dial");
    await clickIid(s.leaders[me]);
    await page.waitForTimeout(140);
    continue;
  }

  // 3. attack the opponent's leader with every legal attacker
  const attackers = (s.legal?.attackers ?? []).filter((a) => a.targets.includes(s.leaders[opp]));
  if (attackers.length > 0) {
    await clickIid(attackers[0].iid);
    await page.waitForTimeout(100);
    // hover the target so the dashed arrow renders, then shoot it
    await page.locator(`[data-iid="${s.leaders[opp]}"]`).first().hover();
    await page.waitForTimeout(120);
    await shot("attack-arrow");
    await clickIid(s.leaders[opp]);
    await page.waitForTimeout(160);
    continue;
  }

  // 4. nothing else → end turn
  await clickAct("endturn");
  await page.waitForTimeout(160);
}

const end = await snap();
console.log("flags:", JSON.stringify(flags));
console.log("final:", JSON.stringify({ phase: end?.phase, turn: end?.turn, winner: end?.winner, reason: end?.winReason, life: end?.life }));

await ctx.close();
await browser.close();

if (consoleErrors.length) {
  console.log("CONSOLE ERRORS:");
  for (const e of consoleErrors) console.log(" -", e);
  process.exitCode = 1;
} else {
  console.log("done, zero console errors");
}
