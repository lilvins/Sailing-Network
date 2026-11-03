# Studio — l'IA attuale di optcgwebsim.com (MetaHub), 2026-10-30

> Scritto il 2026-10-30. Fonti lette (dati non fidati, solo lettura, niente eseguito, niente login): `index.html`, il bundle principale `/assets/index-3YewyJp2.js`, il worker `/assets/ai.worker-j5Hjn008.js`, `/data/playbooks.json`, `sitemap.xml`, le guide pubbliche `/learn/rocks-master-class/` e `/learn/xebec-eb05-guide/`. Copie temporanee solo nella scratchpad della sessione, non nel repo.
> Tutto è riscritto a parole nostre: algoritmi, regole e numeri, nessun codice copiato.
> Collegato a: [teoria-del-vantaggio.md](../teoria-del-vantaggio.md), [coaching-vins.md](../coaching-vins.md), codice in `src/autosim/ai/`.

## 0. In breve: cosa è cambiato dal 27 ottobre

1. **Il worker client è (quasi) identico.** Stesso file logico, nuovo hash (`ai.worker-j5Hjn008.js`). Ricerca Monte Carlo piatta: 4 candidati + Fine turno, 6 rollout ciascuno, 2 cambi di turno, valutazione statica. Timeout di 4 s lato pagina. Si usa solo nel gioco locale "hotseat" contro l'IA, se il server non risponde.
2. **`playbooks.json` copre ancora solo 3 Leader** (OP16-022 Luffy B/G, OP16-080 Teach, OP11-041 Nami). **Non ci sono né Mihawk OP14-020 né Rocks OP17-039.** È cresciuta molto invece la sezione `fundamentals`: 33 concetti, ognuno con una "aiRule", più 6 liste (vita, tempo, attacco, difesa, mulligan, economia DON!!).
3. **Il "Pro AI" ora gira sul server** (stanza `createAiRoom` via socket, livelli easy/medium/hard/pro; senza abbonamento "pro" scende a "hard"). Il suo codice non è pubblico. Dal client si vede il **formato delle sue risposte**: per ogni opzione dà una probabilità di vittoria stimata giocando molte partite ("deals"), più le vittorie e sconfitte nette, un **piano** (la sequenza di azioni fino a Fine turno) e un flag "rough" quando il tempo è finito prima di metà dei deal. Il coach del sito spiega le mosse con questi numeri.
4. **Nessuna IA nuova nel client.** La conoscenza nuova è nelle **guide pubblicate dal Pro**: la "Rocks Master Class" (12 matchup, migliaia di partite del Pro) e 17 guide EB05. Sono la fonte più ricca: regole di mulligan validate giocando **la stessa mano in tutti e due i modi**, primo/secondo di turno per matchup, curve con le percentuali, chi counterare a quante vite, la distribuzione dei DON!! nel turno del kill e l'ordine degli attacchi.

Le sezioni 1–2 descrivono la valutazione del worker, cioè l'unica valutazione di cui si legge il codice. La sezione 3 parla del Pro lato server, la 4 della conoscenza nelle guide, la 5 dei playbook, la 6 del confronto con il nostro bot.

---

## 1. Funzione di valutazione — specifica per reimplementazione

Questa è la valutazione statica che il worker usa alla fine di ogni rollout. È tutta qui: non esistono altri termini. Prima la notazione:

- `me` = giocatore che decide, `opp` = avversario.
- `S` = stile d'attacco effettivo (sez. 1.4), `W = PESI[S]` (tabella 1.3).
- `PB` = playbook effettivo del Leader di `me` contro il Leader di `opp` (sez. 1.4).

### 1.1 Valori terminali

- Partita vinta da `me`: **+1000**. Persa: **−1000**. Nessuna scala per il turno (vincere prima non vale di più).
- Attenzione: una posizione normale può superare ±1000 (es. 5 vite × 115 = 575, più la mano, più la potenza), quindi i terminali **non dominano sempre**. Se la reimplementiamo e vogliamo che la vittoria domini, va alzato il terminale (noi usiamo `WIN = 10000`).

### 1.2 Formula (posizione non terminale)

```
V =  W.myLife  · Vite(me)
   − Wopp      · Vite(opp)
   + (Potenza(me) − Potenza(opp)) / 100
   + W.hand    · Mano(me)
   − W.oppHand · Mano(opp)
   + W.chars   · (NumPers(me) − NumPers(opp))
   − W.restedPenalty · Σ costo(c)   per ogni c tra i MIEI Personaggi riposati con costo(c) > E
   − 90 · max(0, F − Vite(me))      solo se il playbook definisce F
```

Definizioni precise:

