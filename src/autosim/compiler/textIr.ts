/** IR written by hand from the printed text, for the few cards whose
 *  optcg-ai data belongs to another card (M5). Each entry names the text it
 *  was written from: if the catalog text changes, the entry stops applying
 *  and the card goes back to the data. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { Effect, Keyword, Selector } from "../ir/types";

/** `text`: the catalog effect text it was written from (exact, or a pattern). */
interface TextIr { text: string | RegExp; reason: string; effects: Effect[]; keywords?: Keyword[] }

const own = (zone: "leaderOrCharacter") => ({ owner: "self" as const, zone, count: 1, chooser: "controller" as const, upTo: true });

const rayleigh = { owner: "self" as const, zone: "leaderOrCharacter" as const, count: 1, chooser: "controller" as const, filter: { nameIncludes: ["Silvers Rayleigh"] } };
const rayleighCounter: Effect = { timing: "counter", actions: [{ kind: "powerMod", amount: 2000, duration: "thisBattle",
  sel: { ...own("leaderOrCharacter"), filter: { category: ["Character"], or: { nameIncludes: ["Silvers Rayleigh"] } } } }] };

const opp = (zone: Selector["zone"], filter?: Selector["filter"], extra: Partial<Selector> = {}): Selector =>
  ({ owner: "opponent", zone, count: 1, chooser: "controller", upTo: true, ...(filter ? { filter } : {}), ...extra });
/** "Add up to 1 of your opponent's Characters with a cost of 3 or less to the top or bottom of your opponent's Life cards face-up." */
const oppCharToLife = (): Effect["actions"] => [
  { kind: "select", sel: opp("characterArea", { costAtMost: 3 }) },
  { kind: "ifThen", if: [{ kind: "hadTargets" }], then: [{ kind: "chooseOne", labels: ["Top of their Life cards", "Bottom of their Life cards"], options: [
    [{ kind: "addToLife", faceUp: true, sel: { owner: "opponent", zone: "characterArea", count: 1, prev: true, chooser: "controller" } }],
    [{ kind: "addToLife", faceUp: true, bottom: true, sel: { owner: "opponent", zone: "characterArea", count: 1, prev: true, chooser: "controller" } }]] }] },
];
const oppCharToLifeCost = (): Effect["cost"] => [{ kind: "oneOf", labels: ["Top of their Life cards", "Bottom of their Life cards"], options: [
  [{ kind: "action", action: { kind: "addToLife", faceUp: true, sel: { owner: "opponent", zone: "characterArea", count: 1, chooser: "controller", filter: { costAtMost: 3 } } } }],
  [{ kind: "action", action: { kind: "addToLife", faceUp: true, bottom: true, sel: { owner: "opponent", zone: "characterArea", count: 1, chooser: "controller", filter: { costAtMost: 3 } } } }]] }];
const SHAPE = "optcg-ai's steps for it do not map onto the IR";

const self1 = (zone: Selector["zone"], filter?: Selector["filter"], extra: Partial<Selector> = {}): Selector =>
  ({ owner: "self", zone, count: 1, chooser: "controller", ...(filter ? { filter } : {}), ...extra });
const handTrash1 = (): Effect["actions"][number] => ({ kind: "discard", who: "self", sel: self1("hand") });

const flipCost = (faceUp: boolean): Effect["cost"] => [{ kind: "oneOf", labels: ["The top card of your Life", "The bottom card of your Life"], options: [
  [{ kind: "action", action: { kind: "flipLife", who: "self", count: 1, faceUp } }],
  [{ kind: "action", action: { kind: "flipLife", who: "self", count: 1, faceUp, bottom: true } }]] }];

const WB = ["Whitebeard Pirates", "Former Whitebeard Pirates", "Whitebeard Pirates Allies"];

const cost5ToLife = (zone: "hand" | "trash"): Effect["actions"][number] => ({ kind: "addToLife", faceUp: true,
  sel: self1(zone, { category: ["Character"], costAtLeast: 5, costAtMost: 5 }, { upTo: true }) });

