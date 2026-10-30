# madoka_hk: partite ricostruite guardando il video

Data: 2026-10-30. Questo è il seguito di [madoka_hk.md](madoka_hk.md), lo studio fatto solo sul testo. Qui l'obiettivo era diverso: trasformare i video di partite di madoka in **game record** (chi gioca cosa, attacchi, DON!!, counter, K.O., vite), ricavati da quello che si vede a schermo e non dai sottotitoli.

**Risultato in breve: funziona, e meglio del previsto.** madoka registra le partite su **OPTCGSim** e tiene sempre aperto a sinistra il pannello del **combat log** del simulatore. Ogni azione pubblica è scritta lì in inglese con il codice della carta, per esempio `[You] Perona [OP14-033] attacking Monkey D. Luffy [OP13-001]`. Quindi non serve riconoscere le carte sul tavolo: basta fare OCR del log. Le immagini delle carte servono per una cosa sola, la **mano di madoka** (in basso a sinistra), che nel log non compare.

Le **6 partite Mihawk OP14-020** estratte sono in [`madoka-games/`](madoka-games/), con gli script in [`madoka-games/tools/`](madoka-games/tools/).

---

## 1. Cosa c'è a schermo (layout)

Nei 6 video ho trovato tre versioni del simulatore (1.38a, 1.40a, 1.42a) e due impaginazioni: una a schermo intero e una ridotta con bande nere. Il contenuto è sempre lo stesso:

| Zona | Dove (riferimento 1280×720) | Utile? |
|---|---|---|
| **Combat log** | riquadro chiaro a sinistra, fra "Report Player" e "Mute Chat" (circa x 130–400, y 170–445) | **Sì, la fonte principale.** Si legge benissimo, anche a 720p |
| **Mano di madoka** | striscia in basso a sinistra, carte scoperte di circa 60–68×83–95 px, che si sovrappongono quando sono più di 5 | Sì: è l'unica informazione nascosta che il video rivela |
| Mano dell'avversario | dorsi in alto a sinistra | Si vede solo **quante** carte ha |
| Tavolo | al centro: leader, personaggi, stage, DON!!, trash, vite | Le carte sono piccole e coperte da frecce, numeri di potenza e badge "DON!! x1". Riconoscerle è possibile ma inutile, perché il log ha già tutto |
| "TurnN" in alto a destra | contatore dei turni **di ciascun giocatore** | Confermato: il "Turn6" a schermo corrisponde al mio T11 |
| Webcam, zoom carta, finestra "OPBounty" | a destra; la finestra OPBounty a volte copre il log a inizio/fine partita | Sono **disturbi** da filtrare |

Il nome dei giocatori nel log cambia con la versione: `[You]` / `[Opponent]` nella 1.42a, `[madokahk#9226]` / `[nome#1234]` nelle versioni vecchie. Lo script li normalizza: il giocatore il cui nome contiene "madoka" diventa sempre **You**.

## 2. Metodo (pipeline)

Gli script stanno in `madoka-games/tools/`, tutti in Python con ffmpeg, OpenCV e RapidOCR (OCR su CPU, `pip install --user rapidocr-onnxruntime opencv-python`).

