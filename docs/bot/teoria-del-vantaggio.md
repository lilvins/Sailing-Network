# Teoria del vantaggio — come il bot capisce chi sta vincendo

> Scritto il 2026-10-29. Fonti: archivio Patrick (`MigrazioneNewPC/Patrick/archive/`): magic/, fundamentals/, deckade/, next-level-magic/, next-level-deckbuilding/, road-of-the-king/, onepiece/. In più la regola difensiva di Vins.
> Il codice che lo implementa: `src/autosim/ai/evaluate.ts`, pesi in `tuning.ts` (`EVAL`). I pesi imparati giocando sono in `learned.json`, raccontati in fondo.

## 1. Perché serve

Il bot Pro decide simulando: prova una mossa e gioca in fretta fino alla fine del turno (orizzonte 1). Poi deve dire quanto è buona la posizione in cui è arrivato. Giocare ogni volta fino alla fine della partita costa troppo, e con la policy veloce aggiunge solo rumore: lo abbiamo misurato, l'orizzonte 3 è peggio dell'1.

Il bot vede quindi lontano quanto la sua **valutazione**. Questo documento dice cosa conta come vantaggio, perché, e come si misura.

Una conseguenza utile: la valutazione serve solo a **ordinare posizioni sorelle**, cioè quelle che si raggiungono con mosse diverse dallo stesso punto. Le costanti uguali per tutte, come l'asimmetria strutturale di chi va secondo, non cambiano la scelta. Per questo non vanno corrette.

## 2. In One Piece c'è un'unica economia

La lezione più importante viene da `onepiece/life-as-resource.md` e `onepiece/counter-system-combat-math.md`: **vita, mano e difesa sono la stessa valuta**.
- Un colpo al Leader toglie una vita ma **dà una carta**, e a volte un Trigger.
- Un counter toglie una carta dalla mano ma **salva una vita** o un personaggio.
- Un DON!! serve sia a giocare carte sia ad attaccare (+1000).

Per questo la "card advantage" di Magic non si importa in modo lineare (`magic/card-advantage.md`). A vita alta, subire un colpo è quasi neutro (−1 vita, +1 carta). Diventa decisivo vicino a zero, oppure quando costringe a spendere counter.

## 3. Le grandezze, una per una

Notazione: *io* = il bot, *lui* = l'avversario. Ogni voce dà punti; il totale è *mio − suo*.

### 3.1 Vita — valore convesso
**Teoria.** È la "Philosophy of Fire" (`magic/philosophy-of-fire.md`, `deckade/03`): ogni danno rende più prezioso il successivo. Passare da 5 a 4 vite costa poco, da 1 a 0 è la partita.
**Misura.** `V_vita(L) = Σ_{i=1..L} gradino[i]`, dove `gradino[1]` è l'ultima vita, quella che vale di più. Pesi di partenza: 150, 115, 95, 80, 70 (poi 65).

### 3.2 Mano — opzioni
**Teoria.** È il vantaggio carte "quantità" (`fundamentals/card-advantage-quantity-vs-quality.md`): più carte significa più scelte.
**Misura.** `carte_in_mano × peso_mano`. Il peso è basso perché la parte difensiva della mano si conta a parte (3.3).

### 3.3 Counter in mano — budget difensivo
**Teoria.** La matematica dei counter (`onepiece/counter-system-combat-math.md`): il "2k counter" è l'unità di conto. Chi è costretto a cambi peggiori perde il logoramento.
**Misura.** `Σ counter in mano / 1000 × peso_counter`. Per l'avversario si usa la sua mano nel mondo determinizzato: è una stima, non una sbirciata.

### 3.4 Campo — conta solo chi fa qualcosa
**Teoria.** Presenza e minacce (`next-level-deckbuilding/06`), con la correzione di Vins (2026-10-30): *"un 2000 che non fa niente è un −1 e ha 0 valore"*.
Un personaggio in campo vale solo se fa almeno una di queste cose:
- arriva al Leader avversario (con un DON!!), compresi i buff: nel nero i 2000 diventano 5000 quando giochi un gigante;
- blocca (`Blocker`);
- ha un **effetto che continua a lavorare**: static, quando attacca, attivabile, a fine turno, quando viene K.O.

Un On Play non conta, perché ha già dato il suo valore quando la carta è entrata, come il searcher che ti ha messo la carta in mano.

**Misura.** Solo sui personaggi utili:
- numero;
- potenza / 100 (senza i DON!! dati);
- **costo × peso_costo**, perché un K.O. vale quello che uccide (3.8).

In più si contano i `Blocker` attivi e una penalità per i personaggi costosi lasciati riposati. Un personaggio inutile vale 0: giocarlo non è sviluppo, e ucciderlo all'avversario non è un guadagno.

### 3.5 DON!! — tempo
**Teoria.** `onepiece/don-system-tempo.md`, `magic/tempo.md`. In OP non esiste il mana screw: i DON!! arrivano a 2 per turno per entrambi. Il tempo conta solo quando un effetto ne fa guadagnare o perdere (es. "DON!! −1").
**Misura.** `DON!! utilizzabili il prossimo turno × peso_don`, cioè quelli in campo più i 2 della fase DON!!, se il mazzo DON!! li ha.

