# Release checklist

Audit of 2026-11-02 on branch `bot-ladder`. Typecheck, 556 unit tests, 51 API tests
and the production build all pass; the problems below are ones those tests don't see.
Load limits were not measured and legal exposure needs a lawyer.

## Decisions needed first

- [ ] **Bots at release.** Remove them (`npm run bots:purge -- --yes`) or show them
      clearly as bots. They look like real people: they must not count as "captains
      aboard", sit in the public ladder or feed the meta as if they were humans.
- [ ] **Made-up seed games.** 7,406 rows with `source=''` in the dev DB (mostly
      invented by `seed:ladder`) mix with real games in Meta and "Matches logged".
- [ ] **Card art.** `CLAUDE.md:116` says to revisit it before any public release;
      images come from dotgg through a proxy with a spoofed browser identity (`server/card-art.mjs`).
- [ ] **Hosting target** (decides the deploy work and whether SQLite is enough).

## Blockers

- [ ] **Two people cannot play ranked.** `DuelRoomPage.tsx:289-291` opens a local board
      with no session; nothing in `src/` calls `/ready`, `/complete` or `/cancel`, and
      there is no realtime game sync. Build it, or hide the pool and launch without ranked.
- [ ] **Colluding accounts can still farm rating.** A game counts when both players report
      the same winner, so two accounts of one person can agree. Only a game run by the
      server closes this; do it together with the ranked game sync above.
- [ ] **Start production from a clean DB.** The dev DB holds demo accounts with the public
      password `captain123`: the build and the seeds no longer ship them, but copying this
      DB online would.
- [ ] **No deploy path.** `server/index.mjs:934` listens only on 127.0.0.1; nothing serves
      `dist`; no Dockerfile, CI, backups or `trustProxy`; `public/cards` is not in git.
- [ ] **Legal pages and account basics.** No privacy policy, terms, account deletion,
      password reset or email verification.

## Important

- [ ] `/api/queue`, `/api/match-sessions/*` and `/api/queue/tick` work without login.
- [ ] `registerBotGames` is never called: Play vs Bot records get a 404 and the learning
      loop has no data. Add auth before wiring it (it allows anonymous writes).
- [ ] Rate limits behind a proxy put everyone in one bucket; only signup, login and chat have one.
- [ ] CORS reflects any origin with credentials; no CSP or security headers.
- [ ] No block, report or delete for DMs and chat.
- [ ] SQLite: no index on `matches.created_at`, one writer process only, the ladder replays the whole table after every new match, meta pages rescan it.
- [ ] Duel Room shows invented tables; Join and Host Duel do nothing; the Messages badge is
      a fixed "3"; format, region and type are not sent; the format list stops at OP16.
- [ ] 2.5 MB main JS bundle (no code splitting); `/api/cards` is ~1.6 MB uncompressed, no cache.
- [ ] The app has one URL: no deep links, and refresh returns to Home.
- [ ] Home cards have no accessible name.

## Done

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
