# Studio: madoka_hk

> Scritto il 2026-10-30. Fonte: i sottotitoli automatici inglesi dei video YouTube di madoka_hk. I video non sono stati guardati: le carte nominate a voce sono spesso trascritte male ("Bonnie" = Bonney, "Charlestone" = Charlotte, "NL" = Enel, "Goofy" = Buggy/Croc...).
> Tutto è parafrasato, con al massimo una citazione breve per video. Si collega a [teoria-del-vantaggio.md](../teoria-del-vantaggio.md).

## 0. In breve: le cose più utili per il bot

1. **Il letale si calcola, non si indovina.** Lo split dei DON!! va valutato con un minimax a due rami (l'avversario prende la vita oppure countera) e si sceglie la linea che gli costa più counter nel caso peggiore (§3.1).
2. **Mihawk OP14-020 ha un ordine preciso.** Prima gli attacchi di sondaggio, poi si giocano i personaggi, poi si attiva l'abilità riposando la carta che costa meno (Coffin Boat), infine si spendono i +3 DON!!. Se non c'è un personaggio di costo ≥5, l'abilità non fa niente, divieto compreso: la carta riposata è gratis (§3.2).
3. **Coffin Boat è la "carta da riposare" ogni turno.** Va a 4 copie ("il mazzo diventa da 46") e si gioca presto (§3.3).
4. **Il clock sostituisce il ruolo.** Ogni turno: "in quanti turni lo uccido, in quanti muoio?". Una mossa vale solo se sposta uno dei due numeri di almeno un turno. Se muoio al suo prossimo turno ottimale, vado per il letale adesso (§3.4).
5. **Contro Mihawk e con Mihawk:** si dà sempre per scontato il doppio DMG (Vander Decken) e conviene attaccare la board (Mihawk 6, Oden, Shanks), non la faccia (§4).

---

## 1. Catalogo: cosa pubblica madoka_hk

**Chi è.** Giocatore e coach di Hong Kong, tra i migliori su RG Luffy e Mihawk. Il canale YouTube è `youtube.com/@madoka_hk` (canale "Madoka_hk", circa 3.000 iscritti a ottobre 2026).

**Altri canali**
- **Metafy** (`metafy.gg/@madoka-ba3b5690`): guide a pagamento, per esempio la *OP16.5 RG Luffy Comprehensive Guide*, e un abbonamento ("Magical friend") con accesso anticipato agli archivi di coaching. **Non studiate** perché a pagamento.
- **Discord**, con le decklist aggiornate.
- Su X/Twitter, Twitch e blog non ho trovato una presenza OPTCG.

**YouTube, censimento del 2026-10-30:** 1.099 video, 31 live, nessuno short.

| Tipo | Quanti | Note |
|---|---|---|
| Partite RG Luffy (vs X, mirror) | ~340 | Quasi tutte senza commento parlato; il titolo dice il matchup |
| Partite Elbaf Luffy | ~300 | Alcune hanno nel titolo una nota tipo "(misplayed)", "(lethal calculation)", "(how to play vs starve)" |
| Partite Mihawk (verde OP14-020, Mihawk "Law", East Blue, OG) | ~270 titoli che citano Mihawk, ~150 con Mihawk come mazzo di madoka | Anche "G Mihawk vs X (Go first/second)" |
| Rosinante, GU Luffy, P Enel, Foxy, Brook OP15, altri | ~200 | |
| **Coaching registrati** | ~30, da 1 a 3,5 ore | Il materiale didattico vero |
| Live | 31, da 1 a 9 ore | Ranked sul simulatore, test di mazzi; una si intitola "who's the beatdown" |
| Fuori tema | pochi | Video di LoL (Singed) e Master Duel |

**Cosa ho studiato.** 14 coaching, circa **22 ore** di parlato, letti per intero (6 agenti in parallelo, ognuno su 1–4 trascrizioni):

| id | Titolo | Durata |
|---|---|---|
| 0QkIdibP2s4 | OPCG Fundamental Coaching (Mulligan, Resource, Hand read, Deck building, Clocking) | 2h16 |
| OhIbTME0eXw | Coaching session (How to improve and OPCG fundamental) | 1h14 |
| b8Oe6CqZzJI | Mihawk coaching session (4 Shanks build) | 55m |
| 7koX4nIULx4 | Green Mihawk coaching session with Kwallen | 1h14 |
| cqpt36s8yaw | Green Mihawk coaching archive with Razza | 1h00 |
| qPkDqFTlN0U | OP16.5 RG Luffy coaching **with vins** | 3h34 |
| vyDPAsY5Ei4 | RG Luffy Coaching (Mihawk matchup focus) | 1h01 |
| X4Rb26RABkc | Elbaf Luffy Coaching (vod review & new Mihawk MU strategy) | 1h04 |
| ESWQmWGE0nE | Elbaf Luffy Coaching (meta matchup guide) | 1h10 |
| k_TZ0tHIKhc | RG Luffy Coaching (vod review and common mistakes) | 1h02 |
| AxH-9a1lQL0 | OP16.5 RG Coaching (deck build, tech and meta mu) | 2h07 |
| KXWleTX5SL8 | RG Coaching session (game review and meta matchup) | 1h34 |
| DxihrRUGDrA | EB05 RG Luffy Coaching (Mirror & Rocks mu) — il più recente | 2h07 |
| xtKm0o9fc6k | B Luffy Coaching (Rosi mu, vod review, live vs Shanks) | 1h53 |

**Cosa non ho studiato, e perché.**
- **Bloccati da YouTube (HTTP 429 / IP bloccato) dopo i primi download.** Sono altri coaching e i video brevi annotati più rilevanti:
  - coaching: Rosinante (YUd8tfwMFfY, m0LBPrjOf_8, -0gjq3BnfPU, XUTT0j0ISWo, MYhbKuCFOsg, ATp0uvY612I "how to play with bad hands", 7VSH2BJGdfI), Elbaf (YseCymacYrk), OP16.5 (uHZ-J-aiIC8), UG Luffy (xAYi5Ob-55c), RG con Ranker (AuaoIuQLgUU), Cantonese GU (mRny8zMmFuk);
  - video brevi su Mihawk: hdF1DHS5Gkc "that's how you win RG as Mihawk", q6M1t0iKy_Y, x-f32Gvdo1s "lethal", wqUK8CS1vho, bopdfR0KSDw, 09-sWy0Ut0w, LyDv57tIgp0;
  - RG vs Mihawk "practice with detailed explanation" parte 1 e 2 (01uHNUpPwyI, PXHSkVxRfDE);
  - Elbaf annotati: F-XoJiBfgxo "lethal calculation", O4pRjIrU8Ps "vs starve", F_meddcWq8A "common misplay", rbZksrFb-NA "stage docking".

  **Sono il primo lotto da recuperare** ripetendo il download fra qualche ora, con pause lunghe.
- **nzk0gkTj0GE** (OP16.5 vod review) ha i sottotitoli disattivati.
- **Gli ~1.000 video di sole partite.** In genere non hanno commento parlato, e ai sottotitoli non danno quasi niente. Servirebbero come replay da guardare, non da leggere.
- **Le live** (ore di ranked, in gran parte senza titolo).

---

## 2. Lezioni video per video

### 2.1 Fundamental Coaching — 0QkIdibP2s4
Coaching con un allievo, diviso per temi; nella parte finale analizza screenshot, tra cui **Mihawk vs Robin**.

**Mulligan**
- La mano va tenuta se basta a vincere *quel* matchup, non se è la migliore possibile. Nei matchup facili è sufficiente una curva giocabile; in quelli difficili serve la curva piena, e si rimescola anche una mano che in un altro matchup si terrebbe.
- I finisher (i 10 costi) non contano: c'è tempo per pescarli.
- Andare primo o secondo è una scelta statica per matchup, che si decide testando circa 5+5 partite.

**Split del letale**
- Se tutti gli attaccanti arrivano almeno a 4k: split pari, cioè (Σ potenze + DON!!) / numero di attacchi.
- Con un "weenie" (≤3k, anche 0k) conviene aprire con un attacco più piccolo dello split pari, perché l'avversario deve counterarlo e a te resta comunque il letale.
- Algoritmo: parti dallo split pari tra gli attaccanti buoni. Per ogni linea calcola il counter richiesto nei due rami, "prende la vita" e "countera". Poi abbassa il primo attacco di 1k alla volta e fermati quando il risultato peggiora.
- Il valore di una linea è il minimo che l'avversario deve spendere giocando bene. A parità, "X prima della vita" è meglio di "X dopo la vita".
- Lo stesso calcolo serve in difesa: calcola lo split migliore dell'avversario per sapere quale attacco prendere.
- Tra due split equivalenti si sceglie in base alla carta vita attesa. 8/8 conviene se l'ultima vita è probabilmente un brick, 7/9 se è probabilmente un 2k. La stima viene da decklist meno carte uscite meno carte lette.

**Vite**
- Le vite devono assorbire gli attacchi più **grandi**.
- Davanti al primo 5k, chiediti se puoi counterare *tutti* i 5k che arriveranno prima degli attacchi grandi. Se no, prendi subito questo.

**Difendere i personaggi**
- Un personaggio è un generatore di circa 1 carta a turno. Più presto è stato giocato, più vale.
- Se basta **una** carta in totale per salvarlo, quasi sempre conviene.
- Con due carte, nell'early di solito no. Nel late sì, se il personaggio ne chiede 2 a turno all'avversario.
- Contro il leader Mihawk "una carta" diventa due, perché leader + weenie possono riattaccare.

**Faccia o personaggio**
- Nell'early il default è il bersaglio più piccolo, a meno che sul personaggio tu possa chiedere ≥2 carte.
- Con l'avversario a 3 vite si apre in faccia; a 5 vite il 5k in faccia lo prende volentieri.

**Lettura della mano**
- Ricorda tutte le carte cercate dall'avversario.
- Lo scarto è la carta più inutile che ha in mano. Se scarta un 2k, il resto è solo giocate o altri 2k.
- Anche il counter che dà è il più sacrificabile.
- Le "prese innaturali" (scende a 2 vite presto, lascia morire un 8k) indicano pochi counter in mano.

**Trigger**
- Gioca contro il trigger **peggiore**.
- Attacca prima con i personaggi che il trigger metterebbe K.O.: se lo fa, hanno già attaccato.
- Se vinci senza colpire la vita, non colpirla. Se devi, confronta P(trigger) (es. Robin ~18/50) con P(vincere senza colpire).

**Deckbuilding**
- A 4 copie le carte da vedere presto (4 copie: ~41% di averne una entro il T3; con 3 copie il 9% in meno) e quelle che servono doppie.
- Lo stage a 4 copie "vale un 2k".

**Clock**
- Ogni azione deve accelerare il clock avversario o ritardare il tuo di almeno un turno intero. Se no, non conta.
- **Mihawk vs Robin:** Robin si cura sempre, quindi accelerare il suo clock è difficile, mentre ritardare il proprio è facile. Per questo Mihawk ripulisce la board, e va in faccia solo con il letale sicuro il turno dopo, oppure quando morirà comunque fra due turni.

**Altro**
- Un blocker va tolto **prima** di attaccare.
- Due DON!! in più non chiedono 1k di counter in più: per chiederlo devi alzare di 1k *ogni* attacco che le vite non assorbono.
- Gli attacchi da 12k (che nessun counter ferma) contano come "vite rimosse".
- I rush vanno per primi.

> "If one card is enough to defend, is worth to defend usually."

### 2.2 How to improve / fundamentals — OhIbTME0eXw
- **Ordine degli attacchi contro i trigger.**
  - Contro un trigger da −3k (Fen Ogre) attacca prima il più piccolo.
  - Contro un trigger che mette K.O. i costi 1 attacca prima il costo 1.
  - In generale, contro i trigger da K.O. l'ordine è dal costo più basso al più alto.
- **Informazione da ciò che l'avversario NON fa.**
  - Mihawk che salta il turno da 2 DON!! non ha searcher, quindi aspettati un 9k sul leader.
  - Uno scarto di Mihawk 6 al T4 significa che ne ha un altro in mano.
- **Il fondo del mazzo.** Ricorda solo dove finiscono i pezzi chiave. Ogni searcher manda in fondo 4 carte, una in più se non trova niente.
- **Clock.** "Clock N" significa che l'avversario muore fra N turni.
  - A clock 2 avversario si va solo in faccia.
  - Se la faccia non accorcia il clock, attacca il personaggio di valore (per esempio il suo Mihawk).
  - Dal turno da 10 DON!! fatti sempre due domande: "in quanti turni lo uccido? in quanti muoio?". Se sei avanti, gioca sicuro; se sei dietro, gioca rischioso.
- **Simula la curva ottimale dell'avversario.** Contro Mihawk dai sempre per scontato il doppio DMG: con DMG che riposa 4 DON!!, leader e smoke escono circa 7/7/9.
- **L'ultimo turno.** Se lo split da 10 DON!! dell'avversario, che non richiede carte particolari, ti uccide, vai per il letale **adesso**. Se muori solo a una carta specifica, confronta P(il letale passa) con P(non ha quella carta).
- **Vita contro personaggio.** Nell'early un personaggio vale più di una vita. Nel late una vita vale quanto un personaggio, o di più.

> "If losing you do risky play cuz if you play safe you never win."

### 2.3 Mihawk coaching (4 Shanks build) — b8Oe6CqZzJI
**Mulligan e ricerca**
- Rimescola le mani con un searcher, un 5 e due eventi senza DON!! per giocarli.
- Il mulligan è "metà partita": cerca la carta chiave del matchup.
- Risolvi sempre il search **prima** di decidere le giocate del turno.

**Attacchi**
- Nell'early attacca i weenie: ogni personaggio ucciso è un attacco in meno che subisci.
- Primo attacco col 5k sul leader, per vedere se l'avversario difende. Lo stun e gli eventi si usano **dopo** aver visto la reazione.

**Shanks e dimensione della board**
- Uno Shanks appena giocato non va riposato, per giocare attorno a Whitebeard 8 o Mamaragan.
- **Regola base di Mihawk:** se non muori il turno dopo, gioca il personaggio più grande.
- Se la board avversaria è più grande, non puoi giocare la partita lunga: devi correre.

**Abilità del leader**
- **Interazione con lo stage.** Nel turno da 5 DON!!, se non hai personaggi di costo ≥5, attivi l'abilità del leader riposando lo stage. La condizione fallisce, quindi non succede niente, **neanche il divieto di giocare personaggi**. Hai una carta riposata in più e la blocker Bonney pesca già sulla curva.
- Linea tipo: gioca Shanks, riposa lo stage, attacca con il leader a 8, tieni gli altri in piedi.

**Piano per turni**
- Early: search.
- 5 DON!!: un 5, meglio non la blocker Bonney.
- 7 DON!!: Shanks.
- 9 DON!!: Mihawk 9, oppure Shanks, oppure 5+5.
- 10 DON!!: Law & Bepo "per il resto della partita".

**Matchup e counter**
- Contro Teach sviluppa 2 personaggi, perché difende ogni attacco con una carta.
- Contro Ace attacca la board.
- Counterare 1k su un 6 contro 6 equivale ad assorbire un 8k.

> "when you're not going to die next turn, you just play your biggest character"

### 2.4 Green Mihawk con Kwallen — 7koX4nIULx4
**Counter e difesa**
- Contro Yellow Luffy le vite non contano: serve costringerlo a counterare. Meglio più attacchi che attacchi grossi.
- Spendi prima i counter da 1k se arriveranno attacchi da 6k.
- Blocca sempre quando il blocco è gratis.

**Tempismo dei pezzi**
- La stun Bonney va giocata prima del 7° DON!! avversario. Dopo non vale più.
- Laboon serve solo contro le rimozioni pericolose.
- Con Apoo riposa il pezzo che l'avversario userebbe per un'azione futura, non il più grosso.

**Letale**
- Usa il calcolatore. Attacca prima col Mihawk da 10k, che l'avversario deve prendere, poi dividi il resto.
- Se il searcher fa parte dello split, apri basso (8) e decidi dopo aver visto la reazione.

**Ordine delle ricerche**
- Prima la decisione facile (bersagli stretti), poi quella difficile (bersagli ampi), che così si prende con più informazioni.

**Perona "gratis"**
- Prima del turno non c'è niente da riposare. Giochi Perona e la riposi per l'abilità del leader, quindi il suo search non costa niente.
- Conto: 1+4 DON!! spesi, +3 dall'abilità, restano 8 DON!! da dividere (8/8/9).

**Matchup e deckbuilding**
- Contro Foxy pulisci tutti i Foxy Pirates (gliene servono 3) e scarta Mihawk 9, che lì è inutile.
- Il nucleo del mazzo è Law & Bepo 10. **Coffin Boat va a 4 copie**: è il primo taglio quando servono slot, ma mai a zero.

> "If you don't have enough space, just cut boat, but I will never go zero"

### 2.5 Green Mihawk con Razza — cqpt36s8yaw
**Mulligan e matchup**
- Tieni la mano se c'è un weenie (KK, Perona) e non ci sono troppi brick.
- Mihawk perde solo contro Enel ("NL") e Kobe.

**Contro Enel**
- Tieni sempre un 5 in piedi: le sue rimozioni sono contate (4 Kid 10, 4 Mamaragan, 2–4 Gamma, 4 Alvida).
- A 9–10 DON!! gioca Bonney+Bonney, non Mihawk 9: le Bonney si ripagano, mentre Mihawk costa una carta della mano.
- Qui il **numero di carte in mano** conta più del totale dei counter.

**La sequenza del turno, in ordine**
1. Attacca con tutti.
2. Gioca Bonney e rimetti in piedi una carta.
3. Gioca la seconda Bonney e rimetti in piedi un'altra carta.
4. Usa l'abilità del leader per il 3° DON!!.

**Cosa riposare per l'abilità**
- Un DON!! o un personaggio che ha già attaccato.
- Mai le blocker Bonney.
- Se il leader non può superare il blocker (sotto i 7k non serve), riposa il leader.

**Attacchi e ordine**
- Attacca prima con l'11k e guarda la risposta.
- Ordine 7 poi 5: costa all'avversario gli stessi counter, ma se il trigger Thriller Bark mette in campo un corpo riposato ti resta un attacco per colpirlo.

**Quando non c'è un turno dopo**
- Prendi tutto per cercare il DMG e gioca per le tue *outs*.

**Contro Nami**
- Attacca col 5k quando il trigger farebbe troppo male.
- Non spendere mai 2 carte per un 6k.
- Il freeze serve solo con leader da 5k: con leader da 7k ogni carta in mano vale circa 2k.

> "the amount of counter doesn't actually matter that much"

### 2.6 RG Luffy coaching con Vins — qPkDqFTlN0U
Teoria per matchup, poi Vins gioca live sul simulatore e madoka corregge.

**Teoria**
- **Beatdown/control.** In One Piece il concetto regge poco, perché lo swing del leader c'è sempre. Vale questa regola: se hai il vantaggio di board allunga la partita; se ogni turno perdi più risorse dell'avversario, accorciala.
- **"Desperate measure".** Se l'avversario è partito benissimo, prepara un letale in 1–2 turni (con Brook: tutti i DON!! in attacco, poi rimetti in piedi e riattacca).
- **Contro molti DON!! avversari attivi**, fai tanti attacchi anche piccoli, così senza 1k in mano deve spendere un 2k ("cheat value").
- **Ordine dei searcher.** Prima il searcher con meno bersagli: Nami prima dello stage al T1 è l'errore più comune.

**Contro Mihawk**
- A 4 DON!! non giocare Usopp. Metti i DON!! sul leader, attacca e passa: risparmi due carte contro il 9k di Smoker.
- Dai 7 DON!! in poi: uno Zoro a turno, poi Brook, poi il kill. L'obiettivo di ogni turno è non dare né carte né vite.

**Contro Enel**
- Andando secondo, affamalo: non attaccare il leader finché la sua mano non scende a 4–5 carte.
- Con Enel in campo 3 DON!! attivi difendono quanto 5.

**Late game**
- Se sopravvivi al peggior attacco plausibile, gioca un altro turno: accumuli counter.
- Non giocare attorno a ogni combo.

**Correzioni a Vins**
- Meglio Nami che lo stage, quando Nami fa da blocker.
- Va giocato prima il searcher "peggiore".
- Nel mirror si countera anche il 7k: una carta per una vita conviene.
- Ha contato i DON!! come se Zoro avesse rush.
- Meglio Brook+Luna che Zoro+Luna quando si è a poche vite.
- Come counter va data la copia in più di una carta da combo, non il 2k.
- Contro un leader con +1k servono 8k, non 7k.

> "mirror is more like who have more Zoro or Luna"

### 2.7 RG Luffy vs Mihawk — vyDPAsY5Ei4
**Curva e sviluppo**
- Nelle ricerche prendi prima i "restander" (Sanji/Usopp, rimettono in piedi DON!!), poi Zoro.
- La finestra per svilupparli si chiude all'8° DON!!.

**DON!! da lasciare attivi**
- Calcola lo split massimo di Mihawk. Con Shanks + leader + For Fun restano pochi DON!!, quindi bastano 3 DON!! attivi. Il resto va nei searcher.
- Lasciare 1–2 DON!! attivi nell'early lo costringe a scegliere tra cercare e colpire.

**Uccidere Shanks**
- A 9 DON!!, con stage e Shanks riposato, Nika lo uccide con certezza.
- A 8 DON!! l'uccisione non è garantita: meglio sviluppare.

**Bersagli e rischio**
- Attacca la board (Mihawk 6, Oden), non la faccia: ogni vita è una pescata verso la combo e verso Luna dal trigger.
- Se sei dietro, scegli la linea rischiosa.

> "they always have double DMG. Always"

### 2.8 Elbaf Luffy, VOD + nuovo piano contro Mihawk — X4Rb26RABkc
- Contro Mihawk non giocare personaggi piccoli al T1. Madoka dice che danno costi da riposare per la sua abilità; non l'ho verificato sul testo della carta.
- Serve un corpo di costo alto ogni turno: una board di 2 costi la annulla Luna.
- Prima di Shanks devi avere almeno 2 giganti + Zoro, con abbastanza counter per difendere Zoro.
- A 0 vite avversarie metti i DON!! sul personaggio che rende 1k per DON!!.
- Brook serve solo al T1, quando la mano avversaria è piccola. Dopo, l'avversario ha sempre un brick da scartare.

### 2.9 Elbaf, guida ai matchup — ESWQmWGE0nE
- Elbaf è quasi sempre l'aggressore. Nel dubbio attacca: un 8k che attacca chiede 4k di counter, mentre lo stesso 8k che blocca ne fa risparmiare 3k.
- Contro Mihawk: se arriva al **secondo** turno da 10 (secondo Shanks 10), hai perso. Hai circa 6 turni.
  - Spendi le carte per la board e lascia passare in faccia gli attacchi "banish".
  - Al primo turno da 10 assicurati di non morire al prossimo Shanks, poi letale.
- Contro Mihawk il numero di attacchi conta più della loro taglia.

> "If they get to their second ten DON turn, you lose."

### 2.10 RG, errori comuni — k_TZ0tHIKhc
**DON!! e counter**
- Errore numero uno: usa tutti i DON!!-counter prima delle carte in mano. Per il leader RG, un DON!! attivo vale circa un 2k.
- Lascia attivi esattamente i DON!! che servono contro la curva perfetta dell'avversario. Se lui colpisce più forte, ha sacrificato la curva.
- Avanzato: lasciane volutamente meno del necessario, per tentarlo a riposare la board.

**Attacchi contro Mihawk**
- Il primo attacco va a 6, non a 7: deve comunque subire un 6k.
- Contro una mano piccola apri con un attacco senza DON!!. Contro una mano grande meglio 9-9-6-8 che 10-10.
- L'attacco più piccolo va sul personaggio già ridotto.
- Il Mihawk 7 che pesca e scarta va bloccato subito.

**Ricerca e sviluppo**
- Nella ricerca prendi la giocata del turno dopo: mancare la curva è l'errore peggiore.
- Se giochi un solo personaggio, gioca il più grosso.

> "use all your DON before countering."

### 2.11 OP16.5 RG: deck, tech, matchup — AxH-9a1lQL0
**Deckbuilding**
- Restander a 4 copie: tutti li uccidono, bisogna poterli ri-sviluppare.
- Brook a 4: deve comparire in ogni partita.
- 3 Nika se c'è tanto Mihawk, perché Shanks 7 va ucciso.

**Contro Mihawk/Shanks**
- Vai **primo**: a 9 DON!! Nika (con rush dallo stage) uccide Shanks con certezza.
- Ripulire i weenie toglie a Mihawk i costi da riposare per Shanks e per l'abilità del leader.
- Attacca il Mihawk 6, che fa da filtro: senza filtro la sua mano si inceppa.
- Nel late chiediti ogni turno "muoio al doppio DMG?". Se sì, vai per la partita.

**Rush e rischio**
- Dai rush a un pezzo di rimozione solo se l'uccisione è garantita. Si rischia solo quando si è dietro.

**Ordine dei pezzi**
- Contro UG: Luna sempre prima di Zoro, perché la finestra con la board avversaria riposata si chiude.

**Contro Teach**
- Ordine contro i trigger: prima i più deboli.
- Brook rimette in piedi subito dopo il primo colpo.

> "they always have double DMG. They would never not have it."

### 2.12 RG, review e matchup — KXWleTX5SL8
**Il clock come concetto chiave**
- A inizio turno stima in quanti turni muore lui e in quanti muori tu. Una giocata è buona se anticipa la sua morte o ritarda la tua.
- Chiediti "muoio a uno split semplice?" (11/11/11). Se sì, vai per la partita.

**Split degli attacchi**
- Errore base: uno split 7/5 che chiede counter 1-2-1. Meglio concentrare un 10k che chiede 2k-2k-2k.
- In generale scegli la distribuzione dei DON!! che massimizza i counter richiesti.

**Leader prima del personaggio**
- Se due attacchi chiedono la stessa carta, preferisci quello col leader: resta un DON!! attivo e il personaggio resta in piedi.

**Ricerca**
- A parità di bisogno, prendi la carta con meno copie rimaste nel mazzo.

**Contro Mihawk**
- Dai 7k in su, attacca il Mihawk 6 o l'Oden invece della faccia.

> "your goal of the game is to kill your opponent before they kill you."

### 2.13 EB05 RG Luffy, mirror e Rocks — DxihrRUGDrA
**Il mirror**
- Si decide su chi vede più Bonney.
- Le prime 2 vite "non contano": prendile invece di spendere carte, e countera solo quando è gratis.

**Attacchi e bersagli**
- Contro un leader da 6k attacca esattamente a 7 (o a 9): l'avversario è tentato di counterare 1k quando non dovrebbe.
- Costruisci attacchi che puniscono entrambe le risposte: "se countera faccio X, se no Y". Non pianificare tutto il turno all'inizio.
- Non dare opzioni all'avversario: non attaccare dove countera gratis.

**Fondo mazzo e ricerche**
- Traccia il fondo del mazzo: a ~7 carte dalla fine sai esattamente cosa peschi.
- Fai prima la ricerca più facile.

**Risorse da conservare**
- Tieni sempre una coppia di rimozioni per la bomba avversaria (Shanks 10).

> "whoever see more Bonnie would win"

### 2.14 B Luffy, Rosinante e Shanks — xtKm0o9fc6k
**Valore dei personaggi**
- Un personaggio conta solo se sopravvive.
- Due corpi medi valgono più di un gigante, perché il più grande viene sempre stunnato.

**Vite e counter**
- Prendi i primi colpi in vita: più avanti i counter serviranno per la board.

**Ordine degli attacchi**
- Attacca col corpo piccolo o col leader **prima** di giocare i personaggi. Se l'avversario blocca, punisci; se non blocca, il suo blocker non gli dà valore.

**Split del letale**
- Gli attaccanti "buoni" sono quelli con potenza ≥ leader avversario − 1k.
- Simula il ramo "prende tutto".
- A 2–3 vite, più colpi uguali battono un colpo grosso: 7/7/7 chiede 6k di counter, 9/10 solo 5k.

**Difesa**
- Countera 1k per deviare un 10k su un altro bersaglio vale quanto counterare 10k.
- Dai prima il blocker che morirebbe comunque.

> "characters only meaningful when they survive"

---

## 3. Come pensa madoka, e come lo userebbe il bot

Legenda: **[V]** = termine di valutazione (`evaluate.ts`/`EVAL`), **[R]** = regola di ricerca (Pro/MCTS), **[C]** = regola sui candidati (generatore di mosse / policy dei rollout), **[P]** = playbook per leader.

### 3.1 SEQUENZA DEGLI ATTACCHI (debolezza n.1 del bot)

madoka ne parla in ogni video. Tre principi:
1. ogni attacco è una **domanda all'avversario** ("prendi o spendi?");
2. si attacca prima con ciò che **sonda** e costa meno;
3. la distribuzione dei DON!! si sceglie per **massimizzare il counter minimo** che l'avversario deve spendere nel caso peggiore.

**[R] Modulo letale/split.** Va eseguito quando Σ(potenza attaccanti + DON!!) può superare vite × potenza del leader avversario + counter stimato.
- Si enumerano gli ordini degli attaccanti e le distribuzioni dei DON!!. Sono pochi: al massimo 5 attaccanti e 10 DON!!, e si può potare con la regola sotto.
- Ogni linea si valuta con un **minimax a due rami per attacco**: l'avversario *prende la vita* oppure *countera il minimo necessario*. Il valore è il counter minimo che deve spendere per sopravvivere.
- A parità, è meglio la linea che chiede counter **prima** della vita.
- È esattamente quello che fa il calcolatore citato da madoka (optcglab), e si calcola in modo esatto senza rollout. Oggi la ricerca a orizzonte 1 con policy rozza non lo trova.

**Euristica per partire e potare:**
- se tutti gli attaccanti sono ≥ leader avversario − 1k: split pari;
- con un weenie: parti dallo split pari dei buoni e abbassa il primo attacco di 1k alla volta, finché il counter richiesto migliora;
- gli attacchi che nessun counter plausibile ferma (≥12k) contano come "vite rimosse";
- un DON!! in più serve solo se alza **ogni** attacco che le vite non assorbono.

**[C] Ordine degli attacchi fuori dal letale** (policy dei rollout e ordinamento dei candidati):
1. Togli prima i blocker (stun, rest, K.O.), poi attacca.
2. Il **leader** e i corpi sacrificabili attaccano prima; i personaggi di valore dopo, o non attaccano.
   - Fanno eccezione i personaggi che vanno tenuti in piedi: blocker, restander, uno Shanks appena giocato.
   - Se due attacchi chiedono la stessa carta, usa il leader.
3. Gli attacchi di sondaggio (5k sul leader, 1k su 1k) vengono prima degli eventi, dello stun e della rimozione. **Dopo** aver visto se l'avversario countera si decide se spendere DON!! o carte per rimuovere ("se countera X, se no Y").
4. Contro i trigger da K.O. o riduzione si attacca dal costo più basso al più alto, così il trigger colpisce chi ha già attaccato. Se un trigger può mettere in campo un corpo riposato, tieni un attacco dopo per colpirlo (7 poi 5).
5. Il colpo più piccolo va sul personaggio già ridotto o che muore comunque.
6. Restand (Brook) subito dopo il primo colpo.

**[C] Taglie "esca".** Esempi: 7 contro un leader da 6k, 6 invece di 7 contro Mihawk, 10k invece di 7/5.
- La taglia deve far costare all'avversario un counter scomodo, cioè `k×1000+1` sopra la sua potenza, senza che basti un 1k.
- Tra due distribuzioni si sceglie quella che chiede più counter "veri" in totale.

**[V] Faccia o personaggio.**
- Oggi la valutazione premia la vita avversaria in modo convesso. madoka aggiunge che a **vita alta** colpire la faccia dà carte e trigger all'avversario. Per Mihawk, Robin, Ace e Yellow Luffy è un regalo.
- Termine proposto: *penalità per la carta vita data* = (valore della carta pescata + P(trigger) × valore del trigger), da sottrarre al guadagno della vita tolta. Si annulla quando l'avversario è a clock ≤ 2.
- Con questo il bot preferirebbe da solo "7k sul Mihawk 6 / Oden" a "7k in faccia" a 4–5 vite.

**[R] Difesa (blocco e counter).** Il bot deve usare lo stesso split per **prevedere** l'attacco dell'avversario. Si prende la vita sull'attacco che, se counterato, costerebbe di più dopo.

### 3.2 ABILITÀ DEL LEADER: Mihawk OP14-020 (debolezza n.2)

Testo: *[Activate: Main] [Once Per Turn] Puoi riposare 1 tua carta: se c'è un Character di costo ≥5, imposta fino a 3 DON!! come attivi. Poi non puoi giocare Character in questo turno.*

madoka, da b8Oe6CqZzJI ~0:44, conferma due cose sulla regola:
- senza un personaggio di costo ≥5 l'abilità **non fa niente**, divieto compreso;
- la carta da riposare però si riposa lo stesso.

**Da verificare nel motore AUTOSIM**: che l'attivazione sia permessa anche senza un costo ≥5, e che il "Then" non si applichi quando la condizione fallisce.

**[C] Candidati da aggiungere sempre al generatore di mosse:**
1. `ATTIVA_LEADER(riposa X)` per ogni X riposabile.
2. Due tempi diversi:
   - **"Fine Main"**: dopo aver giocato tutti i personaggi del turno, perché il divieto colpisce solo quelli successivi;
   - **"Pre-attacco"**: quando i +3 DON!! servono a uno split di letale o a un evento.

**[C] Cosa riposare, in ordine di priorità:**
1. Coffin Boat o un altro stage.
2. Un personaggio che ha già attaccato.
3. Un personaggio con summoning sickness e senza Blocker, ma non uno Shanks appena giocato che deve restare in piedi.
4. Il leader, se il suo attacco è inutile (per esempio sotto 7k contro un blocker).
5. Un DON!! già speso.

Mai una blocker Bonney, né un 5 che deve stare in piedi contro Enel.

**[C] Uso senza un costo ≥5 ("riposa per niente").** Si attiva riposando lo stage o un weenie quando una carta in mano ha una condizione sul numero di carte riposate (la blocker Bonney che pesca). Va proposto come candidato quando quella carta è in mano.

**[R]/[V] Sequenza tipo, da insegnare alla policy dei rollout:**
- *Turno da 7 DON!!:* Shanks (7) → abilità riposando lo stage → +3 DON!! → leader attacca a 8.
- *Variante con For Fun:* Shanks → rest Shanks (non può attaccare comunque) → +3 → For Fun → split 5/7.
- *Turno da 5 DON!!:* gioca il 5 → riposa lo stage → attacca a 8.
- *Perona "gratis":* gioca Perona (1), cerca, la riposi per l'abilità.
  - Conto: 1+4 DON!! spesi, +3, restano 8 DON!! da dividere.
  - **[V]** Un personaggio che fa da costo dell'abilità ha costo netto pari al suo costo meno 3.
- *Contro Enel (Razza):* attacca con tutti → Bonney → rimetti in piedi → Bonney → rimetti in piedi → abilità per il 3° DON!!.

**[V]** Quando il leader è Mihawk:
- un personaggio di costo ≥5 sul campo vale anche "+3 DON!! nel prossimo turno";
- uno stage o un weenie riposabile vale "il costo dell'abilità pagato".

Senza questi due termini il bot non ha motivo di tenerli.

**Lato avversario [V]:** contro Mihawk, ripulire i suoi weenie gli toglie i costi da riposare per Shanks e per l'abilità. Questo dà un piccolo bonus al K.O. dei weenie di Mihawk.

**Generalizzazione.** Dalla teoria del vantaggio (§3.5): un'abilità del leader che fa guadagnare DON!! è *tempo vero*.
- Il bot dovrebbe trattare ogni `[Activate: Main]` del leader come un candidato obbligatorio.
- Lo valuta la ricerca: oggi la policy veloce non la prova mai, quindi il suo valore non emerge.

Altri leader citati con abilità che contano nel calcolo dell'output:
- Enel: +5 DON!!, cioè 11 DON!! di output;
- Kaido: imposta 1 DON!! attivo prima di Mamaragan;
- Newgate: l'abilità serve a difendere;
- Foxy: riposa il leader avversario ogni turno.

madoka **attiva sempre le abilità prima di decidere lo split**.

### 3.3 STAGE: Coffin Boat OP14-039 (debolezza n.3)

**Cosa dice madoka**
- Coffin Boat è "ottima", va a **4 copie** ("il mazzo diventa da 46"), mai a zero.
- Ha **tre** valori:
  1. On Play pesca 1, quindi si sostituisce da sola;
  2. a fine del tuo turno rimette in piedi 1 DON!! (≈ un counter da 1–2k nel turno avversario);
  3. soprattutto, è **la carta da riposare ogni turno** per l'abilità del leader senza perdere un attaccante: "Shanks, rest the stage, hit eight".
- Due stage in mano sono un brick: tenerne uno.

**[C]** Coffin Boat è sempre un candidato quando costa ≤ i DON!! avanzati. Nei rollout:
- priorità alta nei turni 1–4;
- priorità alta in ogni turno in cui avanza 1 DON!!.

**[V]** Con leader Mihawk, valore persistente dello stage in campo = pesca già incassata + `peso_don` × 1 (DON!! attivo a fine turno) + **valore del "costo di riposo gratuito"**, cioè l'abilità del leader senza riposare un attaccante.
- Oggi la valutazione §3.4 conta solo i personaggi utili: **lo stage vale 0**, per questo il bot non lo gioca mai.
- Serve una voce "stage/permanenti utili", come per i personaggi: conta se ha un effetto che continua a lavorare.

**In generale sugli stage** (anche la Thousand Sunny di RG):
- madoka la usa per ultima tra i searcher, perché ha il bersaglio più largo;
- eccezione: quando serve mettere 1 DON!! e tenerne 1 attivo al T2;
- RG senza stage cambia piano: passa con ≥3 DON!! attivi.

### 3.4 CLOCK al posto del ruolo

madoka dice che "beatdown/control" in One Piece regge poco. Usa invece due interi, ricalcolati a inizio turno:
- **T_kill**: in quanti turni uccido;
- **T_die**: in quanti turni muoio, simulando la **curva ottimale** dell'avversario. Contro Mihawk: doppio DMG sempre in mano; contro RG: Brook+Gatling.

Una mossa vale solo se sposta T_kill o T_die di almeno un turno intero. Questo si lega alla teoria §3.6–3.7, dove il ruolo è fissato alla decisione, come vuole madoka.

**[R] Regole di modalità**

| Condizione | Cosa fare |
|---|---|
| T_die ≤ 1 (lo split da 10 DON!! dell'avversario, senza carte speciali, ti uccide; oppure muori al doppio DMG) | **Vai per il letale ora**, anche improbabile. Accettalo se chiede almeno 2k oltre al counter stimato |
| Muori solo a una carta specifica X | Vai per il letale se P(passa) > P(non ha X) |
| T_kill ≤ T_die | Modalità sicura: gioca contro il trigger peggiore, conserva la vita |
| Altrimenti (sei dietro, perdi risorse ogni turno) | Modalità rischio: massimizza P(vittoria), non l'EV. Letale in 1–2 turni, attacchi sperando che non abbia counter |

Altre regole:
- "C'è un turno successivo?" Se no, gioca solo per le *outs* e prendi tutti i colpi per cercare trigger o DMG.
- Con l'avversario a clock 2: niente attacchi alla board, tutto in faccia.

**[V]**
- La pressione attuale (attaccanti − scudo) è un'approssimazione del clock. Si può migliorare stimando lo scudo con lo split ottimale avversario invece di "counter / 3000".
- Il valore di una vita **dipende dal leader e dal matchup**:
  - quasi nullo nelle prime 2 vite del mirror RG e contro Teach;
  - alto contro Mihawk e RG, dove 2 vite sono la finestra del letale.
- Un personaggio vale circa 1 carta per ogni turno che resta. Nell'early vale più di una vita, nel late meno.

### 3.5 COUNTER e DIFESA

**[V]/[C]**
- Se basta **una** carta per salvare un personaggio o una vita, di solito conviene. Due carte quasi mai nell'early.
- Attenzione al riattacco: contro il leader Mihawk + un weenie, "una carta" diventa due.
- Spendi prima i DON!!-counter e i blocchi gratuiti, poi le carte. Blocca sempre quando il blocco è gratis.
- Il counter da dare è la carta più sacrificabile:
  - i 1k inutili per primi, quando arriveranno attacchi da 6k;
  - la copia in più di una carta da combo;
  - mai il 2k che serve contro gli attacchi da 8.
- Countera i primi attacchi piccoli (5–6k), che poi cresceranno, se le vite dovranno assorbire attacchi grandi. Prendi subito la vita se non puoi counterare *tutti* i 5k che arrivano.
- Dai prima il blocker che morirebbe comunque.
- Counterare 1k per deviare un 10–12k vale quanto l'attacco deviato.
- Contro i mazzi a rimozione (Enel) il **numero di carte in mano** pesa più del totale dei counter. È un peso per matchup sulla voce §3.2 contro §3.3.

### 3.6 LETTURA DELLA MANO e informazione

**[V]/determinizzazione.** Oggi il bot determinizza la mano avversaria a caso. madoka usa vincoli che si possono codificare:
1. Ogni carta cercata e vista è **sicuramente** in mano finché non esce.
2. Lo scarto e il counter dato sono "la carta peggiore": le carte meno utili di quella diventano meno probabili. Se scarta un 2k, la mano è tutta buona.
3. Ciò che non gioca è un'informazione. Se salta il turno da 2 DON!!, non ha searcher.
4. Le "prese innaturali" indicano P(mano di soli brick) più alta.
5. Contare le copie rimaste delle carte chiave avversarie, come le rimozioni di Enel (4 Kid, 4 Mamaragan, 4 Alvida) e le 4 Bonney. Quando finiscono, il ruolo passa a te.

**Fondo del mazzo [V/R]:**
- ogni searcher mette 3–4 carte in fondo (5 se manca);
- a 6–7 carte dalla fine madoka sceglie quale searcher usare per controllare la pescata;
- utile per il bot in partite lunghe, a bassa priorità.

### 3.7 MULLIGAN e scelta del turno

**[P]**
- Si tiene la mano se basta a vincere quel matchup: per i matchup facili qualsiasi curva giocabile, per quelli difficili i pezzi specifici.
- Pesano solo le carte dei primi turni.
- Primo o secondo: una tabella statica per matchup, ottenibile dal simulatore con 5+5 partite o meglio con molte di più.

### 3.8 Playbook per leader

**[P] Mihawk verde OP14-020** (b8Oe, 7koX, cqpt, più la prospettiva dell'avversario in vyDP, X4Rb, ESWQ, AxH, KXWl)

*Curva*
- Early: KK/Perona/Bonney 1 e search, **Coffin Boat**.
- T5: un 5, preferendo quello che non è blocker; poi abilità riposando lo stage.
- Stun Bonney prima del 7° DON!! avversario.
- T7: Shanks, **non riposato**, più abilità (stage) e leader a 8.
- T9: Mihawk 9, Shanks o 5+5 (Bonney + blocker Bonney); contro Enel e Teach 5+5.
- T10: Law & Bepo.

*Regole di gioco*
- Se non muori il turno dopo, gioca il personaggio più grande.
- Si attacca prima la board (weenie avversari, per subire meno attacchi).
- Stun ed eventi solo dopo aver visto la risposta.

*Matchup*
- Contro Robin: ripulisci la board, perché Robin si cura.
- Contro Foxy: pulisci i Foxy Pirates, Mihawk 9 si scarta.
- Contro Nami: Bonney 1 assorbe l'attacco del leader, 5k sul leader quando i trigger fanno male, lascia morire i 6k.
- Contro Enel: tieni sempre un 5 in piedi, Bonney+Bonney invece di Mihawk 9.
- Perde contro Enel e Kobe.

**[P] Contro Mihawk** (per tutti i leader del bot)
- Il doppio DMG c'è sempre.
- Attacca Mihawk 6, Oden e i weenie invece della faccia (filtro e costi di riposo).
- Uccidi Shanks alla prima occasione **garantita**.
- Il secondo turno da 10 di Mihawk è la scadenza (≈6 turni).
- Lascia attivi DON!! pari alla sua curva perfetta: 2 contro 5+stage, 3 contro Shanks+For Fun.

**[P] RG Luffy**
- Il leader rende ogni DON!! attivo ≈ un 2k: lasciare DON!! attivi è difesa ([V] `peso_don` più alto per questo leader nel turno avversario).
- Restander (Sanji/Usopp) prima dell'8° DON!!, poi una catena di 7 costi (Zoro/Nika).
- Luna prima di Zoro.
- Brook è il motore del letale.
- Mirror: chi vede più Bonney/Zoro/Luna vince; le prime vite si concedono.
- Contro Enel andando secondo: starve, non attaccare il leader finché la sua mano è ≥6.
- Contro Teach: tanti attacchi su due turni, e non spendere carte per la vita.

**[P] Elbaf Luffy**
- È quasi sempre il beatdown.
- Contro Mihawk: almeno 2 giganti + Zoro prima di Shanks, e mai giocare giganti "per l'avversario".
- Contro Sabo: controllo.

---

## 4. Priorità suggerite per il codice (non implementate)

1. **Candidati obbligatori.** Nel generatore e nella policy dei rollout vanno aggiunti l'`[Activate: Main]` del leader e gli stage economici, oggi assenti.
   - Per Mihawk servono i due tempi e l'ordine di riposo di §3.2.
   - Va verificato nel motore il caso "condizione falsa ⇒ nessun divieto".
2. **Valore degli stage in `evaluate.ts`.** Uno stage con un effetto ricorrente deve valere più di 0. Per Coffin Boat con leader Mihawk si aggiunge il valore di "costo dell'abilità gratuito".
3. **Modulo split/letale esatto** (minimax prende/countera, §3.1), usato:
   - quando il letale è possibile;
   - per stimare T_die, cioè lo split ottimale dell'avversario.
4. **Ordinamento degli attacchi nella policy:** blocker → sondaggio leader/sacrificabili → grandi → eventi e rimozione dopo la risposta; con trigger a K.O., dal costo basso al costo alto.
5. **Penalità per la carta vita data** a vita alta (faccia o board), dipendente dal matchup.
6. **Regola di modalità sul clock** (T_die ≤ 1 ⇒ letale ora; dietro ⇒ massimizzare P(vittoria)).

Prima di chiudere ogni punto andrebbero fatte le misure del §6 della teoria: Pro contro Pro, coppie di partite, test dei segni.
