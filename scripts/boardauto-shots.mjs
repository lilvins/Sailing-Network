/* Board Auto verification: plays a REAL hotseat game on the AUTOSIM board by
   driving the UI with Playwright, reading the engine state through the dev
   hook (window.__auto.state()). Captures scripts/.shots/boardauto-*.png at the
   key moments: pick, roll, mulligan, main, DON dial, attack arrow, block,
   counter, trigger reveal, manual resolve, game over.
   Usage: node scripts/boardauto-shots.mjs */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

// cards with a compiled [When Attacking] effect (to aim the DON dial at one
// and prove the effect fires in play)
const BATCH = JSON.parse(readFileSync("src/autosim/data/compiled/st01-op01.json", "utf8"));
const WA_IDS = new Set(BATCH.filter((c) => c.effects.some((fx) => fx.timing === "whenAttacking")).map((c) => c.cardId));
// M3 windows to exercise on purpose: DON!!−X costs (payDon), peek/search
// (peekSelect) and "draw up to" (chooseNumber)
const DONX_IDS = new Set(BATCH.filter((c) => c.effects.some((fx) => (fx.cost ?? []).some((k) => k.kind === "returnDonToDeck"))).map((c) => c.cardId));
const PEEK_IDS = new Set(BATCH.filter((c) => c.effects.some((fx) => fx.timing === "onPlay" && JSON.stringify(fx.actions).includes('"peekDeck"'))).map((c) => c.cardId));
const UPTO_IDS = new Set(BATCH.filter((c) => JSON.stringify(c.effects).includes('"kind":"draw"') && JSON.stringify(c.effects).includes('"upTo":true')).map((c) => c.cardId));

const BASE = "http://localhost:5173";
const OUT = "scripts/.shots";
mkdirSync(OUT, { recursive: true });

// BA_W/BA_H: viewport override · BA_TAG: shot-name suffix · BA_PREFIX: shot
// name prefix (e.g. "mobile-") · BA_MOBILE=1: touch device emulation ·
// BA_PORTRAIT=1: only verify the portrait overlay + fallback, no game ·
// BA_DECLINE: see triggers
const W = Number(process.env.BA_W ?? 1440);
const H = Number(process.env.BA_H ?? 900);
const TAG = process.env.BA_TAG ? `-${process.env.BA_TAG}` : "";
const PREFIX = process.env.BA_PREFIX ?? "";
const MOBILE = !!process.env.BA_MOBILE;
const PORTRAIT_ONLY = !!process.env.BA_PORTRAIT;
// BA_SEED: pin the engine seed (DEV hook window.__autoSeed) to reproduce hands
const SEED = process.env.BA_SEED ?? "";

const consoleErrors = [];
const browser = await chromium.launch();
// reuse the session across runs: the login route is rate-limited (10/10min)
const AUTH = `${OUT}/.boardauto-auth.json`;
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  ...(MOBILE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  ...(existsSync(AUTH) ? { storageState: AUTH } : {}),
});
if (SEED) await ctx.addInitScript((seed) => { window.__autoSeed = seed; }, SEED);
// Kill Vite's HMR socket inside this context: other agents editing the repo
// must not hot-reload the page mid-game (the driver reads state across turns).
await ctx.addInitScript(() => {
  const OrigWS = window.WebSocket;
  // @ts-ignore
  window.WebSocket = class extends OrigWS {
    constructor(url, protocols) {
      if (String(url).includes("localhost:5173")) super("ws://localhost:9");
      else super(url, protocols);
    }
  };
});
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (t.includes("WebSocket") || t.includes("vite") || t.includes("ws://localhost:9")) return; // muted HMR socket
  consoleErrors.push(t);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const taken = new Set();
async function shot(name, force = false) {
  if (taken.has(name) && !force) return;
  taken.add(name);
  await page.screenshot({ path: `${OUT}/boardauto-${PREFIX}${name}${TAG}.png` });
  console.log("  shot:", PREFIX + name + TAG);
}

