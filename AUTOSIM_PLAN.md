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
- ✅ **M2 — Compilazione tier-1** (2026-10-22, parte engine/dati — la UI
  ChoiceRequest vive in board-auto, fuori da questo passo) · pipeline AI su
  ST01+OP01 per: powerMod, KO, draw, rest/stand, discard, grantKeyword,
  restriction; UI ChoiceRequest.
  *Exit: ≥80% carte ST01/OP01 `compiled` e giocabili; golden al 100%.*
- ✅ **M3 — Tier-2 zone/risorse** (2026-10-24, su ST01+OP01; l'estensione ad
  altri set è un passo dedicato) · peek/search, play-from-zone, life manip,
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

**UI §7 — BoardAutoPage (2026-10-22) — completata** (view `board-auto`,
`src/features/board-auto/`). Scelte fatte dove il piano lasciava margine:
23. **Hotseat senza rotazione** della metà avversaria: seat A in basso, seat B
    in alto, entrambe le mani visibili e leggibili (user-friendliness >
    fedeltà DuelingBook; la board manuale resta ruotata). Metà tinte col
    colore del leader via `--lc` + color-mix.
24. **Compilazione carte in `features/board-auto/compile.ts`** (volutamente
    FUORI da `src/autosim`): dal completamento di M2 la fonte primaria è il
    batch ufficiale (`src/autosim/data/compiled` · `getCompiledCard`, oggi
    ST01+OP01); l'euristica sotto resta SOLO come fallback per i set non
    ancora compilati, marcata "FALLBACK" nelle notes:
    keyword innate solo se il tag apre una riga del testo ("gains [Rush]" non
    conta); `card.trigger` → effetto `trigger` con azione `manual`; Event
    `[Main]`/`[Counter]` → effetto `main`/`counter` con azione `manual`; tutto
    il resto resta vanilla (plan §1.3). Così blocker/trigger/counter-event
    REALI aprono le finestre giuste già oggi. Nessuna logica di regole in UI.
25. **Demo deck generati dal catalogo** (2 blocker ×4 + 2 [Counter] event ×4 +
    3 trigger char ×4 + riempitivo stesso set, 50 carte legali 5-1-2) così
    ogni finestra di battaglia è esercitabile; i mazzi di My Decks sono
    selezionabili e la legalità la verifica `createGame` (errore → banner
    spiegato, si torna alla scelta mazzi).
26. **Starting roll fuori dal motore** (come previsto: `GameConfig.firstPlayer`
    è "decided outside"): dadi UI, il vincitore sceglie first/second.
27. **Counter value a un tap**: applicato al target corrente della battaglia
    (counterare una carta fuori battaglia è legale ma inutile; meno tap).
28. **manualResolve = ack + testo carta**: niente "mosse libere" perché M1 non
    ha l'intent `manualAction` (il pannello lo dichiara e il log registra).
    Limite noto: un [Trigger] reale "play this card" degrada a manual+trash.
