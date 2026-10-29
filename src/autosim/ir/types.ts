/**
 * AUTOSIM Effect IR — the card-effect classification (AUTOSIM_PLAN.md §5).
 *
 * Every card compiles into a `CompiledCard`: a JSON-serializable description
 * of its effects as timing × conditions × cost × actions × selectors.
 * The AI compilation pipeline (plan §6) emits these; `validate.ts` checks them
 * against `schema.json` plus semantic lint rules; the engine executes them
 * (Action execution lands in M2 — M0 only defines and validates the IR).
 *
 * Everything here must stay JSON-serializable (no functions, no classes).
 */

export type Keyword =
  | "Rush"            // 10-1-1
  | "DoubleAttack"    // 10-1-2
  | "Banish"          // 10-1-3
  | "Blocker"         // 10-1-4
  | "RushCharacter"   // 10-1-6 [Rush: Character]
  | "Unblockable";    // 10-1-7

/** When an effect activates (comprehensive rules 8-1-3, 10-2). */
export type Timing =
  | "onPlay"                  // 10-2-6
  | "whenAttacking"           // 10-2-5
  | "onKO"                    // 10-2-17
  | "onBlock"                 // 10-2-15
  | "counter"                 // 10-2-4 (Event [Counter])
  | "trigger"                 // 10-1-5 ([Trigger] from Life)
  | "activateMain"            // 10-2-2
  | "main"                    // 10-2-3 (Event [Main])
  | "endOfYourTurn"           // 10-2-7
  | "endOfOpponentsTurn"      // 10-2-8
  | "startOfYourTurn"         // 6-2-2
  | "startOfOpponentsTurn"    // 6-2-2
  | "onYourOpponentsAttack"   // 10-2-16
  | "whenAttacked"            // 7-1-3-1
  | "endOfBattle"             // 7-1-5-2
  | "onYouActivateEvent"      // "when you activate an Event" (8-5-2, M3)
  | "onOpponentActivatesEvent" // "when your opponent activates an Event" (M3)
  | "onOpponentCharacterKOd"  // "when your opponent's Character is K.O.'d" (M3)
  | "delayed"                 // M5: run only when scheduled ("… at the end of this turn")
  // M5 — event timings ("When …"), filtered by Effect.react
  | "onYourDonReturned"       // "When DON!! on your field are returned to your DON!! deck"
  | "onKOByEffect"            // "When this Character is K.O.'d by (your opponent's) effect"
  | "onRested"                // "When this Character becomes rested"
  | "onDealDamage"            // "When this card's attack deals damage to your opponent's Life"
  | "onLifeZero"              // "When your number of Life cards becomes 0"
  // M5 — watching other cards (react.whose / react.filter / react.by)
  | "onCharacterKOd"          // "When your / a Character is K.O.'d"
  | "onCharacterRemoved"      // "When your Character is removed from the field by an effect"
  | "onCharacterRestedBy"     // "If a Character is rested by your effect"
  | "onYouPlayCharacter"      // "When you play a Character"
  | "onHandTrashed"           // "When a card is trashed from your hand by an effect"
  | "onLeaderAttacks"         // M5: "When your Leader attacks"
  | "onLeaderAttacked"        // M5: "When your Leader is attacked"
  | "onTakeDamage"            // M5: "When you take damage"
  | "onLifeRemoved"           // M5: "When a card is removed from your or your opponent's Life cards"
  | "onOpponentBlocks"        // M5: "When your opponent activates [Blocker]"
  | "afterBattleWithCharacter" // M5: "At the end of a battle in which this Character battles your opponent's Character"
  | "onDonGiven"              // M5: "When this Leader or any of your Characters is given a DON!! card"
  | "onDrawOutsideDrawPhase"  // M5: "When you draw a card outside of your Draw Phase"
  | "onLifeToHand"            // M5: "When a card is added to your hand from your Life"
  | "onYouDealDamage"         // M5: "When you deal damage to your opponent's Life" (any of your cards / effects)
  | "onTriggerActivated"      // M5: "When a [Trigger] activates" (react.whose narrows it)
  | "onKOInBattle"            // M5: "When this Character battles and K.O.'s your opponent's Character"
  | "onDonPhase"              // M5: after the DON!! cards of your DON!! Phase are placed
  | "onCharacterBounced"      // M5: "When your opponent's Character is returned to the owner's hand by your effect"
  | "onBattlesCharacter"      // M5: "When this Character battles … Characters" (subject = the other Character)
  | "replacement"             // M5: "If … would be K.O.'d / removed …, you may [cost] instead" (8-1-3-4)
  | "static";                 // permanent effects (8-1-3-3)

