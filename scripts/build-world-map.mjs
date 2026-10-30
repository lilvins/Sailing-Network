/* The One Piece world as a pixel sea chart, the backdrop of the whole Home.
     node scripts/build-world-map.mjs
   Drawn here pixel by pixel (project-original, a placeholder until the map
   is commissioned from an artist): the Red Line running north-south with
   Reverse Mountain where it crosses the Grand Line, the two Calm Belts, the
   four Blues, scattered islands, the route, an X on Laugh Tale, a compass.
   Layout (One Piece wiki): North Blue top-left, East Blue top-right, West
   Blue bottom-left, South Blue bottom-right; Paradise is the Grand Line east
   of the Red Line, the New World west of it. Mary Geoise sits where the Red
   Line crosses the Grand Line again, at the map's wrapping edges.
   Outputs into public/assets/bg/world-map/:
     map.png              384×216 (16:9) chart, scaled up by CSS (pixelated)
     sparkle-a/b.png      two frames of light glints on the water
     ship.png             7×6 ship that sails the Grand Line */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = "public/assets/bg/world-map";
mkdirSync(OUT, { recursive: true });

const W = 384, H = 216;
// bands (y): Blues | Calm Belt | Grand Line | Calm Belt | Blues
const BELT_N = 88, GL_TOP = 98, GL_BOT = 118, BELT_S = 128;
const MID_X = 192, ROUTE_Y = 109;

// seeded RNG so every rebuild draws the same world
let seed = 1997; // the year the manga started
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  sea: hex("#0e1f45"), seaWave: hex("#1d3a74"), grid: hex("#152a5c"),
  belt: hex("#22457a"), beltEdge: hex("#3a63a3"),
  gl: hex("#0a2342"), glWave: hex("#1f5287"),
  foam: hex("#2f6aa6"), sand: hex("#d8c08a"), sandDark: hex("#a88d5a"), grass: hex("#4f8a4b"), grassDark: hex("#356638"),
  rock: hex("#8f2a22"), rockHi: hex("#c0443a"), rockLo: hex("#5a1712"),
  mtn: hex("#7a3a2a"), mtnHi: hex("#a65a3e"), snow: hex("#e9edf2"), stream: hex("#6fb6e8"),
  city: hex("#f2efe6"), route: hex("#c9a95a"), gold: hex("#f0c850"), red: hex("#d0302a"),
  text: hex("#c9d6ee"), textDim: hex("#7f95bf"), shadow: hex("#060d22"),
};

const px = Buffer.alloc(W * H * 4);
const land = new Uint8Array(W * H); // 1 = land / rock, nothing else paints over it
const put = (x, y, c, a = 255) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
};
const isSea = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !land[y * W + x];
const inGL = (y) => y >= GL_TOP && y < GL_BOT;
const inBelt = (y) => (y >= BELT_N && y < GL_TOP) || (y >= GL_BOT && y < BELT_S);

/* ── 1. the sea: flat Calm Belts, waves everywhere else, a faint chart grid ── */
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) put(x, y, inGL(y) ? C.gl : inBelt(y) ? C.belt : C.sea);
for (let y = 0; y < H; y += 36) for (let x = 0; x < W; x += 2) if (!inBelt(y)) put(x, y, C.grid);
for (let x = 24; x < W; x += 48) for (let y = 0; y < H; y += 2) if (!inBelt(y)) put(x, y, C.grid);
// wave marks: short 3px strokes with a raised middle, denser on the Grand Line
for (let n = 0; n < 1300; n++) {
  const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
  if (inBelt(y) || (!inGL(y) && rnd() < 0.45)) continue;
  const c = inGL(y) ? C.glWave : C.seaWave;
  put(x, y, c); put(x + 1, y - 1, c); put(x + 2, y, c);
}
// dashed edges of the Calm Belts
for (const y of [BELT_N, BELT_S - 1]) for (let x = 0; x < W; x++) if (x % 5 < 3) put(x, y, C.beltEdge);

/* ── 2. the route along the Grand Line (islands and rock paint over it) ── */
for (let x = 0; x < W; x++) {
  const y = Math.round(ROUTE_Y + Math.sin(x / 19) * 1.6);
  if (x % 4 < 2) put(x, y, C.route);
}

