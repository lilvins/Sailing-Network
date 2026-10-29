/**
 * AUTOSIM events + reducer. Events are the ONLY way state changes: the engine
 * validates an intent, resolves randomness/choices, then emits events;
 * `applyEvent` folds each one into the state. Replaying the log through
 * `applyEvent` reproduces the exact final state (tested in M0).
 *
 * Every event carries the full outcome (e.g. shuffles carry the resulting
 * order) so the reducer is pure and RNG-free. Duration expiry (thisBattle,
 * thisTurn, untilStartOfYourNextTurn) is deterministic and happens inside the
 * reducer at the exact rule points — no dedicated expiry events needed.
 */
import type { Timing } from "../ir/types";
import type { AutoGameState, Iid, Modifier, PID } from "./state";

export type GameEvent =
  // setup (5-2)
  | { type: "gameStarted"; seed: string; order: [PID, PID] }
  | { type: "deckShuffled"; player: PID; order: Iid[] }             // 3-2-4
  | { type: "cardsDrawn"; player: PID; iids: Iid[] }                // 4-5
  | { type: "mulliganResolved"; player: PID; taken: boolean; returnedToDeck: Iid[] } // 5-2-1-6
  | { type: "lifeDealt"; player: PID; iids: Iid[] }                 // 5-2-1-7
  // turn flow (6)
  | { type: "turnStarted"; turn: number; player: PID }
  | { type: "givenDonReturned"; player: PID; count: number }        // 6-2-3 (returned RESTED)
  | { type: "allStood"; player: PID; keepRested?: Iid[] }           // 6-2-4 (M5: cards a static keeps rested)
  | { type: "donPlaced"; player: PID; count: number }               // 6-4
  | { type: "turnEnded"; turn: number; player: PID }
  // main phase actions (6-5)
  | { type: "cardPlayed"; player: PID; iid: Iid; donRested: number; zone: "characterArea" | "stage"; rested?: boolean } // 6-5-3, 2-7-2/4
  | { type: "characterTrashedByRule"; player: PID; iid: Iid }        // 3-7-6-1 / 3-8-5-1
  | { type: "eventCardUsed"; player: PID; iid: Iid; donRested: number; baseCost?: number; stays?: boolean } // 2-7-3 / 7-1-3-2-2 (M5: base cost; stays = activated from the trash)
  | { type: "playDiscountUsed"; player: PID; source: Iid }          // M5: a "next time you play" discount is spent
  | { type: "donGiven"; player: PID; targetIid: Iid }                // 6-5-5
  // battle (7)
  | { type: "attackDeclared"; attackerOwner: PID; attackerIid: Iid; defenderOwner: PID; targetIid: Iid } // 7-1-1
  | { type: "attackStepEnded" }                                      // 7-1-1-4 → Block Step
  | { type: "blockWindowResolved"; blockerIid: Iid | null }          // 7-1-2 / 10-1-4-1
  | { type: "counterApplied"; player: PID; cardIid: Iid; targetIid: Iid; amount: number } // 7-1-3-2-1
  | { type: "counterWindowClosed"; player: PID }
  | { type: "battleWon"; attackerIid: Iid; targetIid: Iid }          // 7-1-4-1
  | { type: "battleLost"; attackerIid: Iid; targetIid: Iid }          // 7-1-4-2
  | { type: "lifeCardToHand"; player: PID; iid: Iid }                // 7-1-4-1-1-2
  | { type: "lifeCardTrashed"; player: PID; iid: Iid }               // 10-1-3-1 [Banish]
  | { type: "characterKOd"; player: PID; iid: Iid; donReturned: number } // 7-1-4-1-2 / 10-2-1, 6-5-5-4
  | { type: "battleEnded" }                                          // 7-1-5
  // effects (8, M1)
  | { type: "effectActivated"; player: PID; sourceIid: Iid; sourceCardId: string;
      effectIndex: number; timing: Timing; oncePerTurn: boolean }    // 8-4-1-4 (+10-2-13-3 marking)
  | { type: "effectDeclined"; player: PID; sourceIid: Iid; effectIndex: number } // 8-1-2 "may"
  | { type: "costPaid"; player: PID; restDon: number; returnDon: number }        // 8-3-1-5 / 8-3-1-6
  | { type: "modifierAdded"; modifier: Modifier }                    // powerMod/grantKeyword/restriction
  | { type: "cardRested"; player: PID; iid: Iid }                    // restTarget
  | { type: "cardStood"; player: PID; iid: Iid }                     // standTarget
  | { type: "cardsDiscarded"; player: PID; iids: Iid[] }             // 10-2-14 (hand → trash)
  | { type: "manualResolved"; player: PID; sourceIid: Iid; text: string } // plan §1.3 fallback ack
  // M3 — tier-2 executor
  | { type: "deckPeeked"; player: PID; iids: Iid[] }                 // "look at N from the top" (log marker)
  | { type: "peekResolved"; player: PID; toHand: Iid[]; played: { iid: Iid; rested: boolean }[];
      top: Iid[]; bottom: Iid[]; trashed: Iid[] }                    // 8-4-4-4, 11-2-1
  | { type: "playedFromZone"; player: PID; iid: Iid; from: "hand" | "trash" | "life"; rested: boolean; zone?: "stage" } // playFromZone (M5: a Stage)
  | { type: "returnedToHand"; player: PID; iid: Iid }                // bounce (field → hand)
  | { type: "returnedToDeck"; player: PID; iid: Iid; where: "top" | "bottom"; from: "field" | "hand" | "trash" | "deck" | "life" }
  | { type: "cardsRevealed"; player: PID; iids: Iid[] }              // reveal from hand / the top of a deck (M5, log only)
  | { type: "costDeclared"; player: PID; value: number }             // "Choose a cost" (M5, log only)
  | { type: "lifeArranged"; player: PID; order: Iid[] }              // M5: the Life area, top first
  | { type: "extraTurnGranted"; player: PID }
  | { type: "attackRedirected"; targetIid: Iid }                     // M5: "Change the attack target to …"
  | { type: "donUngiven"; player: PID; from: Record<Iid, number> }   // M5: given DON!! back to the cost area, rested
  | { type: "donFrozen"; player: PID; count: number }               // M5: rested DON!! skip the next Refresh
  | { type: "givenDonMoved"; player: PID; from: Iid; to: Iid; count: number } // M5: given DON!! to another card                      // M5: "take an extra turn after this one"
  | { type: "startOfGameStage"; player: PID; iid: Iid }              // M5: a Leader rule plays a Stage from the deck at setup
  | { type: "addedToLife"; player: PID; iid: Iid; from: "deck" | "field" | "hand" | "trash"; faceUp: boolean; where: "top" | "bottom" } // M5
  | { type: "lifeFlipped"; player: PID; iids: Iid[]; faceUp: boolean } // M5
  | { type: "donRestedByEffect"; player: PID; count: number }        // M5
  | { type: "lifeTopToBottom"; player: PID }                         // M5
  | { type: "lifePeeked"; player: PID; owner: PID; iid: Iid }        // M5 (log only)
  | { type: "endOfTurnScheduled"; player: PID; sourceIid: Iid; sourceCardId: string; effectIndex: number; subject?: { owner: PID; iid: Iid } } // M5
  | { type: "scheduledQueued"; turn: number }                       // M5: this turn's scheduled effects left the list
  | { type: "milled"; player: PID; iids: Iid[] }                     // deck top → trash
  | { type: "trashToHand"; player: PID; iid: Iid }                   // addFromTrashToHand
  | { type: "donAdded"; player: PID; count: number; rested: boolean } // DON!! deck → cost area
  | { type: "donGivenFromRested"; player: PID; targetIid: Iid; count: number } // "give rested DON"
  | { type: "donStood"; player: PID; count: number }                 // "set DON as active"
  | { type: "donPaid"; player: PID; fromActive: number; fromRested: number;
      fromGiven: Record<Iid, number> }                               // DON!!−X (8-3-1-6)
  // [Trigger] lifecycle (10-1-5)
  | { type: "triggerActivated"; player: PID; iid: Iid; cardId: string } // 10-1-5-1 (revealed; leaves Life)
  | { type: "triggerCardTrashed"; player: PID; iid: Iid }            // 10-1-5-3
  | { type: "triggerCardPlayed"; player: PID; iid: Iid }             // trigger "play this card"
  // game end (1-2, 9-2)
  | { type: "gameEnded"; winner: PID; reason: string };

