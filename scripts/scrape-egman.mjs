/* ===========================================================
   egmanevents OP15 scraper → public/data/popular.json
   Pulls recent regionals + their decklists (decklists are encoded in the
   deckbuilder "?deck=ID:count,..." links). Card art lives at
   deckbuilder.egmanevents.com/card_images/optcg/<ID>.webp.

   Usage:  node scripts/scrape-egman.mjs
   Be polite: this hits a third-party site — run occasionally, not in a loop.
   Fragile by nature (depends on egmanevents' markup); the app falls back to
   sample data if the JSON is missing.
   =========================================================== */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/data/popular.json");
const BASE = "https://egmanevents.com";
const LIST_URL = `${BASE}/one-piece-op15-tournaments`;
const ART_BASE = "https://deckbuilder.egmanevents.com/card_images/optcg/";
const MAX_REGIONALS = 6;
const MAX_DECKS = 12;

const AD_RE = /doubleclick|googlesyndication|adsrvr|rubiconproject|criteo|nitropay|btloader|google-analytics|adservice|amazon-adsystem|nitrocnct|adnxs|pubmatic|casalemedia/;

async function blockNoise(page) {
  await page.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (["image", "media", "font", "stylesheet"].includes(t)) return route.abort();
    if (AD_RE.test(route.request().url())) return route.abort();
    return route.continue();
  });
}

function parseDeckUrl(url) {
  const m = url.match(/[?&]deck=([^&]+)/);
  if (!m) return null;
  const cards = decodeURIComponent(m[1])
    .split(",")
    .map((s) => {
      const [id, c] = s.split(":");
      return { id: (id || "").trim(), count: parseInt(c, 10) || 1 };
    })
    .filter((x) => /^(OP|ST|EB|PRB|P)-?\d/.test(x.id));
  return cards.length ? cards : null;
}

async function scrapeEvent(page, slug) {
  await page.goto(`${BASE}/one-piece-op15-tournaments/${slug}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('a[href*="deckbuilder.egmanevents.com/?deck="]', { timeout: 15000 }).catch(() => {});
  const raw = await page.evaluate(() => {
    const txt = (document.body.innerText || "").replace(/’/g, "'");
    const title = (document.title || "").replace(/\s*[—-]\s*Egman Events.*/i, "").trim();
    const pm = txt.match(/([\d,]{2,6})\s*Players/i);
    const players = pm ? parseInt(pm[1].replace(/,/g, ""), 10) : null;
    const dm = txt.match(/Event Details\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?)/);
    const date = dm ? dm[1] : null;
    const leaders = [];
    const re = /(\d+)\s*-\s*((?:OP|ST|EB|PRB)\d{2}-\d{3})\s+(.+?)(?=\s+\d+\s*-\s*(?:OP|ST|EB|PRB)\d{2}-\d{3}|\s+Event Details|$)/gs;
    let m;
    while ((m = re.exec(txt))) leaders.push({ count: +m[1], id: m[2], name: m[3].trim().slice(0, 40) });
    const decks = [...new Set([...document.querySelectorAll('a[href*="deckbuilder.egmanevents.com/?deck="]')].map((a) => a.href))];
    return { title, players, date, leaders, decks };
  });

  const leaderMap = Object.fromEntries(raw.leaders.map((l) => [l.id, l.name]));
  const seen = new Set();
  const decks = [];
  for (const url of raw.decks) {
    const cards = parseDeckUrl(url);
    if (!cards) continue;
    const key = cards.map((c) => `${c.id}:${c.count}`).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const leaderCard = cards.find((c) => leaderMap[c.id]) || cards[0];
    decks.push({
      leaderId: leaderCard.id,
      leaderName: leaderMap[leaderCard.id] || leaderCard.id,
      cards: cards.filter((c) => c.id !== leaderCard.id),
    });
    if (decks.length >= MAX_DECKS) break;
  }
  return { slug, name: raw.title || slug, date: raw.date, players: raw.players, leaders: raw.leaders.slice(0, 8), decks };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148 Safari/537.36" });
  await blockNoise(page);

  console.log("→ list page");
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('a[href*="/one-piece-op15-tournaments/"]', { timeout: 15000 }).catch(() => {});
  const slugs = await page.evaluate(() => {
    const hrefs = [...document.querySelectorAll('a[href*="/one-piece-op15-tournaments/"]')]
      .map((a) => a.getAttribute("href") || "")
      .map((h) => h.replace(/^.*\/one-piece-op15-tournaments\//, "").replace(/[?#].*$/, ""))
      .filter((s) => s && !s.startsWith("category/") && !s.includes("/"));
    return [...new Set(hrefs)];
  });
  const regionalSlugs = slugs.filter((s) => /regional|top-16/i.test(s)).slice(0, MAX_REGIONALS);
  console.log("  regionals:", regionalSlugs);

  const regionals = [];
  for (const slug of regionalSlugs) {
    try {
      console.log("→ event", slug);
      const ev = await scrapeEvent(page, slug);
      if (ev.decks.length) regionals.push(ev);
      await page.waitForTimeout(800); // polite
    } catch (e) {
      console.warn("  skip", slug, String(e).slice(0, 120));
    }
  }

  await browser.close();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), artBase: ART_BASE, regionals }, null, 2));
  console.log(`✓ wrote ${OUT} — ${regionals.length} regionals, ${regionals.reduce((s, r) => s + r.decks.length, 0)} decks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
