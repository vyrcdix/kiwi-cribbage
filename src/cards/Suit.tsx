// Suit glyphs as 24 x 24 SVG paths, so no font or emoji fallback can change them.
import type { CSSProperties } from 'react';

/** By suit index: 0 spades, 1 hearts, 2 diamonds, 3 clubs. */
export const GLYPH = [
  'M12 2 C8 7 3 10 3 14.2 C3 16.9 5 18.6 7.3 18.6 C8.9 18.6 10.3 17.8 11.1 16.6 C10.9 18.9 10.1 20.6 8.6 22 L15.4 22 C13.9 20.6 13.1 18.9 12.9 16.6 C13.7 17.8 15.1 18.6 16.7 18.6 C19 18.6 21 16.9 21 14.2 C21 10 16 7 12 2 Z',
  'M12 21 C5 15 2 11.5 2 7.8 C2 4.9 4.2 3 6.8 3 C9 3 10.9 4.2 12 6.2 C13.1 4.2 15 3 17.2 3 C19.8 3 22 4.9 22 7.8 C22 11.5 19 15 12 21 Z',
  'M12 2 L20.5 12 L12 22 L3.5 12 Z',
  'M12 2.5 a4.3 4.3 0 1 1 0 8.6 a4.3 4.3 0 1 1 0 -8.6 Z M6.6 9.6 a4.3 4.3 0 1 1 0 8.6 a4.3 4.3 0 1 1 0 -8.6 Z M17.4 9.6 a4.3 4.3 0 1 1 0 8.6 a4.3 4.3 0 1 1 0 -8.6 Z M9.5 9 L14.5 9 L14.5 14 L13 14 L13 16 C13.2 18.8 14 20.6 15.4 22 L8.6 22 C10 20.6 10.8 18.8 11 16 L11 14 L9.5 14 Z',
] as const;

export function Pip({ s, className, style }: { s: number; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className} style={style}>
      <path d={GLYPH[s]} fill="currentColor" />
    </svg>
  );
}
