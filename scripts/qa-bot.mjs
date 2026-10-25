/* QA BOT — automatic, repeatable bug hunter for Sailing Network.
 *
 *  A. PLAYER: plays COMPLETE games on the board-auto (seeded random legal
 *     moves: play / give DON / attack / activate / every ChoiceRequest),
 *     across deck configs × viewports (desktop, phone landscape, phone
 *     portrait = forced landscape), N games per config.
 *  B. CHECKS after every move: console/page errors, 4xx/5xx + broken images,
 *     affordance ↔ legality mismatches, layout (off-viewport, occlusion,
 *     overlap, clipped text, tap targets, document scroll), engine ↔ UI
 *     consistency (counters, power chips, field cards), engine invariants
 *     (card/DON conservation, one blocker per battle).
 *  C. CRAWLER: every site view at 1440 / 768 / 390 with the generic checks.
 *  D. OUTPUT: scripts/.qa/report.md + report.json (+ screenshots); exit ≠ 0
 *     when a HIGH-severity finding exists.
 *
 *  Usage: npm run qa:bot             (full run)
 *         QA_GAMES=1 QA_QUICK=1 npm run qa:bot      (one game per config, 1 viewport)
 *         QA_SEED=qa-xxx QA_CONFIG=st01-vs-op01 QA_VIEWPORT=portrait npm run qa:bot
 *         QA_SKIP_CRAWL=1 / QA_SKIP_GAMES=1 to run only one part.
 *  Prereq: dev server up (npm run dev), card art downloaded (npm run art).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
// QA_OUT: output dir (parallel runs use one dir each); QA_MERGE=dirA,dirB,…
// merges their report.json files into scripts/.qa/report.{md,json}
const OUT = process.env.QA_OUT ?? "scripts/.qa";
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
const AUTH = `scripts/.qa/.auth.json`;

const GAMES = Number(process.env.QA_GAMES ?? 3);
const QUICK = !!process.env.QA_QUICK;
const ONLY_SEED = process.env.QA_SEED ?? "";
const ONLY_CONFIG = process.env.QA_CONFIG ?? "";
const ONLY_VIEWPORT = process.env.QA_VIEWPORT ?? "";
const GAME_TIMEOUT_MS = Number(process.env.QA_GAME_TIMEOUT ?? 300000);
const MAX_MOVES = Number(process.env.QA_MAX_MOVES ?? 900);

const VIEWPORTS = [
  { name: "desktop", w: 1440, h: 900, mobile: false },
  { name: "landscape", w: 844, h: 390, mobile: true },
  { name: "portrait", w: 412, h: 915, mobile: true },
];
/** Deck configs: compiled-set demos, OP01 leaders, and an uncompiled set
 *  (ST02/ST04: the manual-resolution path). */
const CONFIGS = [
  { name: "st01-vs-op01", a: "demo:ST01-001", b: "demo:OP01-001" },
  { name: "op01-091-vs-st01", a: "demo:OP01-091", b: "demo:ST01-001" },
  { name: "st02-vs-st04-uncompiled", a: "demo:ST02-001", b: "demo:ST04-001" },
  { name: "op01-002-vs-st03", a: "demo:OP01-002", b: "demo:ST03-001" },
];