/** Drop modifiers targeting a card that left the field (3-1-6: a card that
 *  changes area is a NEW card — effects applied to the old one end) and its
 *  [Once Per Turn] bookkeeping (10-2-13-4). */
function cardLeftField(state: AutoGameState, owner: PID, iid: Iid): void {
  state.modifiers = state.modifiers.filter((m) => !(m.targetOwner === owner && m.targetIid === iid));
  for (const key of Object.keys(state.oncePerTurnUsed)) {
    if (key.startsWith(`${owner}:${iid}:`)) delete state.oncePerTurnUsed[key];
  }
}

/** Pure reducer. Mutates `state` in place (callers own the draft). */
export function applyEvent(state: AutoGameState, e: GameEvent): void {
  switch (e.type) {
    case "gameStarted":
      break; // creation event — state skeleton is built by createGame

    case "givenDonMoved": {
      const don = state.players[e.player].don;
      don.given[e.from] = (don.given[e.from] ?? 0) - e.count;
      if (don.given[e.from] <= 0) delete don.given[e.from];
      don.given[e.to] = (don.given[e.to] ?? 0) + e.count;
      break;
    }

    case "donFrozen": {
      const don = state.players[e.player].don;
      don.frozen = Math.min((don.frozen ?? 0) + e.count, don.rested);
      break;
    }

    case "extraTurnGranted":
      state.extraTurn = e.player;
      break;

    case "startOfGameStage": {
      const p = state.players[e.player];
      p.zones.deck = p.zones.deck.filter((x) => x !== e.iid);
      p.zones.stage.push(e.iid);
      break;
    }

    case "lifeArranged":
      state.players[e.player].zones.life = [...e.order].reverse(); // the last element is the top (3-10)
      break;

    case "deckShuffled":
      state.players[e.player].zones.deck = [...e.order];
      break;

    case "cardsDrawn": {
      const p = state.players[e.player];
      for (const iid of e.iids) {
        p.zones.deck = p.zones.deck.filter((x) => x !== iid);
        p.zones.hand.push(iid);
      }
      break;
    }

    case "mulliganResolved": {
      const p = state.players[e.player];
      p.mulliganResolved = true;
      // taken: hand returns to the deck (order irrelevant — a deckShuffled
      // event with the post-shuffle order always follows)
      for (const iid of e.returnedToDeck) {
        p.zones.hand = p.zones.hand.filter((x) => x !== iid);
        p.zones.deck.push(iid);
      }
      break;
    }

    case "lifeDealt": {
      const p = state.players[e.player];
      for (const iid of e.iids) {
        p.zones.deck = p.zones.deck.filter((x) => x !== iid);
        p.zones.life.push(iid); // dealt in order; last = top (2-9-2-1)
      }
      break;
    }

    case "turnStarted":
      state.turn = e.turn;
      state.turnPlayer = e.player;
      for (const pid of state.order) { delete state.players[pid].eventsThisTurn; delete state.players[pid].thisTurn; }
      if (state.extraTurn === e.player) { // the extra turn starts (M5)
        delete state.extraTurn;
        state.extraTurns = [...(state.extraTurns ?? []), e.turn];
      }
      state.phase = "main";
      // 6-2-1 (Refresh): effects lasting "until the start of your next turn"
      // expire at the start of the anchored player's next turn.
      state.modifiers = state.modifiers.filter(
        (m) => !(m.duration === "untilStartOfYourNextTurn" && m.anchor === e.player && e.turn > m.createdTurn),
      );
      break;

    case "givenDonReturned": {
      // 6-2-3: given DON return to the cost area RESTED (then 6-2-4 stands them)
      const don = state.players[e.player].don;
      don.given = {};
      don.rested += e.count;
      break;
    }

    case "allStood": {
      const p = state.players[e.player];
      // "will not become active in your next Refresh Phase" (M5): those stay
      // rested, and the effect is used up by this Refresh Phase
      const frozen = new Set([...state.modifiers
        .filter((m) => m.kind === "restriction" && m.restriction === "skipNextRefresh" && m.targetOwner === e.player)
        .map((m) => m.targetIid), ...(e.keepRested ?? [])]);
      state.modifiers = state.modifiers.filter((m) => !(m.duration === "untilOwnersNextRefresh" && m.targetOwner === e.player));
      for (const [iid, inst] of Object.entries(p.instances)) if (!frozen.has(iid)) inst.rested = false;
      const keep = Math.min(p.don.frozen ?? 0, p.don.rested); // M5: frozen DON!! stay rested
      p.don.active += p.don.rested - keep;
      p.don.rested = keep;
      delete p.don.frozen;
      break;
    }

    case "donPlaced": {
      const don = state.players[e.player].don;
      don.deck -= e.count;
      don.active += e.count; // placed active (3-9-3)
      break;
    }

    case "turnEnded":
      // 6-6-1-3/4: "during this turn" effects expire at the End Phase (turn
      // player's first, then non-turn player's — removal order is
      // unobservable here, so a single filter suffices).
      state.modifiers = state.modifiers.filter((m) => m.duration !== "thisTurn");
      // "until the end of your opponent's next turn": expires at the end of
      // the first opposing turn AFTER the one it was created on.
      state.modifiers = state.modifiers.filter(
        (m) => !(m.duration === "untilEndOfOpponentsNextTurn" && e.player !== m.anchor && state.turn > m.createdTurn),
      );
      break;

    case "cardPlayed": {
      const p = state.players[e.player];
      p.don.active -= e.donRested;
      p.don.rested += e.donRested;
      p.zones.hand = p.zones.hand.filter((x) => x !== e.iid);
      const inst = p.instances[e.iid];
      inst.rested = !!e.rested; // played active (3-7-5 / 3-8-4) — M5: "played rested" by a static
      if (e.zone === "stage") p.zones.stage.push(e.iid);
      else { p.zones.characterArea.push(e.iid); inst.playedOnTurn = state.turn; }
      break;
    }

    case "characterTrashedByRule": {
      const p = state.players[e.player];
      p.zones.characterArea = p.zones.characterArea.filter((x) => x !== e.iid);
      p.zones.stage = p.zones.stage.filter((x) => x !== e.iid);
      // given DON return rested (6-5-5-4)
      const given = p.don.given[e.iid] ?? 0;
      if (given > 0) { p.don.rested += given; delete p.don.given[e.iid]; }
      p.zones.trash.push(e.iid);
      p.instances[e.iid].rested = false; // cards in piles are never rested
      cardLeftField(state, e.player, e.iid);
      break;
    }

    case "eventCardUsed": {
      const p = state.players[e.player];
      p.don.active -= e.donRested;
      p.don.rested += e.donRested;
      if (e.baseCost !== undefined) p.eventsThisTurn = [...(p.eventsThisTurn ?? []), e.baseCost];
      if (e.stays) break; // activated from the trash: it stays there
      p.zones.hand = p.zones.hand.filter((x) => x !== e.iid);
      p.zones.trash.push(e.iid); // 2-7-3 / 8-4-2: trash to activate
      break;
    }

    case "playDiscountUsed": {
      const i = state.modifiers.findIndex((m) => m.kind === "playDiscount" && m.targetOwner === e.player && m.source === e.source);
      if (i >= 0) state.modifiers.splice(i, 1);
      break;
    }

    case "donGiven": {
      const don = state.players[e.player].don;
      don.active -= 1;
      don.given[e.targetIid] = (don.given[e.targetIid] ?? 0) + 1;
      break;
    }

    case "attackDeclared": {
      const p = state.players[e.attackerOwner];
      p.instances[e.attackerIid].rested = true; // 7-1-1-1
      // "If this Leader battles your opponent's Character during this turn" (M5)
      if (e.attackerIid === p.leaderIid && state.players[e.defenderOwner].zones.characterArea.includes(e.targetIid)) p.thisTurn = { ...(p.thisTurn ?? {}), leaderBattledCharacter: true };
      state.battle = {
        attackerOwner: e.attackerOwner,
        attackerIid: e.attackerIid,
        defenderOwner: e.defenderOwner,
        targetIid: e.targetIid,
        step: "attack",     // 7-1-1-3: attack-step effects resolve first
        blockerUsed: false,
        pendingDamage: 0,
      };
      break;
    }

    case "attackStepEnded":
      if (state.battle) state.battle.step = "block"; // 7-1-2
      break;

    case "donUngiven": {
      const don = state.players[e.player].don;
      for (const [iid, n] of Object.entries(e.from)) {
        don.given[iid] = (don.given[iid] ?? 0) - n;
        if (don.given[iid] <= 0) delete don.given[iid];
        don.rested += n;
      }
      break;
    }

    case "attackRedirected":
      if (state.battle) state.battle.targetIid = e.targetIid;
      break;

    case "blockWindowResolved": {
      if (!state.battle) break;
      if (e.blockerIid) {
        // 10-1-4-1: activate [Blocker] by RESTING the card; it takes the
        // place of the card being attacked. 7-1-2-1: once per battle.
        state.players[state.battle.defenderOwner].instances[e.blockerIid].rested = true;
        const ap = state.players[state.battle.attackerOwner];
        if (state.battle.attackerIid === ap.leaderIid && state.players[state.battle.defenderOwner].zones.characterArea.includes(e.blockerIid)) {
          ap.thisTurn = { ...(ap.thisTurn ?? {}), leaderBattledCharacter: true }; // M5
        }
        state.battle.targetIid = e.blockerIid;
        state.battle.blockerUsed = true;
      }
      state.battle.step = "counter";
      break;
    }

    case "counterApplied": {
      const p = state.players[e.player];
      p.zones.hand = p.zones.hand.filter((x) => x !== e.cardIid);
      p.zones.trash.push(e.cardIid); // 7-1-3-2-1: trash to activate
      // counter value = a thisBattle powerMod (expires 7-1-5-3/4)
      state.modifiers.push({
        source: e.cardIid, controller: e.player, kind: "powerMod",
        targetOwner: e.player, targetIid: e.targetIid, amount: e.amount,
        duration: "thisBattle", anchor: e.player, createdTurn: state.turn,
      });
      break;
    }

    case "counterWindowClosed":
      if (state.battle) state.battle.step = "damage";
      break;

    case "battleWon":
    case "battleLost":
      break; // outcome events follow (lifeCardToHand / characterKOd)

    case "lifeCardToHand": {
      const p = state.players[e.player];
      p.zones.life = p.zones.life.filter((x) => x !== e.iid);
      p.zones.hand.push(e.iid);
      break;
    }

    case "lifeCardTrashed": {
      // 10-1-3-1 [Banish]: the Life card is trashed instead of added to hand
      const p = state.players[e.player];
      p.zones.life = p.zones.life.filter((x) => x !== e.iid);
      p.zones.trash.push(e.iid);
      break;
    }

    case "characterKOd": {
      const p = state.players[e.player];
      p.thisTurn = { ...(p.thisTurn ?? {}), characterKOd: true };
      p.zones.characterArea = p.zones.characterArea.filter((x) => x !== e.iid);
      const given = p.don.given[e.iid] ?? 0;
      if (given > 0) { p.don.rested += given; delete p.don.given[e.iid]; } // 6-5-5-4
      p.zones.trash.push(e.iid);
      p.instances[e.iid].rested = false;
      cardLeftField(state, e.player, e.iid);
      break;
    }

    case "battleEnded":
      // 7-1-5-3/4: "during this battle" effects become invalid (turn player's
      // first, then non-turn player's — removal order unobservable).
      state.modifiers = state.modifiers.filter((m) => m.duration !== "thisBattle");
      state.battle = null;
      break;

    case "effectActivated":
      // 10-2-13-3: a resolved [Once Per Turn] effect cannot activate again
      if (e.oncePerTurn) {
        state.oncePerTurnUsed[`${e.player}:${e.sourceIid}:${e.effectIndex}`] = state.turn;
      }
      break;

    case "effectDeclined":
      break; // log-only (8-1-2: player chose not to activate)

    case "costPaid": {
      const don = state.players[e.player].don;
      don.active -= e.restDon;   // 8-3-1-5 ①: rest active DON
      don.rested += e.restDon;
      don.active -= e.returnDon; // 8-3-1-6 DON!!−X (M1: from the cost area)
      don.deck += e.returnDon;
      break;
    }

    case "modifierAdded":
      state.modifiers.push(structuredClone(e.modifier));
      break;

    case "cardRested":
      state.players[e.player].instances[e.iid].rested = true;
      break;

    case "cardStood":
      state.players[e.player].instances[e.iid].rested = false;
      break;

    case "cardsDiscarded": {
      const p = state.players[e.player];
      if (e.iids.length > 0) p.thisTurn = { ...(p.thisTurn ?? {}), handTrashed: true };
      for (const iid of e.iids) {
        p.zones.hand = p.zones.hand.filter((x) => x !== iid);
        p.zones.trash.push(iid);
      }
      break;
    }

    case "manualResolved":
      break; // log-only acknowledgement

    case "deckPeeked":
      break; // look-only (11-3-2: cards remain in place while looked at)

    case "peekResolved": {
      const p = state.players[e.player];
      const moved = new Set([...e.toHand, ...e.played.map((x) => x.iid), ...e.top, ...e.bottom, ...e.trashed]);
      p.zones.deck = p.zones.deck.filter((x) => !moved.has(x));
      p.zones.hand.push(...e.toHand);          // 11-2-1: revealed on the way
      for (const pl of e.played) {
        p.zones.characterArea.push(pl.iid);
        const inst = p.instances[pl.iid];
        inst.rested = pl.rested;
        inst.playedOnTurn = state.turn;        // 3-7-4 summoning sickness
      }
      p.zones.deck = [...e.top, ...p.zones.deck]; // chosen order, first = new top
      p.zones.deck.push(...e.bottom);
      p.zones.trash.push(...e.trashed);
      break;
    }

    case "playedFromZone": {
      const p = state.players[e.player];
      p.zones.hand = p.zones.hand.filter((x) => x !== e.iid);
      p.zones.trash = p.zones.trash.filter((x) => x !== e.iid);
      p.zones.life = p.zones.life.filter((x) => x !== e.iid); // M5: from the Life area
      const inst = p.instances[e.iid];
      inst.rested = e.rested;
      delete inst.faceUp;
      if (e.zone === "stage") { p.zones.stage.push(e.iid); break; }
      p.zones.characterArea.push(e.iid);
      inst.playedOnTurn = state.turn;          // 3-7-4
      break;
    }

    case "returnedToHand": {
      const p = state.players[e.player];
      p.zones.characterArea = p.zones.characterArea.filter((x) => x !== e.iid);
      p.zones.stage = p.zones.stage.filter((x) => x !== e.iid);
      const given = p.don.given[e.iid] ?? 0;
      if (given > 0) { p.don.rested += given; delete p.don.given[e.iid]; } // 6-5-5-4
      p.instances[e.iid].rested = false;
      p.zones.hand.push(e.iid);
      cardLeftField(state, e.player, e.iid);   // 3-1-6
      break;
    }

    case "returnedToDeck": {
      const p = state.players[e.player];
      if (e.from === "field") {
        p.zones.characterArea = p.zones.characterArea.filter((x) => x !== e.iid);
        p.zones.stage = p.zones.stage.filter((x) => x !== e.iid);
        const given = p.don.given[e.iid] ?? 0;
        if (given > 0) { p.don.rested += given; delete p.don.given[e.iid]; } // 6-5-5-4
        p.instances[e.iid].rested = false;
        cardLeftField(state, e.player, e.iid); // 3-1-6
      } else if (e.from === "hand") {
        p.zones.hand = p.zones.hand.filter((x) => x !== e.iid);
      } else if (e.from === "life") {
        p.zones.life = p.zones.life.filter((x) => x !== e.iid);
      } else if (e.from === "deck") {
        p.zones.deck = p.zones.deck.filter((x) => x !== e.iid); // "place the top card at the bottom" (M5)
      } else {
        p.zones.trash = p.zones.trash.filter((x) => x !== e.iid);
      }
      if (e.where === "top") p.zones.deck.unshift(e.iid);
      else p.zones.deck.push(e.iid);
      break;
    }

    case "addedToLife": {
      const p = state.players[e.player];
      if (e.from === "field") {
        p.zones.characterArea = p.zones.characterArea.filter((x) => x !== e.iid);
        p.zones.stage = p.zones.stage.filter((x) => x !== e.iid);
        const given = p.don.given[e.iid] ?? 0;
        if (given > 0) { p.don.rested += given; delete p.don.given[e.iid]; } // 6-5-5-4
        p.instances[e.iid].rested = false;
        cardLeftField(state, e.player, e.iid); // 3-1-6
      } else if (e.from === "hand") {
        p.zones.hand = p.zones.hand.filter((x) => x !== e.iid);
      } else if (e.from === "trash") {
        p.zones.trash = p.zones.trash.filter((x) => x !== e.iid);
      } else {
        p.zones.deck = p.zones.deck.filter((x) => x !== e.iid);
      }
      p.instances[e.iid].faceUp = e.faceUp;
      // the top of the Life area is the END of the array (3-10)
      if (e.where === "top") p.zones.life.push(e.iid);
      else p.zones.life.unshift(e.iid);
      break;
    }

    case "donRestedByEffect": {
      const don = state.players[e.player].don;
      don.active -= e.count;
      don.rested += e.count;
      break;
    }

    case "lifeTopToBottom": {
      const life = state.players[e.player].zones.life;
      const top = life.pop();
      if (top) life.unshift(top);
      break;
    }

    case "endOfTurnScheduled":
      (state.scheduled ??= []).push({ turn: state.turn, controller: e.player, sourceIid: e.sourceIid, sourceCardId: e.sourceCardId, effectIndex: e.effectIndex,
        ...(e.subject ? { subject: e.subject } : {}) });
      break;

    case "scheduledQueued":
      state.scheduled = (state.scheduled ?? []).filter((x) => x.turn !== e.turn);
      break;

    case "lifeFlipped": {
      const p = state.players[e.player];
      for (const iid of e.iids) p.instances[iid].faceUp = e.faceUp;
      break;
    }

    case "milled": {
      const p = state.players[e.player];
      for (const iid of e.iids) {
        p.zones.deck = p.zones.deck.filter((x) => x !== iid);
        p.zones.trash.push(iid);
      }
      break;
    }

    case "trashToHand": {
      const p = state.players[e.player];
      p.zones.trash = p.zones.trash.filter((x) => x !== e.iid);
      p.zones.hand.push(e.iid);
      break;
    }

    case "donAdded": {
      const don = state.players[e.player].don;
      don.deck -= e.count;
      if (e.rested) don.rested += e.count;
      else don.active += e.count;
      break;
    }

    case "donGivenFromRested": {
      const don = state.players[e.player].don;
      don.rested -= e.count;
      don.given[e.targetIid] = (don.given[e.targetIid] ?? 0) + e.count;
      break;
    }

    case "donStood": {
      const don = state.players[e.player].don;
      don.rested -= e.count;
      don.active += e.count;
      break;
    }

    case "donPaid": {
      // 8-3-1-6 DON!!−X: the chosen composition returns to the DON!! deck
      const don = state.players[e.player].don;
      don.active -= e.fromActive;
      don.rested -= e.fromRested;
      let total = e.fromActive + e.fromRested;
      for (const [iid, n] of Object.entries(e.fromGiven)) {
        don.given[iid] = (don.given[iid] ?? 0) - n;
        if (don.given[iid] <= 0) delete don.given[iid];
        total += n;
      }
      don.deck += total;
      break;
    }

    case "triggerActivated": {
      // 10-1-5-3: while the [Trigger] resolves, the card belongs to NO area —
      // it leaves Life here and lands via triggerCardTrashed/triggerCardPlayed.
      const p = state.players[e.player];
      p.zones.life = p.zones.life.filter((x) => x !== e.iid);
      break;
    }

    case "triggerCardTrashed":
      state.players[e.player].zones.trash.push(e.iid);
      break;

    case "triggerCardPlayed": {
      const p = state.players[e.player];
      p.zones.characterArea.push(e.iid);
      const inst = p.instances[e.iid];
      inst.rested = false;
      inst.playedOnTurn = state.turn; // 3-7-4 summoning sickness applies
      break;
    }

    case "gameEnded":
      state.phase = "over";
      state.winner = e.winner;
      state.winReason = e.reason;
      state.pendingChoice = null;
      state.battle = null;
      state.exec = null;
      break;
  }
}

/** Apply + append: the engine's single way of changing state. */
export function emit(state: AutoGameState, log: GameEvent[], e: GameEvent): void {
  applyEvent(state, e);
  log.push(e);
}

/** Replay a log from a fresh skeleton (createGame builds the skeleton). */
export function replay(skeleton: AutoGameState, log: GameEvent[]): AutoGameState {
  const s = structuredClone(skeleton);
  for (const e of log) applyEvent(s, e);
  return s;
}
