/**
 * Privacy and Terms. Open to anyone, account or not (`/?page=privacy`,
 * `/?page=terms`, and the links on the login and the Home).
 *
 * The Privacy page says what the code really does: every statement here has a
 * place in `server/` behind it. When the server starts storing, sending or
 * sharing something new, this page changes in the same commit.
 * Who runs the site and how to reach them come from the server's settings
 * (SN_OPERATOR, SN_CONTACT_EMAIL), so the page is right on every host.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useAuthStore } from "../../app/authStore";
import { useUiStore } from "../../app/uiStore";
import { api, type SiteInfo } from "../../lib/api";
import { Header, Dock } from "../profiles/ProfilePages";
import { PixelScene } from "../pixel/PixelScene";
import "../home/home.css";
import "../profiles/profiles.css";
import "../credits/credits.css";
import "../account/account.css";

const UPDATED = "18 November 2026";

function useSite(): SiteInfo | null {
  const [site, setSite] = useState<SiteInfo | null>(null);
  useEffect(() => {
    api.site().then(setSite).catch(() => {});
  }, []);
  return site;
}

function Contact({ site }: { site: SiteInfo | null }) {
  if (!site) return <>…</>;
  if (!site.contactEmail) return <>the admin of this site (message them from the Player Directory)</>;
  return <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>;
}

function Shell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  const signedIn = useAuthStore((s) => !!s.user);
  return (
    <div className="sn snp px">
      <PixelScene kind="night" />
      <Header title={title} sub={sub} />
      <div className="snp-body">
        <div className="snp-wrap cr legal">
          {children}
          <p className="legal-updated">Last updated: {UPDATED}</p>
        </div>
      </div>
      {signedIn && <Dock />}
    </div>
  );
}

export function PrivacyPage() {
  const site = useSite();
  const setView = useUiStore((s) => s.setView);
  return (
    <Shell title="Privacy" sub="What Sailing Network knows about you, and what it does with it">
      <section className="cr-sec">
        <h2>Who runs this site</h2>
        <p>
          Sailing Network is run by {site?.operator || "its admin"}. For anything about your data, write to <Contact site={site} />.
        </p>
      </section>

      <section className="cr-sec">
        <h2>What is stored</h2>
        <ul>
          <li><b>Your account:</b> email address, username, display name and the date you joined. Your password is never stored: only a one-way hash of it (Argon2), which cannot be turned back into the password.</li>
          <li><b>Your profile:</b> what you write or pick yourself (bio, country, favourite Leader).</li>
          <li><b>Your decks</b> and the results of your games: opponent, Leaders, who won, who went first.</li>
          <li><b>Replays:</b> a finished game is kept so it can be watched again, with the two players' names, both decks and hands, and the chat of that game.</li>
          <li><b>Messages:</b> private messages and Global Chat lines, as you wrote them, until you or an admin delete them.</li>
          <li><b>Friends, follows and blocks</b>, and the reports you send to the admins.</li>
          <li><b>Sign-in sessions:</b> a record that your browser is signed in, for 30 days or until you log out.</li>
          <li><b>Technical records:</b> a one-way hash of your network address, to remember that you have seen the welcome screen; your network address in memory only, for a few minutes, to stop floods of requests; and, when a page crashes, the error and the page it happened on.</li>
        </ul>
      </section>

      <section className="cr-sec">
        <h2>Cookies and your browser</h2>
        <p>
          One cookie, <code>sn_session</code>: it keeps you signed in and the page's scripts cannot read it. There are no
          advertising or analytics cookies and no trackers from other companies.
        </p>
        <p>
          Your browser also keeps, on your own device, a few preferences and the game you are in the middle of, so a reload
          does not lose it. That never leaves your device.
        </p>
      </section>

      <section className="cr-sec">
        <h2>Who can see what</h2>
        <ul>
          <li><b>Other signed-in players</b> see your username, display name, profile, public decks, records and place on the ladder. They never see your email address.</li>
          <li><b>Anyone with the link of a replay</b> can watch it without an account: the players' names, the game and its chat.</li>
          <li><b>A private message</b> is read by you and the person you wrote to. If one of you reports a message, the admins read the reported words.</li>
          <li><b>The admins</b> see the list of accounts with their email addresses, and the reports.</li>
        </ul>
      </section>

      <section className="cr-sec">
        <h2>Who else receives data</h2>
        <ul>
          <li>The company that hosts the server stores the database on our behalf.</li>
          {site?.mail !== false && <li>When the site sends you an email (a link to set a new password or to confirm your address), your email address and that message go through an email delivery service.</li>}
          <li>Card images are fetched by the server, not by your browser: the sites they come from do not see you.</li>
        </ul>
        <p>Your data is not sold, and it is not used for advertising.</p>
      </section>

      <section className="cr-sec">
        <h2>How long, and how to leave</h2>
        <p>
          Everything is kept while your account exists. You can delete your account yourself, at any time, from{" "}
          <a onClick={() => setView("edit-profile")}>Edit Profile</a>: the account, profile, decks, messages, chat lines,
          friends and your own practice replays are deleted for good. Other players keep their own records of the games they
          played with you, and the replays of those games, with your name replaced by “Deleted captain” and your chat lines removed.
        </p>
        <p>Links sent by email stop working after one hour (new password) or one day (confirming your address).</p>
      </section>

      <section className="cr-sec">
        <h2>Your rights</h2>
        <p>
          You can read and correct what you gave us in your profile, and delete your account as described above. For a copy of
          your data, or for anything else — including the rights the GDPR gives you if you live in the European Union or the
          United Kingdom (access, correction, deletion, portability, objection, and a complaint to your data protection
          authority) — write to <Contact site={site} />.
        </p>
      </section>
    </Shell>
  );
}

export function TermsPage() {
  const site = useSite();
  const setView = useUiStore((s) => s.setView);
  return (
    <Shell title="Terms" sub="The rules of the ship">
      <section className="cr-sec">
        <h2>What this is</h2>
        <p>
          Sailing Network is a free, fan-made place to build decks and play the ONE PIECE CARD GAME online. It is not affiliated
          with or endorsed by Bandai, Shueisha, Toei Animation or Eiichiro Oda, who own the game, its cards and its artwork
          (see <a onClick={() => setView("credits")}>Credits</a>). It is run by {site?.operator || "its admin"}; contact: <Contact site={site} />.
        </p>
      </section>

      <section className="cr-sec">
        <h2>Your account</h2>
        <ul>
          <li>One account per person. Give an email address that is yours: it is how you get back in if you forget your password.</li>
          <li>Keep your password to yourself. What happens from your account is yours to answer for.</li>
          <li>You can delete your account whenever you want, from Edit Profile.</li>
        </ul>
      </section>

      <section className="cr-sec">
        <h2>How to behave</h2>
        <ul>
          <li>No harassment, threats, hate, sexual content or spam, in chat, messages, names, decks or profiles.</li>
          <li>Do not pretend to be someone else.</li>
          <li>Play fair: no second accounts to move rating, no agreed results, no tools that play for you, no use of bugs to win. Found a bug? Tell the admins.</li>
          <li>Do not attack the site or try to reach other people's accounts or data.</li>
        </ul>
        <p>
          You can block a captain and report them to the admins. The admins may delete content, close a report without
          action, suspend or ban an account that breaks these rules.
        </p>
      </section>

      <section className="cr-sec">
        <h2>Games, ranked and replays</h2>
        <ul>
          <li>A ranked game is judged by the server. Leaving the table is a loss; there are no take-backs.</li>
          <li>Finished games are kept as replays. A replay can be watched by anyone who has its link, with the players' names and the game's chat.</li>
          <li>Ratings, records and seasons may be reset, especially while the site is in beta.</li>
        </ul>
      </section>

      <section className="cr-sec">
        <h2>What you write</h2>
        <p>
          What you write and build here stays yours. By posting it you let the site store it and show it to the people it is
          meant for, as the <a onClick={() => setView("privacy")}>Privacy</a> page describes.
        </p>
      </section>

      <section className="cr-sec">
        <h2>No promises</h2>
        <p>
          The site is offered as it is, for free, by fans. It may be slow, wrong about a card, unavailable, or closed one day,
          and data may be lost. Cards are played by a rules engine that can make mistakes: the printed card and the official
          rules are always the reference.
        </p>
        <p>These terms may change; the date below says when they last did.</p>
      </section>
    </Shell>
  );
}
