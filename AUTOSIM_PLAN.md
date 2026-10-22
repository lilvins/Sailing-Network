# AUTOSIM — Piano per la board automatica (rules engine completo)

> Stato: **PIANO — non ancora in esecuzione.** Preparato il 2026-07-30 dopo lo
> studio delle Comprehensive Rules ufficiali v1.2.0 (16/1/2026) e l'analisi
> statistica dell'intero pool di carte locale (2634 carte).
> Fonte regole nel repo: `docs/rules/op_comprehensive_rules_v1.2.0.txt`
> (testo estratto dal PDF ufficiale Bandai).
> Il prompt esecutivo è in fondo (§10).

## 1. Obiettivo e principi

Una **terza board, automatica** ("Play Auto"), che applica TUTTE le regole del
One Piece Card Game: fasi auto, costi pagati davvero, battaglia a step con
block/counter, effetti delle carte eseguiti dal motore. Le due board manuali
esistenti NON si toccano.

Principi non negoziabili:
1. **Event-sourced e serializzabile** (estensione della regola storica del
   progetto): ogni cambiamento è un `GameEvent` JSON in un log append-only;
   lo stato è riducibile dagli eventi; RNG seedato. Replay/multiplayer gratis.
2. **Il motore chiede, non indovina**: quando serve una scelta (target, "may",
   counter, blocker, ordine trigger) il motore emette una `ChoiceRequest` e si
   ferma finché non riceve la `ChoiceResponse`. La UI umana risponde oggi; un
   bot o il network potranno rispondere domani con la stessa interfaccia.
3. **Degradazione elegante**: le carte il cui effetto non è (ancora) compilato
   nell'IR sono classificate `unsupported` → in partita il motore apre un
   prompt "risolvi manualmente" con azioni libere loggate. Mai bloccare una
   partita per una carta strana; la copertura cresce set dopo set.
4. **Il testo carta vince sulle regole** (rule 1-3-1) → l'IR può esprimere
   override puntuali.

## 2. Fondamenta di regole (sintesi operativa, con riferimenti)

Dal documento ufficiale (numeri di sezione = `docs/rules/...txt`):

- **Sconfitta** (1-2, 9-2): leader prende danno con 0 Life, o deck a 0. Le
  defeat sono "rule processing", valutate immediatamente (9-1-2).
- **Setup** (5-2): decide chi inizia → effetti "At the start of the game" →
  5 carte, un solo mulligan completo → Life dal deck (ordine 2-9-2-1) →
  il primo comincia.