1. **Download** con `python -m yt_dlp -f "bv*[height<=720]"`: solo video, 720p, 45–70 MB a video. Un video alla volta, con almeno 60 s di pausa e `--sleep-requests 5`. Si lavora in `%TEMP%\madoka-vision\`, fuori dal repo.
2. **`ocr_log.py`**: trova da solo il riquadro del log (con una maschera di colore su un fotogramma ogni 30 s), ritaglia solo quella zona a 4 fps con ffmpeg, scarta i fotogrammi in cui il log non è cambiato (restano circa 1 su 8) e fa l'OCR con 6 processi in parallelo.
3. **`merge_log.py`**: ogni fotogramma mostra le ultime ~14 righe. Lo script cerca la sovrapposizione massima fra la coda del log già ricostruito e la finestra nuova e aggiunge solo le righe nuove. Il confronto è fuzzy: tollera 1 riga letta male ogni 4, butta le righe a metà durante lo scorrimento e, quando la stessa riga viene riletta con più confidenza, sostituisce la lettura vecchia. I fotogrammi coperti dalla finestra OPBounty vengono scartati. Se lì sotto si legge "Concedes", lo script lo annota.
4. **`parse_log.py`**: unisce le righe, normalizza i codici carta (correggendo gli errori tipici dell'OCR come O/0, l/1 e `]`→`j`, e verificandoli su `public/data/cards.json`) e con delle regex estrae gli eventi: leader, chi va primo, mulligan, pescate, +DON!!, carte giocate (anche da effetto, per esempio Mihawk ST32-003 che mette in campo Perona), DON!! attaccati con totale, attacchi con potenza e risultato, blocker, counter dalla mano con valore, eventi counter, trigger, K.O., carte scartate dal campo o dalla mano, rimandate in mano o in fondo al mazzo, +1 vita, effetti generici e fine turno. Poi rigioca la partita e tiene vite, DON!! totali, personaggi in campo e stage per ogni fine turno.
5. **`hand_rec.py snap`**: per ogni turno di madoka prende un fotogramma subito dopo la pescata e uno a fine turno. Trova la striscia della mano (posizione e scala si adattano al layout), prova diversi numeri di carte e confronta ogni "fetta" visibile con le immagini OPTCGSim (`StreamingAssets/Cards/<SET>/<ID>.jpg`) di **tutte le carte dei colori del leader**, cioè 447 carte verdi. Il confronto è a correlazione normalizzata. Sotto 0,6 la carta viene segnata "(?)".
6. **`run_video.py VIDEO_ID "titolo"`** esegue tutto e copia in `madoka-games/` tre file: `ID.json` (record completo), `ID.md` (riassunto turno per turno) e `ID.log.txt` (log OCR grezzo con il secondo del video, utile per controllare).

Formato del JSON: `leaders`, `first_player`, `winner`, `end`, `mulligan` e `turns[]`. Ogni turno ha `events[]` (con `t` in secondi nel video, `type`, `player`, `card` o `attacker`/`target`, `attack_power`/`defense_power`, `counters[]`, `result` = hit/fail/ko), `board_end` (vite, DON!! totali, campo, stage) e `hand_you[]` (mano a inizio e fine turno, con i punteggi). C'è anche `quality`, con la frazione di log interpretata, i frammenti non interpretati, gli ID sconosciuti e i salti nel log.

## 3. Accuratezza misurata

| Controllo | Risultato |
|---|---|
| **Codici carta letti dall'OCR** | In 6 partite, 1 solo ID non valido rimasto (`P09-610`, una riga illeggibile). Tutti gli altri sono stati verificati contro `cards.json` |
| **Testo del log trasformato in eventi** | 89–95% dei caratteri a seconda del video. Il resto è quasi tutto innocuo: nomi di carte a capo, righe di connessione, chat ("i am your fans", "ty!"), "Placing cards on bottom of deck" |
| **Stabilità dell'OCR** | Sul pilota ho fatto due passate OCR indipendenti con impostazioni diverse. Su circa 120 eventi non generici differiscono per **1 attacco**, che era su una riga rovinata nella passata lenta. 2 salti di log in tutto il pilota prima delle correzioni, 0 dopo |
| **Attacchi senza esito** | 1 per partita al massimo, quasi sempre l'ultimo, interrotto dalla fine del video |
| **Stato del tavolo ricostruito vs video** | Controllato a occhio su 4 fotogrammi. Pilota T11: 5/5 personaggi per lato. Video Lucy T11: era sbagliato (Kid & Killer che si scarta da solo non veniva tolto); l'ho corretto e ora torna. Restano errori di deriva quando un effetto sposta carte con una frase che il parser non conosce: nel video Lucy l'avversario risulta con 3 Sabo in campo, ma in realtà uno era già andato |
| **Mano di madoka** | Controllata a occhio su 5 fotogrammi di 4 layout: 8/8, 7/7, 3/3, 8/8 e 6/6 nel pilota. Esempio di coerenza: dopo un colpo subito la mano cresce di 2 (pescata + carta vita), e il riconoscitore lo vede. Va male quando madoka passa il mouse su una carta (la carta si alza e si sposta) o quando la mano è coperta. In quei casi i punteggi scendono sotto 0,6 e le carte vengono marcate "(?)". Sono 0–5 fotogrammi su 14–18 per partita |
| **Vincitore** | 5/6 determinati (4 concede, 1 colpo a 0 vite). Il mirror finisce a metà turno, quindi è "non chiaro" |

In sintesi: la **sequenza delle azioni pubbliche è affidabile al ~99%**. Lo **stato del tavolo** derivato è buono ma può derivare dopo effetti rari: va ricontrollato col video quando conta. La **mano di madoka** è giusta nella grande maggioranza dei fotogrammi puliti.

## 4. Cosa NON si recupera (onestamente)

- **La mano dell'avversario.** Si vede solo quanti dorsi ha. Però il log rivela molto: i counter giocati dalla mano (`Discard X for Counter 1000`), gli eventi counter, le carte cercate dai searcher (`Reveal and Draw X`, che sono pubbliche), le carte scartate e i trigger dalle vite.
- **Le carte vita** e l'ordine del mazzo, tranne quando escono.
- **Quali carte scarta il mulligan**: si sa solo che il mulligan c'è stato.
- **Lo stato attivo/riposato** di personaggi e DON!!, la **posizione** sul tavolo e i DON!! "liberi" contro quelli attaccati. Il log dà i DON!! totali e quelli attaccati a ogni carta, ma i riposi da costo non sempre in modo esplicito.
- **Il ragionamento.** Questi video non hanno commento. Il "perché" va preso dai coaching (studio precedente).
- **Gli effetti scritti in modo nuovo.** Ogni frase del log che il parser non conosce resta come `effect` con il testo grezzo, quindi non si perde, ma non aggiorna il tavolo.
- **Le righe sotto la finestra OPBounty.** A volte copre il log per qualche secondo; nei 6 video si sono persi 0–2 brevi tratti (`### SALTO` nel log), di solito righe di effetti.

