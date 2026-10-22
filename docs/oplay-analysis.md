# OPlayTCG (oplaytcg.com/play) — reverse engineering UX/meccaniche

> Analisi 2026-10-22, condotta dal vivo sul loro tutorial interattivo (16 capitoli,
> accessibile senza login). Serve da riferimento per la BoardAutoPage di AUTOSIM e
> per la filosofia "one place for everything". NON copiamo asset/codice/palette:
> estraiamo la grammatica di interazione e le lezioni di design.

## 1. Struttura del sito ("one place")

La pagina /play è l'hub unico, in un solo scroll:
- **Mode cards** in griglia: Ranked / Friendly / New cards (spoiler) / Extended /
  Solo Practice (gioca entrambi i lati + rewind) / Solo vs AI (3 difficoltà).
  Ogni card mostra: formato (STANDARD/EXTENDED), tag (COMPETITIVE/CASUAL/PRACTICE),
  set supportati (fino a OP17/ST36), countdown nuovo set, badge regole
  (No spoilers / Counts for ELO / Rewind / Nothing saved), **contatori live**
  ("278 active rooms · 4 in queue", "1387 connected").
- **Tutorial** 16 capitoli con progresso persistente e Replay per capitolo.
- **Tornei player-run** (Bracket | Swiss + Top Cut) con registrazione, data,
  posti (19/80), durata stimata ("About 2h45, at most 5h30").
- **Leaderboard a tema**: "BOUNTY" (ELO travestito da taglia in Berry), bandiera
  paese, win%, peak.
- **Meta stats** della settimana: leader più giocati con %, colori, first/second
  winrate, "109.839 ranked games last 7 days".
- Footer esplicativo: cos'è il sim + 3 passi per iniziare.
Lezione: il "posto unico" funziona perché ogni sezione risponde a una domanda
("a cosa gioco?", "come imparo?", "chi è il più forte?", "cosa si gioca?").

## 2. Il tavolo

- Due metà specchiate, **ciascuna tinta col colore del Leader del giocatore**
  (io rosso → metà rossastra; avversario verde → verdastra). Riconoscimento
  istantaneo di chi possiede cosa.
- Zone etichettate in maiuscoletto: TRASH / COST AREA / DECK / STAGE / LEADER /
  CHARACTER AREA / DON!! DECK / LIFE·N. Life = colonna laterale verticale di
  dorsi; cost area = striscia orizzontale di DON mini-card.
- Pile con contatore numerico (DECK 40, DON 8, TRASH 2) e leggera rotazione
  "fisica" delle carte sui mazzetti.
- **Pill giocatore** (nome + orologio stile scacchi 17:30 che scorre nel proprio
  turno, tag colorato quando è il turno attivo) ai lati opposti.
- TURN N in alto a destra; bottoni fissi: **End turn** (oro, basso-dx),
  Concede, menu log (▤).
