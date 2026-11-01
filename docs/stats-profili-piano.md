# Stats, leaderboard e profili: confronto con gli altri sim e piano

> Analisi del 30/10/2026. Questo documento è l'ultima rifinitura prima del matchmaking.
> I dati sui concorrenti vengono da una ricerca web: le pagine X rispondono 402 e non si
> leggono, alcuni siti caricano tutto via JavaScript. Quello che non ho potuto
> controllare è segnato con **?**.
> Per la UX di OPlay vedi anche [oplay-analysis.md](oplay-analysis.md).

## Stato (30/10/2026, sera)

Su richiesta, ho saltato la F0 (i dati veri arriveranno col matchmaking) e ho costruito le feature sopra la tabella `matches` e i dati demo (`npm run seed:ladder`).

| Fase | Stato |
|---|---|
| F1 rating vero | **Fatta** in `server/stats/`: Bounty Glicko-2, provvisorio "?", peak, storico, stagioni mensili, tier di bravura (East Blue → Emperor, Pirate King). |
| F2 profilo | **Fatta**, tranne il link al replay e la decklist dell'avversario, che mancano nei dati. |
| F3 leaderboard | **Fatta**: filtri per leader e paese, distribuzione dei tier, pagina "How the Bounty works". |
| F4 mie statistiche | **Fatta**: finestre temporali, per deck o per leader, n e range 95%, ordinamento migliori/peggiori. Manca il trend. |
| F5 meta | **Fatta**, tranne il filtro per fascia di Bounty e i turni medi. |
| F0 tabella `games` | **Da fare** prima del matchmaking: replay, turni, durata, scrittura da Play Auto. |

## 1. Chi c'è là fuori

| Piattaforma | Cosa offre su ranked, stats e profili | Fonte |
|---|---|---|
| **OPTCGSim + OPBounty (TCG Matchmaking)** | **Ranked e rating**: valuta "Bounty ฿" a stagioni (reset il 26/10/2026); la formula è ?. **Profilo**: WR della stagione, top 3 leader con split first/second, Bounty dopo ogni partita, ultime 9 partite con le decklist di entrambi, replay. **Meta**: ogni 6h, per fascia di rank; la matrice dei matchup è dietro Patreon. **Leaderboard**: pubblica solo tramite un tracker della community (optcg-data.pages.dev), con top 10k, filtri paese/leader e top 3 leader per giocatore. | optcgsim.com, stats.tcgmatchmaking.com, optcg-data.pages.dev |
| **OPlayTCG** | **Ranked e rating**: ELO mostrato come Bounty, 7 tier (Civilian → Pirate King) con la distribuzione in %, orologio stile scacchi. **Leaderboard**: Bounty, W-L, %, **Peak**, **Last match**, bandiera, filtri paese e "by leader", 27k giocatori, refresh quasi live. **Meta stats**: **WR ± margine d'errore**, soglia ≥350 partite e ≥30 giocatori, WR first e second ciascuno con il suo n, **WR opponent-adjusted**, finestre 7g/30g/all, vista matchup. **Il punto debole**: i nomi in classifica non aprono nessun profilo. | oplaytcg.com/play/leaderboard, /en/meta-stats |
| **OPTCG Web Sim (MetaHub)** | AI Pro, ranked, pagina /meta con play rate e WR da "top ladder" e tornei. Leaderboard e profili: **?** | optcgwebsim.com/meta |
| **DuelVoyager** | Dichiara ranked, replay, tornei e statistiche: tutto **?** | alternativeto.net |
| **Limitless TCG** | Ranking a **punti torneo**, con filtri per periodo, tipo di evento, regione e formato. **Profilo con palmarès**: ultimi piazzamenti con le liste e career stats (1st/2nd/T4/T8, online/offline). Nessun WR. | onepiece.limitlesstcg.com/players |
| **Egman, Straw Hat Stats, opdecks.xyz, onepiece.gg** | Aggregatori senza profili. **opdecks**: matrice, tier list pesata per meta share, movers settimanali, **durata media della partita**. **Straw Hat**: flag "small sample". **onepiece.gg**: report settimanali "all ranks" e "high rank". | opdecks.xyz, strawhatstats.com |
| **Untap, TTS, TCG+** | Nessun ranked e nessuna stat pubblica per OP. TCG+ è l'app tornei ufficiale. | |

