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

## Bot

**Agente**:
Chi decide al posto di un giocatore: dato lo stato e il giocatore, restituisce un intent. Ha un livello (casuale, greedy, Pro).
_Avoid_: AI, player bot

**Rollout**:
Una partita giocata in fretta da una posizione fino a un orizzonte, su una copia dello stato, per stimare quanto vale una mossa.
_Avoid_: simulazione (troppo generico)

**Determinizzazione**:
Il passo prima di un rollout, in cui le carte che il bot non può vedere (mano, vite e mazzo dell'avversario) vengono rimescolate tra quelle possibili, così il bot non bara.

**Playbook**:
Il piano di gioco di un Leader in forma di dati: stile d'attacco, carte chiave, priorità.

**Mazzo meta**:
Una delle liste dei Leader del formato attuale, presa da Egman Events e data all'account di test.
