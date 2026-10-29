# Piano — il bot gioca dentro il sim (AUTOSIM)

> Scritto il 2026-10-29. Solo piano: niente codice finché non dai il via.
> Dettaglia le tappe 9-10 di `ROADMAP_META_AI.md`.

## Dove siamo

- **AUTOSIM** (il motore di board-auto) automatizza 2850/2850 carte; i mazzi
  meta girano da soli. È il motore "giusto" del sim.
- **Il bot** (Pro, Monte Carlo) vive in optcg-ai e gioca in board-bot con il
  **motore di optcg-ai**, non con AUTOSIM. Due motori di regole = due verità:
  il bot può imparare cose che nel sim non valgono.
- L'account `captain` ha ora 17 liste meta (Egman, blocco OP17/EB05,
  `npm run fetch:meta` + `npm run seed:meta`): sono i mazzi su cui far
  giocare e allenare il bot.

## La scelta di fondo

| Opzione | Come | Pro | Contro |
|---|---|---|---|
| **A. Agente nativo AUTOSIM** (consigliata) | Riscrivere il "cervello" del bot sopra `legalMoves` / `ChoiceRequest` / `applyIntent` di AUTOSIM. Si riusano le idee e i dati di optcg-ai (valutazione, playbook, stile, peso DON, learned.json), non il motore. | Un solo motore; quello che il bot impara vale nel sim; il replay è gratis (seed + intents). | Lavoro iniziale: circa 1.000 righe da riscrivere/adattare. |
| B. Adattatore | Tradurre ogni stato AUTOSIM nello stato optcg-ai, far decidere il bot lì, tradurre la mossa indietro. | Veloce da provare. | Due motori che divergono; traduzione fragile a ogni carta; il bot simula con regole diverse da quelle del tavolo. |

Si va con **A**. B si scarta: vanifica il lavoro fatto per avere un solo motore.
Decisione registrata in `docs/adr/0001-bot-nativo-su-autosim.md`.

## Regole di lavoro

Prese dalla skill `unity-gamedev`, adattate al web: niente Unity, niente C#,
stessa sostanza. Più qualcosa da `card-game` e da `domain-modeling`.