/* ── 3. the Red Line: jagged rock, lit from the west ── */
function redLine(x0, x1, y0 = 0, y1 = H) {
  for (let y = y0; y < y1; y++) {
    const l = x0 + Math.round(rnd() * 1.4), r = x1 - Math.round(rnd() * 1.4);
    for (let x = l; x <= r; x++) {
      put(x, y, x === l ? C.rockHi : x === r ? C.rockLo : (x + y) % 7 === 0 ? C.rockLo : C.rock);
      if (x >= 0 && x < W) land[y * W + x] = 1;
    }
  }
}
redLine(MID_X - 4, MID_X + 3);
redLine(-3, 2); // the same rock, seen again at the edges where the world wraps
redLine(W - 3, W + 2);

/* ── 4. Reverse Mountain: a peak on the crossing, four streams climbing it ── */
const PEAK_Y = ROUTE_Y - 2;
for (let y = BELT_N - 2; y < BELT_S + 2; y++) {
  const hw = Math.max(0, Math.round(15 - Math.abs(y - PEAK_Y) * 0.6));
  for (let x = MID_X - hw; x <= MID_X + hw; x++) {
    const d = Math.abs(x - MID_X) + Math.abs(y - PEAK_Y) * 0.6;
    put(x, y, d < 2.5 ? C.snow : x < MID_X - hw / 3 ? C.mtnHi : x > MID_X + hw / 2 ? C.rockLo : C.mtn);
    land[y * W + x] = 1;
  }
}
// one stream from each Blue up to the summit
for (const [sx, sy] of [[MID_X - 13, BELT_N - 8], [MID_X + 13, BELT_N - 8], [MID_X - 13, BELT_S + 8], [MID_X + 13, BELT_S + 8]]) {
  for (let t = 0; t <= 1; t += 0.02) {
    const x = Math.round(sx + (MID_X - sx) * t), y = Math.round(sy + (PEAK_Y - sy) * t);
    if (Math.abs(x - MID_X) + Math.abs(y - PEAK_Y) > 2) put(x, y, C.stream);
  }
}
// Mary Geoise: a white city on top of the Red Line at both wrapping edges
for (const x0 of [0, W - 3]) for (let y = GL_TOP + 6; y < GL_TOP + 11; y++) for (let x = x0; x < x0 + 3; x++) if ((x + y) % 3) put(x, y, C.city);

/* ── 5. the labels, in a 3×5 pixel font ── */
const FONT = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"], D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"], G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"], I: ["###", ".#.", ".#.", ".#.", "###"],
  L: ["#..", "#..", "#..", "#..", "###"], M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"], O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."], R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."], T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"], W: ["#.#", "#.#", "###", "###", "#.#"],
};
const labels = []; // rectangles islands must keep clear of
function glyph(ch, x, y, color) {
  FONT[ch]?.forEach((row, dy) => [...row].forEach((c, dx) => {
    if (c !== "#") return;
    put(x + dx + 1, y + dy + 1, C.shadow);
    put(x + dx, y + dy, color);
  }));
}
function label(text, cx, y, color = C.text) {
  const w = text.length * 4 - 1, x0 = Math.round(cx - w / 2);
  [...text].forEach((ch, i) => glyph(ch, x0 + i * 4, y, color));
  labels.push([x0 - 3, y - 3, x0 + w + 3, y + 8]);
}
function labelDown(text, x, y0, color) { // stacked letters, for the Red Line
  let y = y0;
  for (const ch of text) { if (ch !== " ") glyph(ch, x, y, color); y += ch === " " ? 3 : 6; }
}

label("NORTH BLUE", 100, 40);
label("EAST BLUE", 290, 40);
label("WEST BLUE", 100, 170);
label("SOUTH BLUE", 290, 170);
label("CALM BELT", 60, BELT_N + 3, C.textDim);
label("CALM BELT", 330, BELT_S - 8, C.textDim);
label("NEW WORLD", 96, GL_TOP + 3);
label("PARADISE", 255, GL_TOP + 3);
label("GRAND LINE", 335, GL_TOP + 3);
labelDown("RED LINE", MID_X - 1, 36, C.snow);