/** Compact chrome: a card sheet may be open (tap outside closes it). */
async function closeSheet() {
  const bd = page.locator(".ba-sheet-backdrop");
  if (await bd.count()) {
    await bd.click({ position: { x: 5, y: 5 }, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(80);
  }
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
      charCards: per((p) => p.zones.characterArea.map((iid) => ({ iid, cardId: p.instances[iid].cardId }))),
      handCards: per((p) => p.zones.hand.map((iid) => ({ iid, cardId: p.instances[iid].cardId }))),
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
// wait for the home mode cards (home root class changes across redesigns)
await page.waitForSelector(".hu-mode", { timeout: 15000 });
await ctx.storageState({ path: AUTH }); // reuse this session next run
await page.locator(".hu-mode", { hasText: "Play Auto" }).click();
await page.waitForSelector(".ba-root", { timeout: 15000 });
await page.waitForSelector("[data-deck-key]", { timeout: 15000 });

// seat A = ST01 demo, seat B = an OP01 demo (both M2 batch-compiled sets)
await page.locator('[data-seat="0"][data-deck-key="demo:ST01-001"]').first().click();
// BA_DECK_B: exact deck key for seat B (e.g. "demo:OP01-091" = purple King,
// whose DON!!−X / draw-up-to cards exercise the M3 payDon / chooseNumber windows)
const deckB = process.env.BA_DECK_B
  ? page.locator(`[data-seat="1"][data-deck-key="${process.env.BA_DECK_B}"]`)
  : page.locator('[data-seat="1"][data-deck-key^="demo:OP01-"]');
if (await deckB.count()) await deckB.first().click();
else await page.locator('[data-seat="1"][data-deck-key^="demo:"]').nth(1).click();
await shot("pick");
await clickAct("start");

// roll + choose first. BA_FIRST=A|B forces who goes first (seed-reproducible
// hands depend on the turn order); default: the roll winner plays first.
await page.waitForSelector('[data-act="roll"]', { timeout: 8000 });
await clickAct("roll");
await page.waitForSelector('[data-act="first"]', { timeout: 8000 });
await shot("roll");
if (process.env.BA_FIRST) {
  const a = Number(await page.getByTestId("die-a").textContent());
  const b = Number(await page.getByTestId("die-b").textContent());
  const winnerIsA = a > b;
  const wantA = process.env.BA_FIRST === "A";
  await clickAct(winnerIsA === wantA ? "first" : "second");
} else {
  await clickAct("first");
}
await page.waitForSelector(".ba-field", { timeout: 8000 });

// portrait phone: the table rotates itself (CSS forced landscape) — assert it
if (PORTRAIT_ONLY || (MOBILE && H > W)) {
  const forced = await page.locator('[data-forced-landscape="1"]').count();
  console.log(`forced landscape active: ${forced > 0 ? "yes" : "NO"}`);
  if (forced === 0) console.log("WARNING: portrait viewport without the rotated table");
}

// ── game driver ───────────────────────────────────────────────────────────────
const flags = {
  blocked: false,
  counterValue: false,
  counterEvent: false,
  triggerActivated: false,
  triggerDeclined: false,
  donGivenTurn: 0,
  activatedTurn: 0,
  playedTurnCount: 0,
  lastTurnSeen: 0,
};

let guard = 900;
let lastSig = "";
let stuck = 0;

while (guard-- > 0) {
  if (MOBILE) await closeSheet(); // a preview sheet left open would block taps
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
  const cardIdOfSeat = (pid, iid) => (s.handCards[pid] ?? []).find((h) => h.iid === iid)?.cardId ?? "";
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
      } else if (ce.length > 0 && (!flags.counterEvent || ce.some((e) => UPTO_IDS.has(cardIdOfSeat(p.player, e.iid))))) {
        // prefer a "draw up to N" [Counter] event (chooseNumber window)
        const upto = ce.find((e) => UPTO_IDS.has(cardIdOfSeat(p.player, e.iid)));
        flags.counterEvent = true;
        await clickIid((upto ?? ce[0]).iid);
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
      if (flags.activatedTurn === s.turn && !taken.has("activate-targets")) await shot("activate-targets");
      await clickAct("confirm-targets");
    } else if (p.kind === "peekSelect") {
      // M3: take the first eligible card, order the rest by tapping in
      // sequence (when the disposition asks for an order), confirm
      await shot("peek");
      if (p.eligible.length > 0) await page.locator(`[data-peek-iid="${p.eligible[0]}"]`).first().click();
      const ordered = ["topAnyOrder", "bottomAnyOrder", "topOrBottomAnyOrder"].includes(p.rest);
      if (ordered) {
        const rest = p.cards.filter((iid) => iid !== p.eligible[0]);
        for (const iid of [...rest].reverse()) {
          await page.locator(`[data-act="peek-order"][data-peek-iid="${iid}"]`).first().click();
        }
      }
      await page.waitForTimeout(120);
      await shot("peek-ordered");
      await clickAct("peek-confirm");
    } else if (p.kind === "payDon") {
      await shot("paydon");
      await clickAct("paydon-auto");
      await page.waitForTimeout(100);
      await shot("paydon-auto", true);
      await clickAct("paydon-confirm");
    } else if (p.kind === "chooseNumber") {
      await shot("number");
      await clickAct("number-confirm");
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

  // 1. play a character (max 2 per turn to keep DON for attacks) — cards that
  //    open an M3 window first (peek/search, DON!!−X). A DON!!−X card only
  //    gets a real payDon choice when DON!! are attached: give DON!! first.
  const cardIdOf = (iid) => (s.handCards[me] ?? []).find((h) => h.iid === iid)?.cardId ?? "";
  const playable = (s.legal?.playableFromHand ?? []).filter((x) => !x.needsReplace);
  const donxPlayable = playable.find((x) => DONX_IDS.has(cardIdOf(x.iid)));
  const givenTotal = Object.values(s.don[me]?.given ?? {}).reduce((a, b) => a + b, 0);
  if (donxPlayable && givenTotal === 0 && (s.don[me]?.active ?? 0) >= 2 && flags.donGivenTurn !== s.turn) {
    flags.donGivenTurn = s.turn;
    await page.locator(`[data-don-seat="${me}"][data-don-index="1"]`).first().click(); // selects that one DON!!
    await page.waitForTimeout(100);
    await clickIid(s.chars[me]?.[0] ?? s.leaders[me]);
    await page.waitForTimeout(120);
    continue;
  }
  playable.sort((a, b) => {
    const w = (x) => (PEEK_IDS.has(cardIdOf(x.iid)) ? 0 : DONX_IDS.has(cardIdOf(x.iid)) ? 1 : 2);
    return w(a) - w(b);
  });
  if (playable.length > 0 && (flags.playedTurnCount < 2 || PEEK_IDS.has(cardIdOf(playable[0].iid)) || DONX_IDS.has(cardIdOf(playable[0].iid))) && (s.chars[me]?.length ?? 0) < 5) {
    flags.playedTurnCount++;
    await clickIid(playable[0].iid);
    await page.waitForTimeout(140);
    // compact chrome: 1st tap selects + opens the card sheet, Play confirms
    const playBtn = page.locator('[data-act="play-selected"]');
    if (await playBtn.count()) {
      await shot("hand");
      await playBtn.click();
      await page.waitForTimeout(140);
    }
    if (s.turn <= 3) await shot("main");
    continue;
  }

  // 2. give 2 DON!! once per turn (dial): to the first character when there is
  //    one (so [DON!!xX] conditions on compiled effects actually fire),
  //    otherwise to the leader
  if (flags.donGivenTurn !== s.turn && (s.don[me]?.active ?? 0) >= 3 && s.turn >= 3) {
    flags.donGivenTurn = s.turn;
    const n = 2;
    // one tap per DON!! (individual selection, no quantity dial)
    for (let i = 1; i <= n; i++) await page.locator(`[data-don-seat="${me}"][data-don-index="${i}"]`).first().click();
    await page.waitForTimeout(120);
    await shot("don-dial");
    const waChar = (s.charCards[me] ?? []).find((c) => WA_IDS.has(c.cardId));
    const donTarget = waChar?.iid ?? s.chars[me]?.[0] ?? s.leaders[me];
    await clickIid(donTarget);
    await page.waitForTimeout(140);
    continue;
  }

  // 2b. [Activate: Main] once per turn when legality offers one (M3) —
  //     e.g. ST01-001 giving a rested DON!! (there are rested DON after plays)
  const acts = s.legal?.activatable ?? [];
  if (acts.length > 0 && flags.activatedTurn !== s.turn) {
    flags.activatedTurn = s.turn;
    await shot("activate");
    await page.locator(`[data-act="activate"][data-iid="${acts[0].iid}"]`).first().click();
    await page.waitForTimeout(140);
    continue;
  }

  // 3. attack the opponent's leader with every legal attacker — a character
  //    with a compiled [When Attacking] first, so the effect provably fires
  const attackers = (s.legal?.attackers ?? []).filter((a) => a.targets.includes(s.leaders[opp]));
  if (attackers.length > 0) {
    const waIids = new Set((s.charCards[me] ?? []).filter((c) => WA_IDS.has(c.cardId)).map((c) => c.iid));
    attackers.sort((a, b) => Number(waIids.has(b.iid)) - Number(waIids.has(a.iid)));
    await clickIid(attackers[0].iid);
    await page.waitForTimeout(100);
    // hover the target so the dashed arrow renders, then shoot it
    await page.locator(`[data-iid="${s.leaders[opp]}"]`).first().hover();
    await page.waitForTimeout(120);
    await shot("attack-arrow");
    await clickIid(s.leaders[opp]);
    await page.waitForTimeout(160);
    await shot("arrow"); // battle in progress: persistent solid arrow attacker → target
    continue;
  }

  // 4. nothing else → end turn
  await clickAct("endturn");
  await page.waitForTimeout(160);
}

const end = await snap();
console.log("flags:", JSON.stringify(flags));
console.log("final:", JSON.stringify({ phase: end?.phase, turn: end?.turn, winner: end?.winner, reason: end?.winReason, life: end?.life }));

// ── per-card effect report: which compiled effects actually FIRED in play ────
const fired = await page.evaluate(() => {
  const events = window.__auto?.events() ?? [];
  const out = {};
  for (const e of events) {
    if (e.type === "effectActivated") {
      const key = `${e.sourceCardId} [${e.timing}]`;
      out[key] = (out[key] ?? 0) + 1;
    }
  }
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return { fired: out, counts };
});
console.log("effects fired (cardId [timing] × n):");
for (const [k, n] of Object.entries(fired.fired).sort()) console.log(`  ${k} × ${n}`);
console.log("event counts:", JSON.stringify(fired.counts));

await ctx.close();
await browser.close();

if (consoleErrors.length) {
  console.log("CONSOLE ERRORS:");
  for (const e of consoleErrors) console.log(" -", e);
  process.exitCode = 1;
} else {
  console.log("done, zero console errors");
}