export type Duration =
  | "instant"
  | "thisBattle"                  // expires 7-1-5-3/4
  | "thisTurn"                    // expires 6-6-1-3
  | "untilStartOfYourNextTurn"    // expires 6-2-1
  | "untilEndOfOpponentsNextTurn"
  | "untilOwnersNextRefresh"      // consumed by the target owner's next Refresh Phase (6-2-4, M5)
  | "permanentWhileInPlay";

export type Who = "self" | "opponent" | "both";

export interface SelectorFilter {
  typeIncludes?: string[];    // {Type} braces (2-4-3)
  nameIncludes?: string[];    // [Name] / "partial" (2-1-2)
  nameExcludes?: string[];    // "other than [Name]" (M2; 2-1-2)
  colors?: string[];
  category?: ("Leader" | "Character" | "Event" | "Stage")[];
  costAtMost?: number;
  costAtLeast?: number;
  powerAtMost?: number;
  powerAtLeast?: number;
  rested?: boolean;
  hasKeyword?: Keyword;
  /** M5: "without [Blocker]" */
  lacksKeyword?: Keyword;
  excludeSelf?: boolean;
  // ── M5 (2026-10-28) ──
  /** none of these types ("you only have {X} type Characters" = no non-X). */
  typeExcludes?: string[];
  /** attributes (2-6): Strike, Slash, Ranged, Special, Wisdom. */
  attributes?: string[];
  /** number of colors on the card (2-3; "multicolored" = at least 2). */
  colorCountAtLeast?: number;
  colorCountAtMost?: number;
  /** PRINTED cost / power ("base cost", "base power", 4-9), unlike
   *  costAtMost/powerAtMost which read the current value on the field. */
  baseCostAtMost?: number;
  baseCostAtLeast?: number;
  basePowerAtMost?: number;
  basePowerAtLeast?: number;
  /** the card has a [Trigger] (10-1-5). */
  hasTrigger?: boolean;
  /** M5: "without the <Special> attribute" */
  attributesExclude?: string[];
  /** M5: "the other" — not one of the previous action's targets */
  notPrev?: boolean;
  /** M5: "the same card name as the trashed card" — the previous target's name */
  sameNameAsPrev?: boolean;
  /** M5: "a cost equal to the number of DON!! cards given to it" */
  costEqualsGivenDon?: boolean;
  /** "a different color than the returned Character" (M5): shares no color with the previous target */
  otherColorThanPrev?: boolean;
  /** the printed counter: "without a Counter" = "none" (M5) */
  counter?: "none" | "some";
  /** the card was played this turn (entered the area on the current turn). */
  playedThisTurn?: boolean;
  /** a Life card that is face-up / face-down (M5). */
  faceUp?: boolean;
  /** cost ≤ a number read from the state ("equal to or less than the number
   *  of your opponent's Life cards", M5). */
  costAtMostQ?: Quantity;
  /** at least N DON!! given to it (M5). */
  donGivenAtLeast?: number;
  /** the card has no printed effect ("no base effect", M5). */
  noBaseEffect?: boolean;
  /** the card has / has no effect of this timing ("without an [On Play]
   *  effect", "an Event with a [Main] effect", M5). */
  hasTiming?: Timing;
  lacksTiming?: Timing;
  /** base-power filters read the PRINTED value (set by the engine for "base
   *  power becomes N" statics, so they don't feed back on themselves; M5) */
  printedBase?: boolean;
  /** "… or [Name] / or Event card": a card matching THIS filter matches too
   *  (M5; NameOverrides / ColoredEventOverrides). */
  or?: SelectorFilter;
}