// ─── seeded RNG (mulberry32) so a game is reproducible from its seed ─────────
function rngFrom(seed) {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

// ─── findings ────────────────────────────────────────────────────────────────
const findings = [];
const seen = new Map();
let shotSeq = 0;
const PER_GAME_KINDS = new Set(["STUCK", "MOVE FAILED", "BOT CRASH"]);
async function finding(page, f) {
  const key = `${f.kind}|${f.viewport ?? ""}|${PER_GAME_KINDS.has(f.kind) ? f.seed : ""}|${(f.message ?? "").replace(/\d+/g, "#").slice(0, 160)}`;
  const prev = seen.get(key);
  if (prev) { prev.count += 1; return; }
  let shot = null;
  if (page) {
    try {
      shot = `${SHOTS}/f${String(++shotSeq).padStart(3, "0")}-${f.kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      await page.screenshot({ path: shot, timeout: 5000 });
    } catch { shot = null; }
  }
  const entry = { ...f, count: 1, screenshot: shot };
  seen.set(key, entry);
  findings.push(entry);
  console.log(`  [${f.severity}] ${f.kind}: ${f.message}`);
}

// ─── browser context with the usual hardening ───────────────────────────────
async function makeContext(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    ...(vp.mobile ? { isMobile: true, hasTouch: true } : {}),
    ...(existsSync(AUTH) ? { storageState: AUTH } : {}),
  });
  await ctx.addInitScript(() => {
    const O = window.WebSocket; // mute Vite HMR: no reloads mid-game
    window.WebSocket = class extends O {
      constructor(u, p) { if (String(u).includes("localhost:5173")) super("ws://localhost:9"); else super(u, p); }
    };
    window.addEventListener("unhandledrejection", (e) => {
      console.error("unhandledrejection: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
    });
  });
  return ctx;
}

/** Attach console/network/pageerror collectors; returns a drain() giving
 *  everything observed since the last drain. */
function attachCollectors(page) {
  let buf = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.includes("ws://localhost:9") || t.includes("WebSocket") || /\[vite\]/.test(t)) return;
    buf.push({ kind: "CONSOLE ERROR", severity: "high", message: t.slice(0, 300) });
  });
  page.on("pageerror", (e) => buf.push({ kind: "PAGE ERROR", severity: "high", message: e.message.slice(0, 300) }));
  page.on("response", (r) => {
    const s = r.status();
    if (s >= 500) buf.push({ kind: "HTTP 5xx", severity: "high", message: `${s} ${r.url().slice(0, 200)}` });
    else if (s >= 400) buf.push({ kind: "HTTP 4xx", severity: "medium", message: `${s} ${r.url().slice(0, 200)}` });
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (u.includes("localhost:9")) return;
    buf.push({ kind: "REQUEST FAILED", severity: "medium", message: `${r.failure()?.errorText ?? "?"} ${u.slice(0, 200)}` });
  });
  return () => { const out = buf; buf = []; return out; };
}

async function login(page, ctx) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  const testBtn = page.getByText("Enter as Test Captain");
  if (await testBtn.count()) await testBtn.click();
  await page.waitForSelector(".hu-mode", { timeout: 20000 });
  await ctx.storageState({ path: AUTH });
}

// ─── in-page checks (serialized functions) ───────────────────────────────────

/** Generic page checks: broken images, document scroll, clipped text,
 *  occluded interactive controls, Vite error overlay. */
const PAGE_CHECKS = () => {
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  if (document.querySelector("vite-error-overlay")) out.push({ kind: "VITE ERROR OVERLAY", severity: "high", message: "Vite error overlay is showing" });
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2) out.push({ kind: "DOCUMENT H-SCROLL", severity: "medium", message: `document scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}` });
  // broken images (loaded but zero-size)
  let broken = 0; const ex = [];
  for (const img of document.images) {
    if (img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith("data:")) { broken++; if (ex.length < 3) ex.push(img.src.replace(location.origin, "")); }
  }
  if (broken) out.push({ kind: "BROKEN IMAGE", severity: "medium", message: `${broken} broken image(s): ${ex.join(", ")}` });
  // clipped text (overflow hidden without ellipsis)
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw; };
  let clipped = 0; const cex = [];
  for (const el of document.querySelectorAll("b, span, p, h1, h2, h3, button, label, i")) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== "hidden" || cs.textOverflow === "ellipsis" || cs.whiteSpace === "normal") continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.textContent.trim()) { clipped++; if (cex.length < 3) cex.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${el.textContent.trim().slice(0, 24)}"`); }
  }
  if (clipped) out.push({ kind: "CLIPPED TEXT", severity: "low", message: `${clipped} clipped text element(s): ${cex.join("; ")}` });
  // occluded controls (top layer aware)
  const overlay = document.querySelector(".ba-overlay, .ba-sheet, .gb-modal, [role=dialog]");
  const controls = [...document.querySelectorAll("button, a[href], [data-act], [role=button]")].filter(vis);
  let occluded = 0; const oex = [];
  for (const el of controls) {
    if (overlay && !overlay.contains(el)) continue;
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !el.contains(hit) && !hit.contains(el)) {
      occluded++;
      if (oex.length < 4) oex.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-act") ?? String(el.className).split(" ")[0]}] "${el.textContent.trim().slice(0, 18)}" under ${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]}`);
    }
  }
  if (occluded) out.push({ kind: "OCCLUDED CONTROL", severity: "medium", message: `${occluded} control(s) not hit-testable at their center: ${oex.join("; ")}` });
  return out;
};

/** Board-auto checks: affordances vs legality, layout of key pieces,
 *  engine ↔ UI consistency, invariants. */
