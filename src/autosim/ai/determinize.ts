import type { AutoGameState, Iid, PID } from "../engine/state";
import { markStateEdited } from "../engine/stateVersion";

/**
 * A copy of the game as `viewer` could imagine it: every card viewer cannot
 * see is reshuffled among the hidden places it could be. Without this an agent
 * that simulates would read the opponent's hand, its Life and both decks.
 *
 * Hidden to the viewer: opponent hand, both decks, face-down Life (own Life
 * too: nobody looks at it). Cards shown by the viewer's own open prompt are visible.
 * Only `cardId`s move between instances, so every iid the state refers to
 * (prompts, battle, given DON) stays valid. The seed changes too: future
 * shuffles are unknown as well.
 */
export function determinize(state: AutoGameState, viewer: PID, rng: () => number): AutoGameState {
  const copy = structuredClone(state);
  const seen = visibleToViewer(copy, viewer);
  for (const p of Object.values(copy.players)) {
    const z = p.zones;
    const faceDownLife = z.life.filter((iid) => !p.instances[iid].faceUp);
    const hidden = [...z.deck, ...faceDownLife, ...(p.id === viewer ? [] : z.hand)].filter((iid) => !seen.has(iid));
    const ids = shuffled(hidden.map((iid) => p.instances[iid].cardId), rng);
    hidden.forEach((iid, i) => { p.instances[iid].cardId = ids[i]; });
  }
  copy.seed = `${copy.seed}|det-${Math.floor(rng() * 1e9).toString(36)}`;
  markStateEdited(copy);
  return copy;
}

function visibleToViewer(state: AutoGameState, viewer: PID): Set<Iid> {
  const pc = state.pendingChoice;
  if (pc?.kind === "triggerDecision") return new Set([pc.iid]); // a revealed Life card is public
  if (!pc || pc.player !== viewer) return new Set();
  if (pc.kind === "peekSelect" || pc.kind === "arrangeLife") return new Set(pc.cards);
  if (pc.kind === "selectTargets") return new Set(pc.candidates.map((c) => c.iid));
  return new Set();
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