export interface Selector {
  owner: "self" | "opponent" | "any";
  zone:
    | "characterArea" | "leader" | "leaderOrCharacter" | "stage"
    | "hand" | "trash" | "deckTop" | "costArea" | "life"
    // M5: "your Leader or Stage", "your Characters or Stage", "your cards" on the field
    | "leaderOrStage" | "characterOrStage" | "field"
    // M5: "the top card of your Life cards" (a revealed Life card)
    | "lifeTop";
  filter?: SelectorFilter;
  count: number;              // convention: 99 = "all" (auto-selected, no choice)
  upTo?: boolean;             // 4-8: may choose 0..count
  self?: boolean;             // the compiled card itself
  /** "that card": the card(s) chosen by the PREVIOUS action of this effect
   *  (M2 — compilation only; the executor degrades it to manualResolve
   *  until selection-binding lands in M3). */
  prev?: boolean;
  chooser: "controller" | "opponent";
  /** M5 — constraints on the chosen SET: "with a total cost / power of N or
   *  less", "with different card names". */
  totalCostAtMost?: number;
  totalPowerAtMost?: number;
  distinctNames?: boolean;
}

/** Activation costs (before the `:` colon — 8-3-1). */
export type CostItem =
  | { kind: "restDon"; count: number }          // ① symbols (8-3-1-5)
  | { kind: "returnDonToDeck"; count: number }  // DON!! −X (8-3-1-6, 10-2-10)
  | { kind: "restSelf" }
  | { kind: "trashFromHand"; sel: Selector }
  | { kind: "trashSelf" }
  | { kind: "trashFromLife"; count: number; bottom?: boolean }
  | { kind: "lifeToHand"; count: number; bottom?: boolean }   // "add N card(s) from your Life to your hand:" (M2; M5: from the bottom)
  | { kind: "handToDeckBottom"; count: number }   // "place N card(s) from your hand at the bottom of your deck:" (M3)
  | { kind: "returnToHand"; sel: Selector }       // "return N Character(s) to your hand:" (M3)
  | { kind: "restFromField"; sel: Selector }      // "rest N of your Characters:" (M3)
  /** Any other cost (M5): paid by performing `action` in full — every
   *  target required, never "up to" (8-3-1-3: unpayable → can't activate).
   *  E.g. "K.O. 1 of your Characters:", "place 3 cards from your trash at the
   *  bottom of your deck:", "reveal 1 card from your hand:", "trash 1 card
   *  from the top of your deck:", "give your Leader −5000 power:". */
  | { kind: "action"; action: Action }
  /** "trash 1 card from your hand or rest 1 of your DON!!:" — the payer picks
   *  one payable option (M5). */
  | { kind: "oneOf"; options: CostItem[][]; labels?: string[] };

