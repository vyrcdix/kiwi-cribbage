// Ghost cards that fly across zones (the deal, discards to the crib). They live in a
// fixed layer above the table, animate transform and opacity only, and remove
// themselves on landing. A tap skips them; under reduced motion none are launched.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/cards';
import { CardView } from '../cards/CardView';
import { CSS_EASE, DUR, onSkip, reducedMotion } from './motion';

export interface Flight {
  id: number;
  card: Card | null;
  from: DOMRect;
  to: DOMRect;
  delay: number;
  duration: number;
  easing: string;
  /** Called as it lands. */
  onLand?: () => void;
  /** Stay at the destination until this resolves, then turn over (the deal's flip). */
  release?: Promise<void>;
}

type Listener = (f: Flight) => void;
const listeners = new Set<Listener>();
let nextId = 1;

/** Launch a ghost card. Returns false (and does nothing) under reduced motion. */
export function fly(f: Omit<Flight, 'id' | 'delay' | 'duration' | 'easing'> & Partial<Pick<Flight, 'delay' | 'duration' | 'easing'>>): boolean {
  if (reducedMotion() || !f.from.width || !f.to.width || listeners.size === 0) return false;
  const flight: Flight = { delay: 0, duration: DUR.card, easing: CSS_EASE.out, ...f, id: nextId++ };
  for (const l of listeners) l(flight);
  return true;
}

function Ghost({ f, done }: { f: Flight; done: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      done(f.id);
      return;
    }
    const dx = f.to.left - f.from.left + (f.to.width - f.from.width) / 2;
    const dy = f.to.top - f.from.top + (f.to.height - f.from.height) / 2;
    const s = f.to.width / f.from.width;
    const anim = el.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1 },
      ],
      { duration: f.duration, delay: f.delay, easing: f.easing, fill: 'both' },
    );
    let landed = false;
    let disposed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      f.onLand?.();
      if (!f.release) {
        done(f.id);
        return;
      }
      f.release.then(() => {
        if (disposed) return;
        const turn = el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
            { transform: `translate(${dx}px, ${dy}px) scale(0, ${s})` },
          ],
          { duration: DUR.flip / 2, easing: 'ease-in', fill: 'both' },
        );
        turn.finished.then(() => done(f.id), () => done(f.id));
      });
    };
    anim.finished.then(land, () => {
      if (!disposed) land();
    });
    const off = onSkip(() => anim.finish());
    return () => {
      disposed = true;
      off();
      anim.cancel();
    };
  }, [f, done]);
  return (
    <div
      ref={ref}
      className="ghost"
      style={{ left: f.from.left, top: f.from.top, width: f.from.width }}
    >
      <CardView card={f.card} width={f.from.width} decorative />
    </div>
  );
}

export function Flights() {
  const [flights, setFlights] = useState<Flight[]>([]);
  useEffect(() => {
    const l: Listener = (f) => setFlights((xs) => [...xs, f]);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const doneRef = useRef((id: number) => setFlights((xs) => xs.filter((x) => x.id !== id)));
  if (!flights.length) return null;
  return (
    <div className="flights" aria-hidden="true">
      {flights.map((f) => <Ghost key={f.id} f={f} done={doneRef.current} />)}
    </div>
  );
}