const BOARD_CHECKS = (opts) => {
  const out = [];
  const s = window.__auto?.state();
  if (!s || !s.game) return out;
  const g = s.game, lm = s.legal, pc = g.pendingChoice;
  const vw = window.innerWidth, vh = window.innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = (sel) => [...document.querySelectorAll(sel)].filter(vis);
  const byIid = (iid) => q(`[data-iid="${iid}"]`);
  const has = (sel) => q(sel).length > 0;
  const enabled = (sel) => q(sel).some((b) => !b.disabled);

  // ── B3 affordances ──
  if (g.phase !== "over") {
    const need = {
      mulligan: '[data-act="keep"]', blockWindow: '[data-act="noblock"]', counterWindow: '[data-act="endcounters"]',
      selectTargets: '[data-act="confirm-targets"]', triggerDecision: '[data-act="trigger-activate"]',
      mayActivate: '[data-act="may-yes"]', manualResolve: '[data-act="manual-done"]', peekSelect: '[data-act="peek-confirm"]',
      payDon: '[data-act="paydon-confirm"]', chooseNumber: '[data-act="number-confirm"]',
    };
    if (pc) {
      if (!has(need[pc.kind])) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: `pending ${pc.kind} but no control ${need[pc.kind]}` });
      if (pc.kind === "blockWindow") for (const b of pc.blockers) if (!byIid(b).some((e) => e.classList.contains("ba-legal"))) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: `blocker ${b} not highlighted/tappable` });
      if (pc.kind === "counterWindow") for (const c of [...(lm.counterCards ?? []), ...(lm.counterEvents ?? [])]) if (!byIid(c.iid).some((e) => e.classList.contains("ba-legal"))) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: `usable counter ${c.iid} not highlighted` });
      if (pc.kind === "selectTargets") for (const c of pc.candidates) if (!byIid(c.iid).some((e) => e.classList.contains("ba-target"))) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: `target candidate ${c.iid} not highlighted`});
      if (pc.kind === "peekSelect") for (const c of pc.cards) if (!has(`[data-peek-iid="${c}"]`)) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: `peeked card ${c} not shown` });
    } else if (g.phase === "main" && !g.battle && !opts.modeActive) {
      for (const h of lm.playableFromHand ?? []) if (!byIid(h.iid).some((e) => e.classList.contains("ba-legal"))) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: `playable ${h.iid} not highlighted in hand` });
      for (const a of lm.attackers ?? []) if (!byIid(a.iid).some((e) => e.classList.contains("ba-legal"))) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: `attacker ${a.iid} not highlighted` });
      for (const a of lm.activatable ?? []) if (!has(`[data-act="activate"][data-iid="${a.iid}"]`)) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: `activatable ${a.iid} has no ACTIVATE chip` });
      if (lm.canEndTurn && !enabled('[data-act="endturn"]')) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: "canEndTurn but End turn disabled/missing" });
      if ((lm.canGiveDonTo ?? []).length > 0 && !has(`[data-don-seat="${g.turnPlayer}"][data-don-index="1"]`)) out.push({ kind: "AFFORDANCE MISSING", severity: "high", message: "active DON!! but no DON cell to dial" });
      // illegal affordance: highlighted hand card that legality doesn't list
      const legalIds = new Set((lm.playableFromHand ?? []).map((h) => h.iid));
      for (const el of q(".ba-hand .ba-legal[data-iid]")) if (!legalIds.has(el.dataset.iid) && g.players[g.turnPlayer].zones.hand.includes(el.dataset.iid)) out.push({ kind: "ILLEGAL AFFORDANCE", severity: "medium", message: `hand card ${el.dataset.iid} highlighted but not playable` });
    }
  }

  // ── B5 engine ↔ UI ──
  for (const [pid, p] of Object.entries(g.players)) {
    const field = [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage];
    for (const iid of field) if (!byIid(iid).length) out.push({ kind: "ENGINE/UI MISMATCH", severity: "high", message: `${pid}: field card ${iid} not rendered` });
    for (const iid of p.zones.hand) if (!byIid(iid).length) out.push({ kind: "ENGINE/UI MISMATCH", severity: "high", message: `${pid}: hand card ${iid} not rendered` });
    // power chips
    for (const iid of field) {
      const el = byIid(iid)[0]; if (!el) continue;
      const chip = el.querySelector(".ba-power"); if (!chip) continue;
      const shown = parseInt(chip.textContent, 10);
      const base = opts.power[p.instances[iid].cardId]; if (base == null) continue;
      const donBonus = pid === g.turnPlayer ? (p.don.given[iid] ?? 0) * 1000 : 0;
      const mods = g.modifiers.filter((m) => m.kind === "powerMod" && m.targetOwner === pid && m.targetIid === iid).reduce((a, m) => a + (m.amount ?? 0), 0);
      const eff = base + donBonus + mods;
      if (shown !== eff) out.push({ kind: "ENGINE/UI MISMATCH", severity: "high", message: `${pid}: power chip ${shown} ≠ effective ${eff} on ${iid}` });
    }
    // counters text (desktop panel or compact pill)
    const txt = [...document.querySelectorAll(".ba-seatpanel, .ba-m-pill")].map((e) => e.textContent).join(" | ");
    const expectLife = p.zones.life.length, expectDeck = p.zones.deck.length, expectHand = p.zones.hand.length;
    // textContent concatenates labels ("LIFE 0DECK 45"): end on a non-digit
    const re = new RegExp(`(LIFE\\s*${expectLife}(?!\\d)|L${expectLife}(?!\\d))`);
    const reD = new RegExp(`(DECK\\s*${expectDeck}(?!\\d)|D${expectDeck}(?!\\d))`);
    const reH = new RegExp(`(HAND\\s*${expectHand}(?!\\d)|H${expectHand}(?!\\d))`);
    if (!re.test(txt) || !reD.test(txt) || !reH.test(txt)) out.push({ kind: "ENGINE/UI MISMATCH", severity: "high", message: `${pid}: counters L${expectLife}/D${expectDeck}/H${expectHand} not found in seat panels (${txt.replace(/\s+/g, " ").slice(0, 120)})` });
  }

  // ── B6 invariants ──
  for (const [pid, p] of Object.entries(g.players)) {
    const z = p.zones;
    const inZones = z.deck.length + z.hand.length + z.trash.length + z.life.length + z.characterArea.length + z.stage.length;
    const limbo = (pc && pc.kind === "triggerDecision" && pc.player === pid) ? 0 : 0;
    if (inZones + limbo > 50 || inZones < 49) out.push({ kind: "INVARIANT", severity: "high", message: `${pid}: ${inZones} cards across zones (expected 50, or 49 while a [Trigger] card is in limbo)` });
    const don = p.don.deck + p.don.active + p.don.rested + Object.values(p.don.given).reduce((a, b) => a + b, 0);
    if (don !== 10) out.push({ kind: "INVARIANT", severity: "high", message: `${pid}: DON!! total ${don} ≠ 10` });
  }
  const ev = window.__auto.events();
  let blockers = 0;
  for (const e of ev) {
    if (e.type === "attackDeclared") blockers = 0;
    if (e.type === "blockWindowResolved" && e.blockerIid) { blockers++; if (blockers > 1) { out.push({ kind: "INVARIANT", severity: "high", message: "two blockers in one battle" }); break; } }
  }

  // ── B4 layout of key pieces ──
  const keyEls = q(".ba-card, .ba-pile, .ba-m-pill, .ba-seatpanel, .ba-m-bar, .ba-left .ba-btn, .ba-actionbar, .ba-sheet, .ba-overlay .ba-ov, .ba-banner, .ba-toast");
  for (const el of keyEls) {
    const r = el.getBoundingClientRect();
    const inScroller = el.closest(".ba-m-strip .ba-hand, .ba-hand, .ba-log, .ba-sheet-body, .ba-decklist");
    const offX = r.right < 0 || r.left > vw, offY = r.bottom < 0 || r.top > vh;
    if ((offY && !inScroller) || (offX && !inScroller)) out.push({ kind: "OFF VIEWPORT", severity: "medium", message: `${el.className.split(" ").slice(0, 2).join(".")} fully outside the viewport (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)})` });
    else if (!inScroller && (r.left < -2 || r.top < -2 || r.right > vw + 2 || r.bottom > vh + 2) && !el.classList.contains("ba-card")) out.push({ kind: "PARTIALLY OFF VIEWPORT", severity: "low", message: `${el.className.split(" ").slice(0, 2).join(".")} spills out of the viewport (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)})` });
  }
  // field cards must not overlap each other (rested rotation included)
  const fieldCards = q(".ba-charrow .ba-card, .ba-lsrow .ba-card").map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (let i = 0; i < fieldCards.length; i++) for (let j = i + 1; j < fieldCards.length; j++) {
    const a = fieldCards[i].r, b = fieldCards[j].r;
    const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const inter = ix * iy, small = Math.min(a.width * a.height, b.width * b.height);
    if (small > 0 && inter / small > 0.12) out.push({ kind: "OVERLAP", severity: "medium", message: `field cards ${fieldCards[i].el.dataset.iid} and ${fieldCards[j].el.dataset.iid} overlap ${Math.round((inter / small) * 100)}%` });
  }
  // the step prompt must never cover a tappable card
  const bar = q(".ba-actionbar")[0];
  if (bar) {
    const br = bar.getBoundingClientRect();
    for (const el of q("[data-iid].ba-legal, [data-iid].ba-target")) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx > br.left && cx < br.right && cy > br.top && cy < br.bottom) out.push({ kind: "OCCLUDED", severity: "medium", message: `action prompt covers tappable card ${el.dataset.iid}` });
    }
  }
  // occlusion of tappable cards by anything else (top layer aware)
  const top = document.querySelector(".ba-overlay, .ba-sheet-backdrop");
  if (!top) for (const el of q("[data-iid].ba-legal, [data-iid].ba-target, [data-act=\"activate\"]")) {
    const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !el.contains(hit) && !hit.contains(el)) out.push({ kind: "OCCLUDED", severity: "medium", message: `${el.dataset.iid ?? el.dataset.act} not hit-testable at center (under ${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]})` });
    // a control INSIDE the card sitting on its center steals the card's tap
    else if (hit && el.dataset.iid && hit !== el && hit.closest("button, [data-act]") && el.contains(hit)) out.push({ kind: "OCCLUDED", severity: "medium", message: `card ${el.dataset.iid}: its center is covered by its own control ${hit.closest("[data-act]")?.getAttribute("data-act") ?? hit.tagName.toLowerCase()} (tap would not select the card)` });
  }
  // touch tap targets
  if (opts.touch) {
    let small = 0; const sx = [];
    for (const el of q("button:not([disabled]), [data-act], .ba-doncell")) {
      if (top && !top.contains(el) && !el.closest(".ba-overlay, .ba-sheet")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 && r.height < 44) { small++; if (sx.length < 4) sx.push(`${el.getAttribute("data-act") ?? el.className.split(" ")[0]} ${Math.round(r.width)}×${Math.round(r.height)}`); }
    }
    if (small) out.push({ kind: "SMALL TAP TARGET", severity: "low", message: `${small} control(s) under 44×44: ${sx.join(", ")}` });
  }
  return out;
};