/** Conditions ([DON!!xX], [Your Turn], … — 8-3-2). */
export type Condition =
  | { kind: "donAttached"; count: number }          // [DON!! xX] (10-2-9)
  | { kind: "yourTurn" }                            // 10-2-11
  | { kind: "opponentsTurn" }                       // 10-2-12
  | { kind: "leaderIs"; filter: SelectorFilter }
  | { kind: "countInZone"; sel: Selector; atLeast?: number; atMost?: number }
  | { kind: "lifeAtMost"; who: Who; count: number }
  | { kind: "lifeAtLeast"; who: Who; count: number }
  | { kind: "handAtMost"; who: Who; count: number }
  | { kind: "handAtLeast"; who: Who; count: number }
  | { kind: "donOnField"; who: Who; atLeast: number }  // "N or more DON!! on your field" (cost area + given, M3)
  | { kind: "selfRested" }                             // "if this Character is rested" (M3)
  // ── M5 (2026-10-28): general forms instead of one kind per wording ──
  /** "if you have less Life than your opponent", "if the number of DON!! on
   *  your field is equal to or less than …", "5 or less combined Life"… */
  | { kind: "compare"; left: Quantity; op: CompareOp; right: Quantity | number }
  /** any one of the conditions holds ("a cost 0 Character or one of cost 8+"). */
  | { kind: "anyOf"; conditions: Condition[] }
  /** every one of the conditions holds (M5: "if you have [A] and [B] Characters with 6000 base power") */
  | { kind: "allOf"; conditions: Condition[] }
  /** "When this Leader attacks your opponent's Leader" (M5): this card's attack targets the Leader */
  | { kind: "attackingLeader" }
  /** "If you do," after a K.O. of "that Character" (M5): the previous targets are in their owners' trash now */
  | { kind: "prevInTrash" }
  /** "If the revealed card is an Event" (M5): the previous targets match */
  | { kind: "prevMatches"; filter: SelectorFilter }
  /** "If that Character has the <Slash> attribute" (M5): the attacking card of the current battle */
  | { kind: "attackerMatches"; filter: SelectorFilter }
  /** "If the revealed card has a cost of 2 or less" (M5): the top card of the deck */
  | { kind: "deckTopMatches"; who: Who; filter: SelectorFilter }
  /** this card matches the filter ("if this Character has 7000 power or more",
   *  "if this Character was played this turn"). */
  | { kind: "selfMatches"; filter: SelectorFilter }
  /** "from your Nth turn on" — the controller's own turn count (6-1). */
  | { kind: "ownTurnAtLeast"; count: number }
  /** the top Life card exists and is face-up / face-down (M5) */
  | { kind: "lifeTop"; who: Who; faceUp: boolean }
  /** "If you do," after an "up to" action (M5): it picked at least 1 card */
  | { kind: "hadTargets" }
  /** "If the revealed card has the chosen cost" (M5): the top card of the
   *  deck has the cost named by this effect's declareCost */
  | { kind: "deckTopCostDeclared"; who: Who }
  /** "If you have activated an Event with a base cost of N or more during this turn" (M5) */
  | { kind: "activatedEventThisTurn"; minBaseCost: number }
  /** "If the trashed card has a cost of 6 or more" (M5): a card the last mill of this effect trashed matches */
  | { kind: "milledMatches"; filter: SelectorFilter }
  /** "During the turn in which a card in your hand is trashed by an effect", "If your opponent's Character has been K.O.'d during this turn" (M5) */
  | { kind: "happenedThisTurn"; who: Who; what: "handTrashed" | "characterKOd" | "leaderBattledCharacter" };

export type CompareOp = "lt" | "le" | "eq" | "ge" | "gt";

/** A number read from the game state, for `compare`. `who: "both"` sums
 *  the two players. `plus` shifts it ("at least 2 less than …"). */
export interface Quantity {
  count: "life" | "hand" | "deck" | "trash" | "trashEvents" | "characters" | "donOnField" | "donGiven"
    | "donActive" | "donRested" | "restedCards"
    | "distinctNames" // M5: different card names among the Characters
    | "lifeTopCost"  // M5: the cost of the top Life card ("per 1 cost on the revealed card")
    | "lifeAndHand"  // M5: "a total of N or less cards in your Life area and hand"
    | "charactersTotalCost"; // M5: "the total cost of your Characters"
  who: Who;
  plus?: number;
}

