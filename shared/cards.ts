// A card is an integer 0..51: rank = c % 13 (0 = ace … 12 = king),
// suit = floor(c / 13) (0 ♠, 1 ♥, 2 ♦, 3 ♣).
export type Card = number;

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export const JACK = 10;

export const rank = (c: Card): number => c % 13;
export const suit = (c: Card): number => Math.floor(c / 13);
/** Counting value: ace 1, pips face value, court cards 10. */
export const value = (c: Card): number => Math.min(rank(c) + 1, 10);
export const isRed = (c: Card): boolean => suit(c) === 1 || suit(c) === 2;
export const cardName = (c: Card): string => RANKS[rank(c)] + SUITS[suit(c)];
export const card = (r: number, s: number): Card => s * 13 + r;

export const fullDeck = (): Card[] => Array.from({ length: 52 }, (_, i) => i);
export const sortHand = (cards: Card[]): Card[] =>
  [...cards].sort((a, b) => rank(a) - rank(b) || suit(a) - suit(b));