**Cosa ne esce.** Nessun sim OPTCG ha un **profilo giocatore completo**, cioè con grafico del rating, WR per leader con n, first/second, cronologia con decklist e replay, palmarès e stagioni tutti nello stesso posto. Ognuno ne ha un pezzo:
- OPBounty ha i dati, ma li tiene sparsi o a pagamento;
- OPlay ha la meta più rigorosa, ma non ha profili;
- Limitless ha il palmarès, ma non ha il WR.

Qui possiamo vincere.

## 2. Il nostro stato (repo `Sailing-Network`, main)

Cose oneste da sapere prima di confrontarci.

| Area | Oggi | Problema |
|---|---|---|
| **Fonte dei dati** | Tabella `matches`, una riga per prospettiva del giocatore. Arriva dal **log manuale** della Duel Room (`POST /api/me/matches`) e dal seed demo. | Le partite vere non ci finiscono. `completeMatchSession` aggiorna solo `match_sessions`, e le partite col bot stanno in `bot_games`. Il log manuale è autodichiarato e chiunque può inventarsi vittorie. Nessun id lega le due righe della stessa partita. Mancano turni, durata, motivo di fine e snapshot del deck. |
| **Rating** | Tabella `user_ratings` con colonne Glicko-2 (`rd`, `vol`). | `updateRating` non è mai chiamata, quindi tutti restano a 1000. `/api/leaderboard` esiste ma la UI non la usa. |
| **Leaderboard** (`Rankings`, [ProfilePages.tsx:653](../src/features/profiles/ProfilePages.tsx)) | Rating calcolato nel client: `1000 + 6·W − 3·L`. | Premia il volume, non la bravura: 300 partite al 40% battono 50 partite al 70%. Mancano stagioni, peak, filtri, minimo di partite, paese. |
| **Tier** (`tierOf`, [ProfilePages.tsx:234](../src/features/profiles/ProfilePages.tsx)) | Rookie, Supernova, Warlord e Yonko, in base alle **vittorie totali**. | Non sono tier di bravura. I nomi sono gli stessi di OPlay. |
| **Le mie statistiche** | Per deck: WR complessivo, WR 1st e 2nd, WR contro ogni leader con split 1st/2nd. | È la base migliore che abbiamo, ed è già alla pari con OPBounty. Però: n solo sul totale e non sulle celle dei matchup; nessun intervallo di confidenza; nessuna finestra temporale; niente aggregato per leader tra più deck; niente streak; niente trend. |
| **Meta** | Share e WR per leader, da tutte le righe di `matches`. | Le partite contano doppio: ognuna ha due righe, quindi lo share e il campione sono gonfiati. Mancano CI, soglia minima, first/second, matrice e finestre. Il log manuale sporca i dati. |
| **Profilo** | Leader preferito come avatar, tier, W/L, bio, deck con W/L, data di iscrizione. | **"Follow" è finto**: è solo stato React e non salva nulla. Mancano rating, match history, stats per leader, paese, peak e stagioni. |

**Il primo problema da risolvere non è grafico.** Le statistiche più belle del mondo, costruite su dati autodichiarati e su un rating finto, valgono meno del tracker di OPBounty. Prima si sistema la base dei dati, poi si costruiscono le pagine.

## 3. Il piano

Le fasi sono ordinate per dipendenza. Ognuna è un commit (o pochi), e ognuna si può mostrare.

### F0. Una sola fonte di verità: la tabella `games`
- **Una riga per partita**, non per giocatore.
  - Giocatori e deck: `p0/p1`, `deck0/deck1` (con snapshot JSON della lista), `leader0/leader1`.
  - Esito e svolgimento: `first_player`, `winner`, `end_reason` (lethal / concede / timeout / disconnect), `turns`, `duration_ms`.
  - Contesto: `mode` (ranked / casual / bot / manual), `season_id`, `created_at`.
  - Replay e rating: `record_id` per il replay, `rating0_before/after` e `rating1_before/after`.
- **Ci scrivono tutte le partite**: la Play Auto PvP e le sessioni di match. Le partite col bot vanno nella stessa tabella con `mode='bot'`, oppure la tabella le collega a `bot_games`.
- **Il log manuale resta**, ma con `mode='manual'`. Conta solo nelle stats *personali*, con l'etichetta "auto-dichiarata". Non entra né nel ranked né nella meta.
- Una migrazione copia le righe di `matches` come `manual`. `matches` diventa una vista, o va in pensione.
- Modulo `server/stats/` senza dipendenze dalla UI, con README, secondo le nostre regole di lavoro.

