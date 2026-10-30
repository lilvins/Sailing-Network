import { useUiStore } from "../../app/uiStore";
import "@fontsource/silkscreen/400.css"; // pixel titles + HUD labels (--hud)
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323/400.css"; // pixel names + numbers (--pixel)
import "./pixel.css";

/**
 * The pixel-art backdrop of the `.snp` pages (profiles, social, decks, admin,
 * credits) — the same register as the Duel Room and Play Auto. Put it as the
 * FIRST child of a page root that has the `px` class (`sn snp px`): it paints
 * the scene behind the page and the art's credit in the bottom-right corner,
 * as OGA-BY asks ("where people see the art"). The pixel pass on headers,
 * panels and buttons lives in pixel.css under `.snp.px`.
 */
export type SceneKind = "night" | "sunset" | "ocean";

interface SceneCredit {
  title: string;
  source: string;
  author: string;
  authorUrl: string;
  license: string;
  licenseUrl: string;
}

// keep in step with public/assets/bg/CREDITS.md and the Credits page
const CREDITS: Record<SceneKind, SceneCredit> = {
  night: {
    title: "Moon and Sea",
    source: "https://opengameart.org/content/moon-and-sea-pixel-art-background",
    author: "CraftPix.net",
    authorUrl: "https://craftpix.net",
    license: "OGA-BY 3.0",
    licenseUrl: "https://opengameart.org/content/oga-by-30-faq",
  },
  sunset: {
    title: "Sunset Clouds Over The Sea",
    source: "https://opengameart.org/node/158492",
    author: "CraftPix.net",
    authorUrl: "https://craftpix.net",
    license: "OGA-BY 3.0",
    licenseUrl: "https://opengameart.org/content/oga-by-30-faq",
  },
  ocean: {
    title: "Ocean View",
    source: "https://opengameart.org/node/133444",
    author: "ansimuz",
    authorUrl: "https://ansimuz.itch.io",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
};

// the PNG layers of each scene, back to front (each is an <i> in pixel.css)
const LAYERS: Record<SceneKind, string[]> = {
  night: ["base", "moon", "clouds", "refl"],
  sunset: ["sky", "cloud", "refl"],
  ocean: ["back", "clouds", "waves"],
};

export function PixelScene({ kind }: { kind: SceneKind }) {
  const setView = useUiStore((s) => s.setView);
  const c = CREDITS[kind];
  return (
    <>
      <div className={`pxs pxs-${kind}`} aria-hidden="true">
        {LAYERS[kind].map((l) => (
          <i key={l} className={l} />
        ))}
        <i className="shade" />
      </div>
      <span className="pxs-credit">
        <a href={c.source} target="_blank" rel="noopener noreferrer">“{c.title}”</a> by{" "}
        <a href={c.authorUrl} target="_blank" rel="noopener noreferrer">{c.author}</a> ·{" "}
        <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer">{c.license}</a> ·{" "}
        <button onClick={() => setView("credits")}>All credits</button>
      </span>
    </>
  );
}
