# Partite di alto livello: cosa fanno i giocatori veri

> Scritto il 2026-10-30. È uno studio, non tocca codice. Le lezioni sono misurate su log reali; per ognuna c'è una proposta su **come lo userebbe il bot**.
> Contesto: [teoria-del-vantaggio.md](../teoria-del-vantaggio.md) (valutazione) e `src/autosim/ai/README.md` (Pro: candidati con `PRIOR`, rollout fino a fine turno).

## 1. Che dati ci sono sul disco

| Fonte | Dove | Formato | Cosa contiene |
|---|---|---|---|
| **Corpus TCGMM** (già scaricato) | `C:\Users\Admin\Documents\RYAN\lab\data\logs\tcgmm\` | combat log OPTCGSim `.log` + `.meta.json` | **7.613 partite** online tra umani, settimana 2026-W34 (fine agosto). Il meta dà leader vincitore/perdente e il **bounty** (rating) di entrambi. 470 MB. |
| Indice già parsato | `RYAN\lab\data\games.jsonl` (7.714 righe) | JSON per partita | giocatori, leader, chi va primo, vincitore (7.435 decise), attacchi, counter. Costruito da `RYAN\lab\logparse.mjs` (parser Node, si autovalida contro i dump di zona: 7.705/7.714 OK). |
| Log locali vecchi | `RYAN\lab\data\logs\local\` (101) | combat log | partite di Vins (`Vins#2821`) di agosto: Luffy & Ace 57, Rosinante 15, Luffy 15, Kaido 9… **nessuna Mihawk**. |
| Log locali nuovi | `Desktop\Builds_Windows\CombatLogs\AutoSaved\` (101) | combat log | 10–29 ottobre, account `Peco#12335` (Rosinante 91, Luffy 31 come leader visti). **Non ancora nel corpus.** OPTCGSim ne tiene circa 100 e ruota. |
| JSON sul Desktop (11) | `Desktop\*.json` ("enel L", "boa L", "ENEL w KINDA", "L davidmelee", "asd", "w3r1e3r32", "rosi vs rocks"…) | lista di **istantanee di stato**, una per turno (10–16 per partita), `turnNumber`, `player1`/`player2` con mano, mazzo, vite, campo, stage, DON attivi/riposati/dati e i flag interni del motore (`bTapped`, `bSummonSick`…) | Posizioni a **fine turno**, informazione completa (anche la mano avversaria). **Nessuna mossa**: le azioni si ricostruiscono solo per differenza tra due istantanee, e l'ordine degli attacchi si perde. 6 sono Mihawk (P1) contro Enel ×2, Luffy OP17-079, Mihawk, Hancock, Sabo; 3 Kaido OP17-058; 2 Rosinante. |

**Il formato da usare è il combat log**, non i JSON. Ha ogni riga in ordine: `Deploy`, `Attach N Don to X`, `X attacking Y`, `[p1] vs [p2]`, blocchi, counter, KO, danni, ogni effetto (`Dracule Mihawk {OP14-020}: Rest Coffin Boat`, `Activate 1 Don`…), mulligan e dump di zona a ogni turno. Le mani di entrambi sono nominate.

