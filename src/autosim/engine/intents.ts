/**
 * Player intents — what a seat ASKS the engine to do. The engine validates,
 * resolves, and turns legal intents into events. Illegal intents throw
 * EngineError and leave the state untouched.
 */
import type { Iid, PID } from "./state";

export type PlayerIntent =
  // setup
  | { type: "respondMulligan"; player: PID; take: boolean }          // 5-2-1-6
  // main phase (6-5)
  | { type: "playCard"; player: PID; iid: Iid; replaceIid?: Iid }    // 6-5-3 (+3-7-6-1/3-8-5-1)
  | { type: "giveDon"; player: PID; targetIid: Iid }                 // 6-5-5
  | { type: "attack"; player: PID; attackerIid: Iid; targetIid: Iid } // 6-5-6, 7-1-1
  | { type: "endTurn"; player: PID }                                 // 6-5-2-1 → 6-6
  // battle windows
  | { type: "respondBlock"; player: PID; blockerIid: Iid | null }    // 7-1-2 / 10-1-4
  | { type: "useCounter"; player: PID; cardIid: Iid; targetIid: Iid } // 7-1-3-2-1
  | { type: "useCounterEvent"; player: PID; cardIid: Iid }           // 7-1-3-2-2
  | { type: "passCounter"; player: PID }                             // closes 7-1-3
  // effect resolution (8, M1)
  | { type: "respondTrigger"; player: PID; activate: boolean }       // 10-1-5-1/2, 8-6-2-1
  | { type: "respondTargets"; player: PID; iids: Iid[] }             // 8-4-4 selectTargets
  | { type: "respondMay"; player: PID; activate: boolean }           // 8-1-2 mayActivate
  | { type: "ackManual"; player: PID }                               // manualResolve acknowledgement
  // any time
  | { type: "concede"; player: PID };                                // 1-2-3

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}