/* ── 6. islands: chains along the Grand Line, scattered in the Blues ── */
const near = (x, y, pad) => labels.some(([a, b, c, d]) => x > a - pad && x < c + pad && y > b - pad && y < d + pad);
function island(cx, cy, r) {
  if (near(cx, cy, r + 1)) return false;
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++)
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++)
      if (!isSea(x, y) || inBelt(y) !== inBelt(cy)) return false;
  const shape = (x, y) => Math.hypot(x - cx, (y - cy) * 1.25) < r + (Math.sin(x * 2.1 + y * 1.3) * 0.6);
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++)
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      if (shape(x, y)) continue;
      if (shape(x + 1, y) || shape(x - 1, y) || shape(x, y + 1) || shape(x, y - 1)) put(x, y, C.foam);
    }
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      if (!shape(x, y)) continue;
      const inner = r >= 2.5 && Math.hypot(x - cx, (y - cy) * 1.25) < r - 1.3;
      put(x, y, inner ? ((x + y) % 4 === 0 ? C.grassDark : C.grass) : !shape(x, y + 1) ? C.sandDark : C.sand);
      land[y * W + x] = 1;
    }
  return true;
}
// Laugh Tale: the last island of the New World, just west of Reverse Mountain
const LT = [MID_X - 24, ROUTE_Y];
island(LT[0], LT[1], 3.2);
for (const [dx, dy] of [[-1, -1], [1, 1], [0, 0], [1, -1], [-1, 1]]) put(LT[0] + dx, LT[1] + dy, C.red);

for (let x = 12; x < W - 10; x += 11 + Math.floor(rnd() * 9)) {
  if (Math.abs(x - MID_X) < 20 || Math.abs(x - LT[0]) < 8) continue;
  island(x, ROUTE_Y + Math.round((rnd() - 0.5) * 6), 1.4 + rnd() * 2.2);
}
for (const [x0, x1, y0, y1] of [[8, MID_X - 14, 4, BELT_N - 5], [MID_X + 14, W - 8, 4, BELT_N - 5], [8, MID_X - 14, BELT_S + 5, H - 4], [MID_X + 14, W - 8, BELT_S + 5, H - 4]]) {
  let placed = 0;
  for (let n = 0; n < 300 && placed < 18; n++) {
    const r = rnd() < 0.2 ? 3 + rnd() * 2.5 : 1.3 + rnd() * 1.8;
    if (island(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), r)) placed++;
  }
}
island(40, BELT_N + 5, 1.5); // a few lonely rocks in the Calm Belts
island(140, BELT_S - 5, 1.6);
island(250, BELT_N + 5, 1.4);

/* ── 7. a compass rose in South Blue ── */
const [kx, ky] = [W - 28, H - 22];
for (let i = 1; i <= 9; i++) {
  const w = i < 3 ? 1 : 0;
  for (let s = -w; s <= w; s++) {
    put(kx + s, ky - i, i > 6 ? C.red : C.gold); put(kx + s, ky + i, C.route);
  }
  if (i <= 6) { put(kx + i, ky, C.gold); put(kx - i, ky, C.route); }
}
for (let a = 0; a < 32; a++) put(Math.round(kx + Math.cos(a / 5.1) * 5), Math.round(ky + Math.sin(a / 5.1) * 5), C.route);
put(kx, ky, C.snow);

await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png({ palette: true }).toFile(`${OUT}/map.png`);

/* ── sparkles: two frames of single-pixel glints on open water ── */
for (const name of ["sparkle-a", "sparkle-b"]) {
  const sp = Buffer.alloc(W * H * 4);
  for (let n = 0; n < 220; n++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
    if (!isSea(x, y) || inBelt(y) || near(x, y, 1)) continue;
    const i = (y * W + x) * 4;
    sp[i] = 170; sp[i + 1] = 210; sp[i + 2] = 245; sp[i + 3] = 200;
  }
  await sharp(sp, { raw: { width: W, height: H, channels: 4 } }).png({ palette: true }).toFile(`${OUT}/${name}.png`);
}

/* ── the ship that sails the Grand Line, 7×6 ── */
const SHIP = { f: C.red, m: hex("#3a2616"), s: hex("#e8e0c8"), h: hex("#6a4426") };
const ship = Buffer.alloc(7 * 6 * 4);
["...f...", "..sms..", ".ssmss.", "...m...", "hhhhhhh", ".hhhhh."].forEach((row, y) =>
  [...row].forEach((ch, x) => {
    if (!SHIP[ch]) return;
    const i = (y * 7 + x) * 4;
    [ship[i], ship[i + 1], ship[i + 2]] = SHIP[ch]; ship[i + 3] = 255;
  }));
await sharp(ship, { raw: { width: 7, height: 6, channels: 4 } }).png().toFile(`${OUT}/ship.png`);
console.log(`world map -> ${OUT}/ (map, sparkle-a, sparkle-b, ship)`);
