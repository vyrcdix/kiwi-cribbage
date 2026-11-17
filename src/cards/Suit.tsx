// Suit glyphs as SVG, so hearts and diamonds never turn into emoji.
import type { ReactElement } from 'react';

const PATHS: Record<number, ReactElement> = {
  // spade
  0: (
    <path d="M50 4C62 22 94 38 94 62c0 14-10 23-22 23-8 0-15-4-18-10 1 10 5 17 13 21H33c8-4 12-11 13-21-3 6-10 10-18 10C16 85 6 76 6 62 6 38 38 22 50 4Z" />
  ),
  // heart
  1: (
    <path d="M50 92C22 70 4 52 4 31 4 16 15 6 28 6c10 0 18 6 22 15 4-9 12-15 22-15 13 0 24 10 24 25 0 21-18 39-46 61Z" />
  ),
  // diamond
  2: <path d="M50 3Q68 29 88 50 68 71 50 97 32 71 12 50 32 29 50 3Z" />,
  // club
  3: (
    <g>
      <circle cx="50" cy="27" r="20" />
      <circle cx="27" cy="58" r="20" />
      <circle cx="73" cy="58" r="20" />
      <path d="M45 50h10c0 22 3 34 13 46H32c10-12 13-24 13-46Z" />
    </g>
  ),
};

export function Suit({ s, className }: { s: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="currentColor" aria-hidden="true" focusable="false">
      {PATHS[s]}
    </svg>
  );
}