### TCGMM: cosa scaricare
- Il sito (`stats.tcgmatchmaking.com`) è una SPA. Le liste e i log dei replay (`/api/replays/list`, `/api/replays/log`) richiedono il token di un membro Patreon. Non mi sono loggato e non ho scaricato niente.
- Lo script c'è già: `RYAN\lab\tcgmm-download.mjs`, incrementale (salta gli id già presenti). **Cosa deve fare Vins:** da browser loggato prendere il refresh token (DevTools → cookie `refresh_token`) e lanciare lo script per le **settimane da 2026-W35 in poi** (meta OP17). Filtri utili: `--winner OP14-020` / `--loser OP14-020` per Mihawk; poi `--winner`/`--loser` per Kaido, Rocks e Rosinante. Destinazione: la cartella di default `RYAN\lab\data\logs\tcgmm\`, poi `node lab/ingest.mjs`. Nell'harvest di agosto ci sono molti `429`: tenere il ritmo lento.
- Copiare anche `CombatLogs\AutoSaved\*.log` in `RYAN\lab\data\logs\local\` prima che OPTCGSim li ruoti.

### Come ho misurato
Ho scritto uno scanner Python che rilegge ogni log **in ordine**. Il parser di RYAN separa giocate, effetti e battaglie, e così perde l'interleaving. Vincitore e giocatori li ho presi da `games.jsonl`. "Alto livello" = bounty del giocatore ≥ 171 (top 30% del corpus). Script in scratchpad (`scan.py`, `ana.py`, `mih.py`, `misc.py`). Non sono nel repo: se servono, vanno portati in `src/autosim/train/`.

Limiti: il bounty è un rating di ladder, non di torneo. "Vincitori contro perdenti" è confuso dalla posizione: chi è sotto gioca diversamente perché è sotto. Le differenze piccole (±2 punti) sono rumore.

## 2. Sequenza degli attacchi (tutti i leader, 161.706 attacchi)

| Misura | Tutti | Top bounty | Vincitori | Perdenti | Mihawk top |
|---|---|---|---|---|---|
| attacchi per turno | 2,21 | 2,27 | 2,36 | 2,05 | 2,19 |
| attacchi a personaggi | 31% | 31% | 28,5% | 34,5% | 33% |
| turni misti: **prima i personaggi, poi la faccia** | 60% | 60% | 61% | 59% | **66%** |
| turni misti: prima la faccia | 24% | 23% | 21% | 26% | 18% |
| attacchi consecutivi al leader: il secondo è **più forte** del primo | 50% | 51% | 50% | 49% | 47% |
| … il secondo è più debole | 16% | 13% | 14,5% | 17% | 16% |
| il leader attacca **per ultimo** (turni con ≥2 attacchi) | 33% | 33% | 31% | 36% | **48%** |
| il leader attacca per primo | 44% | 42% | 44% | 44% | 25% |
| DON dati **dopo** il primo attacco (quota dei DON attaccati) | 49% | 52% | **54,5%** | 44% | 56% |
| turni con almeno un DON dato tra un attacco e l'altro | 27% | 28% | 29% | 25% | 44% |
| turni con una giocata **dopo** aver attaccato | 36% | 40% | 37% | 34% | 25% |
| dopo un blocco, l'attacco seguente colpisce il blocker riposato | 9% | 10% | 10% | 9% | 7% |

**Lezioni**
1. **Prima si pulisce, poi si va in faccia.** Quando nello stesso turno si attaccano sia personaggi sia leader, 6 volte su 10 i personaggi vengono prima; il contrario succede 2 volte su 10.
   → *Regola di ricerca*: tra i candidati, un attacco a un personaggio va ordinato **prima** degli attacchi al leader dello stesso turno. In `PRIOR` oggi vale il contrario: `attackFace` 21 contro `attackChar` 9. Il bonus faccia ha senso nella scelta *se* attaccare, non nell'ordine. Proposta: quando restano attacchi a personaggi che il bot intende fare, sottrarre un malus d'ordine dal prior degli attacchi alla faccia.
2. **Dal piccolo al grande.** Tra due attacchi consecutivi al leader, il secondo è più forte 3 volte più spesso del contrario (50% contro 16%; il resto è a pari potenza). È la regola "meno impegnativo per primo" di `RYAN/archive/sequencing/attack-ordering.md`: il primo attacco fa spendere counter e blocker, il colpo grosso arriva quando la mano è più corta.
   → *Regola candidata*: a parità di altro, ordinare gli attacchi alla faccia per potenza crescente. Tie-break deterministico nel rollout (`rollout.ts`) e nell'ordinamento del Pro.
3. **I DON si danno tra un attacco e l'altro, non tutti prima.** I vincitori ne danno il 54,5% dopo il primo attacco, i perdenti il 44%. Mihawk lo fa nel 44% dei turni. Si guarda come risponde l'avversario (blocco, counter) e poi si decide dove mettere il resto.
   → *Regola di ricerca*: "dai DON" deve restare una mossa disponibile **dopo** ogni battaglia, e il rollout non deve dare tutti i DON all'inizio. *Termine di valutazione*: nessuno, è sequenza pura; va lasciata alla ricerca, ma con candidati giusti.
4. **Il bait-KO del blocker è raro**: solo nel 9–10% dei casi l'attacco dopo un blocco va sul blocker riposato. Non serve insegnarlo come regola fissa: lo trova la ricerca quando conviene.
5. **Mihawk attacca col leader per ultimo** (48% contro 33% degli altri leader). Il motivo è nella sezione 3: i 3 DON stappati vanno quasi sempre sul leader.

## 3. Mihawk OP14-020: lo "stappare" (2.578 partite Mihawk, 1.005 top)

Conto di "turno possibile": un personaggio di costo ≥5 in campo (a inizio turno o giocato nel turno) e almeno 3 DON.

| Misura | Tutti | Top |
|---|---|---|
| turni possibili in cui il leader viene attivato | **92,7%** (10.241/11.050) | 92,7% (4.115/4.437) |
| … a 5 DON | 84% | 83% |
| … da 6 a 10 DON | 93–95% | 93–96% |
| DON rimessi attivi in media | 2,97 | 2,98 |
| attivazioni dopo cui non si fa niente coi DON | 6% | 6% |
| attivato **prima del primo attacco** | 66% | 61% |
| tra un attacco e l'altro | 27% | 30% |
| dopo l'ultimo attacco | 6% | 7% |
| turni con Shanks OP17-022 giocato **e** leader attivato | **94%** (2.822/2.999) | 94% |

**Cosa si riposa per pagare** (top 4.130 attivazioni): Coffin Boat 52%, Perona OP12-034 (searcher già usato) 11%, Mihawk ST32-003 7% (quando si riposa pesca 1 e scarta 1, quindi è un bonus), Kin'emon 7%, 1 DON 6%, **Vander Decken IX dopo il suo On Play** 4%, Otama 4%. Si paga **con quello che ha già dato il suo valore**: lo stage, i searcher da 1 già risolti, il Decken dopo il K.O. Quasi mai con un attaccante grosso ancora attivo.

**Dove vanno i 3 DON**: in media 2,3 vengono dati come DON nello stesso turno, soprattutto al leader (sezione 2). Il resto va in eventi: You Can Be My Samurai!! (1.361 volte), Electrical Luna (895), Coffin Boat giocata dopo (685), I Know You're Strong (199), For Fun (118).

**La combo del finale** (conferma gli appunti di Vins in `RYAN/archive/pov/mihawk-mirror.md`): Shanks (10) stappa 2, il leader stappa 3, cioè 5 DON liberi per Vander Decken IX (2) + Electrical Luna (3).
- Decken: 79% delle giocate a 10 DON; costo medio del bersaglio **8,3** (805 K.O. su costo 10, quasi sempre Shanks); K.O. riuscito nel 95% dei casi.
- Luna: 89% a 10 DON.
- Decken è anche counter: 816 scarti da 1000.

**Lezioni**
6. **Il leader Mihawk si attiva sempre.** I forti lo fanno nel 93% dei turni in cui possono; vincitori e perdenti quasi uguali (93,1% e 92,1%), quindi non è una scelta di stile.
   → *Playbook per leader (Mihawk)*: se c'è un personaggio di costo ≥5, l'attivazione è una mossa forzata. Va fatta **dopo l'ultima giocata di personaggio** (dopo non se ne possono più giocare) e **prima degli attacchi** che useranno i DON. *Regola candidata*: in `pro.ts` l'[Activate: Main] di Mihawk deve sempre stare tra i 6 candidati quando è legale. Oggi `PRIOR.activate` vale 24, contro 45 di una giocata e 46 di un attacco: è facile che venga tagliata.
   → *Termine di valutazione*: a fine turno, contare i DON **attivi non spesi** quando l'attivazione era ancora disponibile come spreco (≈ 3 DON × peso_don). Così la mossa non dipende dal rollout casuale, che la scopre male perché il valore arriva solo dopo, tramite attacchi ed eventi.
7. **Il costo si paga con un pezzo morto.** Ordine di preferenza: Coffin Boat > searcher da 1 già risolti / Decken dopo l'On Play / Mihawk ST32-003 (riposarlo pesca) > 1 DON > mai un attaccante che deve ancora attaccare.
   → *Regola di scelta* per la `ChoiceRequest` del costo: scegliere la carta col minor "valore residuo nel turno". Il criterio è lo stesso di 3.4 della teoria: conta solo chi fa ancora qualcosa.
8. **Shanks + leader nello stesso turno, sempre** (94%). → *Playbook*: quando il bot gioca Shanks con Mihawk, la linea completa è Shanks → attiva leader → Decken su un bersaglio di costo ≥7 → Luna. Il rollout a orizzonte 1 la trova solo se tutti questi passi sono tra i candidati: va fissata come macro-linea.

## 4. Coffin Boat OP14-039

| Misura | Tutti | Top |
|---|---|---|
| partite Mihawk in cui viene giocata | 66% | 68% |
| winrate con / senza | 55,5% / 50,3% | 54,9% / 50,9% |
| turno proprio in cui entra (1°, 2°, 3°, 4°, 5°) | 418, 393, 357, 331, 261 | 159, 162, 151, 130, 99 |
| giocata insieme ad almeno un altro personaggio | 86% | 90% |
| turni in cui il fine-turno rimette attivo 1 DON | 6.462 | 2.647 |

Il winrate più alto è in parte un effetto mano: chi la pesca presto ha una curva migliore. Il dato forte è un altro: **metà delle attivazioni del leader si paga riposando Coffin Boat**.

**Lezioni**
9. **Coffin Boat si gioca presto, appena c'è 1 DON libero.** Va giocata insieme al searcher del turno (es. turno 1: Perona + Coffin Boat a 2 DON, come in "ENEL w KINDA.json" e "enel L.json") ed è una cantrip: pesca 1 quando entra. Poi lavora tutta la partita:
   - a fine turno rimette attivo 1 DON, che resta attivo nel turno avversario e paga un counter event da 1 come Trichiliocosm (nota di Vins in `mihawk-mirror.md`);
   - è il costo gratis dello stappo.

   → *Valutazione*: oggi la teoria (3.4) conta solo i personaggi. Coffin Boat va contata come **permanente con effetto continuo**: +1 DON attivo nel turno avversario, +1 costo gratis per il leader. Proposta: `valore_stage = peso_don + bonus_costo_leader` quando il leader è Mihawk.
   → *Regola candidata*: se resta 1 DON dopo le giocate e Coffin Boat è in mano, giocarla. È una mossa che il prior per costo (`playPerCost`) penalizza, perché costa 1 e non è un personaggio.
   → *Perché il bot non la gioca mai*: il valore arriva solo nel turno avversario e nei turni dopo, oltre l'orizzonte 1. Senza un termine di valutazione per lo stage, la ricerca la vede come "−1 DON, +1 carta".

## 5. Rimozione, mulligan, ordine di turno

10. **Vander Decken IX è una carta da 10 DON** (79%), con bersaglio medio di costo 8,3 e K.O. nel 95% dei casi. La correzione già fatta nella teoria (3.8) va nella direzione giusta: col bot corretto il 27% dei Decken va ancora a vuoto, contro circa il 5% degli umani. Da misurare anche a quanti DON lo gioca il bot, per confrontarlo col 79% a 10 DON degli umani. → *Termine*: alzare a 7 il minimo del "bersaglio futuro" in `max(costo, 5)` contro i mazzi con dieci-costi (Shanks, L&B). *Regola*: lo scarto come counter da 1000 è legittimo (816 casi) quando la partita è una race (appunti di Vins vs Enel).
11. **Electrical Luna**: 89% giocata a 10 DON, quasi sempre pagata coi DON dello stappo. È la seconda metà della combo, non una carta da metà partita.
12. **Mulligan Mihawk: 45%** (1.270 mani visibili). Con 0 searcher (Perona OP12-034, Otama, Kin'emon) e senza Coffin Boat si rimescola il 94% delle mani; con 1 il 54%; con 2 o più il 14%. → *Playbook*: tenere solo con almeno 1 searcher o Coffin Boat; con 1 solo dipende dal resto. Coerente con la nota di Vins: nel mirror conta poter giocare a 2 e a 4.
13. **Mihawk vince di più da secondo**: 60,1% (n=1.359) contro 46,7% da primo (n=1.219). → *Playbook*: scegliere secondo.

## 6. DON per turno (Mihawk contro gli altri leader)

DON dati in media per turno proprio (leader / personaggi):

| Turno proprio | DON disponibili | Mihawk: leader | Mihawk: personaggi | Altri: leader | Altri: personaggi |
|---|---|---|---|---|---|
| 2 | 3,5 | 0,87 | 0,22 | 0,55 | 0,10 |
| 3 | 5,5 | 1,50 | 0,29 | 0,56 | 0,16 |
| 4 | 7,5 | 1,54 | 0,82 | 0,52 | 0,31 |
| 5 | 9,5 | 1,31 | 1,23 | 0,66 | 0,56 |
| 7+ | 10 | 1,55 | 1,40 | 0,92 | 0,97 |

14. Mihawk carica il leader 2–3 volte più degli altri. Sono i DON dello stappo, rimessi attivi dopo le giocate e usati per l'attacco del leader, che arriva per ultimo. → *Regola di rollout*: per Mihawk, dopo lo stappo, i DON liberi vanno al leader se il suo attacco con +1000/+2000 obbliga a un counter in più (tabella di parità in `attack-ordering.md`). Altrimenti vanno a eventi come Samurai o Luna.

## 7. Da log a dati di allenamento

**Cosa si ottiene.** Ogni riga d'azione del log è una coppia *(posizione, mossa umana)*. La posizione è nota esattamente:
- i dump `Hand/Board/Trash/Life` a ogni confine di turno danno le zone;
- dentro il turno le zone si aggiornano evento per evento;
- `logparse.mjs` lo fa già con i record `RZ1|` e si autovalida.

Le stime: 7.613 partite × ~12 turni × ~6 azioni ≈ **500 mila decisioni**, di cui circa 70 mila di Mihawk.

**Passi e sforzo**
1. *Ingest* (fatto): `logparse.mjs` + `games.jsonl`. Manca l'ordine interleaved degli eventi, che il mio scanner aggiunge in ~80 righe. **½ giornata** per portarlo in TS dentro `src/autosim/train/`.
2. *Mappatura sullo stato AUTOSIM*: costruire un `GameState` del motore dai dump (id carta → IR compilato, DON attivi/riposati/dati, flag riposato, summon sickness), poi riapplicare le azioni del log con il motore, verificando a ogni dump che lo stato coincida. È il pezzo grosso: **3–5 giorni**. Il rischio sono gli effetti con scelte nascoste (search, ordine in fondo al mazzo), che il log nomina solo in parte. Le partite che divergono si scartano: basta una frazione buona.
3. *Etichette*: per ogni decisione della Main Phase, la mossa umana mappata su un `PlayerIntent` (gioca X, dai N DON a Y, attacca Y con X, attiva leader, fine turno). Stessa cosa per counter e blocker in difesa. **1–2 giorni.**
4. *Usi, dal più economico*:
   - **a. Prior dei candidati imparato** (consigliato per primo): sostituire i numeri fissi di `PRIOR` con la frequenza con cui gli umani forti scelgono quel tipo di mossa nel contesto (leader, turno, DON). Corregge subito lo stappo che resta fuori dai 6 candidati, Coffin Boat e l'ordine degli attacchi. Non serve una rete: bastano tabelle per leader. **1 giorno** dopo i passi 1–3.
   - **b. Test di accordo** come metrica di regressione: % di posizioni in cui la prima scelta del Pro coincide con l'umano top, per leader. Si aggiunge al gauntlet: misura il "gioca come un umano" che il winrate Pro contro Pro non vede.
   - **c. Calibrare la valutazione**: regressione logistica *posizione → vince?* sui ~90 mila stati di fine turno, per tarare `EVAL` (vita convessa, counter, stage) con dati umani invece che solo self-play.
   - **d. Policy dei rollout** imitata dagli umani (classificatore leggero per tipo di mossa). Rende i rollout più realistici, ed è la condizione che la teoria (§4) pone per far rendere l'orizzonte 3. È il più costoso: **1–2 settimane**.
5. *I JSON del Desktop* servono solo come **posizioni di test**: stati completi a fine turno, da caricare come scenari ("cosa fa il Pro qui?"). Non danno mosse. Il convertitore istantanea → `GameState` costa **½–1 giorno**, e quasi tutto il lavoro coincide con il passo 2.

## 8. Riassunto per il codice (cosa cambierei, in ordine)
1. Mihawk: l'attivazione del leader sempre tra i candidati quando è legale; costo pagato col pezzo morto (Coffin Boat, searcher usato, Decken usato, ST32-003).
2. Valutazione: Coffin Boat (e in generale gli stage con effetti a fine turno) conta come permanente attivo; i DON attivi non spesi con lo stappo disponibile contano come spreco.
3. Ordine attacchi nel Pro e nel rollout: prima i personaggi, poi la faccia; alla faccia dal più debole al più forte; i DON si danno tra un attacco e l'altro.
4. Macro-linea Shanks → leader → Decken → Luna per Mihawk a 10 DON.
5. Scaricare le settimane OP17 da TCGMM (lo fa Vins con il suo account) e costruire il prior imparato (7.4a) con il test di accordo (7.4b).
