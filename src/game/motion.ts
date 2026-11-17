// Motion helpers shared by the table (handoff motion.md and tokens.css).
// Rules: only transform and opacity animate; a tap during an animation skips it
// to its end state; under prefers-reduced-motion nothing travels and every move
// becomes a short fade.

export const DUR = {
  tap: 90,
  card: 220,
  flip: 320,
  count: 120,
  pegLift: 90,
  pegHop: 70,
  pegGlidePerHole: 30,
  pegGlideMax: 900,
  pegSeat: 120,
  pegRow: 120,
  showStep: 450,
  reduced: 120,
  /** A score in pegging: the cards stay butter and the call holds before the peg moves. */
  scoreHold: 500,
  /** After the show's last step the total holds before the peg moves. */
  showHold: 400,
} as const;

export const CSS_EASE = {
  out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  inOut: 'cubic-bezier(0.6, 0, 0.3, 1)',
  seat: 'cubic-bezier(0.3, 1.4, 0.5, 1)',
} as const;

/** A CSS cubic-bezier as a function of progress, for JS-driven motion (the pegs). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-5) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    t = Math.min(1, Math.max(0, t));
    return sy(t);
  };
}

export const EASE = {
  out: cubicBezier(0.2, 0.8, 0.2, 1),
  inOut: cubicBezier(0.6, 0, 0.3, 1),
  seat: cubicBezier(0.3, 1.4, 0.5, 1),
  linear: (t: number) => t,
};

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---- skip: a tap during any animation jumps it to its end state ----

const skippers = new Set<() => void>();

/** Register something that can be skipped; returns the unregister function. */
export function onSkip(fn: () => void): () => void {
  skippers.add(fn);
  return () => skippers.delete(fn);
}

export function skipAnimations(): void {
  for (const fn of [...skippers]) fn();
}

// ---- FLIP: fly an element in from where something used to be ----

const remembered = new Map<string, DOMRect>();

/** Remember where an element is now, so the element that replaces it can fly from here. */
export function rememberRect(key: string, el: Element | null | undefined): void {
  if (el) remembered.set(key, el.getBoundingClientRect());
}

export function takeRect(key: string): DOMRect | undefined {
  const r = remembered.get(key);
  remembered.delete(key);
  return r;
}

interface FlyOptions {
  duration?: number;
  easing?: string;
  delay?: number;
  /** Settle past the end by this many px in the direction of travel, then come back. */
  overshoot?: number;
  /** Scale from the source's size rather than the element's own. */
  scaleFrom?: boolean;
}

/** Animate `el` from the rect `from` to where it sits now (transform only). */
export function flyFrom(el: HTMLElement, from: DOMRect, opts: FlyOptions = {}): Animation | null {
  if (typeof el.animate !== 'function') return null;
  const to = el.getBoundingClientRect();
  if (!to.width || !from.width) return null;
  if (reducedMotion()) {
    return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.reduced, easing: 'linear' });
  }
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const s = opts.scaleFrom ? from.width / to.width : 1;
  const frames: Keyframe[] = [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }];
  if (opts.overshoot) {
    const len = Math.hypot(dx, dy) || 1;
    frames.push({ transform: `translate(${(-dx / len) * opts.overshoot}px, ${(-dy / len) * opts.overshoot}px)`, offset: 0.78 });
  }
  frames.push({ transform: 'none' });
  const anim = el.animate(frames, {
    duration: opts.duration ?? DUR.card,
    easing: opts.easing ?? CSS_EASE.out,
    delay: opts.delay ?? 0,
    fill: 'backwards',
  });
  const off = onSkip(() => anim.finish());
  anim.finished.then(off, off);
  return anim;
}

/** A small entrance for anything that appears in place (fade, or rise + fade). */
export function appear(el: HTMLElement, opts: { duration?: number; delay?: number; rise?: number } = {}): void {
  if (typeof el.animate !== 'function') return;
  const reduced = reducedMotion();
  const frames: Keyframe[] = reduced || !opts.rise
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: `translateY(${opts.rise}px)` }, { opacity: 1, transform: 'none' }];
  const anim = el.animate(frames, {
    duration: reduced ? DUR.reduced : opts.duration ?? DUR.card,
    delay: reduced ? 0 : opts.delay ?? 0,
    easing: CSS_EASE.out,
    fill: 'backwards',
  });
  const off = onSkip(() => anim.finish());
  anim.finished.then(off, off);
}