## 5. Le 6 partite estratte

Tutte con madoka a **Mihawk verde OP14-020**. "T" = turno del record, cioè mezzo turno: T1 è il primo giocatore, T2 il secondo e così via. I dettagli sono nei file `.md` e `.json`.

| Video | Matchup | Primo | Esito | Turni | Note dal record |
|---|---|---|---|---|---|
| [hdF1DHS5Gkc](https://www.youtube.com/watch?v=hdF1DHS5Gkc) (pilota, 10:38) | vs **RG Luffy** OP13-001 | madoka | **vince** (concede T16) | 16 | T1 Perona e T5 Perona OP14-033 per bloccare Nami e Usopp; abilità del leader che riposa Perona o Coffin Boat ogni turno; T9 Mihawk 9; T11–T15 tre **Law & Bepo**, che riposano un personaggio e danno +2000 al leader; 2 Billion-fold World come counter evento. RG resta a 0 vite dal T15 |
| [q6M1t0iKy_Y](https://www.youtube.com/watch?v=q6M1t0iKy_Y) (8:07) | vs **Y Enel** OP05-098 | madoka | **vince** | 13 | madoka **non gioca nulla a T1 e T3** (contro Enel conserva le carte); T5 Tashigi, T7 **Shanks**, T9 quattro carte giocate (Perona, Law, Bonney, Perona). Enel attacca sempre Shanks con 8 DON!! e madoka lo salva con Billion-fold. Coerente con "contro Enel tieni un 5 in piedi" del coaching |
| [x-f32Gvdo1s](https://www.youtube.com/watch?v=x-f32Gvdo1s) (13:44) | vs **Lucy** OP15-002 | madoka | **vince** (letale T17) | 17 | T3 Kid & Killer + Apoo; Law/Perona ogni turno; T15 Mihawk 9. All'ultimo turno 6 DON!! su Law (Sabo lo blocca e muore) e poi 4 DON!! sul leader per il colpo finale: è il "being smart when going for lethal" del titolo |
| [wqUK8CS1vho](https://www.youtube.com/watch?v=wqUK8CS1vho) (12:12) | vs **Y Enel** OP05-098 | madoka | **perde** (madoka concede a 0 vite) | 18 | Partita lunga: l'avversario gioca Hawkins, Kuma, Borsalino, Franky e Moria, e con Kingdom Come distrugge Law & Bepo. madoka difende con 3 Zoro come counter |
| [bopdfR0KSDw](https://www.youtube.com/watch?v=bopdfR0KSDw) (8:14) | **mirror Mihawk** | madoka | non chiaro (il video finisce a metà del T13) | 13 | T1 **Coffin Boat**; T3 Kid & Killer + Bonney; T7 e T9 Shanks; T11 e T13 Law & Bepo. Vite 3–3 a fine video. In questo mirror ho dovuto correggere a chi attribuire i danni, perché i leader sono identici |
| [09-sWy0Ut0w](https://www.youtube.com/watch?v=09-sWy0Ut0w) (10:00) | vs **UY Nami** OP11-041 | avversario | **vince** (concede) | 18 | T2 doppia Perona da 1, T4 Perona + Apoo, T6 Bonney + Kid & Killer, T8 e T10 Shanks; turni con 3–4 Bonney. Nami resta a 1 vita |

Cosa si vede di madoka mettendo insieme i record (da confermare su più partite):
- Contro Enel passa i primi turni senza giocare.
- Usa l'abilità del leader quasi ogni turno, riposando la carta più economica (Perona da 1, Coffin Boat, perfino il Mihawk 9 appena giocato). Dopo l'abilità il log mostra sempre "Activate 1 Don" ×3 e "Can't play Cost 1 or more".
- Tiene Billion-fold World per proteggere Shanks o il leader.
- I counter dalla mano sono quasi sempre Zoro ST32-005, Apoo, Bonney e Kid & Killer.

## 6. Costo e scala: conviene farlo su tutto il canale?

**Tempi misurati su questo PC** (CPU, 6 processi OCR):
- download: 10–20 s a video (45–70 MB a 720p);
- OCR del log: circa **1,2× la durata del video** (10 min di video → circa 12 min);
- merge + parse: meno di 5 s;
- mano: circa 1 min.
- Totale: **circa 1,3× la durata del video**, senza intervento manuale.

**Sul canale:** circa 1.000 video di partite da ~10–12 min fanno circa 200 ore di video, cioè **circa 260 ore di CPU** (11 giorni continui). Oppure circa 2–3 settimane facendo 50 video al giorno di notte.

**Il collo di bottiglia vero è YouTube, non la CPU.** Oggi sono passati 6 download di fila senza blocchi, con 1–2 minuti fra uno e l'altro. Ma qualche ora prima c'era stato un 429. Prudenza: **20–40 video al giorno**, in lotti, fermandosi al primo 429.

**Come renderlo 3–4 volte più veloce** (non ancora fatto):
1. Fare l'OCR solo delle ultime 3–4 righe del log, che sono quelle nuove, invece del pannello intero.
2. Campionare a 2 fps invece di 4: il log scorre di poche righe al secondo.
3. Limitare il riconoscimento della mano alle carte del mazzo, ricavate dal log della stessa partita più `meta-decks.json`.

**Problemi prevedibili in scala:**
- un layout nuovo, se il log non è nella posizione solita (l'auto-ritaglio cerca il riquadro chiaro: va controllato `crop rilevato` nei log);
- video senza pannello log (le live con altre impaginazioni);
- partite tagliate a metà;
- frasi di effetti nuove, che non spostano il tavolo ma restano nel record come testo;
- video di altri giochi nel canale (LoL, Master Duel), da filtrare per titolo.

**Raccomandazione:** sì, scalare, ma per priorità.
1. Prima i circa 150 video con Mihawk come mazzo di madoka e i circa 340 di RG Luffy, che sono i mazzi del bot.
2. 20–40 video al giorno con `run_video.py`.
3. Per ogni lotto un controllo automatico su `quality` (parsed_fraction < 0,85, unknown_ids, log_gaps > 3) e a occhio sui casi sospetti.

**Alternativa molto più economica, da provare prima di tutto:** OPTCGSim ha il pulsante **"Download Combat Log"**, che si vede nei video. Se madoka (o altri giocatori) condivide quei file, si ottiene lo stesso log senza OCR e senza YouTube. Vale una richiesta sul suo Discord.

**Per il bot:** i record sono già sequenze di azioni con codici carta. Si possono rigiocare nel motore (`optcg-ai`) per estrarre coppie stato→azione di un giocatore forte. Dove la mano di madoka è nota, si sa anche quali alternative aveva e non ha scelto. I punti deboli da gestire nell'import sono gli eventi `effect` generici e lo stato attivo/riposato, che va ricostruito dal motore e non letto dal log.

## 7. Come riprendere il lavoro

```
cd %TEMP%\madoka-vision
python -m yt_dlp -f "bv*[height<=720][ext=mp4]/bv*[height<=720]" --sleep-requests 5 -o "%(id)s.%(ext)s" https://www.youtube.com/watch?v=ID
python -P <repo>\docs\bot\studio\madoka-games\tools\run_video.py ID "titolo del video"
```

I file di lavoro restano in `%TEMP%\madoka-vision\g_ID\`: ritagli del log, `ocr_frames.json`, `log_lines.txt`, `log_flat.txt` e `hand_cache.json`. Rilanciare `run_video.py` riusa l'OCR già fatto, quindi dopo una modifica al parser bastano pochi secondi a video.
