import { Header, Dock } from "../profiles/ProfilePages";
import "../home/home.css";
import "../profiles/profiles.css";
import "@fontsource/silkscreen/700.css"; // pixel section heads
import "./credits.css";
import { PixelScene } from "../pixel/PixelScene";

/**
 * Credits — every artwork, font and data source the site shows, with its
 * author, where it comes from and its license. The licenses that ask for
 * attribution (OGA-BY, CC-BY) are satisfied here and next to the art;
 * the CC0 / OFL ones are credited anyway. Keep it in step with
 * public/assets/bg/CREDITS.md.
 */
interface Credit {
  what: string;
  author: string;
  authorUrl?: string;
  source: string;
  license: string;
  licenseUrl: string;
  where: string;
  preview?: string;
}

const ART: Credit[] = [
  {
    what: "Moon and Sea Pixel Art Background",
    author: "CraftPix.net 2D Game Assets",
    authorUrl: "https://craftpix.net",
    source: "https://opengameart.org/content/moon-and-sea-pixel-art-background",
    license: "OGA-BY 3.0",
    licenseUrl: "https://opengameart.org/content/oga-by-30-faq",
    where: "The night sky over the Home banner, the login, the Play Auto table, the profile and social pages; the moon avatar used when a captain has none",
    preview: "/assets/bg/night-sea/full.png",
  },
  {
    what: "Sunset Clouds Over The Sea Pixel Background",
    author: "CraftPix.net 2D Game Assets",
    authorUrl: "https://craftpix.net",
    source: "https://opengameart.org/node/158492",
    license: "OGA-BY 3.0",
    licenseUrl: "https://opengameart.org/content/oga-by-30-faq",
    where: "The Duel Room, Leaderboard, Duel Records, Statistics, Meta and Popular Decks",
    preview: "/assets/bg/sunset-sea/sky.png",
  },
  {
    what: "Ocean View",
    author: "Luis Zuno (ansimuz)",
    authorUrl: "https://ansimuz.itch.io",
    source: "https://opengameart.org/node/133444",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    where: "Behind the Play Auto deck pick, the deck pages, Admin and this page",
    preview: "/assets/bg/ocean-view/back.png",
  },
  {
    what: "Treasure Hunters",
    author: "Pixel Frog",
    authorUrl: "https://pixelfrog-assets.itch.io",
    source: "https://pixelfrog-assets.itch.io/treasure-hunters",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    where: "The timber windows and their wood inside, the parchment notices, the pixel buttons (the red ones recoloured), the candle, flag, chest and helm beside page titles, Captain Clown Nose and Crabby in the empty pages",
    preview: "/assets/ui/board.png",
  },
  {
    what: "Animated water texture 128px",
    author: "YCbCr",
    source: "https://opengameart.org/content/animated-water-texture-128px",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    where: "The shimmering sea on the Home banner and the login",
  },
];

const FONTS: Credit[] = [
  { what: "Silkscreen", author: "The Silkscreen Project Authors", source: "https://github.com/googlefonts/silkscreen", license: "SIL OFL 1.1", licenseUrl: "https://openfontlicense.org", where: "Pixel titles and HUD labels" },
  { what: "VT323", author: "The VT323 Project Authors (Peter Hull)", source: "https://fonts.google.com/specimen/VT323", license: "SIL OFL 1.1", licenseUrl: "https://openfontlicense.org", where: "Duel log, chat and duelist names" },
  { what: "Pixelify Sans", author: "The Pixelify Sans Project Authors", source: "https://github.com/eifetx/Pixelify-Sans", license: "SIL OFL 1.1", licenseUrl: "https://openfontlicense.org", where: "Play vs Bot" },
  { what: "Sora", author: "The Sora Project Authors", source: "https://github.com/sora-xor/sora-font", license: "SIL OFL 1.1", licenseUrl: "https://openfontlicense.org", where: "Site text" },
  { what: "Manrope", author: "The Manrope Project Authors", source: "https://github.com/sharanda/manrope", license: "SIL OFL 1.1", licenseUrl: "https://openfontlicense.org", where: "Site text" },
];

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

function Row({ c }: { c: Credit }) {
  return (
    <li className="cr-row">
      {c.preview ? <img className="cr-thumb" src={c.preview} alt="" loading="lazy" /> : <span className="cr-thumb none" />}
      <div className="cr-main">
        <b className="cr-what"><a href={c.source} {...ext}>{c.what}</a></b>
        <span className="cr-by">by {c.authorUrl ? <a href={c.authorUrl} {...ext}>{c.author}</a> : c.author}</span>
        <span className="cr-where">{c.where}</span>
      </div>
      <a className="cr-license" href={c.licenseUrl} {...ext}>{c.license}</a>
    </li>
  );
}

export function CreditsPage() {
  return (
    <div className="sn snp px">
      <PixelScene kind="ocean" />
      <Header title="Credits" sub="The artists, fonts and data behind Sailing Network" hero="/assets/bg/sunset-sea/sky.png" />
      <div className="snp-body">
        <div className="snp-wrap cr">
          <section className="cr-sec">
            <h2>Pixel art</h2>
            <ul>{ART.map((c) => <Row key={c.what} c={c} />)}</ul>
            <p className="cr-note">
              The Home's wave pattern and boat, stars, gulls, the little ship, the white DON!! back and
              the pixel icons are drawn for this site (<code>src/features/pixel/icons.ts</code>,{" "}
              <code>scripts/build-home-pattern.mjs</code>,{" "}
              <code>scripts/build-pixel-fx.mjs</code>, <code>scripts/build-mode-cards.mjs</code>,{" "}
              <code>scripts/build-don-back.mjs</code>).
            </p>
          </section>
          <section className="cr-sec">
            <h2>Fonts</h2>
            <ul>{FONTS.map((c) => <Row key={c.what} c={c} />)}</ul>
          </section>
          <section className="cr-sec">
            <h2>Cards and data</h2>
            <p className="cr-note">
              ONE PIECE CARD GAME card images, card backs and the artwork cropped from them for the
              section banners are © Eiichiro Oda / Shueisha, Toei Animation, and Bandai. Sailing Network
              is a fan project, not affiliated with or endorsed by them.
            </p>
            <p className="cr-note">
              Card data from the community <a href="https://github.com/buhbbl/punk-records" {...ext}>punk-records</a> dataset;
              tournament decklists from <a href="https://deckbuilder.egmanevents.com" {...ext}>Egman Events</a>.
            </p>
          </section>
          <p className="cr-note">
            Made something you see here and want it credited differently, or removed? Message the admin from
            the Directory and it will be fixed.
          </p>
        </div>
      </div>
      <Dock />
    </div>
  );
}
