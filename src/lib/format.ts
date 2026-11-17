import { type Card, RANKS, SUITS, SUIT_NAMES, rank, suit } from '../../shared/cards';

// U+FE0E asks for the text (not emoji) presentation of ♥ and ♦ on iOS.
const TEXT_STYLE = '︎';
const RANK_NAMES = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];

export const cardText = (c: Card): string => RANKS[rank(c)] + SUITS[suit(c)] + TEXT_STYLE;
export const cardSpoken = (c: Card): string => `${RANK_NAMES[rank(c)]} of ${SUIT_NAMES[suit(c)]}`;

export const possessive = (name: string): string => `${name}’s`;

export function timeAgo(ts: string | number | null | undefined): string {
  if (ts === null || ts === undefined) return '';
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return '';
  const secs = Math.round((t - Date.now()) / 1000);
  const abs = Math.abs(secs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(secs / 86400), 'day');
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