| Simbolo | Come si calcola |
|---|---|
| `Vite(x)` | numero di carte nella zona vita, scoperte o coperte. **Lineare**: ogni vita vale uguale (nessuna convessità). |
| `Wopp` | `W.oppLife`, con un'eccezione: se `Vite(opp) ≤ 1` **e** `W.oppLife < 100`, allora `Wopp = 110`. Così anche gli stili che "non tengono alla vita avversaria" (conserve 80, starve 45) la valutano tanto quando l'avversario è all'ultima. Per flood/race (130/135) e balanced (100) non cambia niente. |
| `Potenza(x)` | somma della potenza di **tutti** i Personaggi in campo di x, attivi e riposati. **Il Leader e lo Stage non contano.** La potenza è quella "in difesa": base + modificatori (di turno, di battaglia, base modificata) + aure passive di Leader/Personaggi/Stage di entrambi. **I DON!! attaccati non contano** (il +1000 per DON!! vale solo in attacco). Se il calcolo fallisce (effetto non supportato), quel Personaggio vale 0. Divisore fisso 100: 5000 di potenza = 50 punti. |
| `Mano(x)` | numero di carte in mano. Nessuna distinzione: counter, eventi ed estrazioni valgono tutti uguale. |
| `NumPers(x)` | numero di Personaggi in campo (attivi + riposati). |
| `E` | `expendableCostLE` del playbook, default **1**. I Personaggi di costo ≤ E sono "sacrificabili": riposarli non costa niente. |
| penalità riposati | solo per i **miei** Personaggi (non quelli avversari), costo stampato × `restedPenalty`. Con flood vale 0, quindi è spenta. |
| `F` | `lifeFloor` del playbook (anche dopo l'override del matchup). Se non è definito, il termine non c'è. Penalità **lineare**: 90 per ogni vita sotto il pavimento (es. F=2 e 0 vite: −180). |

**Cosa NON c'è** (importante, perché il nostro bot ne ha diversi): DON!! (né in campo né il prossimo turno), counter in mano, Blocker, Stage, cimitero, mazzo, qualità della mano, curva, minacce/rimozioni, pressione verso il lethal, chi attacca per primo, Trigger. Non c'è normalizzazione: il punteggio è grezzo e si confronta solo come media fra candidati.

### 1.3 Pesi per stile d'attacco

| Stile | myLife | oppLife | hand | oppHand | chars | restedPenalty |
|---|---|---|---|---|---|---|
| flood | 70 | 130 | 6 | 4 | 16 | 0 |
| race | 85 | 135 | 8 | 4 | 10 | 1 |
| balanced (default) | 100 | 100 | 8 | 6 | 12 | 2 |
| conserve | 115 | 80 | 11 | 7 | 10 | 5 |
| starve | 110 | 45 | 10 | 14 | 14 | 4 |

Come si leggono, in rapporti:
- **1 vita ≈ 9–17 carte in mano.** Con balanced 1 vita (100) = 12,5 carte (8). La vita domina tutto il resto: questa valutazione **non vuole mai prendere un colpo per tenere una carta**, a meno che non lo dica il pavimento (o, al contrario, lo stile flood).
- **1 Personaggio ≈ 1,5–2 carte** (chars 12–16 contro hand 6–8), più la sua potenza/100 (un 5000 = +50). Quindi un 5000 in campo vale circa 62 punti con balanced: più di mezza vita.
- **starve**: vita avversaria quasi irrilevante (45) e mano avversaria pesantissima (14): attacca i Personaggi e "affama".
- **conserve**: la propria vita vale più di quella avversaria, la mano conta molto, i corpi riposati costano 5 × costo.

Altri due parametri dello stile non entrano nella valutazione ma nel **prior dei candidati** (sez. 2.2):

| Stile | leaderBias | tempo |
|---|---|---|
| flood | 0,85 | 1,0 |
| race | 0,90 | 1,0 |
| balanced | 0,70 | 0,8 |
| conserve | 0,60 | 0,7 |
| starve | 0,25 | 0,7 |

E le probabilità di usare un counter (usate dalla politica di difesa, sez. 2.4), per vite del difensore:

| Stile | ≥3 vite | 2 vite | ≤1 vita |
|---|---|---|---|
| flood | 0,10 | 0,35 | 0,85 |
| race | 0,12 | 0,40 | 0,85 |
| balanced | 0,20 | 0,50 | 0,85 |
| conserve | 0,30 | 0,60 | 0,90 |
| starve | 0,30 | 0,60 | 0,90 |

Ritocchi: se il difensore è un **Personaggio** (non il Leader), la probabilità si taglia a **max 0,35**. Se il playbook ha `lifeFloor` e le vite sono ≤ F, la probabilità sale ad **almeno 0,75**.

### 1.4 Come il playbook cambia i pesi

1. Si prende il playbook del Leader di `me`: `leaders[idLeaderMio]`. Se non c'è, stile = balanced e nessun parametro extra.
2. Se il playbook ha `ai.vs[idLeaderAvversario]`, i campi di quell'oggetto (tranne la nota testuale) **sovrascrivono** quelli di `ai`: `attackStyle`, `lifeFloor`, `goSecond`. Il risultato si mette in cache per la coppia (mio Leader, suo Leader).
3. Dal playbook effettivo si legge: `attackStyle` → la riga di pesi; `lifeFloor` → il pavimento; `expendableCostLE` → la soglia dei sacrificabili; `curveFirst`/`curveSecond` → il prior delle giocate; `mulligan` → la regola del mulligan; `goSecond` → la scelta del turno.
4. **Non esistono pesi numerici per Leader**: il playbook sceglie solo una delle 5 righe, più pavimento e soglia. Tutto il "carattere" per matchup passa da quella scelta.

I valori dei 3 playbook:

| Leader | stile base | lifeFloor | expendable ≤ | override per matchup |
|---|---|---|---|---|
| OP16-022 Luffy B/G | flood | 1 | 2 | flood contro tutti (mirror, Nami, Rosinante, Teach) |
| OP16-080 Teach | conserve | 2 | 1 | starve contro Enel OP05-098, Enel OP15-058, Rosinante OP12-061; race contro Nami OP11-041 (floor 2) e Luffy OP16-022; conserve nel mirror |
| OP11-041 Nami | balanced | 1 | (1) | race contro Luffy B/G e Teach; floor 3 contro i due Enel; floor 2 contro Rosinante; contro Lucy/Ace solo note |

### 1.5 Quando si valuta (conta per riprodurre i numeri)

- La valutazione si chiama **solo alla fine di un rollout**, mai a metà turno.
- Il rollout parte dalla posizione dopo la mossa candidata e gioca **entrambi i giocatori** con la politica veloce (sez. 2.4) finché non sono avvenuti **2 cambi di turno** e tocca di nuovo a `me`. In pratica la posizione valutata è **l'inizio del mio turno successivo**, dopo che l'avversario ha giocato un turno intero. Limite di sicurezza: 400 azioni.
- Conseguenze: i DON!! "regalati" e i corpi riposati si sono già sistemati. La vita persa nel turno avversario c'è già. La **penalità dei riposati** colpisce i corpi che non si sono raddrizzati: di fatto a inizio turno sono tutti attivi, quindi pesa soprattutto quando il rollout si ferma prima (vittoria, limite di passi).
- Il valore di un candidato è la **media semplice** dei suoi rollout. Una mossa che il motore rifiuta vale −1000 per quel rollout.

### 1.6 Ricetta per reimplementarla da noi

Si mappa quasi tutta sui nostri `EvalWeights` (`tuning.ts`). Un set "MH" per stile (esempio balanced):

| Nostro peso | Valore MH balanced | Note |
|---|---|---|
| myLifeBase / oppLifeBase | 100 / 100 | per stile, dalla tabella 1.3 |
| lifeConvex | 0 | loro lineare |
| hand / oppHand | 8 / 6 | |
| counter | 0 | loro non lo contano |
| chars | 12 | ma **tutti** i Personaggi, non solo gli "utili" |
| charCost, removalOption, blocker, don, curve, pressure, lethalBonus | 0 | assenti da loro |
| powerDivisor | 100 | uguale; ma la loro potenza conta tutti i Personaggi e mai il Leader |
| rested / expendableCost | 2 / 1 | uguale alla nostra impostazione |
| roleShift | 0 | il loro "ruolo" è lo stile scelto dal playbook |

Servono **tre cose nuove** in `evaluate.ts`:
1. il bump della vita avversaria a ≤1 vite (peso max(stile, 110));
2. la penalità del pavimento (−90 per vita sotto F);
3. un interruttore "conta tutti i Personaggi" al posto di `useful`.

Il resto è già lì. Lo stile si sceglie per matchup da un nostro playbook. **Avvertenza onesta:** questa è la valutazione del livello Hard/locale. Il Pro del server quasi certamente **non** decide con questa formula: stima la probabilità di vittoria giocando le partite fino in fondo (sez. 3). Copiarla ci dà un riferimento misurabile (gauntlet A/B contro la nostra `EVAL_BASE`), non il Pro.

---

## 2. Il resto del worker (livello Hard / locale)

### 2.1 Ricerca

- **Monte Carlo piatto** su una sola decisione. Niente albero, niente UCB, niente MCTS.
- Budget passato dalla pagina: **4 candidati, 6 rollout, 2 cambi di turno**. Totale ≈ 30 rollout per decisione.
- RNG con seme = seme del messaggio XOR (round × 7919).
- La pagina tiene una lista di **mosse bandite**: le azioni che nello stesso turno non hanno prodotto effetti (es. un'abilità non supportata). Così non si ripetono all'infinito.
- **Timeout di 4 s**: se il worker non risponde, la pagina usa la politica di base.

### 2.2 Generazione dei candidati e prior

1. Tutte le azioni legali, tranne "concedi" e quelle bandite. Se ce n'è una sola, si gioca quella.
2. Si scartano gli attacchi con potenza dell'attaccante < potenza del bersaglio (DON!! già attaccati inclusi).
3. Se ci sono DON!! attivi, si aggiungono due mosse sintetiche: **tutti i DON!! attivi sul Leader** e **tutti sul mio Personaggio attivo più forte**. Non esistono divisioni parziali dei DON!!.
4. Ogni azione ha un prior:
   - **Giocare una carta**: 50 + 6 × costo + bonus curva. Il bonus vale +45 se il costo è il primo della lista curva di quel round, +25 se è nella lista, −8 se non c'è; 0 se il playbook non ha curva. Le liste: `curveFirst`/`curveSecond[min(round, 8)]`.
   - **Attacco** (se la potenza non basta: 1): 40 × (0,5 + tempo) + (sul Leader: leaderBias × 30; su un Personaggio: (1 − leaderBias) × 30) + margine/500. Poi i moltiplicatori:
     - × 0,6 se è sul Leader, l'avversario ha più di 1 vita, il margine è < 2000 e ha almeno 1 carta in mano ("un counter lo ferma");
     - con conserve/starve, × 0,4 se attacca un Personaggio non sacrificabile con margine < 2000 e l'avversario ha più di 1 vita;
     - con starve, × 0,3 per gli attacchi al Leader quando l'avversario ha più di 1 vita;
     - con flood/race, +14 per gli attacchi al Leader.
   - **DON!!**: 30. **Attiva Main**: 25. **Fine turno**: 5. Altro: 10.
5. Si prendono i **primi 4** per prior, più **Fine turno** se non c'è già.

### 2.3 Determinizzazione

- Prima di ogni rollout si **rimescolano gli identificativi delle carte nascoste dell'avversario**: mano + mazzo + vite coperte, tutte nello stesso mucchio. L'avversario simulato ha quindi una mano casuale presa dalle sue carte non viste.
- Il **proprio mazzo non viene rimescolato**: l'IA "conosce" l'ordine delle proprie pescate. È un piccolo trucco (o una svista); da noi `determinize.ts` lo fa giusto.

### 2.4 Politica veloce nei rollout (entrambi i giocatori)

- **Main**: gioca la carta che massimizza 2 × costo + bonus curva (60 se è il primo costo della lista del round, 30 se è nella lista) + 1. Poi **attacca tutti i DON!! attivi al Leader**. Poi un attacco: tra quelli con potenza ≥ bersaglio sceglie il punteggio più alto (Leader: 1000 + margine; Personaggio: 500 + potenza del bersaglio, cioè il più grosso). Se non ce ne sono, Fine turno.
- **Counter**:
  - si calcola il buco: potenza dell'attaccante − (difensore + counter già messi);
  - se il buco è < 0, niente counter;
  - si countera se: Leader a 0 vite, **oppure** c'è già un counter in questa battaglia (si continua), **oppure** la probabilità della tabella 1.3 è ≥ 0,45 (nel rollout è una soglia fissa; nella decisione vera è un tiro di dado con quella probabilità);
  - serve anche che la somma dei counter disponibili copra buco + 1000; si gioca **il counter più piccolo**, uno alla volta.
  - Effetto pratico nei rollout: con flood/race si countera solo a ≤1 vita; con balanced a ≤2; con conserve/starve a ≤2; i Personaggi non vengono mai counterati (0,35 < 0,45), salvo il pavimento.
- **Blocco**: si blocca se il bloccante è più forte dell'attaccante, oppure se l'attacco è al Leader e le vite sono ≤2. Tra i candidati si sceglie il bloccante più forte. Nella decisione vera serve anche un tiro con probabilità 1,6 × (prob. counter della tabella), oppure Leader a 0 vite.
- **Trigger**: sempre attivati. **Bersagli degli effetti**: preferiti i Personaggi/Leader avversari (il più forte), poi le proprie carte in mano/cimitero, poi i propri Personaggi (sempre il più forte). Scelte a opzioni: sempre la prima. Riordini: invariati.

### 2.5 Mulligan e turno

- **Con playbook** si tiene se vale almeno una di queste:
  - (a) carte di costo ≤ `cheapCost` (default 2) ≥ `minCheap`;
  - (b) in mano c'è una carta di `wantAnyCards`;
  - (c) carte con costo in `wantAnyCosts` ≥ `wantCostsMin` (default 1).
  
  Altrimenti si rimescola.
- **Senza playbook**: si tiene con ≥2 carte di costo ≤3.
- **Primo/secondo**: da `goSecond` (anche per matchup). Senza playbook va primo.

---

## 3. Il Pro sul server: cosa si vede da fuori

Il codice del Pro non si vede. Si vedono però i campi che il client riceve e mostra, e le frasi con cui il coach del sito spiega le mosse.

**La sua "valutazione" è una probabilità di vittoria.**
- Per ogni opzione il server manda: la probabilità di vittoria stimata, quante simulazioni l'hanno **vinta** e quante **persa** "nette" (partite finite), e un **piano** (le azioni successive fino a Fine turno).
- Manda anche: il numero di simulazioni ("deals") previste e fatte, un flag "occupato", una nota.
- Se ne ha fatte meno di metà, la risposta è marcata "rough".

**Come lo racconta il coach.**
- "X vince circa N% delle partite del coach": soglie di 5 punti per "vicino" e 15 per "molto meglio".
- "Ha vinto subito in K su N tentativi".
- "Nessuna linea vince" (tutte ≤2% o tutte perse) e "ogni linea vince" (≥98%).
- Il piano si mostra come "poi attacca…, poi…".

**Analisi delle partite.**
- Il coach ripercorre la partita, trova le mosse in cui la probabilità di vittoria del giocatore è scesa di più ("Big mistake" ≥20 punti, "Mistake" ≥12, sotto è "Slip") e dice "con la mossa del Pro vinceresti X partite, con la tua Y".
- C'è una coda sul server ("il coach ha N revisioni prima della tua").

**Metodo statistico delle guide.** È la parte da copiare come metodo, non come codice:
- "**Stesse mescolate giocate nei due modi**": ogni mano/mescolata si gioca due volte cambiando una sola cosa (primo/secondo, tenere/rimescolare). È la tecnica dei numeri casuali comuni, applicata alle decisioni di inizio partita, con 300–700 mescolate per matchup.
- "**Close calls**": nelle decisioni dove le due mosse migliori sono vicine, il Pro le confronta testa a testa. "Meglio in 23 su 30" vuol dire che quella scelta è uscita avanti 23 volte su 30.
- Dati "full strength": partite con più budget, poche decine per matchup.

**Le regole che il coach usa per spiegare** dicono cosa il Pro considera un errore tipico (le stesse in tutte le partite):
- **Fine turno con un attacco ancora valido** → errore ("usa gli attaccanti").
- **Fine turno con DON!! o carte giocabili inutilizzati** → errore ("un DON!! fermo è sprecato"). Vale anche per [Activate: Main] ancora disponibile: c'era altro da fare prima di finire.
- **Ordine degli attacchi sul Leader**: prima lo swing **più piccolo**, così quello che spendono per fermarlo non ferma più il grande. Nelle guide: "attacca con X prima di Xebec: quello che spendono qui non li salva dopo".
- **DON!! dove cambia il conto**: sull'attaccante che così supera il Leader avversario. In attacco, **abbastanza DON!! perché un solo counter non basti** ("servirebbe +4000, non +2000").
- **Prima le carte, poi i DON!!**: un DON!! dato a un personaggio non paga più le carte.
- **Prima l'attacco, poi la carta**: un colpo o un K.O. in questo turno può valere più della carta.
- **Bersaglio**: il Leader per la vita; un Personaggio quando è un Blocker o il loro attaccante migliore.
- **Non attaccare quando non si arriva**: un Personaggio tenuto attivo non può essere attaccato.
- **Counter col più piccolo che basta**. Si prende il colpo quando le vite lo permettono; si countera a vite basse o sullo swing che conta.
- **Blocco**: non a ogni colpo; quando salva la vita o un pezzo migliore.
- **Carte con counter alto (≥2000) o eventi counter**: spesso meglio tenerle in mano per il turno avversario.
- **Mulligan**: si spiega con "N Personaggi di costo 1–2 e M counter".
- C'è anche un **calcolatore di lethal/difesa** (lato client, per il coach). Per una lista di attacchi pianificati cerca in modo esaustivo la difesa avversaria che spende meno carte: blocchi, counter impilabili, effetti "guardia" a uso singolo, buff per tutto il turno, entro il limite della sua mano. Se nessuna difesa lo tiene in vita, è lethal salvo Trigger.

---

## 4. Conoscenza nelle guide (Rocks Master Class, OP17)

Rocks OP17-039 è il Leader più giocato su MetaHub e uno dei nostri avversari principali (Mihawk–Rocks è la partita del coaching). La guida usa la lista Rocks top di MetaHub (53% di vittorie) e ~8.000 partite del Pro.

**Identità.** Midrange di valore con il motore nel Leader. L'attacco del Leader scarta 1, rivela la prima carta e, se è "Rocks Pirates", pesca 2. Con questa lista la rivelazione prende sempre, quindi **+1 carta a ogni attacco del Leader**.
- Il Leader attacca ~6 volte a partita e il Pro usa lo scavo nel 99,7% dei casi.
- Al 4° turno ha ~9 carte.
- Difesa: 8 eventi counter a costo 0 (+2000), Buckin (+1000) e Xebec in mano (+2000, attivo solo se i suoi Personaggi non hanno counter).
- Xebec (10) arriva nel turno dei 10 DON!! (6° turno andando primo, 5° andando secondo) nel 93–94% dei casi in cui viene giocato.

**Regole "mai".**
- Mai saltare l'attacco del Leader.
- Mai giocare Buckin in campo (0 volte su 7.968 partite).
- Mai DON!! al Leader prima del turno 6: 0–0,7 a turno, tutto alla curva. Il Leader attacca per lo scavo, non per il danno.

**Curva del Pro.**
- Andando primo: T1 Streusen, T2 Don Marlon/Stussy/Kyo, T3 Linlin o Gloriosa, T4 Shiki, T5 Newgate + Stussy o un altro Shiki, T6 Xebec.
- Andando secondo: Kyo/Streusen, poi Gloriosa/John/Marlon, Newgate a 6 (60–85%), Shiki a 8, Xebec a 10.
- **Lezione ricorrente**: Gloriosa è la **terza** giocata del turno, mai la prima. Newgate e Shiki la battono nel 70–100% dei close call.

**Mulligan.** Si rimescola solo una mano **senza nessun Personaggio di costo 2–5** (≈1 mano su 20).
- Tenere tutto il resto vince il 59,6%, la regola migliore provata (tenere sempre: 59,2%; rimescolare: 58,8%).
- I giocatori forti rimescolano il 47% delle mani: troppo.
- Eccezione **Rosinante**: rimescolare vince ~6 punti in più, quindi le mani dubbie si rimandano.
- Mani migliori: con Linlin o Don Marlon.

**Primo/secondo** (Rocks, stesse mescolate):

| Contro | primo | secondo | Pro sceglie |
|---|---|---|---|
| mirror | 54,3% | 45,7% | primo (il 94% dei giocatori va secondo) |
| Luffy & Ace | 71,1% | 75,8% | secondo |
| Sabo | 52,1% | 65,7% | secondo |
| Black Luffy | 46,0% | 62,0% | secondo |
| Kaido | 47,0% | 27,0% | **primo** (+20) |
| Enel OP15 | 68,3% | 46,7% | **primo** (+22) |
| Shanks | 64,3% | 58,3% | primo |
| Robin | 64,3% | 56,7% | primo |
| Enel OP05 | 48,3% | 57,3% | secondo |
| Pudding | 55,3% | 45,7% | primo |
| Hancock | 73,7% | 71,7% | indifferente |
| Rosinante | 59,3% | 52,0% | primo |

**Vita e counter.** La regola cambia per matchup ed è il punto dove il Pro diverge di più dai giocatori:
- **mirror**: a 5 vite quasi mai counter (11%), a 0 vite tutto;
- **Luffy & Ace / Enel OP15 / Hancock**: counter dal primo colpo, anche a 5 vite (Enel: meglio counterare in 48 casi su 53);
- **Kaido / Shanks / Enel OP05 / Pudding**: a 5 vite si prende il colpo;
- a 1–2 vite, nei close call si prende spesso il colpo. La carta vita arriva in mano e il counter tenuto ferma lo swing letale.

Abitudine: +1000 (Buckin) presto, +2000 tenuti per le vite basse. **Non pagare carte per buff piccoli**: il +3000 di Newgate in attacco va saltato (meglio in 58 casi su 85).

**Turno del kill.**
- Arriva al 6°–8° turno, con l'avversario a ~1–1,5 vite e 4–6 carte in mano.
- I DON!! vanno **larghi**: ~3–6 sul Leader e 1,5–3,5 sui Personaggi, in 3–4 attacchi.
- **Shiki/Newgate attaccano prima di giocare Xebec** (meglio in 7 casi su 8 contro Kaido, 18 su 22 contro Pudding).
- "Aggiungi DON!! finché un counter non basta più": nell'esempio, 3 DON!! su un 6000 vincono l'87%, 1 DON!! vince lo 0%.
- L'Unblockable di Xebec si usa contro chi ha Blocker (Rosinante: 21 kill su 54).
- Contro Enel OP05 si pianifica un colpo in più (il loro Leader recupera una vita).

**Bersagli delle rimozioni.** Il pezzo che "accende" il mazzo avversario: i Luffy contro L&A, le carte da 12 contro Sabo/Black Luffy, Kaido Blocker, Benn Beckman contro Shanks, Rosinante & Law contro Rosinante. Nel mirror si uccide prima il loro Shiki.

Mihawk OP14-020 **non ha una guida né un playbook** su MetaHub.

---

## 5. I tre playbook per Leader (`playbooks.json`)

### OP16-022 Luffy Blu/Verde — aggro "flood"
- **Mulligan** (IA): tieni con ≥2 carte di costo ≤2, oppure con OP16-048 o OP16-026 (Buggy 5c, Ivankov 4c). Testo: più pesi da 1–2 possibile.
- **Turno**: secondo, contro tutti.
- **Curva** (costi preferiti per round):
  - primo: 1 → [1]; 2 → [2, 1]; 3 → [5, 2, 1]; 4 → [7, 5, 4, 2]; 5 → [5, 4, 2, 1]; 6 → [7, 5, 2];
  - secondo: 1 → [2]; 2 → [2, 4, 1]; 3 → [5, 1]; 4 → [7, 5, 2]; 5 → [10, 7, 5, 2].
- **Piano**: il Leader raddrizza 2 DON!!, quindi pesi da 2 che si rimpiazzano ogni turno; Buggy + Prigioniero a 5–6; Boa a 7–8; a 10 lethal subito. Finale Brook + Boa a 0–1 vite.
- **Regole**:
  - mai difendere i corpi: le carte da 2 sono sacrificabili, i corpi da 6000 si proteggono;
  - Gravity Blade solo da un board sviluppato;
  - più attacchi piccoli nello stesso turno, non uno alla volta;
  - con una mano debole, 1 DON!! sui 6000 per attaccare a 7000.
- **Vita**: il primo colpo si prende; si difendono i colpi iniziali che costano una sola carta.

### OP16-080 Teach — controllo "conserve"
- **Mulligan**: tieni con lo Stage OP09-099 (Fullalead), oppure con ≥2 carte di costo 6, 8 o 10.
- **Turno**: secondo (nel mirror ~80/20).
- **Curva**:
  - primo: 1 → [1]; 2 → [3, 1]; 3 → [4, 5]; 4 → [6]; 5 → [8, 1]; 6 → [10, 8];
  - secondo: 1 → [1]; 2 → [3, 4, 1]; 3 → [6]; 4 → [8, 6, 1]; 5 → [10, 8].
- **Piano**: "6 su 6, 8 su 8, 10 su 10". Va bene non fare niente all'inizio se garantisce quei pezzi.
- **Regole**:
  - redirect degli attacchi sui corpi da 1;
  - **resta a 2 vite** (a 1 ti tassano 3–4 carte);
  - attiva lo Stage ogni turno;
  - un **doppione in mano è scarto**, anche il 10c;
  - non giocare l'8c al turno 8 contro aggro.
- **Per matchup**: affama (starve) Enel e Rosinante, corsa (race) contro Nami e Luffy B/G, perché lì le carte si rimpiazzano.

### OP11-041 Nami Blu/Giallo — difensivo "balanced"
- **Mulligan**: tieni con EB03-053 (Nami 5c, il rimbalzo), oppure con ≥2 carte di costo ≤2. Testo: si mulligana quasi solo per Nami.
- **Turno**: secondo; primo nel mirror.
- **Curva**:
  - primo: 2 → [2]; 3 → [5, 4, 2]; 4 → [7, 5, 4]; 5 → [8, 7]; 6 → [10, 8, 7];
  - secondo: 1 → [2]; 2 → [4, 2]; 3 → [5, 4]; 4 → [7, 5]; 5 → [8, 7]; 6 → [10, 8, 7].
- **Piano**: la vita si converte in carte (il Leader pesca quando perde vita). Non counterare un 7 singolo; counterare i turni da più attacchi.
- **Sequenze tardive**: Robin all'8, Robin prima di Moria al 9, poi Gal-Dino + Borsalino/Marco ogni turno.
- **Per matchup**: contro Enel pavimento a 3 vite (counter presto), contro Rosinante a 2.

### `fundamentals` (per tutti)
33 concetti con regola IA. Quelli più vicini ai nostri difetti:
- penalizza la fine turno con DON!! non spesi;
- dividi i DON!! per l'usura, concentrali per forzare una difesa;
- dimensiona l'attacco **appena sopra** la soglia probabile di counter;
- prima gli attacchi, poi le giocate che non sono di combattimento;
- **prima l'attaccante "naturale", poi quello potenziato coi DON!!**;
- ordina gli attacchi in base a ciò che forzano e precalcola le risposte;
- pianifica il lethal all'indietro;
- prevedi il prossimo "power turn";
- ruolo beatdown/controllo ricalcolato ogni turno;
- da dietro, cerca la varianza;
- mulligan: curva turni 1–2 + pescata/interazione.

Sono testo: **nel codice del worker usato non ci sono** (servono al coach / al server).

### Copertura dei 17 Leader del nostro `meta-decks.json`

| Leader | playbook MH | guida Pro |
|---|---|---|
| OP14-020 Mihawk | no | no |
| OP09-062 Robin | no | capitolo Rocks + guida EB05 |
| OP17-039 Rocks | no | **Master Class** + guida EB05 Xebec |
| OP13-004 Sabo | no | capitolo Rocks + EB05 |
| OP15-058 Enel | solo come "vs" | capitolo Rocks + EB05 |
| ST30-001 Luffy & Ace | no | capitolo Rocks + EB05 |
| OP17-058 Kaido | no | capitolo Rocks + EB05 |
| OP17-079 Black Luffy | no | capitolo Rocks |
| OP16-001 Ace | no | no |
| OP05-098 Enel | solo come "vs" | capitolo Rocks + EB05 |
| OP13-001 Luffy | no | EB05 (Luffy OP13) |
| OP14-041 Hancock | no | capitolo Rocks + EB05 |
| OP12-061 Rosinante | solo come "vs" | capitolo Rocks + EB05 |
| OP08-098 Kalgara | no | no |
| ST10-002 Luffy | no | EB05 (Luffy ST10) |
| OP08-058 Pudding | no | capitolo Rocks |
| OP09-042 Buggy | no | EB05 |

---

## 6. Confronto con il nostro bot (in ordine di impatto probabile)

Il nostro Pro (`pro.ts`) è già più avanzato del loro worker:
- 6 candidati più tutte le [Activate: Main], halving successivo con numeri casuali comuni, orizzonte 1;
- la valutazione ha convessità della vita, counter, utilità del board, rimozioni, curva e pressione.

Il divario vero è con il **Pro server**, e con la **conoscenza per matchup** delle guide.

1. **Stimare la probabilità di vittoria, non un punteggio.**
   - Loro: le opzioni si confrontano come % di vittorie su molti deal giocati fino in fondo (o molto in là), con i conteggi netti.
   - Noi: orizzonte 1 più valutazione statica, perché la politica veloce è troppo grezza per giudicare più turni (misurato).
   - Da fare: rendere la politica dei rollout abbastanza buona da giocare fino alla fine (vedi punto 3), poi misurare l'orizzonte "fino a fine partita" con un budget a tempo e il flag "rough".
2. **Ordine del turno come regola esplicita** (è il nostro difetto principale). Loro hanno regole che danno priorità e il coach le punisce:
   - attacco prima della giocata;
   - swing piccolo prima del grande sul Leader;
   - attaccante naturale prima di quello con DON!!;
   - carte prima dei DON!!;
   - [Activate: Main] prima di finire il turno;
   - **mai Fine turno con DON!! inutilizzati o con un attacco valido**.
   
   Per Mihawk: "personaggio → stappo dei DON!! (piegando il pezzo già usato) → DON!! → attacco", come ha detto Vins. Da noi: un ordinamento/potatura nei candidati (es. vietare Fine turno se esiste un attacco legale ≥ Leader, o se restano DON!! attivi e un attaccante attivo), più un prior che metta [Activate: Main] che **libera DON!!** prima degli attacchi.
3. **Counter realistici nei rollout.** I loro rollout counterano per probabilità di stile e vite (tabella 1.3); il Pro server ne ha di veri. Da noi (coaching, partita 2) l'avversario simulato countera troppo poco, quindi per il bot l'attacco piccolo "uccide sempre" e caricare DON!! non serve. Due interventi:
   - una tabella per vite come la loro, con +2000 sul Leader già a 3–5 vite nei matchup veloci;
   - la regola "aggiungi DON!! finché un counter non basta" come candidato sintetico: DON!! sull'attaccante pari a buco + taglia tipica di un counter (2000).
4. **Mulligan per Leader validato a mani appaiate.** Loro: regola semplice per Leader ("un Personaggio 2–5" per Rocks; "Stage o due tra 6/8/10" per Teach), scelta confrontando le stesse mani tenute e rimescolate. Noi: euristica unica. Da fare:
   - `mulligan` per Leader nel nostro playbook (Mihawk: Coffin Boat o un searcher, come da dati TCGMM);
   - un banco "stesse mescolate nei due modi" in autosim, per misurare keep e ship e primo e secondo per matchup. È lo strumento più riutilizzabile di tutto lo studio.
5. **Playbook per matchup che cambia stile e pavimento.** Loro: `vs[leader]` cambia attackStyle (race/starve/conserve) e lifeFloor. Noi: un solo ruolo derivato dal "clock". Il nostro playbook dovrebbe fissare, per (Leader, avversario):
   - lo stile (pesi vita/mano);
   - il pavimento di vita;
   - la soglia sacrificabile;
   - la **curva preferita per round** (loro: liste di costi per round, primo/secondo; noi: `curveFill`, generico).
6. **Primo/secondo per matchup.** Gli scarti fino a 22 punti valgono più di quasi ogni altra cosa (Rocks contro Kaido/Enel). Noi oggi non scegliamo per matchup. Va misurato con le mescolate appaiate.
7. **Coerenza del piano (power turn, lethal all'indietro).** Loro lo hanno come principio e come "piano" restituito dal server (la sequenza fino a Fine turno), quindi le mosse dello stesso turno seguono un piano unico. Noi decidiamo mossa per mossa. Si potrebbe cercare **sequenze di turno** (piani) invece di singole mosse, valutando la posizione a fine turno, almeno per la fase attacchi + DON!!.
8. **Valutazione più ricca ma non necessariamente più forte.** La loro è molto semplice (lineare, niente DON!! né counter) e regge perché dietro c'è la simulazione. Copiarla serve come **riferimento A/B** (ricetta in 1.6), non come sostituto: da misurare con il gauntlet contro `EVAL_BASE`.
9. Dettagli minori:
   - loro non rimescolano il proprio mazzo nella determinizzazione: noi sì, va bene così;
   - loro mettono i DON!! "tutti sul Leader o tutti sul migliore": peggio della nostra granularità per singolo DON!!;
   - la loro scelta dei bersagli è "il più forte": noi abbiamo il lookahead greedy.

**Proposta di ordine di lavoro:**
1. banco a mescolate appaiate (mulligan e primo/secondo);
2. regole d'ordine del turno + divieto di Fine turno con risorse;
3. counter realistici nei rollout + candidato "DON!! finché un counter non basta";
4. playbook per matchup per Mihawk (stile, pavimento, curva, mulligan);
5. set di pesi "MH" per l'A/B;
6. ricerca di piani di turno.
