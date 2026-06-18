# Sailing Network — Backend & Users Plan (draft for discussion)

> Status: V1 is **local, single-player, no backend** (by design). This document
> is the plan for when we add the real ecosystem (accounts, social, multiplayer).
>
> **Update (decision taken):** we chose a **custom local Node backend** (not
> Supabase) for autonomy — no external signup, no keys to paste. Phase 1 is
> **built & tested**: Fastify + libsql(SQLite) + argon2, accounts with `user`/
> `admin` roles, httpOnly-cookie sessions, admin user management. See `server/`
> (and `server/README.md`). Supabase remains a possible future migration — the
> data model below is unchanged. Remaining phases (profiles, decks, friends,
> messages, realtime, match server) still apply.

## 1. What actually needs a backend

| Area | Needs backend | Notes |
|------|---------------|-------|
| **Accounts & Auth** | ✅ | signup / login, sessions, password reset, email verify |
| **Profiles** | ✅ | persist avatar, bio, supporter flag; public Profile Viewer |
| **Decklists** | ✅ | save/load decks per user (Deck Builder output) |
| **Friends** | ✅ | requests / accept / remove |
| **Presence** | ✅ (realtime) | online / in-duel / offline |
| **Messages (DM)** | ✅ (realtime) | conversations + live delivery |
| **Duel Room / matchmaking** | ✅ (realtime) | pool, host/join, spectate |
| **Ranking / ELO / seasons** | ✅ | persisted ratings + leaderboards |
| **Gameplay sync + replays** | ✅ (realtime) | the action-log streams between players |
| Card database (static) | ❌ (just hosting) | read-only JSON/images; can stay client-side/CDN |

## 2. The asset we already have

CLAUDE.md's **non-negotiable rule** (all state changes go through named,
**serializable** actions + an `actionLog`) is the key enabler: those actions
become **network messages**, a **replay log**, and a **spectator stream** with no
rewrite. Keep RNG behind `lib/rng.ts` (seedable) so the **server owns shuffles**
later (anti-cheat).

## 3. Architecture options

**Option A — BaaS (recommended to start): Supabase**
- Postgres + **Auth** (handles password hashing, sessions, OAuth) + **Realtime**
  (presence, messages, live tables) + **Storage** (avatars) + **Row-Level
  Security** (DB-enforced "users only touch their own rows").
- Pros: auth & most security handled for us, fast to ship, realtime built in.
- Cons: heavy game-authoritative logic / matchmaking may still want a small
  custom service later.

**Option B — Custom**: Node (Fastify) + Postgres + WebSockets (ws/Socket.IO) +
Redis (presence/matchmaking queues).
- Pros: full control, ideal for an authoritative game server.
- Cons: we hand-roll auth + security (more risk, more time).

**Recommendation:** start with **Supabase** for accounts/profiles/decks/friends/
messages/ranking, and add a **thin Node "match server"** later only for
authoritative duels (RNG, ranked anti-cheat, replays).

## 4. Rough data model

`users` · `profiles(user_id, display_name, avatar, bio, supporter)` ·
`decks(user_id, leader, cards jsonb)` · `friendships(a,b,status)` ·
`messages(from,to,body,ts)` · `matches(id, players, action_log jsonb, result)` ·
`ratings(user_id, format, elo, season)`.

## 5. Security (must-haves — flagged as important)

- **Passwords**: never plaintext. Supabase Auth handles it; if custom → `argon2`.
- **Tokens/sessions**: short-lived access + refresh; `httpOnly`+`Secure` cookies;
  CSRF protection.
- **Authorization**: Supabase **RLS** policies (or server checks) so a user can
  only read/write their own data; validate **every** action server-side.
- **Anti-cheat (ranked)**: server-authoritative RNG (the `lib/rng.ts` seam) +
  server validates match results; don't trust the client.
- **Input validation**: `zod` schemas on every endpoint **and** every websocket
  message; reject malformed `GameAction`s.
- **Rate limiting / brute-force**: on login, signup, message send, matchmaking.
- **WebSocket auth**: authenticate the socket on connect; authorize per room.
- **XSS**: bio/messages/deck names are user content → React escapes by default;
  never use `dangerouslySetInnerHTML` on user data; sanitize on display.
- **Transport/secrets**: HTTPS only; secrets in env (never committed); rotate.
- **Privacy (GDPR / EU user)**: minimal PII, privacy policy, data export +
  delete, consent for analytics.
- **Supply chain**: `npm audit` + Dependabot/Renovate; lockfile review.

## 6. Cybersecurity skills/tools — do we download anything?

- **Right now: no.** V1 has no backend, no auth, no user data → nothing to
  secure beyond normal code hygiene. The built-in **`/security-review`** skill is
  enough for the current client code.
- **When the backend starts: yes, add scanning to the workflow:**
  - Use **`/security-review`** on every auth/backend PR (already available).
  - Consider a SAST/dependency scanner MCP/CLI: **Semgrep** (rules for authz,
    injection, secrets), **Snyk** (deps + code), **socket.dev** (supply chain).
    These install via CLI/marketplace when we get there (the MCP registry was
    empty in this environment, so we'd add them deliberately).
  - Add CI: `npm audit`, Semgrep scan, secret-scanning (gitleaks).

## 7. Suggested phasing

1. **V2a** — Supabase auth + profiles + decklist persistence (wire Edit Profile,
   Profile Viewer, Deck Builder to real data). Security baseline: RLS + zod.
2. **V2b** — Friends + presence + direct messages (Supabase Realtime).
3. **V2c** — Matchmaking + ranked/ELO + match sync + replays + the thin
   authoritative match server (server RNG, anti-cheat). Full security review.

> Decision points for you: (a) Supabase vs custom; (b) when to start the backend
> (after the playmat/gameplay, presumably); (c) green-light installing Semgrep/
> Snyk at V2a. No action needed now.
