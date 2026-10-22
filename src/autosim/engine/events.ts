/**
 * AUTOSIM events + reducer. Events are the ONLY way state changes: the engine
 * validates an intent, resolves randomness/choices, then emits events;
 * `applyEvent` folds each one into the state. Replaying the log through
 * `applyEvent` reproduces the exact final state (tested in M0).
 *
 * Every event carries the full outcome (e.g. shuffles carry the resulting
 * order) so the reducer is pure and RNG-free.
 */
import type { AutoGameState, Iid, PID } from "./state";

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
  | { type: "allStood"; player: PID }                               // 6-2-4
  | { type: "donPlaced"; player: PID; count: number }               // 6-4
  | { type: "turnEnded"; turn: number; player: PID }
  // main phase actions (6-5)
  | { type: "cardPlayed"; player: PID; iid: Iid; donRested: number; zone: "characterArea" | "stage" } // 6-5-3, 2-7-2/4
  | { type: "characterTrashedByRule"; player: PID; iid: Iid }        // 3-7-6-1 / 3-8-5-1
  | { type: "eventCardUsed"; player: PID; iid: Iid; donRested: number } // 2-7-3 (M0: effect skipped)
  | { type: "donGiven"; player: PID; targetIid: Iid }                // 6-5-5
  // battle (7)
  | { type: "attackDeclared"; attackerOwner: PID; attackerIid: Iid; defenderOwner: PID; targetIid: Iid } // 7-1-1
  | { type: "blockWindowResolved"; blockerIid: Iid | null }          // 7-1-2
  | { type: "counterApplied"; player: PID; cardIid: Iid; targetIid: Iid; amount: number } // 7-1-3-2-1
  | { type: "counterWindowClosed"; player: PID }
  | { type: "battleWon"; attackerIid: Iid; targetIid: Iid }          // 7-1-4-1
  | { type: "battleLost"; attackerIid: Iid; targetIid: Iid }         // 7-1-4-2
  | { type: "lifeCardToHand"; player: PID; iid: Iid }                // 7-1-4-1-1-2
  | { type: "characterKOd"; player: PID; iid: Iid; donReturned: number } // 7-1-4-1-2, 6-5-5-4
  | { type: "battleEnded" }                                          // 7-1-5
  // game end (1-2, 9-2)
  | { type: "gameEnded"; winner: PID; reason: string };

/** Pure reducer. Mutates `state` in place (callers own the draft). */
export function applyEvent(state: AutoGameState, e: GameEvent): void {
  switch (e.type) {
    case "gameStarted":
      break; // creation event — state skeleton is built by createGame

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
      state.phase = "main";
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
      for (const inst of Object.values(p.instances)) inst.rested = false;
      p.don.active += p.don.rested;
      p.don.rested = 0;
      break;
    }

    case "donPlaced": {
      const don = state.players[e.player].don;
      don.deck -= e.count;
      don.active += e.count; // placed active (3-9-3)
      break;
    }

    case "turnEnded":
      break; // next turnStarted carries the new turn/player

    case "cardPlayed": {
      const p = state.players[e.player];
      p.don.active -= e.donRested;
      p.don.rested += e.donRested;
      p.zones.hand = p.zones.hand.filter((x) => x !== e.iid);
      const inst = p.instances[e.iid];
      inst.rested = false; // played active (3-7-5 / 3-8-4)
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
      break;
    }

    case "eventCardUsed": {
      const p = state.players[e.player];
      p.don.active -= e.donRested;
      p.don.rested += e.donRested;
      p.zones.hand = p.zones.hand.filter((x) => x !== e.iid);
      p.zones.trash.push(e.iid); // 2-7-3: trash to activate
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
      state.battle = {
        attackerOwner: e.attackerOwner,
        attackerIid: e.attackerIid,
        defenderOwner: e.defenderOwner,
        targetIid: e.targetIid,
        step: "block",
        mods: [],
      };
      break;
    }

    case "blockWindowResolved": {
      if (!state.battle) break;
      if (e.blockerIid) state.battle.targetIid = e.blockerIid; // 10-1-4-1 (M1)
      state.battle.step = "counter";
      break;
    }

    case "counterApplied": {
      const p = state.players[e.player];
      p.zones.hand = p.zones.hand.filter((x) => x !== e.cardIid);
      p.zones.trash.push(e.cardIid); // 7-1-3-2-1: trash to activate
      state.battle?.mods.push({ iid: e.targetIid, amount: e.amount });
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

    case "characterKOd": {
      const p = state.players[e.player];
      p.zones.characterArea = p.zones.characterArea.filter((x) => x !== e.iid);
      const given = p.don.given[e.iid] ?? 0;
      if (given > 0) { p.don.rested += given; delete p.don.given[e.iid]; } // 6-5-5-4
      p.zones.trash.push(e.iid);
      p.instances[e.iid].rested = false;
      break;
    }

    case "battleEnded":
      state.battle = null; // thisBattle mods die with it (7-1-5-3/4)
      break;

    case "gameEnded":
      state.phase = "over";
      state.winner = e.winner;
      state.winReason = e.reason;
      state.pendingChoice = null;
      state.battle = null;
      break;
  }
}

/** Replay a log from a fresh skeleton (createGame builds the skeleton). */
export function replay(skeleton: AutoGameState, log: GameEvent[]): AutoGameState {
  const s = structuredClone(skeleton);
  for (const e of log) applyEvent(s, e);
  return s;
}