/** What to do with cards seen by a deck peek. */
export interface PeekDisposition {
  reveal?: boolean;
  addToHand?: Selector["filter"];   // add up to N matching (search)
  addCount?: number;
  play?: Selector["filter"];        // play matching from among them
  playCount?: number;
  playRested?: boolean;             // "you may play that card rested" (M3)
  toLife?: Selector["filter"];      // "add up to N to the top of your Life" (M5)
  lifeCount?: number;
  lifeFaceUp?: boolean;
  trash?: Selector["filter"];       // "trash up to N cards" among them (M5)
  trashCount?: number;
  rest: "topAnyOrder" | "bottomAnyOrder" | "topOrBottomAnyOrder" | "shuffle" | "trash";
}

export type Action =
  // ── Tier 1 — core (majority of the pool) ──────────────────────────────────
  | { kind: "powerMod"; sel: Selector; amount: number; duration: Duration;
      /** M5: amount × the number of cards the previous action affected ("for every card trashed") */
      perPrevTarget?: boolean;
      /** M5: amount × the DON!! given to each target ("for every DON!! card given to that Character") */
      perGivenDon?: boolean;
      /** M5: with perPrevTarget — "for every 3 cards placed": per this many */
      perPrevEvery?: number;
      /** M5: "set the power of … to 0": the amount is minus the target's power now */
      toZero?: boolean;
      /** M5 (static): amount × ⌊quantity / per⌋ ("+1000 for every 2 Events in your trash") */
      scale?: { q: Quantity; per: number } }
  | { kind: "koTarget"; sel: Selector }                       // 10-2-1
  | { kind: "draw"; count: number; upTo?: boolean; who?: "opponent"; countFromPrev?: boolean } // 4-5 (M5: "your opponent draws N", "draw as many")
  | { kind: "restTarget"; sel: Selector }
  | { kind: "standTarget"; sel: Selector }
  | { kind: "discard"; who: Who; sel: Selector; keepInHand?: number; countFromPrev?: boolean } // trash from hand (10-2-14); M5: "until you have N cards in your hand", "the same number"
  | { kind: "grantKeyword"; sel: Selector; keyword: Keyword; duration: Duration }
  | { kind: "restriction"; sel: Selector;
      what: "cannotAttack" | "cannotBeKOd" | "cannotBeKOdInBattle" | "cannotBlock"
          | "cannotBeAttacked" | "mustAttackIfAble" | "canAttackActiveCharacters"
          | "onlyAttackTarget"  // M5: "your opponent cannot attack any card other than [this Character]"
          | "skipNextRefresh"  // "will not become active in the next Refresh Phase" (M5)
          | "cannotBeRested"  // M5
          | "cannotPlayCharacters"  // M5: on your Leader; `amount` = lowest locked base cost (0 = all)
          | "cannotBeKOdByOpponent" | "cannotBeRemovedByOpponent" | "cannotBeRestedByOpponent"  // M5
          | "cannotTakeLifeByOwnEffects"  // M5
          | "cannotDrawByOwnEffects"  // M5: on your Leader — "you cannot draw cards using your own effects"
          | "cannotStandDonByCharacters"  // M5: on your Leader — "you cannot set DON!! cards as active using Character effects"
          | "noBlockers"  // M5: on the Leader — "your opponent cannot activate [Blocker] during this turn"
          | "cannotAttackLeaders"  // M5: "This Character cannot attack a Leader (on the turn in which it is played)"
          | "noLeaderAttacks"  // M5: on your Leader — "you cannot attack a Leader during this turn"
          | "noRefresh"  // M5: "do not become active in your and your opponent's Refresh Phases" (static)
          | "charactersPlayedRested"  // M5: on your Leader — "Your Character cards are played rested"
          | "cannotPlayFromHand"  // M5: on your Leader — "you cannot play cards from your hand during this turn"
          | "onPlaysNegated"  // M5: on a Leader — "Your [On Play] effects are negated"
          | "cannotBePlayedByEffects"  // M5: "This card in your hand cannot be played by effects"
          | "cannotBeKOdByEffectsOf"  // M5: "cannot be K.O.'d by effects of (your opponent's) Characters …" (sourceFilter)
          | "cannotAttackCharactersBaseCostAtMost"
          | "toDeckBottomAtEndOfBattle"
          | "faceUpLifeToDeck"
          | "gainsAttribute"  // M5: "gains the <Slash> attribute" (attributes)
          | "restDonAtMainStart"
          | "grantsReplacement"
          | "attackTaxDiscard";  // M5: "cannot attack unless your opponent trashes N cards from their hand whenever they attack" (amount)  // M5: on your Leader — the source card's replacement effect #amount works for this duration ("during this turn, … instead")  // M5: on a Leader — "rests 1 of their active DON!! cards at the start of their next Main Phase" (amount)  // M5: "Your face-up Life cards are placed at the bottom of your deck instead of being added to your hand"  // M5: "at the end of this battle, place this Character at the bottom of the owner's deck"  // M5: "cannot attack your opponent's Characters with a base cost of N or less" (amount): on your Leader — "you cannot add Life cards to your hand using your own effects"
      duration: Duration; amount?: number;
      /** cannotBeKOdInBattle: only against these attacker attributes (M5) */
      attributes?: string[]; attackerCharactersOnly?: boolean; attackerLeadersOnly?: boolean;
      /** cannotBeKOdInBattle: not against attackers with one of these attributes ("by Characters without <Special>", M5) */
      exceptAttributes?: string[];
      /** cannotBeKOdByEffectsOf: the card whose effect it is; sourceOpponentOnly = only the opponent's cards (M5) */
      sourceFilter?: SelectorFilter; sourceOpponentOnly?: boolean }
  // ── Tier 2 — zones & resources ────────────────────────────────────────────
  | { kind: "returnToHand"; sel: Selector }
  | { kind: "returnToDeck"; sel: Selector; where: "top" | "bottom" }  // "place ... at the top/bottom of the owner's deck" (M2); from the field, hand or trash (M5)
  | { kind: "trashTarget"; sel: Selector }                    // field → trash, not a K.O. (M5)
  | { kind: "restDon"; who: Who; count: number; upTo?: boolean } // "rest up to N of your (opponent's) DON!!" (M5); upTo = "any number"
  | { kind: "lifeTopToBottom"; who: Who }                    // "place the top Life card at the bottom" (M5)
  | { kind: "peekLife"; who: Who }                           // "look at the top Life card" (M5; log only)
  | { kind: "scheduleEndOfTurn"; effectIndex: number; actions?: Action[]; aboutPrev?: boolean } // "… at the end of this turn" (M5: queues this card's `delayed` effect #effectIndex in this turn's End Phase; `actions` = compiler input, folded into a delayed effect)
  | { kind: "select"; sel: Selector }                         // "Select up to 1 …": choose now, "the selected card" later (M5)
  | { kind: "reveal"; sel: Selector }                         // "reveal N cards from your hand" (M5; no movement)
  | { kind: "giveActiveDon"; sel: Selector; count: number }   // "give N active DON!! to …" (M5)
  | { kind: "playFromZone"; zone: "hand" | "trash" | "revealed" | "life"; sel: Selector;
      free?: boolean; rested?: boolean }
  | { kind: "peekDeck"; who: Who; count: number; then: PeekDisposition }
  | { kind: "mill"; who: Who; count: number; countFromPrev?: boolean } // M5: "the same number of cards as you did from your hand"
  | { kind: "addFromTrashToHand"; sel: Selector }
  | { kind: "lifeToHand"; who: Who; count: number; bottom?: boolean }
  | { kind: "trashLife"; who: Who; count: number; untilLeft?: number; faceUpOnly?: boolean } // M5: "until you have N Life cards", "all your face-up Life cards"
  | { kind: "addToLife"; sel: Selector; faceUp?: boolean; bottom?: boolean }  // M5: from deckTop / field / hand
  | { kind: "flipLife"; who: Who; count: number; faceUp: boolean; bottom?: boolean }  // "turn N card(s) from the top of your Life face-up/-down" (M5; 99 = all)
  | { kind: "giveRestedDon"; sel: Selector; count: number }   // from cost area
  | { kind: "attachDonFromDeck"; sel: Selector; count: number; rested?: boolean }
  | { kind: "placeDonInCostArea"; count: number; rested?: boolean; upTo?: boolean } // M5: upTo — "add up to N DON!!" (the player picks how many)
  | { kind: "returnDonToDeck"; who: Who; count: number; activeOnly?: boolean
      /** M5: "until you have the same number of DON!! cards on your field as your opponent" */
      downToOpponent?: boolean }
  | { kind: "standDon"; count: number; upTo?: boolean } // "set up to N of your DON!! as active" (M3; M5: upTo — the player picks how many)
  | { kind: "costMod"; sel: Selector; amount: number; duration: Duration; scale?: { q: Quantity; per: number } }
  /** "the counter of … in your hand becomes +N" / "have a +N Counter" (M5, static) */
  | { kind: "setCounter"; sel: Selector; amount: number; duration: Duration }
  | { kind: "setBasePower"; sel: Selector; amount: number; duration: Duration
      /** "becomes the same as the selected Character's / your opponent's
       *  Leader's power" (M5): the power of the previous action's target */
      amountFromPrev?: boolean;
      /** M5: "becomes the same as your Leader's base power" (the printed one) */
      fromLeaderBase?: boolean;
      /** M5: "becomes the same as the power of your opponent's attacking Leader or Character" */
      fromAttackerPower?: boolean } // 4-9
  // ── Tier 3 — control & meta ───────────────────────────────────────────────
  | { kind: "negateEffect"; sel: Selector; scope: string; duration: Duration }
  | { kind: "redirectAttack"; sel: Selector }
  | { kind: "endBattle" }
  | { kind: "ifThen"; if: Condition[]; then: Action[]; else?: Action[] }  // 4-10
  | { kind: "chooseOne"; options: Action[][]; labels?: string[]; chooser?: "opponent";
      /** M5: options offered only when their first action can be done in full
       *  ("Your opponent may trash 1 Life card. If they do not, …") */
      payable?: boolean[] }  // "Choose one:" (M5: the controller picks; "Your opponent chooses one:")
  /** "Then, you may [cost]. If you do, [then]" (M5): offered only when the
   *  cost can be paid in full; paying it runs `then`, declining skips it. */
  | { kind: "mayPay"; cost: CostItem[]; then: Action[]; label?: string }
  | { kind: "declareCost" }   // "Choose a cost" (M5): the controller names 0–10; read by deckTopCostDeclared
  /** "Look at all of your (opponent's) Life cards and place them back in any
   *  order" — optionally "place N at the top of your deck" first (M5) */
  | { kind: "arrangeLife"; who: Who; toDeckTop?: number }
  /** "Activate up to 1 … Event from your hand / trash" (M5): its [Main]
   *  effect resolves now (conditions and cost as when played, 8-4-1), the
   *  card goes to the trash */
  | { kind: "activateEvent"; sel: Selector }
  | { kind: "winGame" }   // "you win the game" (M5)
  | { kind: "freezeDon"; who: Who; count: number }
  /** "return N total of your currently given DON!! cards to your cost area rested" (M5; taken in field order) */
  | { kind: "ungiveDon"; count: number }
  /** "Swap the base power of the selected Characters with each other" (M5): 2 targets */
  | { kind: "swapBasePower"; sel: Selector; duration: Duration; withLeader?: boolean } // M5: withLeader — "Select your Leader and 1 Character"
  /** "Give up to N of your currently given DON!! cards to 1 of your Characters" (M5):
   *  moved from the previous targets (the cards holding them) to `sel` */
  | { kind: "moveGivenDon"; sel: Selector; count: number }   // "up to N rested DON!! will not become active in the next Refresh Phase" (M5)
  /** "deal N damage to your opponent" (M5): as battle damage — Life to the
   *  hand, [Trigger]s offered, damage at 0 Life loses (9-2-1-1) */
  | { kind: "dealDamage"; who: Who; count: number }
  | { kind: "takeExtraTurn" }   // "take an extra turn after this one" (M5)
  /** "The next time you play [X] … from your hand during this turn, the cost
   *  will be reduced by N" (M5) */
  | { kind: "nextPlayDiscount"; filter: SelectorFilter; amount: number }
  | { kind: "shuffleDeck"; who: Who }                        // "shuffle your deck" (M5)
  /** "return all cards in your hand to your deck and shuffle it; then draw
   *  as many" (M5) */
  | { kind: "shuffleHandIntoDeck"; who: Who; redraw: boolean }
  | { kind: "manual"; text: string };  // explicit escape hatch