- Mano a ventaglio FUORI dal bordo tavolo (bassa-sx per me, alta-dx per l'opp),
  contatore carte + tag lingua. La mano avversaria è dorsi.
- **Chip di potenza live** sulla carta: "8000 (+3000)" verde quando buffata,
  "5000 (+1000)" col bonus DON. I modificatori si LEGGONO, non si calcolano.
- Badge keyword ON-CARD: chip "BLOCK" sui blocker; chip oro "⚡ Activate" sulle
  carte con abilità attivabile LEGALE ORA (affordance = legalità).

## 3. Grammatica di interazione (tutta tap-based, zero drag)

- **Tap su carta = preview ingrandita** (pannello con testo effetto leggibile).
- **Giocare una carta: 1 tap dalla mano** → entra sul campo, il costo si paga DA
  SOLO (i DON si restano automaticamente). Niente drag, niente conferma.
- **Dare DON: tap sul DON → tap su Leader/Char.** La fila DON è un **DIAL**:
  "tapping the third active DON picks three; tapping the last picks all" —
  scegli QUANTI, non quali (i DON sono fungibili). Cancel = tap altrove o
  "Stop giving DON!!".
- **Attacco: tap attaccante → tap bersaglio.** Freccia tratteggiata curva
  colorata col colore del leader attaccante. L'attaccante si resta subito.
  Solo i bersagli legali sono proposti (leader sempre, char solo se rested;
  il just-played non è nemmeno offerto come attaccante).
- **Step di battaglia espliciti** con un solo grande bottone contestuale in
  basso-centro: "Don't block" (block step) → "End counters" (counter step).
  Counter: tap su evento [Counter] o su carta con counter value in mano
  (evidenziate solo quelle usabili).
- **Scelte con target**: prompt in-context ("CHOOSE WHO YOU PROTECT"), bersagli
  legali evidenziati, bottoni "Confirm (N)" + "None".
- **[Trigger]**: il danno SOSPENDE il gioco, la carta Life si rivela ingrandita
  con glow + tag "You took a Life with [Trigger]" + bottone "Activate [Trigger]";
  decline → in mano. Anche senza trigger: reveal + "Continue" (ritmo uniforme).
- **Rifiuti spiegati**: banner rosso top-center "Not yet. When it is time to
  defend, tap the Counter event in your hand." Mai un no secco: sempre il perché
  e il cosa fare. ("Almost every time the table seems to refuse an attack, it is
  one of these rules and not a fault.")
- **Mosse di sistema** come prompt dedicati: STARTING ROLL (dadi animati, vinci
  → "Play first / Play second"), KEEP OR MULLIGAN (prompt compatto vicino alla
  mano, "Mulligan = reshuffle and draw 5 new (once)").
- Tutorial driver: ArrowRight avanza gli step informativi; gli step azione
  pretendono l'azione vera sul tavolo.

## 4. Estetica loro (da NON copiare, per differenziarci)

Pergamena chiara/crema, oro/ottone, serif editoriale per i titoli, bussole e
motivi da carta nautica, dadi gialli, pill scure. Vibe "mappa del tesoro
diurna". → Sailing Network deve stare su un registro DIVERSO: notturno
(già nostra identità: navy profondo, ottone/ambra, rosso segnale) — "plancia
di notte / quartier di comando del capitano" vs la loro "mappa di giorno".

## 5. Checklist meccaniche che la nostra board auto deve coprire (viste live)

1. Roll iniziale + scelta first/second (first: no draw, 1 DON).
2. Mulligan unico pre-Life.
3. Fasi auto: refresh (DON tornano, stand all) → draw → +2 DON → main → end.
4. Play con pagamento automatico costi; limiti 5 char / 1 stage.
5. Dare DON (dial di quantità) solo nel proprio main, solo a leader/char.
6. Attacco: attaccante attivo → rest; bersagli = leader | char rested;
   vietato al primo turno di ciascuno; il just-played non attacca (no Rush).
7. Block step: [Blocker] uno per battaglia, redirige su di sé.
8. Counter step: eventi [Counter] (con costo) e counter value (scarto da mano);
   pareggio vince l'ATTACCANTE (serve superare strettamente).
9. Damage: su leader → life→mano con sospensione [Trigger] (activate/decline);
   su char → K.O.; Double Attack = 2 danni; Banish = niente trigger.
10. Win/loss: life 0 + colpo al leader, o deck-out.
11. Orologi per giocatore; log consultabile; concede.

## 6. Cosa prendiamo / cosa facciamo meglio

PRENDIAMO: tap-first con un bottone di step contestuale; dial dei DON; chip
Activate guidati dalla legalità; potenza live con delta; frecce col colore del
leader; rifiuti spiegati; trigger-reveal che ferma il ritmo; metà campo tinte.
MIGLIORIAMO: (a) il nostro hub ha già social/amici/chat/profili veri — loro no;
(b) rewind/undo in practice (il loro Solo Practice ce l'ha, la nostra board
manuale già ha undo dal board overhaul — portarlo in auto);
(c) estetica notturna distintiva vs il loro parchment chiaro;
(d) il motore event-sourced AUTOSIM permette replay/spectate futuri.