### 3.6 Pressione — chi minaccia il letale
**Teoria.** La densità di minacce contro le risposte (`deckade/08`). L'aggressore "spinge la diga" finché le risposte finiscono. Si collega alla regola di Vins: **scudo = blocker + vite + counter in mano ÷ 3000**.
**Misura:**
- `attaccanti(io)` = Leader + personaggi che al prossimo turno attaccano con potenza ≥ quella del suo Leader;
- `scudo(lui)` = vite + Blocker attivi + counter in mano / 3000;
- `pressione = attaccanti(io) − scudo(lui)`, limitata tra −3 e +3.

Quando è positiva il letale è vicino e vale molto di più (`bonus_letale`). Si fa lo stesso dal suo lato e si sottrae.

### 3.7 Ruolo — chi è il beatdown
**Teoria.** "Who's the beatdown?" (`magic/whos-the-beatdown.md`, `onepiece/archetype-theory-beatdown.md`): sbagliare il ruolo fa perdere la partita, e il ruolo dipende dal matchup, non dal mazzo.
**Misura.**
- `orologio(io) = scudo(lui) / attaccanti(io)` = turni che mi servono per ucciderlo.
- Se il mio orologio è più corto del suo, sono il **beatdown**: le sue vite pesano di più (+`spostamento_ruolo`) e le mie un po' meno.
- Se è più lungo, sono il **control**: mano e counter pesano di più.

Il ruolo non è una voce di punteggio: **sposta i pesi**.

**Si decide una volta sola, prima di pensare.** All'inizio il ruolo veniva ricalcolato su ogni posizione simulata, e così il bot crollava al 34% contro la versione senza ruolo. Il motivo: due mosse sorelle potevano arrivare a "ruoli" diversi, e i loro valori saltavano di decine di punti senza una vera differenza di gioco.

Ora il Pro legge il ruolo dalla posizione **in cui deve decidere** (`roleOf`) e lo tiene fisso per tutte le posizioni che confronta. È anche la lezione di Flores: il ruolo è un piano, non un'etichetta che cambia a ogni mossa.

### 3.8 Rimozione — vale quello che uccide
**Teoria.** Chapin (`next-level-deckbuilding/06`): una rimozione si misura sul **bersaglio migliore che le resta**, non su quello che c'è adesso. Il caso concreto è il Vander Decken IX di Mihawk: è una carta da late game per togliere i pezzi grossi riposati. Giocarla a 2 DON!! a vuoto, o a 5 su un costo 1 invece di sviluppare un 6000, la butta via.
**Misura:**
- una carta è "rimozione" se il suo On Play, [Main] o [Counter] toglie un personaggio avversario (K.O., in mano, nel mazzo, nel cestino). Lo si legge dall'IR, quindi vale per tutte le carte (`ai/cardTraits.ts`);
- ogni rimozione in mano vale `peso_opzione × max(costo del suo pezzo più grosso in campo, 5)`. Il 5 c'è perché i pezzi grossi arrivano più avanti anche se ora non ci sono;
- spenderla su un costo 1 brucia questa opzione e guadagna poco (3.4). Spenderla su un costo 7 guadagna più di quanto brucia.

**Misurato** (Mihawk pilotato dal Pro, 60 partite):

| | Decken giocati | a vuoto | a ≤3 DON!! | K.O. (costo medio) | turno medio |
|---|---|---|---|---|---|
| prima | 39 | 21 (54%) | 10 | 10 (5,1) | 5,6 |
| con 3.4 + 3.8 | 11 | 3 (27%) | 0 | 6 (6,0) | 8,1 |

Nel complesso il Pro nuovo batte quello di prima 53% su 400 partite: è positivo, ma non ancora significativo.

**Mai a vuoto.** Restava un 27% di Decken a vuoto, quasi tutti **pareggi esatti** di punteggio. Nel rollout la policy veloce calava Decken da sola subito dopo, quindi "giocalo ora" e "tienilo" finivano nella stessa posizione. Due correzioni:
- la policy veloce non gioca mai una rimozione: decidere quando spenderla spetta alla ricerca;
- una rimozione che, provata su una copia, non toglie nessun personaggio avversario non è mai una candidata (`ai/waste.ts`).

Risultato su 260 partite: **0 a vuoto**. Per confronto, i giocatori forti dei log TCGMM giocano Decken nel 79% dei casi a 10 DON!!, su bersagli di costo medio 8,3.

### 3.9 Sequenza degli attacchi — una lezione misurata
**Teoria.** Tutte le fonti dello studio (`docs/bot/studio/`) sono d'accordo: Fleche, madoka_hk, optcggrinder e i log TCGMM. Si attacca dal più piccolo al più grande. Il primo attacco serve a vedere come risponde l'avversario, i DON!! vanno sugli ultimi attaccanti, e i personaggi da abbattere vengono prima del Leader (60% dei turni misti nei log).

