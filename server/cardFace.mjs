// cardFace.mjs — a card drawn with its own text, sent when /cards/<id>.webp has
// no file yet (the cards revealed before their set is out). Every <img> of the
// site then shows something readable, and the real art replaces it once the
// file is there (it is sent with a short cache time).

const HUES = { Red: "#b8443c", Green: "#3f8f5a", Blue: "#3d6fb0", Purple: "#7a4ea8", Black: "#3a3a40", Yellow: "#b89a2e" };

const escapeXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Splits text into lines of at most `width` characters, at spaces. */
export function wrap(text, width) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line && (line + " " + word).length > width) { lines.push(line); line = word; }
      else line = line ? line + " " + word : word;
    }
    lines.push(line);
  }
  return lines;
}

/** `card` is a row of the cards table (colors and types as JSON text). */
export function cardFaceSvg(card) {
  const colors = JSON.parse(card.colors || "[]");
  const types = JSON.parse(card.types || "[]");
  const bg = HUES[colors[0]] ?? "#444";
  const leader = card.category === "Leader";
  const stats = [
    leader ? `Life ${card.cost}` : card.cost != null ? `Cost ${card.cost}` : "",
    card.power ? `${card.power} power` : "",
    card.counter ? `+${card.counter} counter` : "",
  ].filter(Boolean).join(" · ");
  const body = [...wrap(card.effect || "", 38), ...(card.trigger ? ["", ...wrap(`[Trigger] ${card.trigger}`, 38)] : [])];
  const size = body.length > 20 ? 8.5 : 10; // long texts get smaller letters to fit
  const text = body
    .map((l, i) => `<tspan x="14" dy="${i === 0 ? 0 : size * 1.3}">${escapeXml(l) || " "}</tspan>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" width="250" height="350" font-family="sans-serif">
<rect width="250" height="350" rx="10" fill="#14161b"/>
<rect x="4" y="4" width="242" height="342" rx="8" fill="none" stroke="${bg}" stroke-width="4"/>
<rect x="8" y="8" width="234" height="62" fill="${bg}"/>
<text x="14" y="30" font-size="15" font-weight="700" fill="#fff">${escapeXml(card.name)}</text>
<text x="14" y="48" font-size="10" fill="#f3efe6">${escapeXml(`${card.id} · ${card.category}`)}</text>
<text x="14" y="62" font-size="10" fill="#f3efe6">${escapeXml(stats)}</text>
<text x="14" y="86" font-size="9.5" fill="#a9a395">${escapeXml(types.join(" / "))}</text>
<text x="14" y="106" font-size="${size}" fill="#ece7dc">${text}</text>
<text x="14" y="338" font-size="8.5" fill="#7d786d">No picture yet</text>
</svg>`;
}