// ─── the player ──────────────────────────────────────────────────────────────

const POWER = Object.fromEntries(
  (() => { try { return JSON.parse(readFileSync("public/data/cards.json", "utf8")).map((c) => [c.id, c.power]); } catch { return []; } })(),
);

async function snap(page) {
  return page.evaluate(() => {
    const s = window.__auto?.state();
    if (!s) return null;
    const g = s.game;
    return { stage: s.stage, phase: g?.phase ?? null, turn: g?.turn ?? 0, turnPlayer: g?.turnPlayer ?? null, pending: g?.pendingChoice ?? null,
      battle: g?.battle ?? null, winner: g?.winner ?? null, winReason: g?.winReason ?? null, legal: s.legal,
      players: g ? Object.fromEntries(Object.entries(g.players).map(([k, p]) => [k, { leader: p.leaderIid, chars: p.zones.characterArea, hand: p.zones.hand, don: p.don }])) : null };
  });
}

let lastSel = "";
async function act(page, sel, label) {
  lastSel = sel;
  const loc = page.locator(sel).first();
  await loc.click({ timeout: 4000 });
  return label ?? sel;
}
/** What sits at the center of the last clicked selector (STUCK diagnostics). */
async function hitDiag(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return `${sel}: not in DOM`;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const d = (e) => e ? `${e.tagName.toLowerCase()}.${String(e.className).split(" ").slice(0, 2).join(".")}${e.dataset?.iid ? `[${e.dataset.iid}]` : ""}${e.dataset?.act ? `[${e.dataset.act}]` : ""}` : "null";
    return `${sel} @ ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} → hit ${d(hit)}${hit && (el.contains(hit) || hit.contains(el)) ? " (self)" : " (OTHER)"}; classes ${el.className}`;
  }, lastSel);
}

