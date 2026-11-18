# Release checklist

Audit of 2026-11-17 on `main` at `644e002` (the audit before it: 2026-11-02). Both type
checks, 680 unit tests, 91 API checks and the production build pass; the problems below
are ones those tests don't see. Load limits were not measured. CI on GitHub was not
looked at today (no `gh` here; on 2026-11-11 it did not start: account billing).

## Decisions (Vins, 2026-11-17)

- [x] **Card art:** the card images stay (dotgg, `npm run art`). ST37-001 and ST38-001
      have no image there yet: they stay drawn in SVG.
- [x] **Ranked:** it must be a game both players share, run through the server. It may
      stay locked during the beta: `SN_RANKED` is `closed` in production until set to `open`.
- [x] **Database:** production starts from a clean one (`seed:cards` + `seed:admin`).
      That also leaves out the 40 bots, the demo accounts and the made-up games.
- [x] **Replays:** public by link; the players' names and the chat show to whoever has it.
- [ ] **Hosting target:** chosen last. It needs one persistent disk.
- [ ] **Bots online:** a clean database has none. If they are ever seeded in production
      they must show as bots: today nothing in the API or the pages tells them apart.

## Blockers

- [ ] **Ranked shows both hands to both browsers.** The server judges the game, but each
      browser still holds the whole of it (both hands, both decks), as in a friend game:
      a player who opens the developer tools can read the opponent's hand. Before ranked
      opens to strangers the server must send each player only what they may see.
- [ ] **Deploy.** Pick the host, copy `public/cards` there (2,973 files, 666 MB,
      `SN_CARDS_DIR`), set up database backups, try the Docker image (never built: no
      Docker here), and get CI running.
- [ ] **Legal pages: read them, and fill in who runs the site.** Privacy and Terms are
      written from what the code does, not by a lawyer. Set `SN_OPERATOR` and
      `SN_CONTACT_EMAIL`; decide the minimum age and the governing law, which they do
      not state.
- [ ] **Email is off until a provider is set.** Reset and confirmation links go out
      through Resend when `RESEND_API_KEY`, `SN_MAIL_FROM` and `SN_PUBLIC_URL` are set;
      until then an admin hands out reset links and no address can be confirmed.
      Never sent a real mail: the tests write them to a file.

## Important

- [ ] The replay of a friend game, or of a game against the AI or at one screen, is
      still the browser's word for what happened (a ranked replay is the server's own).
      The engine is on the server now: a friend game can be judged the same way.
- [ ] Ranked has no turn clock: a player who stays at the table without moving holds the
      game until the 2 hour limit cancels it with no result. Two accounts of one person
      can still trade wins by conceding, when the queue pairs them.
- [ ] A ranked game lives in the server's memory: a restart loses the games in progress
      (they end with no result, and the players are told).
- [ ] Reports reach the Admin page, but an admin can only close them or make a reset
      link there: banning is still API only (`POST /api/admin/bans`).
- [ ] A confirmed email address is shown but asked of nobody: an account with an
      address that is not theirs can do everything.
- [ ] SQLite: no index on `matches.created_at`; one writer process only; the ladder
      reads every counted row again after each new match (`server/stats/index.mjs:30`).
- [ ] The app has two links only, `?duel=CODE` and `?replay=ID`. Any other page has no
      address, and a refresh returns to Home.
- [ ] `registerBotGames` is still never called: Play vs Bot records get a 404. It allows
      anonymous writes, so add a session before wiring it.
- [ ] `/api/stats` (public) counts every account and every match row, bots and made-up
      games included. Gone with a clean database.
- [ ] Rules questions still open: three on OP18 cards and four older ones (`_Reports/`).
- [ ] The meta decks are those of 2026-10-27 (optcgwebsim's `/api/meta` answered with one
      Leader on 2026-11-15).
- [ ] Never tried: a phone, a long game between two people, a replay after a reload.

## Done

