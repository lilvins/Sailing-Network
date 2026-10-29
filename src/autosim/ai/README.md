# src/autosim/ai — agenti che giocano su AUTOSIM

Fase 2 di `PLAN_BOT_AUTOSIM.md`. Un agente legge lo stato e risponde con **un**
`PlayerIntent`: mosse della Main Phase e tutte le 13 `ChoiceRequest`. Non tocca
mai lo stato: chi lo usa (tavolo, test, self-play) applica l'intent con il motore.

| File | Cosa fa |
|---|---|
| `agent.ts` | interfaccia `Agent`, agente casuale, `agentStep` (una mossa; se il motore la rifiuta gioca una mossa casuale legale e lo segnala) |
| `random.ts` | giocatore casuale con seed (usato anche da benchmark e impronte) |
| `greedy.ts` | agente greedy: regole fisse + lookahead di una mossa |
| `evaluate.ts` | valutazione statica di una posizione (vite, mano, campo, DON) |
| `determinize.ts` | copia "immaginata" della partita: le carte che l'agente non vede vengono rimescolate |
| `tuning.ts` | tutti i pesi e le soglie, solo numeri |

## Uso

```ts
import { agentStep } from "./agent";
import { createGreedyAgent } from "./greedy";

const bot = createGreedyAgent("seed");
const { state, events, intent } = agentStep(db, game, bot); // modalità tavolo (copia)
```

Al tavolo: `features/board-auto/autoStore.ts` (`aiStep`), un agente per ogni
posto "AI".

## Garanzie (test in `__tests__/greedy.test.ts`)
- Il greedy vince > 80% contro il casuale con tutti i 17 mazzi meta (oggi 102/102),
  senza nessuna mossa rifiutata dal motore.
- `determinize` non cambia le carte visibili e rimescola solo quelle nascoste.