- **Turno** (6): Refresh (fine effetti "until start of your next turn" →
  trigger "at the start of turn" → DON dati tornano in cost area RESTED →
  stand di tutto) → Draw (skip 1° turno del primo) → DON!! (+2, +1 al 1° turno
  del primo; 6-4-2 se ne resta 1 metti 1) → Main → End (ordine preciso:
  [End of Your Turn] del turn player → [End of Your Opponent's Turn] → scadenza
  "at end of turn" TP poi NTP → scadenza "during this turn" TP poi NTP).
- **Main** (6-5): in qualsiasi ordine e quantità: play (costo = rest di DON
  attivi), attivare [Activate: Main]/[Main], dare DON (solo attivi, +1000 nel
  proprio turno per DON, 6-5-5-2), battaglia (non al 1° turno di ciascuno,
  6-5-6-1).
- **Battaglia** (7): Attack Step (rest attaccante → scegli target: leader o
  personaggio RESTED → [When Attacking] poi [On Your Opponent's Attack],
  10-2-16) → Block Step ([Blocker]: max uno per battaglia, redirige) →
  Counter Step (difensore, quante volte vuole: counter dalla mano +power,
  eventi [Counter] pagandone il costo) → Damage Step (attacco ≥ difesa vince;
  su leader: danno→Life in mano, con [Trigger] attivabile invece; su
  personaggio: K.O.) → End of Battle (effetti "end of battle", scadenza
  "during this battle"). A fine di OGNI step: se attaccante o target hanno
  lasciato l'area → salta a End of Battle (7-1-1-4 ecc.).
- **Effetti** (8): 4 categorie — **auto** (timing events), **activate**
  ([Activate: Main]/[Main]), **permanent** (continui, ricalcolo a fixpoint
  8-1-3-3-5), **replacement** ("instead", regole 8-1-3-4). One-shot vs
  continuous (8-1-4). Costi di attivazione col `:` (①=rest DON, DON!!−X =
  torna al DON deck da leader/char/cost area, 8-3-1-5/6). Condizioni
  [DON!!xX] [Your Turn] [Opponent's Turn]. **Ordine di risoluzione** (8-6):
  a parità di timing risolve prima il turn player, con interleaving definito
  (8-6-1-1); trigger durante damage processing si accodano a fine damage
  (8-6-2); [Trigger] sospende il damage processing (8-6-2-1).
- **Rule processing** (9) + limiti struttura: max 5 personaggi (eccesso: trash
  by rule al play, 3-7-6-1), max 1 stage, leader inamovibile (3-6-3), carta che
  cambia area = carta NUOVA (3-1-6, chiave per [Once Per Turn] 10-2-13-4 e per
  interrompere le battaglie).
- **Keyword effects** (10-1): Rush, Double Attack, Banish (niente Trigger!),
  Blocker, Trigger, Rush: Character, Unblockable.
- **Keywords** (10-2): K.O. (i "cannot be K.O.'d" valgono solo per battaglia
  o effetti che dicono K.O., 10-2-1-3), Activate: Main, Main, Counter,
  When Attacking, On Play, End of Your (Opponent's) Turn, DON!!xX, DON!!−X,
  Your/Opponent's Turn, Once Per Turn (per-carta, 10-2-13), Trash, On Block,
  On Your Opponent's Attack, On K.O. (unico auto che risolve dal trash,
  10-2-17-2).
- **Extra** (11): loop infiniti (draw o scelta del numero di iterazioni),
  reveal obbligatorio segreto→segreto (11-2-1), viewing di aree segrete.

## 3. Il pool reale (analisi di 2634 carte locali)

Frequenze dei tag di timing: On Play 858 · Trigger 515 · Activate: Main 363 ·
Blocker 355 · Main 328 · Once Per Turn 295 · When Attacking 246 · Counter 191 ·
DON!!x1 177 · On K.O. 161 · Your Turn 97 · Rush 86 · Opponent's Turn 76 ·
End of Your Turn 50 · On Your Opp. Attack 48 · DON!!x2 41 · Double Attack 32 ·
Banish 22 · On Block 14 · Unblockable 8 · Rush: Character 5.

Azioni più comuni: rest 619 · power ± 564 · K.O. 513 · draw 360 · peek/arrange
deck 314 · discard 265 · search+reveal 195 · stand 172 · "gains [Keyword]" 167
· DON!!−X 162 · manipolazione Life 155 · play from hand 122 · give rested DON
101 · mill 77 · bounce in mano 75 · attach DON dal DON deck 72 · cannot-be-KO
43 · negate 36 · cannot-attack 35 · trash→mano 23 · play from trash 20.

Conclusione: **~25 primitive d'azione + ~15 timing + un sistema di selettori
coprono la quasi totalità del pool**. La coda lunga (effetti one-off strani)
va a `unsupported` con fallback manuale — per design, non per ripiego.

## 4. Architettura

```
src/autosim/
  ir/
    types.ts          # CompiledCard, Effect, Timing, Cost, Condition, Action,
                      # Selector, Duration — TUTTO JSON-serializzabile
    schema.json       # JSON Schema dell'IR (validazione compilazione AI)
    validate.ts       # schema check + linter semantico
  engine/
    state.ts          # AutoGameState (zone, instances, modifiers, battle, choices)
    events.ts         # GameEvent union (append-only log) + reducer
    intents.ts        # PlayerIntent union (playCard, attack, giveDon, activate,
                      # endMain, respondChoice, concede, manualAction)
    engine.ts         # loop: intent → legality → events → trigger queue →
                      # rule processing → choice requests
    battle.ts         # macchina a stati dei 5 step (7-1-*)
    effects.ts        # esecutore delle Action primitives sull'engine
    continuous.ts     # modifiers con durations + permanents (fixpoint 8-1-3-3-5)
    triggers.ts       # coda auto-effects con ordering 8-6
    legality.ts       # mosse legali correnti (per UI e futuri bot)
    rng.ts            # riusa lib/rng seedable
  data/
    compiled/ST01.json, OP01.json, ...   # output pipeline AI (per set)
    golden/golden-cards.json             # ~30 carte compilate a mano (test)
  __tests__/          # unit per regola + scenari scriptati end-to-end
src/features/board-auto/
  BoardAutoPage.tsx   # nuova view "board-auto"; riusa il layout DB (CardArt,
                      # DCard read-only, layout db-*) MA input = solo mosse
                      # legali proposte dall'engine + prompt di scelta
  autoStore.ts        # zustand: engine state + dispatch intents (stesso
                      # pattern serializzabile del gameStore)
```

Decisioni chiave:
- **Motore puro e sincrono**: `applyIntent(state, intent) → {state', events[],
  pendingChoice?}`. Niente side effect, niente Promise dentro il motore.
- **ChoiceRequest tipizzate**: `selectTargets`, `mayActivate`, `orderEffects`,
  `counterWindow`, `blockWindow`, `triggerDecision`, `mulligan`,
  `manualResolve` — ognuna con il set legale di risposte già calcolato.
- **Modifiers**: lista di `{source, kind: powerMod|keywordGrant|costMod|
  restriction|..., target, amount?, duration}` ricalcolata sui valori base;
  le durations scadono nei punti esatti definiti dalle regole (End Phase
  ordering 6-6-1-2/3, End of Battle 7-1-5-3/4, Refresh 6-2-1).
- **[Once Per Turn]**: contatore per `instanceId` (la carta che cambia area è
  nuova → contatore azzerato, coerente con 3-1-6).
- Il **gameStore manuale non si tocca**; l'autosim ha il suo store. Componenti
  visivi condivisi importati da BoardPage.

## 5. Effect IR — la classificazione (v1)

Ogni carta compila in:

```ts
interface CompiledCard {
  cardId: string;
  version: 1;
  confidence: number;          // 0..1 dalla pipeline AI
  classification: "vanilla" | "keyword-only" | "compiled" | "partial" | "unsupported";
  keywords: Keyword[];         // Rush | Blocker | DoubleAttack | Banish | Unblockable | RushCharacter
  counterValue?: number;       // già nel DB, ripetuto per comodità
  effects: Effect[];
  notes?: string;              // dubbi della pipeline, per review umana
}

interface Effect {
  timing: Timing;              // vedi sotto
  oncePerTurn?: boolean;
  optional?: boolean;          // "you may"
  conditions?: Condition[];    // DonAttached(x) | YourTurn | OpponentTurn |
                               // LeaderIs{color/type/name} | CountInZone{...} |
                               // LifeAtMost(n) | HandAtMost(n) | ...
  cost?: CostItem[];           // RestDon(n)=① | ReturnDon(n)=DON!!−X |
                               // RestSelf | TrashFromHand{sel} | TrashSelf |
                               // TrashFromLife(n) | ...
  actions: Action[];           // in ordine testuale (1-3-7); supporta
                               // {kind:"ifThen", if:..., then:[...], else?:[...]}
}

type Timing =
  | "onPlay" | "whenAttacking" | "onKO" | "onBlock" | "counter" | "trigger"
  | "activateMain" | "main"                       // activate effects
  | "endOfYourTurn" | "endOfOpponentsTurn"
  | "startOfYourTurn" | "startOfOpponentsTurn"
  | "onYourOpponentsAttack" | "whenAttacked"      // 7-1-3-1
  | "onOpponentPlaysCharacter" | "endOfBattle"
  | "static";                                     // permanent/continuous

type Action =
  // Tier 1 — core (copre la maggioranza del pool)
  | { kind: "powerMod"; sel: Selector; amount: number; duration: Duration }
  | { kind: "koTarget"; sel: Selector }
  | { kind: "draw"; count: number; upTo?: boolean }
  | { kind: "restTarget"; sel: Selector }
  | { kind: "standTarget"; sel: Selector }
  | { kind: "discard"; who: Who; sel: Selector }          // trash from hand
  | { kind: "grantKeyword"; sel: Selector; keyword: Keyword; duration: Duration }
  | { kind: "restriction"; sel: Selector; what: "cannotAttack"|"cannotBeKOd"|
      "cannotBlock"|"cannotBeAttacked"|"mustAttackIfAble"; duration: Duration }
  // Tier 2 — zone e risorse
  | { kind: "returnToHand"; sel: Selector }
  | { kind: "playFromZone"; zone: "hand"|"trash"|"revealed"; sel: Selector;
      free?: boolean; rested?: boolean }
  | { kind: "peekDeck"; count: number; then: PeekDisposition }  // reveal/add/
      // play/bottom/top-any-order/shuffle (i "search" sono peek+filter+add)
  | { kind: "mill"; who: Who; count: number }
  | { kind: "addFromTrashToHand"; sel: Selector }
  | { kind: "lifeToHand"; who: Who; count: number }        // "take life"
  | { kind: "trashLife"; who: Who; count: number }
  | { kind: "addToLife"; sel: Selector; faceUp?: boolean }
  | { kind: "giveRestedDon"; sel: Selector; count: number }
  | { kind: "attachDonFromDeck"; sel: Selector; count: number; rested?: boolean }
  | { kind: "placeDonInCostArea"; count: number; rested?: boolean }
  | { kind: "returnDonToDeck"; who: Who; count: number }
  | { kind: "costMod"; sel: Selector; amount: number; duration: Duration }
  | { kind: "setBasePower"; sel: Selector; amount: number; duration: Duration }
  // Tier 3 — controllo e meta
  | { kind: "negateEffect"; sel: Selector; scope: string; duration: Duration }
  | { kind: "redirectAttack"; sel: Selector }
  | { kind: "endBattle" }
  | { kind: "ifThen"; if: Condition[]; then: Action[]; else?: Action[] }  // 4-10
  | { kind: "chooseOne"; options: Action[][] }
  | { kind: "manual"; text: string };   // valvola di sfogo esplicita

interface Selector {
  owner: "self" | "opponent" | "any";
  zone: "characterArea" | "leader" | "leaderOrCharacter" | "stage" | "hand"
      | "trash" | "deckTop" | "costArea" | "life";
  filter?: { typeIncludes?: string[]; nameIncludes?: string[]; colors?: string[];
             costAtMost?: number; costAtLeast?: number; powerAtMost?: number;
             powerAtLeast?: number; rested?: boolean; hasKeyword?: Keyword;
             excludeSelf?: boolean; category?: string[] };
  count: number; upTo?: boolean; self?: boolean;   // self = la carta stessa
  chooser: "controller" | "opponent";
}

type Duration = "instant" | "thisBattle" | "thisTurn" | "untilStartOfYourNextTurn"
              | "untilEndOfOpponentsNextTurn" | "permanentWhileInPlay";
```

Golden examples (da compilare A MANO come primi test):
`ST01-006` (draw semplice), `OP01-016` [On Play] search, un [Counter] event
(`ST01-014`), un [Blocker] puro, un [Trigger], un DON!!−X, un permanent
("all your {Type} gain +1000"), un replacement/negate, un [Once Per Turn]
[Activate: Main] con costo ①.

## 6. Pipeline AI di compilazione carte

1. **Batch per set** (ST01 → OP01 → OP02 …): l'agente riceve N carte per call
   (id, nome, categoria, colori, tipi, costo, power, counter, effect, trigger)
   + lo schema IR + 10 golden examples + le regole rilevanti in sintesi.
2. **Output**: `CompiledCard[]` valido secondo `schema.json`, con
   `confidence` e `notes`.
3. **Validazione automatica a 3 livelli**:
   a. JSON Schema; b. linter semantico (selettori sensati, durations coerenti
   col timing, costi solo dove la carta li ha); c. **dry-run nel motore**
   (ogni effetto istanziato in una partita sintetica non deve lanciare).
4. **Golden test**: sul set curato a mano l'output deve coincidere (diff
   strutturale). Sotto soglia → il batch si rilancia con gli errori nel prompt.
5. **Triage**: `confidence < 0.75` o linter-fail → `partial`/`unsupported` +
   coda di review in un report MD (carta, testo, IR proposto, dubbio).
6. **Cache**: output committato in `src/autosim/data/compiled/<SET>.json`;
   la pipeline si rilancia solo per carte nuove o per bump di `version`.

## 7. UI — BoardAutoPage

- Nuova voce home "Play Auto — Full Rules" (view `board-auto`), terza board.
- Riusa l'estetica DB della board 1 (CardArt, layout db-*), ma:
  - le azioni disponibili vengono da `legality.ts` (bottoni/drag solo legali);
  - le `ChoiceRequest` renderizzano prompt dedicati (target picker con
    evidenziazione dei legali, finestra counter con carte usabili, blocker
    yes/no, ordine trigger, mulligan);
  - pannello log eventi (dal GameEvent log, human-readable);
  - la carta `unsupported` apre il pannello "risolvi manualmente" (mosse
    libere stile board manuale, tutte loggate come `manualAction`).
- Test mode hotseat sin da M0 (entrambe le mani visibili, si risponde per
  entrambi i seat) — stessa filosofia della board manuale.

## 8. Milestones

- ✅ **M0 — Fondamenta** (2026-07-31) · IR types+schema+linter, engine skeleton: setup/
  mulligan/fasi/DON/play con costi/limiti struttura/defeat, battaglia
  completa SENZA effetti (solo power+counter values), event log + reducer +
  test. *Exit: partita vanilla completa hotseat via test scriptato.*
- ✅ **M1 — Keywords & finestre** (2026-10-22) · Rush/Blocker/DoubleAttack/Banish/
  Unblockable/RushCharacter, Counter Step completo (counter values + eventi
  [Counter] tier-1), [Trigger] flow, trigger queue con ordering 8-6.
  *Exit: starter vs starter giocabile con keyword corrette.*
- **M2 — Compilazione tier-1** · pipeline AI su ST01+OP01 per: powerMod, KO,
  draw, rest/stand, discard, grantKeyword, restriction; UI ChoiceRequest.
  *Exit: ≥80% carte ST01/OP01 `compiled` e giocabili; golden al 100%.*
- **M3 — Tier-2 zone/risorse** · peek/search, play-from-zone, life manip,
  DON manip, mill, bounce, costMod. *Exit: ≥90% ST01+OP01, ≥75% OP02-OP05.*
- **M4 — Continuous & meta** · permanents a fixpoint, negate, replacement,
  setBasePower, redirect/endBattle, [Once Per Turn] edge (10-2-13-5).
- **M5 — Copertura totale** · pipeline su tutti i set; report copertura;
  triage code; fallback manuale rifinito.
- **M6 (opz.)** · bot avversario (facile: risponde alle stesse ChoiceRequest).

## 9. Rischi

- **Testi ambigui/tradotti male nel DB community** → golden set + confidence
  + fallback manuale; mai fidarsi ciecamente della compilazione.
- **Interazioni continuous/replacement** (M4) è la parte più difficile del
  motore → isolata in milestone dedicata, non blocca M0-M3 giocabili.
- **Scope creep UI** → la UI auto riusa l'estetica esistente; niente redesign.
- **Drift col sim manuale** → nessuna condivisione di store; solo componenti
  visivi.

## 10. PROMPT ESECUTIVO

> Da lanciare per iniziare l'implementazione (una milestone per sessione).
> Sostituire `<M>` con la milestone (M0 per la prima).

```
Leggi AUTOSIM_PLAN.md e docs/rules/op_comprehensive_rules_v1.2.0.txt nel repo
Sailing-Network. Esegui la milestone <M> del piano, esattamente come
specificata, senza toccare le board manuali (BoardPage, BoardPage2, gameStore).

Regole di lavoro:
- Tutto ciò che entra nello stato è JSON-serializzabile; il motore è puro e
  sincrono; ogni cambiamento passa da GameEvent nel log; RNG solo da lib/rng.
- Ogni regola implementata cita nel commento il numero di sezione delle
  comprehensive rules (es. "7-1-2-1").
- Test PRIMA dell'UI: ogni exit criterion della milestone ha almeno un test
  vitest dedicato; gli scenari end-to-end sono partite scriptate via intents.
- Typecheck (npx tsc -b) e npm run test:unit devono restare verdi a ogni step.
- Se una decisione di design non è coperta dal piano, scegli la soluzione più
  semplice che non violi i principi §1 e documentala in AUTOSIM_PLAN.md in
  una sezione "Decisioni prese in corso d'opera".
- A fine milestone: aggiorna CLAUDE_NOTES.md, riporta i criteri di uscita
  verificati uno per uno, e fermati — non iniziare la milestone successiva.

Per M2+ (pipeline AI): compila le carte in batch usando lo schema IR di
src/autosim/ir/schema.json e i golden examples; valida con i 3 livelli del
§6; le carte sotto soglia vanno in classification "unsupported" con nota.
```

## Decisioni prese in corso d'opera

**M0 (2026-07-31) — completata.** Scelte fatte dove il piano lasciava margine:
1. La battle machine vive dentro `engine.ts` (declareAttack / openCounterWindow /
   resolveDamageStep) invece che in `battle.ts`: per M0 il flusso è coeso con
   l'intent handling; si estrae in M1 quando blocker/trigger la faranno crescere.
2. **DON come contatori** (`don: {deck, active, rested, given}`) e non istanze:
   sono 10 carte identiche; i "given" mappano iid→count (né attivi né rested,
   4-4-2). Più semplice e ugualmente serializzabile.
3. Golden set M0 = **sintetico** (`TEST-*`, marcato nelle notes): fissare testi
   di carte reali a memoria rischiava golden sbagliati; il set reale (~30 carte)
   si costruisce in M2 leggendo il DB live.
4. `pendingChoice` e `rngUses` sono bookkeeping del motore, NON derivati dagli
   eventi: il replay li riallinea esplicitamente (documentato nel test). Se in
   futuro serviranno nel replay puro, si promuovono a eventi.
5. `lib/rng.ts` esteso con `seededRng`/`shuffleWith` (mulberry32+FNV-1a); la
   `shuffle` non seedata del sim manuale resta intatta.
6. Il rimpiazzo del 6° personaggio (3-7-6-1) è parte dell'intent
   (`playCard.replaceIid`) invece di una ChoiceRequest dedicata.
7. Le carte Event in M0 si possono giocare (costo pagato, trash) con effetto
   no-op loggato (`eventCardUsed`) — l'esecuzione arriva con M2.
8. `resolveJsonModule` aggiunto a tsconfig.app.json (import dei golden JSON).

**Post-M0 (2026-07-31) — esito dei check multi-agente** (coerenza piano/regole,
fluidità partita, estensibilità carte). Fix applicati:
9. **Deck-out immediato** (finding major confermato): pescare l'ultima carta fa
   perdere sul colpo (1-2-1-1-2 + 9-1-2), non al tentativo di pesca successivo.
   Test dedicato che verifica anche l'ordine esatto degli eventi.
10. **Costruzione mazzo completa** (finding minor confermato): oltre alle 50
    carte ora si valida max 4 copie per numero (5-1-2-3), colori inclusi nel
    leader (5-1-2-2, multicolor ok) e niente Leader nel mazzo (5-1-2-1).
    Le fixture di test sono state rese construction-legal.
11. **Fuzz suite permanente** (`__tests__/fuzz.test.ts`, iniziata dall'agente
    smoothness e completata a mano): 32 partite casuali seedate + 8 run di
    probe illegali; invarianti dopo OGNI intent (conservazione carte e DON,
    pile mai rested, caps zone, coerenza pendingChoice/battle, purezza di
    applyIntent, terminazione, JSON round-trip throttled). Il fuzz ha scovato
    due buchi reali, entrambi fixati: intent di tipo sconosciuto accettati in
    silenzio (ora default case → EngineError) e `concede` da un giocatore
    inesistente che assegnava la vittoria (ora requirePlayer).

**M1 (2026-10-22) — completata.** Keywords 10-1, Counter Step completo,
[Trigger] flow, coda auto-effects 8-6 e nucleo dell'esecutore tier-1.
Scelte fatte dove il piano lasciava margine:
12. **Battle machine estratta in `battle.ts`** (come previsto dalla decisione
    M0 #1) insieme al "pump": lo scheduler unico della risoluzione effetti —
    avanza l'effetto corrente azione per azione (1-3-7), drena la coda con
    l'ordering 8-6, sospende la coda finché il damage processing è in corso
    (8-6-2), si ferma sulle ChoiceRequest e infine riprende il flusso
    interrotto (block step / counter window / damage / main). `effects.ts` =
    esecutore tier-1 + selettori/filtri/condizioni/costi; `triggers.ts` =
    coda pura (generazioni monotone, turn-player-first a parità → modella
    8-6-1 e 8-6-1-1 senza casi speciali).
13. **`EngineCard.compiled?: CompiledCard`**: keyword ed effetti arrivano dal
    CardDb — nessun metadato carta entra nello stato (coerente con M0).
14. **Modifiers unificati in `state.modifiers`** (anche i counter values;
    `battle.mods` eliminato): `{source, controller, kind: powerMod|
    keywordGrant|restriction, target, duration, anchor, createdTurn}`,
    ricalcolati sui valori base. Le scadenze sono deterministiche e vivono nel
    reducer (battleEnded → thisBattle 7-1-5-3/4; turnEnded → thisTurn 6-6-1-3
    e untilEndOfOpponentsNextTurn; turnStarted → untilStartOfYourNextTurn
    6-2-1): niente eventi di expiry dedicati. I modifier che puntano a una
    carta che lascia il campo cadono con lei (3-1-6).
15. **`state.exec`** (coda + effetto running + flow di ripresa) è bookkeeping
    del motore come `pendingChoice`, NON event-derived: il replay lo riallinea
    esplicitamente (stessa regola della decisione M0 #4).
16. **Scelte forzate auto-risolte** (8-4-4-1): `selectTargets` viene emessa
    solo quando esiste una scelta reale (upTo, o candidati > count); con
    candidati ≤ count obbligatori il motore seleziona da sé.
17. **[Trigger]**: la `triggerDecision` è offerta solo se l'effetto è
    davvero attivabile (condizioni 8-4-1-1 + costo pagabile 8-3-1-3);
    una Life senza trigger va in mano senza pausa né reveal (10-1-5-2: la
    carta declinata non si rivela — un evento di reveal avrebbe leakato
    informazione nel log). Durante la risoluzione la carta è "in limbo"
    (10-1-5-3): esce da Life con `triggerActivated` e atterra con
    `triggerCardTrashed` o `triggerCardPlayed`; `playFromZone self` con area
    piena o carta non-Character degrada a trash ("to the extent possible",
    8-1-2).
18. **Eventi [Main] eseguiti** con lo stesso percorso dei [Counter]
    (`eventCardUsed` + effetto): non richiesto da M1 ma elimina il no-op
    incoerente di M0; un Event con effetti compilati ma senza timing `main`
    non è giocabile in Main Phase (10-2-3/10-2-4).
19. **Costi di attivazione M1**: `restDon` (①), `returnDonToDeck` (solo dal
    cost area attivo — il DON!!−X da leader/characters arriva in M2/M3) e
    `restSelf`. Costi che richiedono scelta di carte (trashFromHand, …) → M2:
    gli effetti che li portano non vengono offerti (8-3-1-3).
20. **Degradazione**: azioni fuori tier-1 → ChoiceRequest `manualResolve`
    (ack loggato come `manualResolved`); restriction oltre
    cannotAttack/cannotBlock memorizzate ma non applicate (M4); `draw upTo`
    pesca sempre il massimo (la scelta arriva in M2).
21. **[Once Per Turn]**: `oncePerTurnUsed["pid:iid:effectIndex"] = turn`,
    azzerato quando la carta lascia il campo (3-1-6, 10-2-13-4). Usato dalla
    coda; l'intent [Activate: Main] arriva in M2.
22. **Fuzz esteso** (non solo mantenuto verde): driver con
    block/trigger/counter-event/target/may; nuove invarianti — max UN blocker
    per battaglia (7-1-2-1, verificata sull'event log), coerenza
    battle.step↔pendingChoice↔exec, modifiers solo su carte in campo e
    thisBattle mai fuori battaglia, conservazione carte che tiene conto del
    limbo [Trigger]. Nuove sonde illegali per tutti i nuovi intent.

Debiti dichiarati per M2+: [Activate: Main] come intent, effetti
endOfYourTurn/endOfOpponentsTurn/endOfBattle (il cablaggio della coda c'è,
manca il punto di enqueue), DON!!−X da leader/characters, costi con scelta,
`draw upTo`, restriction M4, cannotBeKOd su koTarget.

## Fonti

- Comprehensive Rules v1.2.0 ufficiali (PDF Bandai, estratto in
  `docs/rules/op_comprehensive_rules_v1.2.0.txt`)
- Analisi pool: script su `public/data/cards.json` (2634 carte, 2026-07)
- Struttura battaglia/keyword cross-check: optcg.one, tcgprotectors.com,
  one-piece-tcg.com
