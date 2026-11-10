# Roadmap — simulatore automatico per il meta + AI che si allena

> Scritto il 2026-10-28, nella copia `Sailing-Network-bot`. Si aggiorna a ogni
> tappa chiusa: stato, numeri, decisioni. Una tappa = una sessione (o poche),
> con criteri d'uscita misurabili.

## Obiettivo finale

1. **board-auto gioca da sola i mazzi del meta** (Rocks, Luffy & Ace, Sabo,
   Luffy OP17, Enel viola, Kaido, Enel giallo, Shanks, Robin, Pudding…): ogni
   carta di quei mazzi risolve i suoi effetti senza "risolvi a mano", con le
   regole giuste.
2. **Un'AI gioca dentro lo stesso motore (AUTOSIM)**, migliaia di partite
   senza interfaccia, impara dai risultati, e si può sfidare in board-auto.

Un solo motore di regole: AUTOSIM. optcg-ai resta la fonte dei dati degli
effetti (tramite il compilatore) e, finché serve, il riferimento per le
euristiche del bot.

## Stato al 28/10 notte

- **Mazzi meta: 100%.** Tutte le 1479 copie dei 29 mazzi meta di optcg-ai
  girano da sole (era 74,1% al mattino); 29/29 mazzi interi.
- **Catalogo: 2850 carte su 2850** senza avvertenza in board-auto (2574 al
  mattino, 2691 in serata). 96 carte hanno un'approssimazione dichiarata
  (nota sulla carta), da rivedere nella tappa 8.
- 174 partite casuali tra mazzi meta: nessun errore, tutte finite.
- Tappe 2-7 fatte (decisioni 71-110 in AUTOSIM_PLAN.md). Prossime: tappa 8
  (correttezza: revisione testo ↔ IR delle carte meta), poi 9-10 (AI).

## Punto di partenza (misurato il 28/10 mattina)

Carte (copie nel mazzo) che girano da sole nel motore, con M4 incluso:

| Mazzo (quota meta) | Automatico | Leader | Cosa blocca il Leader |
|---|---|---|---|
| Rocks D. Xebec OP17-039 (44%) | 30/50 · 60% | a mano | scelta dentro "guarda le prime N" |
| Luffy & Ace ST30-001 (25%) | 40/50 · 80% | a mano | condizione "un altro con base ≥ X" |
| Sabo OP13-004 (18%) | 13/50 · 26% | ok | — |
| Luffy OP17-079 (17%) | 13/50 · 26% | a mano | Blocker dato a tutto il campo |
| Enel viola OP15-058 (14%) | 20/50 · 40% | a mano | "dal tuo secondo turno", mazzo DON da 6 |
| Kaido OP17-058 (14%) | 20/50 · 40% | ok | — |
| Enel giallo OP05-098 (12%) | 16/50 · 32% | a mano | timing "quando le tue vite diventano 0" |
| Shanks OP17-020 (11%) | 39/50 · 78% | a mano | costo non esprimibile |
| Robin OP09-062 (7%) | 26/50 · 52% | a mano | filtro "carta con [Trigger]" |
| Pudding OP08-058 (6%) | 19/50 · 38% | a mano | costo "gira vite a faccia in su" |

Ostacoli, pesati per quanto sono giocati nel meta:

| Ostacolo | Peso | Dove sta |
|---|---|---|
| Costi non esprimibili (mill, dai DON attivo, rivela dalla mano, gira vite…) | 843 | IR + motore |
| Condizioni mancanti (c'è un personaggio con costo ≥ X, DON ≤ X, DON dati, turno ≥ X, …) | ~1700 | IR + motore (economico) |
| "Scegli uno" (`chooseOne`) non eseguito | 641 | motore + UI |
| Sostituzioni "se verrebbe rimosso… invece" (Pre*) | ~440 | motore (grosso) |
| Filtri bersaglio (costo totale ≤ X, ha [Trigger], "o [Nome]") | ~720 | IR + motore |
| Effetti continui di campo (base power, Double Attack/Blocker a tutti, immunità, costo) | ~650 | motore (M4) |
| Timing mancanti (attacca/attaccato il tuo Leader, DON restituiti, vite a 0, carta scartata) | ~650 | motore |
| Scelte dentro "guarda le prime N" | 260 | compilatore + motore |

Velocità oggi: una partita completa con driver casuale ≈ 20-30 ms.

---

## Tappa 1 — Il tabellone del meta (misura prima di tutto)

> **Stato 28/10: fatta.** `generated/meta-report.json` (29 mazzi): 74,1% delle
> copie automatiche, 13/29 Leader (era 71,7% / 12 alla prima misura). Carte che bloccano più copie: OP17-112
> Linlin (base power di campo), OP14-104 Moria e OP16-119 Teach (scelte nelle
> viste / aggiungi alla vita), EB04-007 Zoro (condizione), EB03-053 Nami (vita
> a faccia in su).

Un test che produce `generated/meta-report.json`: per ogni mazzo meta, carte
automatiche / a mano / effetti inerti, e i motivi. Si committa e il test
controlla che non regredisca.

- Uscita: la tabella sopra è generata da un test; ogni tappa dopo la aggiorna.
- In più: correggere la lista Luffy OP16-022 (9 copie di OP16-042) in optcg-ai.

## Tappa 2 — Vocabolario dell'IR, parte facile (condizioni + filtri)

> **Stato 28/10: fatta la parte condizioni** (decisioni 55-58 in
> AUTOSIM_PLAN). Carte del catalogo senza avvertenza 1797 → 1997 su 2850.
> Restano: vite a faccia in su/giù (FaceupLife, serve lo stato nel motore),
> filtri "costo ≤ vite avversarie", "costo totale ≤ X", NameOverrides.

Aggiungere a `ir/types.ts` + `effects.ts` (valutazione) + compilatore:
- condizioni: "esiste un personaggio con costo ≥ X" (da una o due parti), DON
  sul campo ≤ X, DON dati totali ≥ X, turno ≥ X, "solo personaggi senza
  counter", numero di colori del Leader, attributo del Leader, "il tuo Leader è
  attivo/rested", "giocato in questo turno";
- filtri: costo **corrente** (oggi stampato), base power, "ha [Trigger]",
  "costo totale ≤ X", "o [Nome]" (NameOverrides).

Criterio: ogni aggiunta ha il suo test in `m*.test.ts`, la copertura sale, la
deriva è controllata. Uscita: Luffy & Ace, Robin, Shanks al 100%.

## Tappa 3 — "Scegli uno" e scelte nelle viste

> **Stato 28/10: "scegli uno" e alternative di costo fatti** (decisioni
> 63-65), anche Freeze. Shanks OP17-020 ora ha il Leader automatico. Restano
> le scelte dentro le viste ("guarda le prime N").

- Eseguire `chooseOne` nel motore: nuova `ChoiceRequest` "chooseOption" + prompt
  in board-auto (la UI ha già i pattern dei prompt).
- Compilatore: Choices dentro "guarda le prime N" → opzioni della vista
  (aggiungi / gioca / metti in fondo).

Uscita: Kaido, Enel giallo, Pudding, Rocks senza `chooseOne` a mano.

## Tappa 4 — Costi completi

> **Stato 28/10: fatta quasi tutta** (decisioni 59-62). Costi bloccati 180 →
> 40; carte senza avvertenza 1997 → 2121. Restano: alternative di costo
> ("X o Y", con la tappa 3), vite a faccia in su, staccare DON.

Nuovi `CostItem`: mill dal mazzo, dai DON attivo, rivela N carte dalla mano,
gira le vite a faccia in su/giù, K.O. / rimetti nel mazzo un tuo personaggio,
"riposa questo" combinato con il pagamento. Il compilatore smette di
richiedere che i costi stiano in passi separati dal payoff.

Uscita: zero "costo non esprimibile" nei mazzi meta.

## Tappa 5 — Timing che mancano

> **Stato 28/10: fatta** (decisioni 75, 83). Enel giallo, Rocks: Leader automatici.

"Quando il tuo Leader attacca / è attaccato", "quando dei tuoi DON tornano nel
mazzo DON", "quando le tue vite diventano 0" (Enel giallo), "quando una carta
viene scartata dalla mano", "quando questo viene riposato", e le azioni a fine
turno messe in coda (QueuedEndOfTurn).

Uscita: Enel giallo e Rocks con il Leader automatico.

## Tappa 6 — Sostituzioni (8-1-3-4) — la più grossa

> **Stato 28/10: fatta** (decisione 76): `mayReplace`, anche per il K.O. in battaglia.

"Se questo personaggio verrebbe K.O. / rimosso … invece …" e la versione per
gli alleati. Nel motore: prima di ogni spostamento dal campo, raccolta delle
sostituzioni applicabili, scelta del giocatore (mayActivate), una volta per
evento. Va disegnata prima su carta (scrivere le decisioni in AUTOSIM_PLAN.md).

Uscita: i mazzi Rocks/Kaido/Sabo/Luffy OP17 senza sostituzioni a mano.

## Tappa 7 — Effetti continui rimasti (M4 parte 2)

> **Stato 28/10: fatta** (decisioni 74, 82, 84-86): mazzi meta al 100%.

Base power di campo, Double Attack / Blocker / Rush a tutto il campo, immunità
("non può essere K.O. / rimosso dagli effetti avversari"), costo delle carte in
mano, "+X per ogni …", "l'avversario può attaccare solo questo", mazzo DON
ridotto (Enel viola), negazione (`negateEffect`), `setBasePower`,
`addToLife`, `redirectAttack`, `endBattle`.

Uscita della parte "simulatore": **tutti i 28 mazzi meta al 100%**, e nessun
effetto inerte nelle loro carte.

## Tappa 8 — Correttezza delle carte meta (in parallelo, da subito)

La copertura non basta: una carta automatica ma sbagliata è peggio di una a
mano.
- Revisione testo ↔ IR di **tutte** le ~330 carte dei mazzi meta (non a
  campione), a gruppi, con un revisore indipendente; gli errori diventano
  regole o override.
- Test di scenario per ogni Leader meta e per le 2-3 carte chiave di ogni
  mazzo ("con questo stato, giocando X succede Y").
- Fuzz: 500 partite per coppia di mazzi senza blocchi né eccezioni.

Stato al 10/11: revisione fatta su tutte le 391 carte dei mazzi meta, a 6
gruppi, ognuno con un revisore indipendente. Corretti gli errori confermati
(branch `fix/meta-cards-review`, test in `src/autosim/__tests__/meta-review.test.ts`):
costi su "il tuo Leader", Luffy OP13-001 senza DON!!, condizioni dei [Trigger]
sulle vite, [Counter] pagati con se stessi, "[Trigger] Play this card", tipi in
pareggio ({Shandian Warrior}), "from your hand or trash", "until the end of
your next turn", e Kalgara, Five Elders, Perona, Buggy dal testo.
Restano: le domande di regole da decidere con Vins, gli errori minori ("fino
a", nomi confrontati per pezzo di parola), i test di scenario per ogni Leader
e il fuzz da 500 partite.

## Tappa 9 — Motore pronto per l'AI (velocità + interfaccia)

- Cache del calcolo degli effetti continui (oggi ricalcolati a ogni domanda:
  la suite è passata da 5 a 10 s).
- Benchmark: partite/secondo headless; obiettivo ≥ 100 partite casuali/s su un
  core, perché la ricerca Monte Carlo ne gioca migliaia per decisione.
- Interfaccia agente unica: dato lo stato e chi deve agire (`legalMoves` +
  `pendingChoice`), restituire un `PlayerIntent`. Già quasi tutto c'è: il
  motore "chiede, non indovina".
- Determinizzazione (mano e mazzo avversario mescolati dalle carte non viste)
  per non far barare il bot.

## Tappa 10 — L'AI dentro AUTOSIM (M6)

- `src/autosim/ai/`: agente casuale → greedy → Monte Carlo (come optcg-ai Pro).
  Si riusano le idee e i dati di optcg-ai che non dipendono dal motore: piani
  di gioco per Leader (playbook), pesi della valutazione, stile per matchup.
- Runner headless (`npm run selfplay`): N partite tra mazzi meta, record
  completo (seed + intents: AUTOSIM è a eventi, il replay è gratis), salvataggio
  in `bot_games`.
- Apprendimento: porting di `learn.ts` (taratura stile/peso DON per Leader e
  matchup), poi i casi "mossa sbagliata" come test di regressione.

Uscita: il bot Pro su AUTOSIM batte il Casual su ogni mazzo dei top 8, e gioca
in board-auto ("Play vs Bot · Full Rules").

## Tappa 11 — Un solo simulatore

Quando board-auto + bot AUTOSIM coprono tutto, board-bot (motore optcg-ai) si
ritira o resta solo come riferimento per confronti. Poi il merge nella
`Sailing-Network` originale, da fare con te.

---

## Ordine di lavoro (aggiornato 28/10, su tua richiesta)

Si implementano **tutte le carte**, non solo il meta: una meccanica alla
volta, in ordine di quante carte sblocca. Prossime, dalla misura di oggi
(motivi "a mano" sul catalogo):
1. ~~costi con ":" non esprimibili (180 effetti)~~ fatto, restano 40;
1b. ~~"scegli uno" + alternative di costo~~ fatto;
1c. ~~vite a faccia in su, aggiungi alle vite~~ fatto;
2. ~~bersagli/filtri mancanti~~ fatto (anche i bersagli alternativi, che prima
   venivano ignorati);
3. ~~effetti singoli~~ fatto;
4. ~~timing e sostituzioni (tappe 5-6), effetti continui rimasti (tappa 7)~~ fatto;
5. ~~coda lunga~~ fatto: 2850/2850.

## Ordine e dipendenze

```
1 tabellone ──► 2 condizioni/filtri ──► 3 scegli-uno ──► 4 costi ──► 5 timing ──► 6 sostituzioni ──► 7 continui
                     │                                                                                   │
                     └──────────── 8 correttezza (sempre, in parallelo) ───────────────────────────────────┤
                                                                                                         ▼
                                              9 motore pronto per l'AI ──► 10 AI su AUTOSIM ──► 11 un solo simulatore
```

Le tappe 9-10 possono partire dopo la 3: il bot impara già sui mazzi che sono
al 100% (Kaido, Sabo) mentre il resto si completa.

## Regole di lavoro (dalla skill, adattate al web)

- Una tappa per sessione; si parte da un commit pulito; si chiude con i test
  verdi, la tabella aggiornata e un report in `_Reports/`.
- Ogni pezzo nuovo è un modulo con una responsabilità e il suo test; niente
  file tuttofare.
- Nessuna regola inventata: quello che non è sicuro resta "a mano" finché non
  è verificato.
- Lavoro solo nella copia finché non decidi tu il merge.