/** One bot decision: returns a description of the move, or null if idle. */
async function botMove(page, s, rnd, vp, turnMoves) {
  const pc = s.pending;
  const me = s.turnPlayer;
  const opp = Object.keys(s.players).find((k) => k !== me);
  if (pc) {
    switch (pc.kind) {
      case "mulligan": return act(page, rnd() < 0.5 ? '[data-act="keep"]' : '[data-act="mulligan"]', "mulligan");
      case "blockWindow": {
        if (pc.blockers.length && rnd() < 0.6) return act(page, `[data-iid="${pick(rnd, pc.blockers)}"]`, "block");
        return act(page, '[data-act="noblock"]', "noblock");
      }
      case "counterWindow": {
        const cc = s.legal?.counterCards ?? [], ce = s.legal?.counterEvents ?? [];
        const all = [...cc, ...ce];
        if (all.length && rnd() < 0.55) return act(page, `[data-iid="${pick(rnd, all).iid}"]`, "counter");
        return act(page, '[data-act="endcounters"]', "endcounters");
      }
      case "triggerDecision": return act(page, rnd() < 0.6 ? '[data-act="trigger-activate"]' : '[data-act="trigger-decline"]', "trigger");
      case "mayActivate": return act(page, rnd() < 0.7 ? '[data-act="may-yes"]' : '[data-act="may-no"]', "may");
      case "manualResolve": return act(page, '[data-act="manual-done"]', "manual-done");
      case "selectTargets": {
        const max = Math.min(pc.count, pc.candidates.length);
        const n = pc.upTo ? Math.floor(rnd() * (max + 1)) : max;
        const cands = [...pc.candidates].sort(() => rnd() - 0.5).slice(0, n);
        for (const c of cands) await act(page, `[data-iid="${c.iid}"]`);
        return act(page, '[data-act="confirm-targets"]', `targets(${n})`);
      }
      case "peekSelect": {
        const take = pc.eligible.length && rnd() < 0.8 ? [pick(rnd, pc.eligible)] : [];
        for (const t of take) await act(page, `[data-peek-iid="${t}"]`);
        if (["topAnyOrder", "bottomAnyOrder", "topOrBottomAnyOrder"].includes(pc.rest) && rnd() < 0.7) {
          const rest = pc.cards.filter((c) => !take.includes(c)).sort(() => rnd() - 0.5);
          for (const c of rest) await act(page, `[data-act="peek-order"][data-peek-iid="${c}"]`);
          if (pc.rest === "topOrBottomAnyOrder") for (const c of rest) if (rnd() < 0.5) await act(page, `[data-act="peek-side"][data-peek-iid="${c}"]`);
        }
        return act(page, '[data-act="peek-confirm"]', `peek(take ${take.length})`);
      }
      case "payDon": {
        if (rnd() < 0.5) await act(page, '[data-act="paydon-auto"]');
        else {
          // manual composition: press + on random rows until the total matches
          for (let i = 0; i < pc.amount * 4; i++) {
            const pluses = await page.locator('[data-act^="paydon-plus-"]:not([disabled])').all();
            if (!pluses.length) break;
            await pluses[Math.floor(rnd() * pluses.length)].click();
          }
          const ok = await page.locator('[data-act="paydon-confirm"]:not([disabled])').count();
          if (!ok) await act(page, '[data-act="paydon-auto"]');
        }
        return act(page, '[data-act="paydon-confirm"]', "paydon");
      }
      case "chooseNumber": {
        const v = pc.min + Math.floor(rnd() * (pc.max - pc.min + 1));
        await act(page, `[data-act="number-${v}"]`);
        return act(page, '[data-act="number-confirm"]', `number(${v})`);
      }
      default: throw new Error(`unknown choice ${pc.kind}`);
    }
  }
  if (s.phase !== "main" || s.battle) return null;
  const lm = s.legal ?? {};
  const p = s.players[me];
  const options = [];
  if (turnMoves < 14) {
    for (const h of lm.playableFromHand ?? []) options.push({ w: 3, run: async () => {
      await act(page, `[data-iid="${h.iid}"]`);
      await page.waitForTimeout(80);
      const playBtn = page.locator('[data-act="play-selected"]');
      if (await playBtn.count()) await playBtn.click();
      if (h.needsReplace) { await page.waitForTimeout(80); const tgt = pick(rnd, p.chars); if (tgt) await act(page, `[data-iid="${tgt}"]`); }
      return `play ${h.iid}`;
    } });
    if ((lm.canGiveDonTo ?? []).length && p.don.active > 0) options.push({ w: 2, run: async () => {
      const n = 1 + Math.floor(rnd() * p.don.active);
      await act(page, `[data-don-seat="${me}"][data-don-index="${n}"]`);
      await page.waitForTimeout(60);
      const tgt = pick(rnd, lm.canGiveDonTo);
      await act(page, `[data-iid="${tgt}"]`);
      return `giveDon ${n} → ${tgt}`;
    } });
    for (const a of lm.activatable ?? []) options.push({ w: 2, run: async () => { await act(page, `[data-act="activate"][data-iid="${a.iid}"]`); return `activate ${a.iid}`; } });
    for (const a of lm.attackers ?? []) options.push({ w: 3, run: async () => {
      await act(page, `[data-iid="${a.iid}"]`);
      await page.waitForTimeout(60);
      if (process.env.QA_TRACE) console.log("    after attacker click: pending", (await snap(page))?.pending?.kind ?? "none", "matches", await page.locator(`[data-iid="${a.iid}"]`).count());
      const tgt = rnd() < 0.7 ? s.players[opp].leader : pick(rnd, a.targets);
      await act(page, `[data-iid="${tgt}"]`);
      if (process.env.QA_TRACE) console.log("    after target click: pending", (await snap(page))?.pending?.kind ?? "none", "target matches", await page.locator(`[data-iid="${tgt}"]`).count());
      return `attack ${a.iid} → ${tgt}`;
    } });
  }
  if (lm.canEndTurn) options.push({ w: options.length ? 1 : 10, run: async () => { await act(page, '[data-act="endturn"]'); return "endTurn"; } });
  if (!options.length) return null;
  const total = options.reduce((a, o) => a + o.w, 0);
  let r = rnd() * total;
  for (const o of options) { r -= o.w; if (r <= 0) return o.run(); }
  return options[options.length - 1].run();
}