export interface Effect {
  timing: Timing;
  oncePerTurn?: boolean;        // [Once Per Turn] (10-2-13)
  optional?: boolean;           // "you may" (8-1-2)
  conditions?: Condition[];
  cost?: CostItem[];
  actions: Action[];            // resolved in written order (1-3-7)
  /** M5 event timings: only when at least `minCount` cards were involved,
   *  and/or only when the cause was your ("you") / your opponent's effect */
  /** M5 replacement effects: which removals of which card they answer */
  replaces?: {
    events: ("koBattle" | "koEffect" | "bounce" | "deckBottom" | "life" | "trash" | "rest" | "damage")[]; // M5: "rest" — "would be rested by …", "damage" — "If you would take damage"
    subject: "self" | "ally"; filter?: SelectorFilter; excludeSelf?: boolean;
    /** only when your opponent's effect causes it */
    byOpponent?: boolean;
  };
  react?: {
    minCount?: number; by?: "you" | "opponent"; byEffect?: boolean;
    /** watching timings: whose card it was, and what it must match */
    whose?: "yours" | "opponents"; filter?: SelectorFilter;
    /** onYouPlayCharacter: only plays from the trash (M5) */
    fromTrash?: boolean;
    /** M5: the card whose effect caused it must match ("by your {Navy} type card's effect") */
    sourceFilter?: SelectorFilter;
    /** M5: an alternative to `filter` — "… or when your opponent plays a Character using a Character's effect" */
    orSourceFilter?: SelectorFilter;
  };
}

