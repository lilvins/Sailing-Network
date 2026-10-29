# Il bot gioca con il motore AUTOSIM, non con quello di optcg-ai

Il bot Pro nasce in optcg-ai, che ha un suo motore di regole. Nel sim le regole
vere sono quelle di AUTOSIM (2850/2850 carte automatiche). Abbiamo deciso di
riscrivere il bot sopra AUTOSIM (`legalMoves`, `ChoiceRequest`, `applyIntent`),
riusando da optcg-ai solo le idee e i dati: valutazione, playbook, parametri
appresi. Così quello che il bot simula e impara vale al tavolo, e le partite si
rigiocano esatte con seed + intents.

## Opzione scartata

Un adattatore che traduce ogni stato AUTOSIM in uno stato optcg-ai e la mossa
all'indietro. Si fa prima, ma tiene in vita due motori che divergono carta per
carta: il bot sceglierebbe con regole diverse da quelle della partita.