29. Il bottone contestuale unico (Don't block / End counters / Confirm) vive
    IN FLUSSO tra campo e mano (mai sopra DON o counter da tappare).
30. Dev hook `window.__auto` (solo `import.meta.env.DEV`) espone stato+eventi+
    legal per il driver Playwright `scripts/boardauto-shots.mjs`, che gioca una
    partita vera via UI, verifica ogni finestra e a fine run stampa QUALI
    effetti compilati sono partiti (cardId × timing). Il driver disattiva il
    websocket HMR nel proprio browser (altri agenti che salvano file non
    ricaricano la pagina a metà partita) e riusa la sessione via storageState
    (la login è rate-limited 10/10min).
31. **Trasparenza automazione (round UX 2026-10-24)**: un effetto che non parte
    non deve mai sembrare un silenzio rotto. `automationInfo(card)` deriva da
    batch/fallback: chip on-field "MANUAL" (si risolve col pannello manuale) e
    "NO-AUTO" (timing che il motore non esegue ancora: [Activate: Main],
    static/continui, start/end-of-turn… o testo di set non compilato), nota
    dettagliata nel pannello anteprima, e avviso nel deck picker per i set
    senza batch. I timing eseguibili oggi sono censiti in
    `ENGINE_RUNNABLE_TIMINGS` (compile.ts) — aggiornarli quando M3+ ne accende
    di nuovi. I demo deck preferiscono carte dei set compilati (i demo
    ST01/OP01 sono 100% automatizzati, gli altri dichiarano l'avviso).
32. **Segnaposto DON!! (tasto destro / long-press su touch)**: marcatore
    PURAMENTE visivo locale (tilt+dim+"HOLD") per dividersi i DON "come dal
    vivo" — nessun intent, stato motore intatto, reset al cambio turno, hint
    (banner tone "info", non rosso) alla prima attivazione.
33. **Chrome "compact" per telefono (2026-10-24)** — `boardauto-compact.css`
    + `COMPACT_QUERY` in BoardAutoPage (`(max-width:1024px) and
    (max-height:560px)` oppure portrait ≤820px). LANDSCAPE è il target
    primario: stessa geometria del tavolo (due metà specchiate) scalata
    dall'ALTEZZA (`--bacw: clamp(40px, 9.5vh, 72px)`), mani come strisce
    overlay top/bottom con scroll orizzontale, pill giocatore minime, barra
    azioni in basso a destra (End turn / Log / Card), anteprima e log come
    sheet a scomparsa (sinistra/destra), prompt di step ancorato in basso a
    destra sopra l'angolo pile (mai sopra una char row). Su touch la carta in
    mano si gioca in 2 tap (1° seleziona + apre lo sheet con "Play this
    card", 2° o il bottone gioca). Tap target ≥44px, safe-area. PORTRAIT:
    overlay "Rotate your phone" + "Continue anyway" → stesso DOM con metà
    impilate e scroll verticale (fallback minimale, mai rotto). Nessuna
    logica di gioco toccata; il desktop resta identico sopra la soglia.
    I chip (potenza/costo/DON) sono `pointer-events: none`: un chip di una
    carta rested intercettava i tap sulla vicina (bug trovato dal driver).
34. **UI M3 (2026-10-24)** — nuovi intent/finestre collegati nello stile
    legality-first: chip "ACTIVATE" sulle carte in `legalMoves.activatable`
    (tap → `activateMain`; su una carta con [Activate: Main] NON legale il tap
    spiega nel banner: già usata / condizioni o costo), con bottone gemello
    nello sheet compact; `peekSelect` → pannello "look at the top N" (carte
    viste in grande, eleggibili evidenziate, take ≤ N, resto ordinato con tap
    in sequenza, Top/Bottom per `topOrBottomAnyOrder`, shuffle/trash senza
    ordine — ordine vuoto = ordine corrente, come accetta il motore);
    `payDon` → stepper per cost area rested/active e per ogni carta con DON
    attaccati, Confirm solo a somma esatta, "Auto" = rested→active→attaccati;
    `chooseNumber` → bottoni min..max (default max). I `selectTargets` in
    fase di costo (`exec.running.costIndex < costs.length`) hanno titolo
    "Pay the cost: …". `ENGINE_RUNNABLE_TIMINGS` aggiornato (activateMain,
    end-of-turn/battle, onYou/OpponentActivatesEvent, onOpponentCharacterKOd);
    le 12 carte "static-only" del coverage-report (`compiledButDegradingTo
    Manual`) portano la nota "continuous effect not yet automatic (M4)".
    Log: righe per i 12 eventi tier-2.
35. **Landscape automatico da telefono (2026-10-24)** — l'overlay "Rotate
    your phone" è stato sostituito da una rotazione a due livelli. Livello 1
    (API, solo `pointer: coarse`, al gesto d'ingresso "To the starting roll"
    / Roll / Play first-second): `requestFullscreen()` +
    `screen.orientation.lock("landscape")` in try/catch silenzioso (iOS
    Safari non ha il lock); `unlock()` + `exitFullscreen()` allo smontaggio
    della GameScreen (Home / Change decks / Rematch). Livello 2 (CSS, vale
    sempre quando il viewport resta portrait su device compact): la root
    `.ba-game.compact.ba-forced` è `position: fixed`, 100dvh × 100dvw,
    `transform: rotate(90deg) translateY(-100%)` con origine top-left → copre
    esattamente il viewport portrait; i figli `position: fixed` (strisce,
    sheet, prompt, banner, modali) restano DENTRO il contenitore trasformato
    (containing block); `--bacw` e i limiti vw/vh passano a dvw/dvh;
    safe-area: notch (inset-top) → lato SINISTRO della board, inset-bottom →
    lato DESTRO. Le schermate pre-partita (pick, roll) restano portrait. Lo
    stack verticale resta come fallback interno (`.ba-stack`, non esposto).
    Il driver gioca partite complete sul tavolo ruotato (390×844, 412×915).
36. **QA bot (2026-10-25)** — `scripts/qa-bot.mjs` (`npm run qa:bot`):
    giocatore a mosse legali casuali con seed (ogni ChoiceRequest coperta),
    4 config di mazzi × 3 viewport, controlli per mossa (errori, rete/art,
    affordance↔legality con traccia del call-site dei banner di rifiuto,
    layout/occlusioni/tap target, coerenza motore↔UI, invarianti) + crawler
    del sito; report md/json con comando di riproduzione, exit≠0 su high.
    Bug trovati e fixati al primo giro: chip ACTIVATE sul centro carta
    (rubava il tap "attacca"), banner di rifiuto che bloccava i tap sulla
    mano in alto, DON rested ruotato che copriva il centro dell'ultimo DON
    attivo (dial impossibile; su compact anche celle sovrapposte →
    passo positivo e rested non ruotati), phase pill tagliata.
37. **Playtest round (2026-10-25)** — (a) turno a colpo d'occhio: metà del
    giocatore di turno con bordo 2px + tinta più forte nel colore leader,
    l'altra attenuata; pill/strip del turno tinte col leader; End turn con
    striscia del colore del turno; (b) micro-animazioni funzionali
    (transform/opacity, ≤250ms, niente con prefers-reduced-motion): Life
    presa → dorso che scivola dalla pila Life alla mano + flash rosso della
    metà colpita + "tick" del contatore; K.O. → fantasma della carta che
    scivola nel trash (200ms); le posizioni usano l'ultimo rect registrato
    prima del re-render; (c) **freccia nel tavolo ruotato**: i punti viewport
    sono convertiti nello spazio locale dell'overlay con
    `svg.getScreenCTM().inverse()` (include la rotazione CSS del `.ba-forced`)
    — l'SVG resta sempre montato come "oracolo" di coordinate, stesso
    convertitore per le animazioni; (d) freccia continua (4px, punta piena,
    colore leader attaccante), identica per il redirect del blocker; (e) **via
    il dial DON**: ogni tap seleziona/deseleziona SOLO quel DON (ring +
    "N DON!! selected", scorciatoia All, Cancel/tap altrove), poi tap su
    leader/char assegna i selezionati — il motore riceve N `giveDon`
    (DON fungibili); il segnaposto HOLD resta separato. Driver e QA bot
    aggiornati; nota in docs/oplay-analysis.md §6.
38. **Stage a risoluzione fissa (2026-10-26, decisione utente: "un gioco,
    non un sito responsivo")** — sostituisce #33/#35: un solo layout desktop
    disegnato a 1600×900 px virtuali, scalato al viewport con letterbox
    (`scale = min(vw/W, vh/H)`) e ruotato di 90° in portrait, nella stessa
    matrice (`translate · scale · rotate(90deg) · translateY(-H)`). Dentro
    lo stage niente media query né vw/vh; `--bacw` fissa (92px) per TUTTE
    le carte del tavolo (pile e DON compresi — i 10 DON condividono la cost
    area via stride dichiarato, rested attenuati e non ruotati). Il chrome
    dell'app (ThemeToggle) non viene renderizzato sulle board. PLAY in-place
    a 2 tap su ogni device; anteprima nel rail. Il QA bot verifica il
    contratto strutturale (stessa bbox per le carte del tavolo ±1px, nessuna
    intersezione fuori dagli stride, nessun chrome esterno sopra lo stage,
    scala uniforme X/Y e stage dentro il viewport) a 1440×900, 844×390,
    412×915 e 1024×768. Scala ~0.46 su telefono accettata.

**M2 (2026-10-22) — completata (compilazione ST01+OP01 + API dati; il
rimpiazzo del compile.ts euristico di board-auto è un passo successivo).**
Scelte fatte dove il piano lasciava margine:
31. **Artefatti dati**: `src/autosim/data/compiled/st01-op01.json` (tutte le
    138 carte ST01+OP01) + `coverage-report.json` (conteggi per set, carte
    compiled che degradano a manual e perché, motivi dei partial/unsupported)
    + API `getCompiledCard`/`allCompiledCards`/`coverage` in
    `data/compiled/index.ts`. Il report è asserito nei test contro un
    ricalcolo dal batch: non può driftare.
32. **Metrica dell'exit "≥80% compiled e giocabili"**: contano le
    classificazioni IR-complete `vanilla` + `keyword-only` + `compiled`
    (vanilla/keyword-only sono compilazioni complete degeneri). Risultato:
    **113/138 = 81.9%** (ST01 17/17 = 100%, OP01 96/121 = 79.3%).
    Strettamente `classification: "compiled"` sono 90: 37 girano interamente
    sull'esecutore tier-1 di M1, 53 usano azioni tier-2/3 già previste
    dall'IR (peekDeck, playFromZone, returnToHand/Deck, DON manip, ifThen,
    prev) che fino a M3 degradano a `manualResolve` — giocabili, mai
    bloccanti (§1.3). Dettaglio carta per carta nel report.
33. **Estensioni IR minime** per fedeltà al testo (types+schema+validate in
    sync): `filter.nameExcludes` ("other than [Name]"), `Selector.prev`
    ("that card" — binding alla selezione precedente, manual fino a M3),
    azione `returnToDeck` (top|bottom), costo `lifeToHand` ("add 1 card from
    your Life area to your hand:"), disposizione peek `topOrBottomAnyOrder`.
    Convenzioni documentate: `count: 99` = "all" (auto-selezione, nessuna
    choice); ricerca sull'intero mazzo = `peekDeck 50 + shuffle`;
    "[Trigger] Activate this card's [Main]/[Counter] effect" = stesse azioni
    duplicate sotto timing `trigger`; le clausole "If X" dopo i due punti
    compilate come `conditions` (approssimazione di 8-3-3, annotata per
    carta: leggermente più stretta, il costo non si può pagare a vuoto).
34. **Mai inventare semantica** (il testo vince, 1-3-1): pattern non
    esprimibili → `partial`/`unsupported` con nota e confidence ≤0.7 (triage
    §6.5). Cause reali su OP01: amount scalari ("+1000 per ogni…"), stand dei
    DON ("set DON as active"), timing mancanti ("when your opponent activates
    an Event", "when your opponent's Character is K.O.'d"), reveal della mano
    avversaria, costi non modellati (rest 2 Characters, return a Character,
    hand→bottom deck), permessi d'attacco ("can also attack active
    Characters"), taunt di Kid (OP01-051), name-treatment (OP01-121),
    override di costruzione mazzo (OP01-075). Gli effetti con timing chiaro
    restano nel JSON come azioni `manual` → prompt in partita.
35. **Dry-run §6c**: ogni effetto non-static di ogni carta è istanziato in
    una partita sintetica e pompato dall'engine con risposte automatiche alle
    ChoiceRequest (i trigger passano dal percorso reale `triggerActivated`,
    10-1-5-3); gli static sono effetti continui (8-1-3-3, fixpoint in M4) e
    non si pompano. Fix contestuale: `legalMoves` ora filtra gli eventi
    [Main] con costo non pagabile (specchia il check 8-3-1-3 di playCard).
    In più: partite complete seedate con mazzi REALI (mirror ST01, OP01 rosso
    vs verde) giocate dal driver random fino alla vittoria.
36. **Golden set**: +22 carte REALI ST01/OP01 verificate a mano contro il
    testo (tutte le keyword, counter event a doppia azione, trigger "play
    this card", restriction untilEndOfOpponentsNextTurn, DON!!−6 board wipe,
    discard scelto dall'avversario, dual-timing WA/OnBlock, static
    DoubleAttack condizionale…). Il test fa il diff strutturale golden ↔
    output del batch (§6.4) — al 100%.

Debiti M3 (dettagliati nel coverage report): esecutore tier-2
(peekDeck/search, playFromZone, returnToHand, returnToDeck,
addFromTrashToHand, giveRestedDon, placeDonInCostArea, lifeToHand), costi con
scelta di carte (trashFromHand/lifeToHand) con pausa di pagamento, binding
`prev`, intent [Activate: Main], DON!!−X da leader/characters, condizione
"N DON on field", azione "stand DON".

**M3 (2026-10-24) — completata (esecutore tier-2 + [Activate: Main] +
ricompilazione ST01+OP01 al 94.2% IR-complete).** Scelte fatte:
37. **Fase costi nel pump** (8-3-1-1): `RunningEffect` ora porta snapshot
    JSON di `costs` e `actions` (così `ifThen` splice-a il ramo inline e le
    pause riprendono a metà item); `effectActivated` è emesso PRIMA del
    pagamento (10-2-13-5: l'[Once Per Turn] conta come usato all'attivazione).
    Costi con scelta: trashFromHand/returnToHand/restFromField/handToDeckBottom
    → `selectTargets`; DON!!−X → `payDon` quando esistono DON attaccati
    (composizione da leader/characters/cost area, 8-3-1-6), altrimenti
    auto-composizione rested-first (mai peggiorativa). `lifeToHand`/
    `trashFromLife` pagano dalla CIMA della Life (3-10, area segreta:
    nessuna ispezione).
38. **Finestra peek/search**: `peekSelect` (carte viste, eleggibili filtrate,
    take fino a N, resto ordinato top/bottom/misto o shuffle/trash come da
    disposition; `playRested` per OP01-060, carta non giocata torna in cima
    11-2-2); risposta `respondPeek {take, restTop, restBottom}` validata come
    partizione. Ricerche "dall'intero mazzo" = peek 50 + shuffle (conv. M2).
    Le carte giocate da peek/playFromZone innescano i loro [On Play] (10-2-6)
    e hanno summoning sickness (3-7-4); con area piena l'effetto gioca ciò
    che può (8-1-2, niente replace-by-rule per le giocate da effetto).
39. **[Activate: Main] come intent** (10-2-2, 6-5-4): validazione = finestra
    main, carta sul proprio campo, timing giusto, condizioni 8-4-1-1, costo
    pagabile 8-3-1-3, [Once Per Turn] libero; `legalMoves.activatable` è lo
    specchio esatto. ST01-001 end-to-end nel test di exit.
40. **End Phase e fine battaglia agganciati alla coda**: `endTurn` →
    [End of Your Turn] (TP) poi [End of Your Opponent's Turn] (NTP) via
    ordering 8-6-1 (6-6-1-1/2), POI scadenze e passaggio di turno (flow
    `toEndTurn`); fine battaglia → effetti 7-1-5-2 drenati prima di
    battleEnded/scadenze thisBattle (flow `toBattleCleanup`). `startTurn` è
    migrato in battle.ts per permettere la ripresa del flusso.
41. **Binding `prev` reale**: `RunningEffect.lastTargets` ricorda i target
    dell'ultima azione con selettore; `sel.prev` li riusa (filtrati a chi è
    ancora in campo, 8-1-2) senza ri-selezione. `ifThen` eseguito inline;
    `draw upTo` → finestra `chooseNumber` (8-4-4-1 ammette 0).
42. **Nuove timing/condizioni/costi IR** (types+schema+validate in sync):
    timing `onYouActivateEvent` / `onOpponentActivatesEvent` (8-5-2, enqueue
    a ogni attivazione di Event, risolti dopo l'effetto della carta 8.6.3) e
    `onOpponentCharacterKOd` (enqueue a ogni K.O.); condizioni `donOnField`
    (cost area + attaccati) e `selfRested`; costi `handToDeckBottom`,
    `returnToHand`, `restFromField`; azione `standDon` (sempre max: non
    conviene mai stare sotto); restriction `cannotBeKOdInBattle` (battle-only,
    distinta da cannotBeKOd 10-2-1-3, applicata nel damage step) e permission
    `canAttackActiveCharacters` (7-1-1-2 allargata in declareAttack/legality).
    `costMod` ora applicato: `effectiveCost` (base+mod, floor 0) usato da
    playCard/legality/counter-event.
43. **Ricompilazione ST01+OP01**: 17 carte da partial/unsupported a compiled
    → **130/138 = 94.2% IR-complete** (ST01 100%, OP01 93.4%); 95 compiled su
    107 interamente auto-eseguibili, 12 degradano SOLO per effetti static
    (fixpoint M4). Restano 8 non compilate con motivo (chaining di colore
    OP01-002, immunità per attributo 024, reveal mano avversaria 063/105,
    amount scalari 072/083, override costruzione 075, name-treatment 121).
    Report rigenerato con la metrica "fullyAutoExecutable" (asserito nei test
    contro il ricalcolo). Golden +5 carte reali activate/search (ST01-001,
    OP01-030, OP01-041, OP01-055, OP01-112) → 43 entry, diff al 100%.
44. **Batch ST02-ST06 rimandato** a un passo dedicato: altre ~85 carte da
    compilare e verificare a mano contro il testo; l'exit M3 richiedeva
    ST01+OP01 e il vocabolario/esecutore ora copre i pattern necessari
    (stesso §6 a 3 livelli quando si farà).

Debiti M4+: effetti `static` a fixpoint (8-1-3-3-5) — unica causa di
degrado rimasta tra i compiled —, replacement/negate (8-1-3-4, 8-2),
setBasePower/redirectAttack/endBattle/addToLife/chooseOne, reveal della mano
avversaria, amount scalari ("+X per ogni ..."), peek del mazzo avversario,
[Once Per Turn] edge 10-2-13-5 con pagamento interrotto a metà (oggi il
pagamento non può fallire a metà: validato prima).

## Fonti

- Comprehensive Rules v1.2.0 ufficiali (PDF Bandai, estratto in
  `docs/rules/op_comprehensive_rules_v1.2.0.txt`)
- Analisi pool: script su `public/data/cards.json` (2634 carte, 2026-07)
- Struttura battaglia/keyword cross-check: optcg.one, tcgprotectors.com,
  one-piece-tcg.com
