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

| Var | Default | |
|-----|---------|--|
| `PORT` | `8787` | API port |
| `COOKIE_SECRET` | dev placeholder | **set in production** |
| `SN_DB_PATH` | `server/sailing.db` | DB file location |
| `NODE_ENV` | — | `production` ⇒ `secure` cookies (HTTPS only) |

## Not yet wired

The frontend still uses the prototype (fake) login. Next step: an auth client +
store, real Login/Signup screens, route protection, and an Admin panel. Profiles,
decklists, friends, messages come after (see `../BACKEND_PLAN.md`).