export const TEXT_IR: Record<string, TextIr> = {
  "EB05-052": {
    text: "If you would take damage, you may trash this Character instead.",
    reason: "the damage replacement does not map onto optcg-ai's steps; battle damage only",
    effects: [
      { timing: "replacement", optional: true, replaces: { events: ["damage"], subject: "self" }, cost: [{ kind: "trashSelf" }], actions: [] },
      { timing: "trigger", actions: [{ kind: "draw", count: 2 }, handTrash1()] },
    ],
  },
  "EB02-030": {
    text: "[Counter] If any of your Characters would be K.O.'d in battle during this turn, you may trash 1 card from your hand instead.",
    reason: SHAPE,
    effects: [
      { timing: "counter", actions: [{ kind: "restriction", what: "grantsReplacement", amount: 2, duration: "thisTurn", sel: self1("leader") }] },
      { timing: "trigger", actions: [{ kind: "draw", count: 1 }] },
      { timing: "replacement", optional: true, replaces: { events: ["koBattle"], subject: "ally" }, cost: [{ kind: "trashFromHand", sel: self1("hand") }], actions: [] },
    ],
  },
  "EB02-039": {
    text: "[Main] You may trash 1 {GERMA 66} type Character card with 4000 power or less from your hand: If the number of DON!! cards on your field is equal to or less than the number on your opponent's field, play up to 1 Character card with 5000 to 7000 power and the same card name as the trashed card from your trash.",
    reason: SHAPE,
    effects: [{ timing: "main", optional: true,
      cost: [{ kind: "action", action: { kind: "discard", who: "self", sel: self1("hand", { category: ["Character"], typeIncludes: ["GERMA 66"], powerAtMost: 4000 }) } }],
      conditions: [{ kind: "compare", left: { count: "donOnField", who: "self" }, op: "le", right: { count: "donOnField", who: "opponent" } }],
      actions: [{ kind: "playFromZone", zone: "trash", free: true,
        sel: self1("trash", { category: ["Character"], powerAtLeast: 5000, powerAtMost: 7000, sameNameAsPrev: true }, { upTo: true }) }] }],
  },
  // optcg-ai: the reveal is filtered to Events (the choice would see the hidden hand)
  "OP01-063": {
    text: "[DON!! x1] [Activate: Main] You may rest this Character: Choose 1 card from your opponent's hand; your opponent reveals that card. If the revealed card is an Event, place up to 1 card from your opponent's Life area at the bottom of the owner's deck.",
    reason: "optcg-ai filters the hidden choice to Events",
    effects: [{ timing: "activateMain", optional: true, conditions: [{ kind: "donAttached", count: 1 }], cost: [{ kind: "restSelf" }],
      actions: [
        { kind: "reveal", sel: { owner: "opponent", zone: "hand", count: 1, chooser: "controller" } },
        { kind: "ifThen", if: [{ kind: "prevMatches", filter: { category: ["Event"] } }],
          then: [{ kind: "returnToDeck", where: "bottom", sel: opp("life") }] }] }],
  },
  // optcg-ai has no data for it
  "OP01-105": {
    text: "[On Play] Choose 2 cards from your opponent's hand; your opponent reveals those cards.",
    reason: "optcg-ai has no data for it",
    effects: [{ timing: "onPlay", actions: [{ kind: "reveal", sel: { owner: "opponent", zone: "hand", count: 2, chooser: "controller" } }] }],
  },
  "ST28-004": {
    text: "[Your Turn] If you have 2 or less Life cards, your Leader gains +1000 power.\n[Activate: Main] [Once Per Turn] You may return 2 total of your currently given DON!! cards to your cost area rested: This Character gains [Rush] and +1000 power during this turn.\n(This card can attack on the turn in which it is played.)",
    reason: "the given DON!! cost does not map onto optcg-ai's steps",
    effects: [
      { timing: "static", conditions: [{ kind: "lifeAtMost", who: "self", count: 2 }, { kind: "yourTurn" }],
        actions: [{ kind: "powerMod", sel: self1("leader"), amount: 1000, duration: "permanentWhileInPlay" }] },
      { timing: "activateMain", oncePerTurn: true, optional: true, cost: [{ kind: "action", action: { kind: "ungiveDon", count: 2 } }],
        actions: [{ kind: "grantKeyword", keyword: "Rush", duration: "thisTurn", sel: self1("characterArea", undefined, { self: true }) },
          { kind: "powerMod", amount: 1000, duration: "thisTurn", sel: self1("characterArea", undefined, { self: true }) }] },
    ],
  },
  // optcg-ai: both picks from the trash only
  "ST13-003": {
    text: "Your face-up Life cards are placed at the bottom of your deck instead of being added to your hand, according to the rules.\n[DON!! x2] [Activate: Main] [Once Per Turn] You may trash 1 card from your hand: If you have 0 Life cards, add up to 2 Character cards with a cost of 5 from your hand or trash to the top of your Life cards face-up.",
    reason: "optcg-ai picks from the trash only",
    effects: [
      { timing: "static", actions: [{ kind: "restriction", sel: self1("leader"), what: "faceUpLifeToDeck", duration: "permanentWhileInPlay" }] },
      { timing: "activateMain", oncePerTurn: true, optional: true, cost: [{ kind: "trashFromHand", sel: self1("hand") }],
        conditions: [{ kind: "donAttached", count: 2 }, { kind: "lifeAtMost", who: "self", count: 0 }],
        actions: [0, 1].map((): Effect["actions"][number] => ({ kind: "chooseOne", labels: ["From your hand", "From your trash"],
          options: [[cost5ToLife("hand")], [cost5ToLife("trash")]] })) },
    ],
  },
  "OP03-083": {
    text: "[On Play] Look at 5 cards from the top of your deck and trash up to 2 cards. Then, place the rest at the bottom of your deck in any order.",
    reason: SHAPE,
    effects: [{ timing: "onPlay", actions: [{ kind: "peekDeck", who: "self", count: 5, then: { trash: {}, trashCount: 2, rest: "bottomAnyOrder" } }] }],
  },
  "OP12-058": {
    text: "[Main] If your Leader's type includes \"Whitebeard Pirates\", reveal 1 card from the top of your deck. If that card is a Character card with a type including \"Whitebeard Pirates\" and a cost of 9 or less, you may play that card. If you do, that Character gains [Rush] during this turn.",
    reason: SHAPE,
    effects: [
      { timing: "main", conditions: [{ kind: "leaderIs", filter: { typeIncludes: WB } }], actions: [
        { kind: "peekDeck", who: "self", count: 1, then: { reveal: true, play: { category: ["Character"], typeIncludes: WB, costAtMost: 9 }, playCount: 1, rest: "topAnyOrder" } },
        { kind: "grantKeyword", keyword: "Rush", duration: "thisTurn", sel: self1("characterArea", undefined, { prev: true }) }] },
      { timing: "trigger", actions: [{ kind: "draw", count: 1 }] },
    ],
  },
  "OP04-069": {
    text: "[On Your Opponent's Attack] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): This Character's base power becomes the same as the power of your opponent's attacking Leader or Character during this turn.",
    reason: SHAPE,
    effects: [
      { timing: "onYourOpponentsAttack", optional: true, cost: [{ kind: "returnDonToDeck", count: 1 }],
        actions: [{ kind: "setBasePower", amount: 0, fromAttackerPower: true, duration: "thisTurn", sel: self1("characterArea", undefined, { self: true }) }] },
      { timing: "trigger", optional: true, cost: [{ kind: "returnDonToDeck", count: 1 }],
        actions: [{ kind: "playFromZone", zone: "hand", free: true, sel: self1("hand", undefined, { self: true }) }] },
    ],
  },
  "OP12-020": {
    text: "[DON!! x3] [Activate: Main] [Once Per Turn] If this Leader battles your opponent's Character during this turn, set this Leader as active. Then, this Leader cannot attack your opponent's Characters with a base cost of 7 or less during this turn.",
    reason: SHAPE,
    effects: [{ timing: "activateMain", oncePerTurn: true,
      conditions: [{ kind: "donAttached", count: 3 }, { kind: "happenedThisTurn", who: "self", what: "leaderBattledCharacter" }],
      actions: [{ kind: "standTarget", sel: self1("leader", undefined, { self: true }) },
        { kind: "restriction", what: "cannotAttackCharactersBaseCostAtMost", amount: 7, duration: "thisTurn", sel: self1("leader", undefined, { self: true }) }] }],
  },
  "ST36-005": {
    text: "[On Your Opponent's Attack] [Once Per Turn] You may turn 1 card from the top or bottom of your Life cards face-down: Change the target of the attack to your [Eustass\"Captain\"Kid] with 5000 base power or more.\n[Activate: Main] [Once Per Turn] You may turn 1 card from the top or bottom of your Life cards face-up: Give up to 1 rested DON!! card to your Leader.",
    reason: SHAPE,
    effects: [
      { timing: "onYourOpponentsAttack", oncePerTurn: true, optional: true, cost: flipCost(false),
        actions: [{ kind: "redirectAttack", sel: self1("leaderOrCharacter", { nameIncludes: ["Eustass\"Captain\"Kid"], basePowerAtLeast: 5000 }) }] },
      { timing: "activateMain", oncePerTurn: true, optional: true, cost: flipCost(true),
        actions: [{ kind: "giveRestedDon", sel: self1("leader"), count: 1 }] },
    ],
  },
  "ST07-015": {
    text: "[Main] Your opponent chooses one: - Trash 1 card from the top of your opponent's Life cards. - Add 1 card from the top of your deck to the top of your Life cards.",
    reason: SHAPE,
    effects: (["main", "trigger"] as const).map((timing): Effect => ({ timing, actions: [{ kind: "chooseOne", chooser: "opponent",
      labels: ["Trash 1 card from the top of your Life cards", "Your opponent adds 1 card from the top of their deck to their Life"],
      options: [[{ kind: "trashLife", who: "opponent", count: 1 }], [{ kind: "addToLife", sel: { owner: "self", zone: "deckTop", count: 1, chooser: "controller" } }]] }] })),
  },
  "OP12-057": {
    text: "[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, trash 1 card from your hand.",
    reason: SHAPE,
    effects: [
      { timing: "counter", actions: [{ kind: "powerMod", sel: own("leaderOrCharacter"), amount: 4000, duration: "thisBattle" }, handTrash1()] },
      { timing: "trigger", optional: true, cost: [{ kind: "trashFromHand", sel: self1("hand") }], actions: [{ kind: "draw", count: 1 }] },
    ],
  },
  "ST25-001": { // optcg-ai: stray PassiveCantAttack / PassiveCostChange keys and a cost condition on the [On Play]
    text: "If you have 2 or more Characters with a base cost of 5 or more, this Character gains +1 cost.\n[On Play] If your Leader is [Buggy], draw 3 cards and trash 2 cards from your hand.",
    reason: SHAPE,
    effects: [
      { timing: "static", conditions: [{ kind: "countInZone", sel: { owner: "self", zone: "characterArea", count: 99, chooser: "controller", filter: { baseCostAtLeast: 5 } }, atLeast: 2 }],
        actions: [{ kind: "costMod", sel: self1("characterArea", undefined, { self: true }), amount: 1, duration: "permanentWhileInPlay" }] },
      { timing: "onPlay", conditions: [{ kind: "leaderIs", filter: { nameIncludes: ["Buggy"] } }],
        actions: [{ kind: "draw", count: 3 }, { kind: "discard", who: "self", sel: { ...self1("hand"), count: 2 } }] },
    ],
  },
  "OP11-100": {
    text: "[On Play] If your Leader is [Shirahoshi], you may turn 1 card from the top of your Life cards face-down: Draw 1 card.",
    reason: SHAPE,
    effects: [{ timing: "onPlay", optional: true, conditions: [{ kind: "leaderIs", filter: { nameIncludes: ["Shirahoshi"] } }],
      cost: [{ kind: "action", action: { kind: "flipLife", who: "self", count: 1, faceUp: false } }], actions: [{ kind: "draw", count: 1 }] }],
  },
  "OP11-119": {
    text: "[On Play] Up to 1 of your Characters can also attack active Characters during this turn.\n[When Attacking] You may place 2 cards from your trash at the bottom of your deck in any order: Up to 1 of your Leader or Character cards gains +1000 power until the end of your opponent's next turn.",
    reason: SHAPE,
    effects: [
      { timing: "onPlay", actions: [{ kind: "restriction", what: "canAttackActiveCharacters", duration: "thisTurn", sel: self1("characterArea", undefined, { upTo: true }) }] },
      { timing: "whenAttacking", optional: true, cost: [{ kind: "action", action: { kind: "returnToDeck", where: "bottom", sel: { ...self1("trash"), count: 2 } } }],
        actions: [{ kind: "powerMod", sel: own("leaderOrCharacter"), amount: 1000, duration: "untilEndOfOpponentsNextTurn" }] },
    ],
  },
  "OP11-030": {
    text: "[Activate: Main] You may rest 1 of your DON!! cards and this Character: Look at 5 cards from the top of your deck; reveal up to 1 {Neptunian} or {Fish-Man Island} type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
    reason: SHAPE,
    effects: [{ timing: "activateMain", optional: true, cost: [{ kind: "restDon", count: 1 }, { kind: "restSelf" }],
      actions: [{ kind: "peekDeck", who: "self", count: 5, then: { reveal: true, addToHand: { typeIncludes: ["Neptunian", "Fish-Man Island"] }, addCount: 1, rest: "bottomAnyOrder" } }] }],
  },
  "OP13-035": {
    text: "[End of Your Turn] Set this Character or up to 1 of your DON!! cards as active.",
    reason: SHAPE,
    effects: [{ timing: "endOfYourTurn", actions: [{ kind: "chooseOne", labels: ["Set this Character as active", "Set 1 of your DON!! cards as active"], options: [
      [{ kind: "standTarget", sel: self1("characterArea", undefined, { self: true }) }], [{ kind: "standDon", count: 1 }]] }] }],
  },
  "P-060": {
    text: "[Main] You may rest 1 of your [Uta] cards: Rest up to 2 of your opponent's DON!! cards.",
    reason: SHAPE,
    effects: [{ timing: "main", optional: true,
      cost: [{ kind: "action", action: { kind: "restTarget", sel: self1("field", { nameIncludes: ["Uta"], rested: false }) } }],
      actions: [{ kind: "restDon", who: "opponent", count: 2, upTo: true }] }],
  },
  "ST13-001": {
    text: "[DON!! x1] [Activate: Main] [Once Per Turn] You may add 1 of your Characters with a cost of 3 or more and 7000 power or more to the top of your Life cards face-up: Up to 1 of your Characters gains +2000 power until the start of your next turn.",
    reason: SHAPE,
    effects: [{ timing: "activateMain", oncePerTurn: true, optional: true, conditions: [{ kind: "donAttached", count: 1 }],
      cost: [{ kind: "action", action: { kind: "addToLife", faceUp: true, sel: self1("characterArea", { costAtLeast: 3, powerAtLeast: 7000 }) } }],
      actions: [{ kind: "powerMod", sel: self1("characterArea", undefined, { upTo: true }), amount: 2000, duration: "untilStartOfYourNextTurn" }] }],
  },
  "OP16-059": {
    text: "[Main] You may rest 7 of your DON!! cards: Look at 5 cards from the top of your deck; play up to 2 {Impel Down} type Character cards with 6000 power or less. Then, place the rest at the bottom of your deck in any order.\n[Counter] Your Leader gains +3000 power during this battle.",
    reason: SHAPE,
    effects: [
      { timing: "main", optional: true, cost: [{ kind: "restDon", count: 7 }],
        actions: [{ kind: "peekDeck", who: "self", count: 5, then: { play: { category: ["Character"], typeIncludes: ["Impel Down"], powerAtMost: 6000 }, playCount: 2, rest: "bottomAnyOrder" } }] },
      { timing: "counter", actions: [{ kind: "powerMod", sel: self1("leader"), amount: 3000, duration: "thisBattle" }] },
    ],
  },
  "OP11-088": {
    text: "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)\n[Once Per Turn] This effect can be activated when your opponent's Character attacks. If that Character has the ＜Slash＞ attribute, this Character gains +5000 power during this battle.",
    reason: SHAPE,
    keywords: ["Blocker"],
    effects: [{ timing: "onYourOpponentsAttack", oncePerTurn: true,
      conditions: [{ kind: "attackerMatches", filter: { category: ["Character"], attributes: ["Slash"] } }],
      actions: [{ kind: "powerMod", sel: self1("characterArea", undefined, { self: true }), amount: 5000, duration: "thisBattle" }] }],
  },
  "OP15-065": {
    text: "[On Play] Reveal 1 card from the top of your deck. If the revealed card has a cost of 2 or less, add up to 1 DON!! card from your DON!! deck and rest it.",
    reason: SHAPE,
    effects: [{ timing: "onPlay", actions: [
      { kind: "peekDeck", who: "self", count: 1, then: { reveal: true, rest: "topAnyOrder" } },
      { kind: "ifThen", if: [{ kind: "deckTopMatches", who: "self", filter: { costAtMost: 2 } }], then: [{ kind: "placeDonInCostArea", count: 1, rested: true }] }] }],
  },
  "EB02-057": {
    text: "[When Attacking] You may add 1 card from the top or bottom of your Life cards to your hand: Add up to 1 of your opponent's Characters with a cost of 3 or less to the top or bottom of your opponent's Life cards face-up.",
    reason: SHAPE,
    effects: [{ timing: "whenAttacking", optional: true,
      cost: [{ kind: "oneOf", labels: ["From the top", "From the bottom"], options: [[{ kind: "lifeToHand", count: 1 }], [{ kind: "lifeToHand", count: 1, bottom: true }]] }],
      actions: oppCharToLife() }],
  },
  "OP05-111": {
    text: "[On Play] You may play 1 [Kotori] from your hand: Add up to 1 of your opponent's Characters with a cost of 3 or less to the top or bottom of your opponent's Life cards face-up.",
    reason: SHAPE,
    effects: [{ timing: "onPlay", optional: true,
      cost: [{ kind: "action", action: { kind: "playFromZone", zone: "hand", free: true, sel: { owner: "self", zone: "hand", count: 1, chooser: "controller", filter: { category: ["Character"], nameIncludes: ["Kotori"] } } } }],
      actions: oppCharToLife() }],
  },
  "OP09-101": {
    text: "[On Play] Place 1 of your opponent's Characters with a cost of 3 or less at the top or bottom of your opponent's Life cards face-up: Your opponent trashes 1 card from their hand.",
    reason: SHAPE,
    effects: [{ timing: "onPlay", optional: true, cost: oppCharToLifeCost(),
      actions: [{ kind: "discard", who: "opponent", sel: { owner: "opponent", zone: "hand", count: 1, chooser: "opponent" } }] }],
  },
  "EB03-012": {
    text: "[Activate: Main] You may rest this Character: Rest up to 1 of your opponent's DON!! cards or {Animal} or {SMILE} type Characters with a cost of 3 or less.",
    reason: SHAPE,
    effects: [{ timing: "activateMain", optional: true, cost: [{ kind: "restSelf" }],
      actions: [{ kind: "chooseOne", labels: ["Rest 1 of their DON!! cards", "Rest 1 of their {Animal} / {SMILE} Characters"], options: [
        [{ kind: "restDon", who: "opponent", count: 1 }],
        [{ kind: "restTarget", sel: opp("characterArea", { typeIncludes: ["Animal", "SMILE"], costAtMost: 3, rested: false }) }]] }] }],
  },
  "EB04-011": {
    text: "[Rush: Character] (This card can attack Characters on the turn in which it is played.)\n[On Play] Draw a card for each of your {Neptunian} type Characters. Then, trash the same number of cards from your hand.",
    reason: SHAPE,
    keywords: ["RushCharacter"],
    effects: [{ timing: "onPlay", actions: [
      { kind: "select", sel: { owner: "self", zone: "characterArea", count: 99, chooser: "controller", filter: { typeIncludes: ["Neptunian"] } } },
      { kind: "draw", count: 0, countFromPrev: true },
      { kind: "discard", who: "self", countFromPrev: true, sel: { owner: "self", zone: "hand", count: 1, chooser: "controller" } }] }],
  },
  "EB04-023": {
    text: "[Double Attack] (This card deals 2 damage.)\n[On Play] You may give your active Leader −5000 power during this turn: Draw 2 cards.",
    reason: SHAPE,
    keywords: ["DoubleAttack"],
    effects: [{ timing: "onPlay", optional: true,
      cost: [{ kind: "action", action: { kind: "powerMod", amount: -5000, duration: "thisTurn", sel: { owner: "self", zone: "leader", count: 1, chooser: "controller", filter: { rested: false } } } }],
      actions: [{ kind: "draw", count: 2 }] }],
  },
  "EB05-019": {
    text: "[Counter] You may rest 1 of your cards: Up to 1 of your {Land of Wano} type Leader or Characters gains +4000 power during this battle.",
    reason: SHAPE,
    effects: [
      { timing: "counter", optional: true,
        cost: [{ kind: "oneOf", labels: ["Rest 1 of your DON!! cards", "Rest 1 of your Leader / Characters / Stage"], options: [
          [{ kind: "restDon", count: 1 }],
          [{ kind: "action", action: { kind: "restTarget", sel: { owner: "self", zone: "field", count: 1, chooser: "controller", filter: { rested: false } } } }]] }],
        actions: [{ kind: "powerMod", amount: 4000, duration: "thisBattle", sel: { ...own("leaderOrCharacter"), filter: { typeIncludes: ["Land of Wano"] } } }] },
      { timing: "trigger", conditions: [{ kind: "lifeAtMost", who: "opponent", count: 3 }],
        actions: [{ kind: "playFromZone", zone: "hand", free: true, sel: { owner: "self", zone: "hand", count: 1, chooser: "controller", upTo: true,
          filter: { category: ["Character"], typeIncludes: ["Land of Wano"], powerAtMost: 6000 } } }] },
    ],
  },
  "OP05-116": {
    text: "[Main] K.O. up to 1 of your opponent's Characters with a cost equal to or less than the number of your opponent's Life cards.",
    reason: SHAPE,
    effects: [
      { timing: "main", actions: [{ kind: "koTarget", sel: opp("characterArea", { costAtMostQ: { count: "life", who: "opponent" } }) }] },
      { timing: "trigger", actions: [{ kind: "koTarget", sel: opp("characterArea", { costAtMostQ: { count: "life", who: "opponent" } }) }] },
    ],
  },
  "OP06-033": {
    text: "[On Play] You may trash 1 {Fish-Man} type card from your hand or 1 [The Ark Noah] from your hand or field: K.O. up to 1 of your opponent's rested Characters.",
    reason: SHAPE,
    effects: [{ timing: "onPlay", optional: true,
      cost: [{ kind: "oneOf", labels: ["Trash 1 {Fish-Man} type card from your hand", "Trash [The Ark Noah] from your hand", "Trash [The Ark Noah] from your field"], options: [
        [{ kind: "trashFromHand", sel: { owner: "self", zone: "hand", count: 1, chooser: "controller", filter: { typeIncludes: ["Fish-Man"] } } }],
        [{ kind: "trashFromHand", sel: { owner: "self", zone: "hand", count: 1, chooser: "controller", filter: { nameIncludes: ["The Ark Noah"] } } }],
        [{ kind: "action", action: { kind: "trashTarget", sel: { owner: "self", zone: "field", count: 1, chooser: "controller", filter: { nameIncludes: ["The Ark Noah"] } } } }]] }],
      actions: [{ kind: "koTarget", sel: opp("characterArea", { rested: true }) }] }],
  },
  "OP06-119": {
    text: "[On Play] Reveal 1 card from the top of your deck and play up to 1 Character with a cost of 9 or less other than [Sanji]. Then, place the rest at the bottom of your deck.",
    reason: SHAPE,
    effects: [{ timing: "onPlay", actions: [{ kind: "peekDeck", who: "self", count: 1,
      then: { reveal: true, play: { category: ["Character"], costAtMost: 9, nameExcludes: ["Sanji"] }, playCount: 1, rest: "bottomAnyOrder" } }] }],
  },
  "OP08-118": {
    text: "[On Play] Select up to 2 of your opponent's Characters, and give 1 Character −3000 power and the other −2000 power until the end of your opponent's next turn. Then, K.O. up to 1 of your opponent's Characters with 3000 power or less.",
    reason: SHAPE,
    effects: [{ timing: "onPlay", actions: [
      { kind: "powerMod", amount: -3000, duration: "untilEndOfOpponentsNextTurn", sel: opp("characterArea") },
      { kind: "powerMod", amount: -2000, duration: "untilEndOfOpponentsNextTurn", sel: opp("characterArea", { notPrev: true }) },
      { kind: "koTarget", sel: opp("characterArea", { powerAtMost: 3000 }) }] }],
  },
  "OP10-033": {
    text: "[On Play] If you have 2 or more rested {ODYSSEY} type Characters, up to 1 of your opponent's rested DON!! cards will not become active in your opponent's next Refresh Phase.",
    reason: SHAPE,
    effects: [{ timing: "onPlay",
      conditions: [{ kind: "countInZone", sel: { owner: "self", zone: "characterArea", count: 99, chooser: "controller", filter: { typeIncludes: ["ODYSSEY"], rested: true } }, atLeast: 2 }],
      actions: [{ kind: "freezeDon", who: "opponent", count: 1 }] }],
  },
  // "You may give N active DON!! cards to 1 of your [Silvers Rayleigh]:" — optcg-ai writes the cost as NoCancel payoff steps
  "OP12-016": {
    text: /^\[Main\] You may give 2 active DON!! cards to 1 of your \[Silvers Rayleigh\]: Your opponent cannot activate \[Blocker\] when the card given these DON!! cards attacks during this turn\.\n\[Counter\] Up to 1 of your Characters or \[Silvers Rayleigh\] gains \+2000 power during this battle\.$/,
    reason: "the DON!! gift cost is written as payoff steps",
    effects: [
      { timing: "main", optional: true, cost: [{ kind: "action", action: { kind: "giveActiveDon", sel: rayleigh, count: 2 } }],
        actions: [{ kind: "grantKeyword", keyword: "Unblockable", duration: "thisTurn", sel: { ...rayleigh, prev: true } }] },
      rayleighCounter,
    ],
  },
  "OP12-019": {
    text: /^\[Main\] You may give 1 active DON!! card to 1 of your \[Silvers Rayleigh\]: Up to 1 of your Leader or Character cards gains \+1000 power during this turn\.\n\[Counter\] Up to 1 of your Characters or \[Silvers Rayleigh\] gains \+2000 power during this battle\.$/,
    reason: "the DON!! gift cost is written as payoff steps",
    effects: [
      { timing: "main", optional: true, cost: [{ kind: "action", action: { kind: "giveActiveDon", sel: rayleigh, count: 1 } }],
        actions: [{ kind: "powerMod", sel: own("leaderOrCharacter"), amount: 1000, duration: "thisTurn" }] },
      rayleighCounter,
    ],
  },
  // optcg-ai: an [Activate: Main] with −2000 to 2 opponent's Characters — another card
  "OP11-020": {
    text: /^\[Counter\] Up to 1 of your Leader or Character cards gains \+2000 power during this battle\. Then, if your opponent has a Character with 6000 power or more, up to 1 of your Leader or Character cards gains \+1000 power during this turn\./,
    reason: "optcg-ai has another card's data",
    effects: [
      { timing: "counter", actions: [
        { kind: "powerMod", sel: own("leaderOrCharacter"), amount: 2000, duration: "thisBattle" },
        { kind: "ifThen", if: [{ kind: "countInZone", sel: { owner: "opponent", zone: "characterArea", count: 99, chooser: "controller", filter: { powerAtLeast: 6000 } }, atLeast: 1 }],
          then: [{ kind: "powerMod", sel: own("leaderOrCharacter"), amount: 1000, duration: "thisTurn" }] }] },
      { timing: "trigger", actions: [{ kind: "powerMod", sel: own("leaderOrCharacter"), amount: 1000, duration: "thisTurn" }] },
    ],
  },
};
