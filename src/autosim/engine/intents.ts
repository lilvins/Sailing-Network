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
  | { type: "respondBlock"; player: PID; blockerIid: Iid | null }    // 7-1-2 (M1)
  | { type: "useCounter"; player: PID; cardIid: Iid; targetIid: Iid } // 7-1-3-2-1
  | { type: "passCounter"; player: PID }                             // closes 7-1-3
  // any time
  | { type: "concede"; player: PID };                                // 1-2-3

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}
