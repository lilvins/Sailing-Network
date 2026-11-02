# scripts/bot-ladder — AI accounts that play ranked

Accounts marked `users.is_bot=1` play ranked through the real API: queue, ready,
complete. Each game is really played by the Pro agent on AUTOSIM, so the Bounty,
profile and meta stats come from games that happened, not from made-up results.
Bots are paired only with bots.

| File | Job |
|---|---|
| `accounts.json` | The invented accounts: username, display name, country. |
| `tuning.json` | Every number: workers, how many bots online, sittings, rests, skill mix. |
| `run.mjs` | The demon: gives each bot a session and a life (sit down, play, leave). |
| `game-worker.ts` | One full game in a worker thread. Bundled by `run.mjs` into `scripts/.bot-ladder/`. |
| `../../server/seed-bots.mjs` | Creates the accounts and their decks from `public/data/meta-decks.json`. |
| `../../server/purge-bots.mjs` | Removes all the bots and everything they did. |

## Run

```bash
npm run bots:seed             # once
npm run server                # the API, in another terminal
npm run bots:run              # Ctrl+C stops it; they leave the queue and go offline
npm run bots:purge            # shows what would be deleted; add -- --yes to delete
```

`SN_API` picks another API (default `http://127.0.0.1:8787`), `SN_DB_PATH` the DB.
`npm run bots:run -- --games 20` stops after 20 games.

## Skill

Bots differ by how hard the Pro searches (`skills` in `tuning.json`), assigned from
a hash of the username: it stays the same across runs and is not saved anywhere.

## Output

- `scripts/.bot-ladder/games.jsonl`: every game, with leaders, winner, turns, moves
  the engine refused (`fellBack`) and errors. Read it to find engine bugs.
- A game with no winner or an error is cancelled and writes no match row.
