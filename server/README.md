# Sailing Network — Backend (local dev)

Local Node API for accounts, sessions and roles. **No external services** — a
file-backed SQLite DB lives next to this README (`sailing.db`, git-ignored).

Stack: **Fastify 5** · **libsql** (SQLite, prebuilt binaries — no compiler needed)
· **@node-rs/argon2** (argon2id password hashing) · **zod** (input validation).

## Run

```bash
npm run seed:admin      # create the first admin (once)
npm run seed:demo       # create demo captains + real egmanevents decklists (once)
npm run seed:ladder     # ~40 more demo captains + 60 days of made-up games for the ladder (once)
npm run server          # start API on http://localhost:8787
```

### Demo captains (from `seed:demo`)

Six accounts, each with a profile and **real decklists scraped from egmanevents**
(`public/data/popular.json`). All share the password `captain123`:

```
redhaired_saki · navigator_mika · wano_ren · bigmom_tomo · shadow_kai · baroque_lia · captain
```

`captain` is the **test account** used by the "Enter as Test Captain" button on the
login screen. The seed also generates a **real match history** between the captains,
so Duel Records, My Statistics and Rankings are all real and consistent.

Run alongside the frontend (`npm run dev`, :5173) in a second terminal.

### Default admin (dev only — change it)

```
email: admin@sailing.local   username: admin   password: admin12345
```

Create a custom admin instead:

```bash
ADMIN_EMAIL=you@x.com ADMIN_USERNAME=you ADMIN_PASSWORD='strong-pass' npm run seed:admin
# or: node server/seed-admin.mjs you@x.com you strong-pass
```

If the email/username already exists, that user is **promoted** to admin.

## Endpoints

| Method | Path | Auth | Body | Notes |
|--------|------|------|------|-------|
| POST | `/api/auth/signup` | — | `{email, username, password, displayName?}` | creates a `user`, sets session cookie |
| POST | `/api/auth/login` | — | `{identifier, password}` | `identifier` = email **or** username |
| POST | `/api/auth/logout` | cookie | — | clears session |
| GET | `/api/auth/me` | cookie | — | `{user|null}` |
| GET | `/api/me/profile` | cookie | — | own profile |
| PATCH | `/api/me/profile` | cookie | `{bio?, avatarColor?, favoriteLeader?, supporter?}` | edit own profile |
| GET | `/api/profiles/:username` | cookie | — | public profile + deck summaries |
| GET | `/api/users` | cookie | — | captain directory (profile + deck counts) |
| GET | `/api/me/decks` | cookie | — | own decks (full) |
| POST | `/api/me/decks` | cookie | `{name, leaderId?, leaderName?, cards?, format?, fav?}` | create a deck |
| GET | `/api/decks/:id` | cookie | — | a deck (any logged-in user) |
| PATCH | `/api/decks/:id` | owner | partial deck | edit (owner only) |
| DELETE | `/api/decks/:id` | owner | — | delete (owner only) |
| GET | `/api/me/matches` | cookie | — | recent matches (real opponents) |
| GET | `/api/me/stats` | cookie | — | per-deck WR + matchups vs each leader |
| GET | `/api/me/friends` | cookie | — | accepted + pending (incoming/outgoing) |
| POST | `/api/me/friends/:username` | cookie | — | send a friend request |
| PATCH | `/api/me/friends/:id` | cookie | `{action:"accept"\|"decline"\|"remove"}` | accept/decline a request, or remove |
| GET | `/api/me/threads` | cookie | — | DM list w/ last message + unread count |
| GET | `/api/threads/:username` | cookie | — | full thread (marks as read) |
| POST | `/api/threads/:username` | cookie | `{body}` | send a direct message |
| POST | `/api/threads/:username/read` | cookie | — | mark thread as read |
| GET | `/api/stats` | — | — | public counts (captains/decks/matches) |
| GET | `/api/leaderboard` | — | `?limit&leader&country` | season ladder by Bounty, tier distribution, rules (`server/stats`) |
| GET | `/api/profiles/:username/stats` | cookie | — | Bounty, rank, tier, history, past seasons, per-leader + matchup stats, recent games |
| POST/DELETE | `/api/follows/:username` | cookie | — | follow / unfollow a captain (one-way) |
| GET | `/api/meta` | cookie | `?days&min` | per-leader play rate, WR ± 95% range, 1st/2nd, adjusted WR, movers, matchup matrix |
| GET | `/api/meta/report` | cookie | `?format&from&to&minBounty&maxBounty` | Meta Analytics page: matchup grid + best lists (more than 30 games) |
| GET | `/api/admin/users` | admin | — | list all users |
| PATCH | `/api/admin/users/:id/role` | admin | `{role:"user"\|"admin"}` | can't demote the last admin |
| GET | `/api/health` | — | — | `{ok:true}` |

