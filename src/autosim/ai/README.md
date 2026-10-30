# src/autosim/ai — agenti che giocano su AUTOSIM

Fase 2 di `PLAN_BOT_AUTOSIM.md`. Un agente legge lo stato e risponde con **un**
`PlayerIntent`: mosse della Main Phase e tutte le 13 `ChoiceRequest`. Non tocca
mai lo stato: chi lo usa (tavolo, test, self-play) applica l'intent con il motore.

| File | Cosa fa |
|---|---|
| `agent.ts` | interfaccia `Agent`, agente casuale, `agentStep` (una mossa; se il motore la rifiuta gioca una mossa casuale legale e lo segnala) |
| `random.ts` | giocatore casuale con seed (usato anche da benchmark e impronte) |
| `greedy.ts` | agente greedy: regole fisse + lookahead di una mossa |
| `pro.ts` | agente Pro: ricerca Monte Carlo (candidati, eliminazione progressiva, numeri casuali comuni) |
| `rollout.ts` | policy veloce e rollout fino all'orizzonte, usati dal Pro |
| `evaluate.ts` | valutazione statica di una posizione: vita convessa, mano, counter, campo utile, rimozioni in mano, DON!!, pressione, ruolo (teoria in `docs/bot/teoria-del-vantaggio.md`) |
| `cardTraits.ts` | cosa fa una carta, letto dall'IR: è una rimozione? ha un effetto che continua a lavorare? |
| `determinize.ts` | copia "immaginata" della partita: le carte che l'agente non vede vengono rimescolate |
| `tuning.ts` | tutti i pesi e le soglie, solo numeri |
| `learned.json` | i pesi che l'allenamento ha adottato e il registro dei tentativi (`npm run train:autosim`, `src/autosim/train/`) |

## Uso

```ts
import { agentStep } from "./agent";
import { createGreedyAgent } from "./greedy";

const bot = createGreedyAgent("seed");
const { state, events, intent } = agentStep(db, game, bot); // modalità tavolo (copia)
```

Al tavolo: `features/board-auto/autoStore.ts` (`aiStep`), un agente per ogni
posto "AI".

## Il Pro

Per ogni decisione della Main Phase prende le mosse sensate (giocate, [Activate: Main],
DON!! su chi può ancora attaccare, attacchi che arrivano), le ordina con un punteggio
rapido (`PRIOR` in `tuning.ts`) e ne tiene 6, più End Turn e la mossa che sceglierebbe
il greedy. Ogni candidata viene provata su mondi determinizzati, giocata fino alla
fine del turno con la policy veloce e valutata; l'eliminazione progressiva dà più
rollout alle migliori. Blocker, counter e scelte sì/no si cercano allo stesso modo;
bersagli, peek e numeri vanno al lookahead del greedy.

```ts
import { createProAgent } from "./pro";
const bot = createProAgent("seed");                     // default di tuning.ts (PRO)
const veloce = createProAgent("seed", { rollouts: 4 }); // meno rollout, più rapido
```

Forza (2026-10-29, `npm run gauntlet:autosim -- --rounds 8`): Pro contro greedy
**61,7%** su 128 partite in coppia, ~40 ms a decisione contro ~1 ms del greedy.
Ancora sotto il 50% con Kaido OP17-058, Rocks OP17-039 e Mihawk OP14-020: è il
lavoro del passo 2 (valutazione per stile, playbook).

## Garanzie (test in `__tests__/greedy.test.ts` e `__tests__/pro.test.ts`)
- Il greedy vince > 80% contro il casuale con tutti i 17 mazzi meta (oggi 102/102),
  senza nessuna mossa rifiutata dal motore.
- `determinize` non cambia le carte visibili e rimescola solo quelle nascoste.
- Il Pro finisce le partite meta senza mosse rifiutate, e con gli stessi seed rigioca
  la stessa identica partita (il replay resta esatto).