**Sistemi autonomi e riusabili**
- Il bot è un sistema a sé: `src/autosim/ai/`, con il suo `README.md` (a cosa
  serve, come si aggancia, interfaccia pubblica, esempio d'uso).
- Dipende solo dal motore AUTOSIM (`engine/`, `ir/`), **mai** da board-auto,
  React o gli store. È il gioco a usare il bot, non il contrario. Si deve
  poter copiare in un altro progetto TCG con lo stesso motore.
- Interfaccia piccola: un `Agent` con `decide(state, pid) → PlayerIntent`,
  più le fabbriche dei livelli. Tutto il resto resta interno.
- I numeri di taratura (peso del DON, numero di rollout, orizzonte, budget di
  tempo) non stanno scritti nel codice: vanno in un file di config dati
  (`ai/config.ts` con i default commentati, sovrascrivibili da `learned.json`).
  I contenuti, cioè i playbook per Leader, sono dati JSON e non codice.
- Nomi: si tengono le convenzioni del progetto web (cartelle minuscole,
  camelCase). `Vins<Nome>System` è una convenzione Unity, come già deciso nel
  report del compilatore. Il bot entra nel catalogo dei sistemi come
  "sistema bot TCG".

**Codice umano**
- Un file = una responsabilità: generatore di mosse, determinizzazione,
  valutazione, ricerca e runner restano separati. Niente file tuttofare.
- Metodi corti (~30 righe al massimo), nomi parlanti, commenti sul *perché*.
- Niente numeri magici, niente codice morto, niente blocchi commentati.

**Regole del motore che il bot non deve rompere** (da `card-game`)
- Un intent illegale non cambia niente: `applyIntent` è atomico. Eventuali
  scorciatoie per la velocità valgono solo sulle copie usa e getta dei rollout,
  mai sullo stato della partita vera.
- Il caso del bot non consuma il caso della partita. Gli shuffle usano
  `${seed}:${rngUses}`: il bot ha il suo generatore e lavora solo su copie,
  così il replay di una partita (seed + intents) resta identico.
- Le scelte simultanee hanno un ordine fisso: il bot non deve introdurre
  risultati diversi a parità di seed.

**Ciclo di lavoro**
- Due modalità dichiarate: **pianificare** (solo lettura, il piano sta in
  questo file) ed **eseguire** (una sezione alla volta, seguendo il piano). Se
  il piano si rivela sbagliato ci si ferma e si torna a pianificare.
- Si parte da un commit pulito; ogni passo si chiude con i test verdi, il
  typecheck pulito e, quando si vede, una prova nel browser.
- Un commit, una cosa. La bozza del messaggio la propongo io, tu la correggi.
  Il corpo del commit dice come è stato verificato.
- Ogni sessione chiude con un report in `_Reports/` (fuori dai commit): in
  breve, file toccati, come funziona, concetti nuovi, scelte, come
  verificarlo, errori del modello, domande da esame, riuso, da fare.

**Lessico e decisioni** (da `domain-modeling`)
- I termini del bot (rollout, determinizzazione, agente…) vanno in
  `GLOSSARY.md`, aggiornato appena un termine si chiarisce.
- Un ADR in `docs/adr/` si scrive solo per decisioni difficili da
  ribaltare, sorprendenti e frutto di un vero compromesso.

## Fasi

### Fase 1 — Motore pronto per le simulazioni (tappa 9)

**Spec.** Il Monte Carlo gioca migliaia di partite per ogni decisione:
AUTOSIM deve giocare partite intere senza interfaccia, in fretta, con risultati
identici a quelli di oggi a parità di seed.

**Passi**, ognuno con il suo commit:
1. **Misurare prima di toccare.** Creare `scripts/bench-autosim.mjs`
   (`npm run bench:autosim`): N partite con driver casuale a seed fissi tra i
   17 mazzi dell'account di test. Stampa partite/s, intents/s, ms medi per
   intent e i 3 punti più costosi (profilo di Node). Salva anche
   un'**impronta** delle partite (hash degli eventi per seed), che serve ai
   passi 2-3.
   Criterio: numeri di partenza scritti nel report; nessun file del motore
   toccato.
2. **Cache degli effetti continui.** Oggi `activeModifiers` ricalcola tutti gli
   statici a ogni domanda (potenza, costo, keyword, restrizioni). Va calcolato
   una volta per versione dello stato e invalidato quando un evento cambia il
   campo. Il modulo resta `engine/continuous.ts`, con la sua responsabilità.
   Criterio: impronta identica, test verdi, guadagno misurato con il bench.
3. **Copia più leggera dello stato.** `applyIntent` fa `structuredClone`
   dell'intero stato a ogni intent; questo garantisce l'atomicità e resta per
   il gioco vero. Si aggiunge un'entrata separata per i rollout, che lavora su
   una copia già fatta a inizio rollout. Se un intent fallisce lì, si scarta
   l'intero rollout. Criterio: impronta identica e un test che dimostra che
   lo stato della partita vera non viene mai modificato.
4. **Solo se serve**, dopo aver rimisurato: gli altri punti caldi indicati dal
   profilo (`legalMoves`, la risoluzione dei selettori).

**Uscita.** ≥ 100 partite casuali/s su un core, oppure il motivo misurato per
cui non ci si arriva e cosa costerebbe. Impronta delle partite invariata,
489+ test verdi, typecheck pulito, report in `_Reports/`.

### Fase 2 — Interfaccia agente (`src/autosim/ai/`)
1. `Agent.decide(state, pid) → PlayerIntent`, un solo punto d'ingresso per
   ogni situazione: Main Phase (`playCard` / `giveDon` / `attack` /
   `activateMain` / `endTurn`) e tutte le 13 `ChoiceRequest` (mulligan,
   block, counter, trigger, target, may, peek, payDon, number, option,
   arrangeLife, replace, manualResolve).
2. **Generatore di mosse** completo da `legalMoves` + `pendingChoice`,
   comprese le combinazioni (bersagli multipli, pagamento DON, ordine vite)
   con una potatura sensata.
3. **Determinizzazione**: il bot non vede mano, vite e mazzo avversari. Prima di
   simulare, rimescola le carte che non vede (da quelle rimaste nella lista
   avversaria). Senza questo il bot bara.
4. Agente **casuale** e agente **greedy** (porting di `optcg/ai/greedy.ts`).
   Uscita: 500 partite greedy-vs-casuale su ogni mazzo meta senza errori,
   greedy vince > 80%.

### Fase 3 — Il bot Pro su AUTOSIM (tappa 10, M6)
1. Porting di `pro.ts`: successive halving, orizzonte di 2-3 turni, difesa
   con ricerca, numeri casuali comuni.
2. Porting di `evaluate.ts` (con il valore relativo del DON) e dei playbook
   per Leader. I 17 Leader dell'account di test sono la lista da coprire.
   Mancano i playbook di 6 Leader: Mihawk OP14-020 (il più giocato del
   formato!), Ace OP16-001, Luffy OP13-001, Kalgara OP08-098, Luffy
   ST10-002 e Buggy OP09-042.
3. Livelli `pro-fast` / `pro` come oggi.
   Uscita: Pro batte Greedy ≥ 60% su ciascuno dei top 8 mazzi (gauntlet a
   partite in coppia).

### Fase 4 — Il bot al tavolo (board-auto)
1. Web worker come `board-bot/bot.worker.ts`, ma con lo stato AUTOSIM.
2. board-auto: un posto si può dare al bot ("Seat B: Bot Pro"). Il bot
   risponde anche alle finestre fuori dal suo turno (counter, blocker,
   trigger). Ha un ritardo minimo per rendere le mosse leggibili e un log
   "perché" (le 3 mosse migliori con il punteggio).
3. Il mazzo si sceglie fra quelli dell'account (le 17 liste meta),
   non più dal bundle di optcg-ai.
   Uscita: una partita completa umano-vs-bot in board-auto, verificata nel
   browser, su ogni mazzo meta.

### Fase 5 — Il bot impara giocando nel sim
1. **Selfplay headless** `npm run selfplay`: N partite bot-vs-bot tra i mazzi
   meta. Ogni record è seed + intents (AUTOSIM è a eventi, il replay è esatto).
   I record vanno in `bot_games`.
2. Le partite umano-vs-bot in board-auto si salvano nello stesso modo, con il
   feedback "mossa sbagliata" (tabella `bot_feedback`, già esistente).
3. Porting di `learn.ts`: taratura per Leader e per matchup (stile, peso DON),
   test dei segni appaiati, adozione solo se p < 0,05. Le mosse segnalate
   diventano test di regressione.
4. Matchup chart automatico tra i 17 mazzi, rigenerato dopo ogni giro di
   apprendimento.

### Fase 6 — Un solo simulatore (tappa 11)
board-bot (motore optcg-ai) va in pensione, oppure resta solo per i confronti.
optcg-ai resta la fonte dei dati degli effetti per il compilatore. Il merge
nella `Sailing-Network` originale si fa solo quando decidi tu.

## Rischi

- **Velocità**: se AUTOSIM resta a ~30 ms a partita, il Pro "pieno" diventa
  lento (decine di secondi a mossa). Si rimedia con la fase 1, rollout più
  corti e il livello `pro-fast`.
- **Carte giuste ma approssimate** (96 con approssimazione dichiarata): il bot
  impara anche dagli errori del motore. La tappa 8 (revisione testo ↔ IR delle
  carte meta) va fatta in parallelo, partendo dai 17 mazzi dell'account.
- **Lo spazio delle scelte** (peek, payDon, bersagli multipli) esplode: serve
  una potatura (come le "prime k mosse per euristica" di optcg-ai).

## Ordine e dimensione

```
Fase 1 (motore veloce) ─► Fase 2 (interfaccia + greedy) ─► Fase 3 (Pro) ─► Fase 4 (al tavolo) ─► Fase 5 (impara) ─► Fase 6
                      tappa 8 (correttezza carte meta) in parallelo ─────────────────────────────────────┘
```

Una fase per sessione, circa. Le fasi 1-2 sono la base; dopo la 2 si può già
giocare contro un bot greedy al tavolo, se vuoi vederlo presto.