**Cosa abbiamo misurato.** Messa come **regola fissa** nella policy dei rollout ("piccolo prima, DON!! all'ultimo"), ha fatto perdere il bot: **45%** su 600 partite contro la versione senza (51%). La sequenza dei giocatori forti è **adattiva**: guardano la risposta al primo attacco e poi scelgono. Una regola fissa in una simulazione rozza prende solo il costo (attacchi senza DON!! counterati gratis) e non il beneficio (leggere la risposta).

**Quindi** la sequenza va fatta come ricerca: un risolutore degli attacchi e del letale che, dopo ogni attacco, considera le risposte dell'avversario (prendere la vita o counterare) e sceglie la linea che resiste al caso peggiore, come fa madoka. È il prossimo passo.

## 4. Cosa resta alla simulazione

Queste cose non si vedono in una foto della posizione:
- il contenuto vero della mano avversaria e i Trigger nelle vite: ci pensa la determinizzazione;
- le sequenze, le esche, il "giocare attorno" a una carta: sono decisioni della ricerca;
- l'inevitabilità oltre l'orizzonte, cioè chi vince se la partita va lunga: va imparata come **prior per matchup** giocando tante partite (vedi 6);
- il letale esatto in più turni: la pressione ne dà solo una stima.

**Perché non guardare semplicemente 3 turni avanti?** Lo abbiamo misurato: con l'orizzonte 3 il bot peggiora. Nei turni simulati entrambi giocano con regole rozze (la carta più cara, poi i DON!!, poi gli attacchi). Più turni si simulano, più errori si accumulano, e la differenza vera tra due mosse affoga nel rumore.

La valutazione serve proprio a dire in un colpo solo quello che 3 turni ben giocati mostrerebbero: il 6000 colpisce e porta vantaggio, il 2000 senza effetti non fa niente. Guardare più lontano diventerà utile quando la policy dei rollout sarà più realistica.

## 5. Cosa NON importiamo da Magic

- La teoria su terre, manabase e mana screw: i DON!! sono fissi.
- Le conversioni "1 carta = 2 vite = 2 mana" (`next-level-deckbuilding/06`): in OP la vita è 4–5 e restituisce carte. I numeri si tarano con il simulatore, non a priori.

## 6. Come il bot evolve le sue valutazioni

I pesi qui sopra sono un punto di partenza ragionato. Quelli definitivi li sceglie il bot giocando:
1. prende i pesi attuali e ne cambia uno (es. `bonus_letale` +20%);
2. il Pro con i pesi nuovi gioca contro il Pro con i pesi attuali, partite in coppia sui mazzi meta;
3. tiene il cambio **solo se vince in modo statisticamente significativo** (test dei segni, p < 0,05). Altrimenti lo scarta.

Ogni tentativo, adottato o scartato, finisce nel registro in `learned.json` e nella sezione qui sotto, rigenerata da `npm run train:autosim`. Così si legge cosa ha imparato e perché.

## 7. Le misure (2026-10-29, Pro contro Pro, coppie su mazzi meta casuali)

| Confronto | Vince il primo | Partite |
|---|---|---|
| v2 (tutta la teoria, ruolo ricalcolato ovunque) contro v1 | 41,8% | 400 |
| v1 + solo vita convessa | 48% | 200 |
| v1 + solo counter in mano | 53% | 200 |
| v1 + solo Blocker | 47,5% | 200 |
| v1 + solo pressione e letale | 52% | 200 |
| v1 + solo ruolo, ricalcolato ovunque | **34%** | 200 |
| v1 + solo ruolo, fissato alla decisione | 50% | 200 |
| **v2 completa, ruolo fissato** contro v1 | **55,5%** | 200 |

Con 200 partite l'errore è di circa ±3,5%, quindi le singole voci tra 47% e 53% sono nel rumore. Due cose sono sicure:
- il ruolo ricalcolato ovunque era un errore;
- la teoria nel suo insieme migliora il bot.

I pesi giusti li trova l'allenamento.

## 8. Cosa ha imparato il bot

Lo racconta [allenamento.md](allenamento.md), rigenerato a ogni tentativo da `npm run train:autosim`: pesi attuali contro quelli di partenza e registro dei tentativi, adottati e scartati.

## 9. Lo studio da cui viene (2026-10-30)

In `docs/bot/studio/`:
- `partite-alto-livello.md`: 7.613 partite TCGMM tra umani già sul disco (`Documents/RYAN/lab/data/logs/tcgmm/`), con statistiche su Mihawk, attacchi e Decken. Circa 500.000 coppie posizione-mossa umana, usabili come dati di allenamento;
- `fleche-masterclass.md`: Fundamental Masterclass di Fleche (8 capitoli) e i Fundamentals di SkepasG;
- `madoka_hk.md`: 14 coaching, circa 22 ore, compreso quello con Vins;
- `optcggrinder.md`: 26 video, tutti quelli didattici;
- `youtube-recente.md`: classifica dei 22 video recenti più educativi. **Da leggere**: YouTube ha bloccato il PC per troppe richieste, nel file c'è come riprendere.