async function playGame(browser, vp, cfg, seed) {
  const ctx = await makeContext(browser, vp);
  const page = await ctx.newPage();
  const drain = attachCollectors(page);
  const tag = { viewport: vp.name, config: cfg.name, seed };
  const rnd = rngFrom(seed);
  let moves = 0, lastMove = "-";
  const report = async (list, extra = {}) => { for (const f of list) await finding(page, { ...tag, move: lastMove, moveNo: moves, ...extra, ...f }); };
  try {
    await page.addInitScript((s) => { window.__autoSeed = s; }, seed);
    await login(page, ctx);
    await page.locator(".hu-mode", { hasText: "Play Auto" }).click();
    await page.waitForSelector("[data-deck-key]", { timeout: 15000 });
    await page.locator(`[data-seat="0"][data-deck-key="${cfg.a}"]`).first().click();
    await page.locator(`[data-seat="1"][data-deck-key="${cfg.b}"]`).first().click();
    await act(page, '[data-act="start"]');
    await act(page, '[data-act="roll"]');
    await page.waitForSelector('[data-act="first"]', { timeout: 8000 });
    await act(page, rnd() < 0.5 ? '[data-act="first"]' : '[data-act="second"]');
    await page.waitForSelector(".ba-field", { timeout: 8000 });
    await page.waitForTimeout(300);
    // trace the UI call site of every refusal banner (dev-only store hook)
    await page.evaluate(() => {
      window.__qaBannerTrace = null;
      window.__auto?.store?.subscribe((st, prev) => {
        if (st.banner && st.banner !== prev.banner && st.banner.tone !== "info") {
          window.__qaBannerTrace = (new Error().stack || "").split("\n").filter((l) => /BoardAutoPage|autoStore/.test(l)).slice(0, 6).map((l) => l.trim().replace(/\(?https?:\/\/[^)]*\)?/g, "")).join(" ← ");
        }
      });
    });
    await report(drain());
    await report(await page.evaluate(PAGE_CHECKS));

    const started = Date.now();
    let lastSig = "", stuck = 0, turnMoves = 0, lastTurn = 0;
    while (moves < MAX_MOVES) {
      if (Date.now() - started > GAME_TIMEOUT_MS) { await report([{ kind: "STUCK", severity: "high", message: `game timeout after ${moves} moves (turn ${lastTurn})` }]); break; }
      // close a stray card sheet (compact)
      const bd = page.locator(".ba-sheet-backdrop");
      if (await bd.count()) { await bd.click({ position: { x: 5, y: 5 }, timeout: 2000 }).catch(() => {}); await page.waitForTimeout(60); }
      const s = await snap(page);
      if (!s || s.stage !== "play") { await report([{ kind: "STUCK", severity: "high", message: `left the game unexpectedly (stage ${s?.stage})` }]); break; }
      if (s.phase === "over") break;
      if (s.turn !== lastTurn) { lastTurn = s.turn; turnMoves = 0; }
      const sig = JSON.stringify([s.turn, s.pending?.kind, s.battle?.step, s.players]);
      stuck = sig === lastSig ? stuck + 1 : 0; lastSig = sig;
      if (stuck >= 6) { await report([{ kind: "STUCK", severity: "high", message: `no state change after 6 moves; last move "${lastMove}"; pending ${s.pending?.kind ?? "none"}; phase ${s.phase}; last click: ${await hitDiag(page)}` }]); break; }
      // checks on this state
      await report(drain());
      await report(await page.evaluate(BOARD_CHECKS, { power: POWER, touch: vp.mobile, modeActive: false }));
      if (moves % 10 === 0) await report(await page.evaluate(PAGE_CHECKS));
      // dismiss any banner left by an earlier move, so a banner seen after
      // THIS move is attributed to it
      await page.evaluate(() => document.querySelector(".ba-banner")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      // move
      let desc;
      try { desc = await botMove(page, s, rnd, vp, turnMoves); }
      catch (e) { await report([{ kind: "MOVE FAILED", severity: "high", message: `${e.message.split("\n")[0].slice(0, 200)} (pending ${s.pending?.kind ?? "none"}); last click: ${await hitDiag(page)}` }]); desc = null; stuck += 2; }
      if (desc) { lastMove = desc; moves++; turnMoves++; }
      await page.waitForTimeout(90);
      // a red banner after a legal move = UI offered something the engine refused
      const banner = await page.evaluate(() => document.querySelector(".ba-banner:not(.info)")?.textContent ?? null);
      if (banner && desc) {
        const trace = await page.evaluate(() => { const t = window.__qaBannerTrace; window.__qaBannerTrace = null; return t; });
        await report([{ kind: "ILLEGAL AFFORDANCE", severity: "medium", message: `after "${desc}" (pending was ${s.pending?.kind ?? "none"}${s.pending?.kind === "selectTargets" ? ` ${s.pending.actionKind} cands=${s.pending.candidates.map((c) => c.iid).join("/")}` : ""}): ${banner.slice(0, 160)}${trace ? ` · raised by: ${trace}` : ""}` }]);
      }
    }
    const end = await snap(page);
    await report(drain());
    const shot = `${SHOTS}/game-${cfg.name}-${vp.name}-${seed}.png`;
    await page.screenshot({ path: shot }).catch(() => {});
    return { ...tag, moves, result: end?.phase === "over" ? `${end.winner} wins (${end.winReason}) turn ${end.turn}` : `unfinished at turn ${end?.turn}`, screenshot: shot };
  } catch (e) {
    await report([{ kind: "BOT CRASH", severity: "high", message: e.message.split("\n")[0].slice(0, 240) }]);
    return { ...tag, moves, result: "crashed" };
  } finally {
    await ctx.close();
  }
}