### F1. Il rating vero
- **Glicko-2 applicato davvero** a fine partita ranked. È atomico con l'insert in `games`.
- **Mostrato come Bounty ฿.** La formula è pubblica, sulla pagina "Come funziona la Bounty": il punto debole di OPBounty e OPlay qui diventa un vantaggio.
- **Provvisorio con "?"** finché RD > 110, come su Lichess. Le prime ~10 partite sono di piazzamento e non compaiono in classifica.
- **Tabella `rating_history`**, una riga per partita, che alimenta il grafico. Il **peak** si ricava da lì.
- **Stagioni.** Tabella `seasons`, reset morbido verso la media (RD rialzata). L'archivio delle stagioni chiuse va nel profilo.
- **Tier di bravura**, non di volume. Soglie di Bounty definite come dati e non nel codice, distribuzione in % visibile, "Pirate King" assegnato ai top N. I nomi vanno scelti in modo da non essere una copia 1:1 di OPlay.

### F2. Il profilo "finito"
In ordine di pagina:
1. **Testata**: avatar o leader preferito, nome, bandiera (campo `country` opzionale), tier, **Bounty con #rank**, peak, badge (supporter, admin, campione di stagione).
2. **Grafico della Bounty** per la stagione corrente, con un selettore per le stagioni passate.
3. **Riepilogo**: partite, W-L, WR, **WR 1st e 2nd**, streak attuale e migliore, turni medi, partite degli ultimi 30 giorni.
4. **Tabella per leader giocato**: partite, WR ± CI, 1st/2nd, Bounty media dell'avversario. Ogni riga si espande nei matchup.
5. **Ultime partite**: avversario (link), i due leader, esito, first o second, turni, ΔBounty, **link al replay**, decklist di entrambi.
6. **Deck pubblici**, con W/L calcolato da `games`.
7. **Archivio stagioni**: Bounty finale, picco, posizione, tier.
8. **Follow vero** (tabella `follows`), con il contatore follower.
9. **Privacy**: un'opzione per nascondere le decklist nelle partite recenti.

### F3. Leaderboard
- **Usa davvero `/api/leaderboard`.** La formula nel client va eliminata.
- **Colonne**: #, giocatore (link al profilo) con bandiera, tier, Bounty, **Peak**, W-L, WR, partite, **top 3 leader** (icona, WR e n), last match.
- **Filtri**: stagione, leader ("i migliori con Luffy"), paese.
- **Regole d'ingresso**: minimo 10 partite, rating non provvisorio, attività negli ultimi 30 giorni.
- **Contorno**: barra con la distribuzione dei tier e la mia riga sempre fissata in vista.

### F4. Le mie statistiche
- **n su ogni numero e intervallo di Wilson al 95%.** Le celle con n < 10 sono attenuate e marcate "pochi dati".
- **Due assi di lettura**: per deck *e* per leader (che aggrega i deck dello stesso leader).
- **Filtri**: finestre 7g / 30g / stagione / sempre, e modalità ranked / casual / bot / manual.
- **Matrice dei miei matchup**, con colore e n.
- **Trend**: WR mobile sulle ultime 20 partite e turni medi per matchup.

### F5. Meta pubblica
- **Si conta per partita, non per riga.** Così sparisce il doppio conteggio.
- **Base dati**: solo `ranked` e `casual`. Soglia minima configurabile (es. ≥200 partite e ≥20 giocatori), finestre 7g/30g/stagione, filtro per fascia di Bounty ("tutti" / "top 20%").
- **Per leader**: play rate, WR ± CI, WR 1st e 2nd con n, **WR pesato per meta**, turni medi, variazione rispetto alla settimana prima.
- **Matrice leader × leader gratuita**, con n e CI nel tooltip. TCGMM la fa pagare.

### Dopo (non bloccano il matchmaking)
- **Stats per carta**, in stile HSReplay o 17lands: WR quando la carta è giocata o pescata, inclusion rate per leader. Nessuno lo fa per OP, ma richiede le azioni dei replay.
- **Report settimanale automatico**: un'immagine per X e Discord con top leader, movers e top Bounty.
- **Achievement e titoli stagionali**, per esempio un "Wanted poster" con la Bounty finale.
- **Palmarès tornei** in stile Limitless, quando avremo i tornei.

## 4. Decisioni aperte
1. **Il log manuale**: tenerlo solo per le stats personali (la mia proposta) o toglierlo del tutto?
2. **Il paese sul profilo**: lo sceglie l'utente (la mia proposta) o lo ricaviamo dall'IP?
3. **I nomi dei tier**: come evitiamo di replicare la scala di OPlay?
4. **Le partite col bot**: entrano nelle stats personali (sì, con un filtro) e nella meta (no)?
