// Haptics where motion.md calls for them. They fire when something lands, never
// when it starts, and are unchanged under reduced motion. Guarded: most desktop
// browsers and iOS Safari have no navigator.vibrate, and Chrome refuses (with a
// console warning) until the user has interacted with the page.

export type Haptic = 'light' | 'medium' | 'heavy';

const PATTERN: Record<Haptic, number | number[]> = { light: 10, medium: 22, heavy: [35, 40, 35] };

export function haptic(kind: Haptic): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    navigator.vibrate(PATTERN[kind]);
  } catch {
    /* unsupported or refused */
  }
}

/** Three medium pulses 120 ms apart: the 29. */
export function hapticTwentyNine(): void {
  haptic('medium');
  setTimeout(() => haptic('medium'), 120);
  setTimeout(() => haptic('medium'), 240);
}
