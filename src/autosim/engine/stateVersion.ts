import type { AutoGameState } from "./state";

/**
 * A version number per game-state object, bumped by the event reducer
 * (`applyEvent`) on every event. Values derived only from event-built state
 * (the continuous effects, static negation) can then be cached for "this
 * state object at this version" and recomputed only after the next event.
 *
 * Kept outside the state on purpose: the state stays plain JSON, and a copy
 * (structuredClone in applyIntent, the rollouts) starts with no cached value.
 * Not tracked: `exec`, `pendingChoice`, `rngUses` — written directly by the
 * engine, and never read by what is cached here.
 */
const versions = new WeakMap<AutoGameState, number>();

export function stateVersion(state: AutoGameState): number {
  return versions.get(state) ?? 0;
}

export function bumpStateVersion(state: AutoGameState): void {
  versions.set(state, stateVersion(state) + 1);
}

/**
 * For code that changes a state by hand instead of through events (test
 * set-ups, tools): call it after the change, or the cached values above
 * would still describe the state as it was.
 */
export const markStateEdited = bumpStateVersion;

/**
 * Caches `compute(db, state)` for one state object at one version and one
 * card DB. Returns a function with the same signature.
 */
export function cachedPerVersion<D extends object, T>(
  compute: (db: D, state: AutoGameState) => T,
): (db: D, state: AutoGameState) => T {
  const cache = new WeakMap<AutoGameState, { db: D; version: number; value: T }>();
  return (db, state) => {
    const version = stateVersion(state);
    const hit = cache.get(state);
    if (hit && hit.db === db && hit.version === version) return hit.value;
    const value = compute(db, state);
    cache.set(state, { db, version, value });
    return value;
  };
}