## Security baseline (already in place)

- Passwords hashed with **argon2id**; never stored or logged in plaintext.
- Session tokens are random 32-byte strings; only their **SHA-256** is stored, so
  a DB leak can't forge sessions. Token rides in an **httpOnly** cookie
  (`sameSite=lax`, `secure` in production), 30-day expiry.
- **zod** validation on every body; generic `Invalid credentials` on login.
- **Rate limiting** on signup (10 / 10 min) and login (10 / 5 min).
- Role gate: `requireUser` / `requireAdmin`; admin can't demote the last admin.

## Config (env)

Read once at start by `config.mjs`; `../.env.example` lists every variable with its
meaning. In development none is needed.

| Var | Default | |
|-----|---------|--|
| `NODE_ENV` | — | `production` ⇒ https-only cookies, the built site served by the API, listening on `0.0.0.0`, and the checks below |
| `COOKIE_SECRET` | dev placeholder | **required in production** (32+ random characters): the server does not start without it |
| `PORT` / `SN_API_PORT` | `8787` | `PORT` is read in production only (hosts set it); `SN_API_PORT` always wins |
| `SN_HOST` | `127.0.0.1` dev, `0.0.0.0` production | address to listen on |
| `SN_DB_PATH` | `server/sailing.db` | DB file location — on a disk that survives redeploys |
| `SN_STATIC_DIR` | `dist` in production | the built site; `off` = API only |
| `SN_CARDS_DIR` | — | folder with the card images, served as `/cards/<file>` |
| `CORS_ORIGINS` | none in production | other sites allowed to call the API with the cookie, comma separated |
| `TRUST_PROXY` | off | `1` behind one proxy: each visitor gets their own rate limit |

## Production

One process is the whole product: the API and the built site (`static.mjs`). It needs
one disk that survives redeploys, for the database and the card images.

```bash
npm ci
npm run build                 # the site → dist/
cp .env.example .env          # fill in COOKIE_SECRET, SN_DB_PATH, SN_CARDS_DIR
npm run seed:cards            # card list into the new database
ADMIN_EMAIL=… ADMIN_USERNAME=… ADMIN_PASSWORD=… npm run seed:admin
npm start                     # with the variables of .env in the environment
```

Or with Docker (`../Dockerfile`): `docker build -t sailing-network .`, then
`docker run -p 8787:8787 -v sailing-data:/data --env-file .env sailing-network`, and run
the two seeds once with `docker exec`.

What to know before going online:

- **Start from a clean database.** Never copy `server/sailing.db`: it holds the demo
  accounts with a public password and the bots. `seed:demo`, `seed:ladder` and
  `bots:seed` refuse to run with `NODE_ENV=production`.
- **Card images are not in git** (`public/cards`, 638 MB). Copy the folder to the
  server's disk and point `SN_CARDS_DIR` at it. The rights to the art are still an
  open question (`../docs/release-checklist.md`).
- **One instance only.** SQLite has one writer and friend games live in the memory of
  the process (`rooms.mjs`): a second instance would not see them, and a restart or a
  redeploy ends the games in progress.
- **HTTPS and compression come from the host's proxy.** The session cookie is
  `secure`, so the site must be reached over https; the server does not compress, and
  the main script is 2.5 MB (about 340 kB gzipped).
- **Back up the database file** (`SN_DB_PATH`, plus its `-wal` file): nothing does it yet.


