// "Counting pace": how fast the show counts a hand aloud. Relaxed (the default) gives
// each step about 1.4 s to look at the cards and read the line; brisk is about half.
// Kept on this device in localStorage for now; the toggle is on the Profile screen.
import { useSyncExternalStore } from 'react';

export type Pace = 'relaxed' | 'brisk';

const KEY = 'cabbage:pace';
const listeners = new Set<() => void>();

function read(): Pace {
  try {
    return localStorage.getItem(KEY) === 'brisk' ? 'brisk' : 'relaxed';
  } catch {
    return 'relaxed';
  }
}

let pace: Pace = typeof localStorage === 'undefined' ? 'relaxed' : read();

export function setPace(next: Pace): void {
  pace = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private mode: keep it for this visit.
  }
  for (const l of listeners) l();
}

export function usePace(): [Pace, (p: Pace) => void] {
  const p = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pace,
    () => pace,
  );
  return [p, setPace];
}

/** Timings of the count, in ms. `gap` is the moment with nothing lit between steps, so the eye sees the change. */
export function countTiming(p: Pace): { step: number; gap: number; total: number } {
  return p === 'brisk' ? { step: 700, gap: 110, total: 900 } : { step: 1400, gap: 200, total: 1800 };
}
