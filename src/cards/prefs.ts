// Per-player card preferences. Four-colour suits are a player setting, not a
// deck property (handoff README, "The cards"). The profile on the server
// (GET/PATCH /api/me) is the source of truth; this module holds the value in
// memory so every CardView can read it synchronously, and the session pushes
// changes back to the server. Signed out, it is off.
import { useSyncExternalStore } from 'react';

/** Where four-colour lived before profiles were on the server. Migrated once, then removed. */
const LEGACY_KEY = 'cabbage:cards';

let fourColour = false;
let persist: ((on: boolean) => void) | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

/** The session sets this from the profile (and clears it on sign-out). */
export function setFourColourFromProfile(on: boolean): void {
  if (fourColour === on) return;
  fourColour = on;
  emit();
}

/** The session registers how a change is saved to the profile. */
export function setFourColourPersist(fn: ((on: boolean) => void) | null): void {
  persist = fn;
}

/**
 * The old localStorage preference, if any, removing it so the migration runs
 * once per device. Returns null when there was nothing to migrate.
 */
export function takeLegacyFourColour(): boolean | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) return null;
    localStorage.removeItem(LEGACY_KEY);
    const p: unknown = JSON.parse(raw);
    return Boolean(p && typeof p === 'object' && (p as { fourColour?: unknown }).fourColour === true);
  } catch {
    return null;
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFourColour(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => fourColour, () => fourColour);
  return [
    on,
    (next: boolean) => {
      setFourColourFromProfile(next);
      persist?.(next);
    },
  ];
}
