# Sailing Network — simulatore e bot

Il simulatore di One Piece TCG (AUTOSIM, giocato in board-auto) e il bot che ci gioca dentro.

## Motore

**Intent**:
Una richiesta di un giocatore al motore (giocare una carta, attaccare, rispondere a una scelta). Il motore la accetta tutta o la rifiuta senza cambiare niente.
_Avoid_: azione, mossa (per il dato che si manda al motore)

**Scelta in sospeso** (`ChoiceRequest`):
Una domanda che il motore fa a un giocatore e che blocca la partita finché non arriva l'intent di risposta (mulligan, blocker, counter, bersagli…).
_Avoid_: prompt, popup

**Impronta**:
L'hash degli eventi di una partita giocata a seed fisso. Se cambia dopo una modifica "solo di velocità", la modifica ha cambiato le regole.

**Tutti** (`COUNT_ALL`, 99):
Il numero che in un selettore vuol dire "tutte le carte che ci sono": non si sceglie niente. Usato come costo ("dai −2000 al tuo Leader") basta che ce ne sia una.

**Mano o cestino** (`handOrTrash`):
La zona di un selettore che legge insieme la mano e il cestino ("from your hand or trash"). La carta giocata dice da quale delle due è venuta davvero.

**Fino alla fine del tuo prossimo turno** (`untilEndOfYourNextTurn`):
La durata di un effetto usato nel turno avversario ([Trigger], [Counter]) che resta per tutto il tuo turno successivo e sparisce quando finisce.

**Override dal testo** (`TEXT_IR`):
L'effetto di una carta scritto a mano dal testo stampato, quando i dati di optcg-ai sono sbagliati. Vale solo finché il testo nel catalogo è quello da cui è stato scritto.

## Bot

**Agente**:
Chi decide al posto di un giocatore: dato lo stato e il giocatore, restituisce un intent. Ha un livello (casuale, greedy, Pro).
_Avoid_: AI, player bot

**Rollout**:
Una partita giocata in fretta da una posizione fino a un orizzonte, su una copia dello stato, per stimare quanto vale una mossa.
_Avoid_: simulazione (troppo generico)

**Determinizzazione**:
Il passo prima di un rollout, in cui le carte che il bot non può vedere (mano, vite e mazzo dell'avversario) vengono rimescolate tra quelle possibili, così il bot non bara.

**Orizzonte**:
Quanti cambi di turno gioca un rollout prima di valutare la posizione. 1 = fino alla fine del turno in corso.

**Policy veloce**:
Le regole fisse con cui entrambi i giocatori giocano dentro un rollout (la carta più cara, poi i DON!!, poi gli attacchi), senza lookahead, per fare tanti rollout in poco tempo.

**Eliminazione progressiva** (successive halving):
Il modo in cui il Pro divide il tempo tra le mosse candidate: tutte ricevono qualche rollout, la metà migliore ne riceve altri, e così via finché ne resta una.

**Numeri casuali comuni**:
Tutte le mosse candidate vengono provate sugli stessi mondi determinizzati, così il confronto non dipende dalla fortuna di un singolo rimescolamento.

**Gauntlet**:
Una serie di partite in coppia (stesso seed, agenti scambiati) tra due agenti sui mazzi meta, per misurare se uno è più forte dell'altro.

**Valutazione**:
Il punteggio che il bot dà a una posizione senza giocarla fino alla fine: vita (convessa), mano, counter, campo, DON!!, pressione. La teoria sta in `docs/bot/teoria-del-vantaggio.md`.

**Scudo**:
Quanti attacchi un giocatore può ancora assorbire: vite + Blocker attivi + counter in mano ÷ 3000 (regola di Vins).

**Pressione**:
Attaccanti che al prossimo turno arrivano al Leader avversario, meno il suo scudo. Sopra zero il letale è in vista.

**Ruolo** (beatdown / control):
Chi deve chiudere in fretta (beatdown) e chi deve durare (control), deciso confrontando i due orologi. Il bot lo fissa al momento della decisione.
_Avoid_: archetipo (quello è del mazzo, il ruolo è della partita)

**Allenamento**:
Il bot cambia un peso della valutazione, gioca partite in coppia contro sé stesso con il peso vecchio e tiene il cambio solo se vince in modo significativo.

**Playbook**:
Il piano di gioco di un Leader in forma di dati: stile d'attacco, carte chiave, priorità.

**Mazzo meta**:
Una delle liste dei Leader del formato attuale, presa da Egman Events e data all'account di test.