export type Classification =
  | "vanilla"        // no effect text at all
  | "keyword-only"   // only keyword effects (e.g. just [Blocker])
  | "compiled"       // fully expressed in IR
  | "partial"        // some effects compiled, some manual
  | "unsupported";   // falls back to manual resolution in-game

/** Rule changes printed on a card ("Under the rules of this game …", M5). */
export interface CardRules {
  /** "you may have any number of this card in your deck" (5-1-2-3 exception) */
  anyCopies?: boolean;
  /** "Also treat this card's name as [X]" (name filters match X too) */
  alsoNames?: string[];
  /** Leader: "your DON!! deck consists of N cards" */
  donDeck?: number;
  /** Leader: "when your deck is reduced to 0, you win the game instead of losing" */
  winsOnDeckOut?: boolean;
  /** Leader: "you do not lose when your deck has 0 cards. You lose at the end of the turn in which your deck becomes 0 cards" */
  deckOutLosesAtEndOfTurn?: boolean;
  /** Leader: deck cards may not match ("you cannot include Events with a cost of 2 or more") */
  deckBan?: SelectorFilter;
  /** Leader: deck cards must match ("you can only include {East Blue} type cards") */
  deckOnly?: SelectorFilter;
  /** Leader: "at the start of the game, play up to 1 {X} type Stage card from your deck" */
  startOfGamePlay?: SelectorFilter;
}

export interface CompiledCard {
  rules?: CardRules;
  cardId: string;
  version: 1;
  /** Pipeline self-assessed confidence, 0..1. <0.75 → triage (plan §6). */
  confidence: number;
  classification: Classification;
  keywords: Keyword[];
  counterValue?: number;
  effects: Effect[];
  notes?: string;
}