// ─── the crawler ─────────────────────────────────────────────────────────────

const VIEWS = ["home", "deck-constructor", "my-decks", "popular-decklists", "directory", "profile-viewer", "edit-profile", "rankings", "meta", "records", "statistics", "messages", "friends", "global-chat", "notifications", "duel-room", "board", "board2"];
const CRAWL_VIEWPORTS = [{ name: "desktop", w: 1440, h: 900, mobile: false }, { name: "tablet", w: 768, h: 1024, mobile: true }, { name: "phone", w: 390, h: 844, mobile: true }];

async function crawl(browser) {
  const rows = [];
  for (const vp of CRAWL_VIEWPORTS) {
    if (QUICK && vp.name !== "desktop") continue;
    const ctx = await makeContext(browser, vp);
    const page = await ctx.newPage();
    const drain = attachCollectors(page);
    const tag = { viewport: vp.name, config: "crawl", seed: "-" };
    try {
      // login page first (logged-out context would need its own; we check the form while logged in is not possible → open it fresh)
      // logged-out context (HMR muted like the others: a live edit by another
      // agent must not reload the page under the checks)
      const fresh = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, ...(vp.mobile ? { isMobile: true, hasTouch: true } : {}) });
      await fresh.addInitScript(() => {
        const O = window.WebSocket;
        window.WebSocket = class extends O {
          constructor(u, p) { if (String(u).includes("localhost:5173")) super("ws://localhost:9"); else super(u, p); }
        };
      });
      const fp = await fresh.newPage();
      const fdrain = attachCollectors(fp);
      await fp.goto(BASE, { waitUntil: "networkidle" });
      await fp.waitForTimeout(800);
      for (const f of fdrain()) await finding(fp, { ...tag, view: "login", ...f });
      for (const f of await fp.evaluate(PAGE_CHECKS)) await finding(fp, { ...tag, view: "login", ...f });
      await fp.screenshot({ path: `${SHOTS}/crawl-login-${vp.name}.png` }).catch(() => {});
      rows.push({ view: "login", viewport: vp.name, screenshot: `${SHOTS}/crawl-login-${vp.name}.png` });
      await fresh.close();

      await login(page, ctx);
      for (const view of VIEWS) {
        try {
          await page.evaluate((v) => window.__auto?.setView?.(v), view);
          await page.waitForTimeout(1300);
          for (const f of drain()) await finding(page, { ...tag, view, ...f });
          for (const f of await page.evaluate(PAGE_CHECKS)) await finding(page, { ...tag, view, ...f });
        } catch (e) {
          // a view that navigates / reloads the document is itself a finding;
          // recover the session and keep crawling
          await finding(null, { ...tag, view, kind: "VIEW NAVIGATED AWAY", severity: "medium", message: `${e.message.split("\n")[0].slice(0, 160)} — url now ${page.url()}` });
          await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
          await page.waitForSelector(".hu-mode", { timeout: 15000 }).catch(() => {});
        }
        const shot = `${SHOTS}/crawl-${view}-${vp.name}.png`;
        await page.screenshot({ path: shot }).catch(() => {});
        rows.push({ view, viewport: vp.name, screenshot: shot });
      }
    } catch (e) {
      await finding(page, { ...tag, kind: "CRAWL CRASH", severity: "high", message: e.message.split("\n")[0].slice(0, 240) });
    } finally {
      await ctx.close();
    }
  }
  return rows;
}