- [x] Account basics (2026-11-18): a new password by a one-use link (by email, or made
      by an admin), the email address confirmed by a link, a new password while signed
      in, and deleting the account with its data (`server/account.mjs`). Other players
      keep their games, with the deleted name and chat lines taken out of the replays.
- [x] Privacy and Terms pages (2026-11-18), open without an account, linked from the
      login, the signup and the Home.
- [x] Safety between players (2026-11-18): block a captain (their DMs and friend
      requests are refused, their chat lines hidden), report a player or a message to
      the admins with the words copied by the server, delete one's own chat line or
      private message; an admin deletes any chat line (`server/moderation.mjs`).
- [x] Two people play ranked (2026-11-17): the queue leads both to a table the server
      sets (seats, decks, seed, first player) and plays with the rules engine
      (`server/engine.mjs`). An illegal move is refused; the result and the replay are
      written by the server; no take-back, no rematch; a player who leaves the table for
      2 minutes loses. Nothing a browser reports counts, so two accounts cannot agree on
      a result without playing it. Tried with two accounts in two browser tabs.
- [x] Weight (2026-11-17): the first script is 268 kB (72 kB on the wire), it was
      2,584 kB: every page but Login and Home loads on demand, the rules engine with
      the cards' effects when a table opens. The server compresses what it sends and
      `/api/cards` answers 304 to a browser that already has the catalog.
- [x] Replays cannot speak for someone else (2026-11-17): a record a browser sends in
      carries the sender's account name, a bot's name and no chat; a friend game's
      record must end with the winner both players reported.
- [x] Security (2026-11-17): `/api/queue`, `/api/queue/tick` and `/api/match-sessions/*`
      need a session; every answer carries a content policy and the other security
      headers (`server/security.mjs`); in production one visitor gets 900 API requests
      a minute (`SN_RATE_LIMIT`), and the writes that can be repeated without end (DMs,
      friend requests, decks, duel tables, joining with a password) have their own limit.
- [x] Home mode cards and tiles have their text as accessible name (2026-11-17 audit).
- [x] Duel Room (2026-11-10/11): the tables are the real open duels, Host and Join work,
      invitation code and link, formats up to OP18, the format is sent and checked.
- [x] Friend games are recorded in Duel Records (`source='friend'`, out of ladder and meta).
- [x] Finished games are kept as replays, public by link (2026-11-17).
- [x] OP18: 119 cards, all automatic; 2,971 cards, none partial or unsupported.
- [x] Deploy, server side (2026-11-10, `server/README.md` → Production): in production the
      server listens on every interface, serves the built site and the card images
      (`static.mjs`), refuses to start without a real `COOKIE_SECRET`, allows no other
      origin unless listed in `CORS_ORIGINS`, and reads `TRUST_PROXY` so rate limits are per
      visitor. `Dockerfile`, `.env.example`, `npm start`, CI workflow, clean shutdown.
- [x] Profiles no longer show an email to other users.
- [x] The production build has no test login; demo seeds refuse `NODE_ENV=production`; `seed:admin` needs `ADMIN_PASSWORD` there.
- [x] Results logged by hand stay in the player's records, out of the ladder and the meta.
- [x] A game counts only when both players report the same winner; if they disagree it is cancelled.
- [x] `active` games expire after 2 hours, so nobody stays "matched" forever.
- [x] Queue and match sessions accept only the player's own deck.
- [x] Ranked results reach `matches`, once only, all or nothing, and only with a winner from the match.
- [x] SQLite in WAL mode with a busy timeout (without them, three processes locked each other out).
- [x] The queue pairs on the ladder rating (it was stuck at 1000 for everyone).
- [x] `POST /api/match-sessions/:id/cancel`.
- [x] Bots are paired only with bots.
- [x] `tests/api-test.mjs` can start again (it set the wrong port variable) and covers ranked.
- [x] DB writes no longer reload every open page in dev.