// ─── report writer (also used by QA_MERGE) ───────────────────────────────────

function writeReport(dir, { games, crawlRows, findings, seconds }) {
  mkdirSync(dir, { recursive: true });
  const sev = { high: 0, medium: 0, low: 0 };
  for (const f of findings) sev[f.severity] = (sev[f.severity] ?? 0) + 1;
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind));
  const rel = (p) => (p ? p.replace(/^scripts\/\.qa\//, "").replace(/^scripts\//, "../") : null);
  const repro = (f) => f.seed && f.seed !== "-" ? `QA_SEED=${f.seed} QA_CONFIG=${f.config} QA_VIEWPORT=${f.viewport} QA_SKIP_CRAWL=1 npm run qa:bot` : `QA_SKIP_GAMES=1 npm run qa:bot (view ${f.view ?? "?"} @ ${f.viewport})`;
  const md = [
    `# QA bot report — ${new Date().toISOString()}`,
    ``,
    `Duration ${seconds}s · games ${games.length} · views crawled ${crawlRows.length} · findings ${findings.length} (high ${sev.high}, medium ${sev.medium}, low ${sev.low})`,
    ``,
    `## Games`,
    ``,
    `| config | viewport | seed | moves | result |`, `|---|---|---|---|---|`,
    ...games.map((g) => `| ${g.config} | ${g.viewport} | \`${g.seed}\` | ${g.moves} | ${g.result} |`),
    ``,
    `## Findings`,
    ``,
    `| sev | kind | message | where | ×n | screenshot | reproduce |`, `|---|---|---|---|---|---|---|`,
    ...findings.map((f) => `| **${f.severity}** | ${f.kind} | ${f.message.replace(/\|/g, "\\|")} | ${f.config}${f.view ? `/${f.view}` : ""} @ ${f.viewport}${f.move ? ` · move ${f.moveNo} "${f.move}"` : ""} | ${f.count} | ${f.screenshot ? `[shot](${rel(f.screenshot)})` : "-"} | \`${repro(f)}\` |`),
    ``,
    `## Crawled views`,
    ``,
    ...crawlRows.map((r) => `- ${r.view} @ ${r.viewport} → ${rel(r.screenshot)}`),
    ``,
  ].join("\n");
  writeFileSync(`${dir}/report.md`, md);
  writeFileSync(`${dir}/report.json`, JSON.stringify({ generated: new Date().toISOString(), games, crawl: crawlRows, findings, severity: sev }, null, 2));
  console.log(`\n${findings.length} finding(s): high ${sev.high}, medium ${sev.medium}, low ${sev.low} → ${dir}/report.md`);
  return sev;
}

if (process.env.QA_MERGE) {
  const parts = process.env.QA_MERGE.split(",").map((d) => JSON.parse(readFileSync(`${d.trim()}/report.json`, "utf8")));
  const all = { games: parts.flatMap((p) => p.games), crawlRows: parts.flatMap((p) => p.crawl), findings: [], seconds: 0 };
  const byKey = new Map();
  for (const f of parts.flatMap((p) => p.findings)) {
    const key = `${f.kind}|${f.viewport}|${f.message.replace(/\d+/g, "#").slice(0, 160)}`;
    const prev = byKey.get(key);
    if (prev) prev.count += f.count; else { byKey.set(key, { ...f }); all.findings.push(byKey.get(key)); }
  }
  const sev = writeReport("scripts/.qa", all);
  process.exit(sev.high > 0 ? 1 : 0);
}

// ─── main ────────────────────────────────────────────────────────────────────

const browser = await chromium.launch();
const games = [];
const t0 = Date.now();

if (!process.env.QA_SKIP_GAMES) {
  for (const vp of VIEWPORTS) {
    if (ONLY_VIEWPORT && vp.name !== ONLY_VIEWPORT) continue;
    if (QUICK && !ONLY_VIEWPORT && vp.name !== "desktop") continue;
    for (const cfg of CONFIGS) {
      if (ONLY_CONFIG && cfg.name !== ONLY_CONFIG) continue;
      const n = ONLY_SEED ? 1 : GAMES;
      for (let i = 0; i < n; i++) {
        const seed = ONLY_SEED || `qa-${cfg.name}-${i}`;
        console.log(`\n▶ game ${cfg.name} @ ${vp.name} seed=${seed}`);
        const g = await playGame(browser, vp, cfg, seed);
        console.log(`  → ${g.result} (${g.moves} moves)`);
        games.push(g);
      }
    }
  }
}

let crawlRows = [];
if (!process.env.QA_SKIP_CRAWL) {
  console.log("\n▶ crawling site views");
  crawlRows = await crawl(browser);
}
await browser.close();

const sev = writeReport(OUT, { games, crawlRows, findings, seconds: Math.round((Date.now() - t0) / 1000) });
process.exitCode = sev.high > 0 ? 1 : 0;
