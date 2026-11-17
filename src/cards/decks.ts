// A deck is a theme: tokens plus optional photo slots (handoff decks.js and
// deck-photo-spec.md). Everything about how a card looks is chosen here and
// drawn by CardView; game screens only ever say "draw card N" or "draw a back".
// The tokens themselves live in deckTokens.ts (plain data the baking script reads).
import { createContext } from 'react';
import { type Card, RANKS, rank, suit } from '../../shared/cards';
import baked from './baked';
import { DECKS, type DeckSpec } from './deckTokens';
import type { PhotoTreatment } from './photoTreatment';

export type { PhotoTreatment } from './photoTreatment';
export { DECKS, suitInk, type DeckSpec } from './deckTokens';

export const DECK_ORDER = ['lily', 'enamel', 'seed', 'blueplate'] as const;
export const DEFAULT_DECK = 'lily';

export const getDeck = (id: string | undefined): DeckSpec => DECKS[id ?? DEFAULT_DECK] ?? DECKS[DEFAULT_DECK];

/** Which deck the cards below this provider use. */
export const DeckContext = createContext<string>(DEFAULT_DECK);

export const SUIT_CODES = ['S', 'H', 'D', 'C'] as const;
export const cardCode = (c: Card): string => RANKS[rank(c)] + SUIT_CODES[suit(c)];

// ---- baked renders (scripts/bake-deck.mjs) ----

/** What the baking script wrote for one deck (src/cards/baked.ts). */
export interface BakedDeck {
  /** Public folder of the renders, e.g. /decks/lily/baked. */
  dir: string;
  treatments: PhotoTreatment[];
  codes: string[];
  /** Courts that also have a four-colour render (their four-colour ink differs). */
  four: string[];
  /** The tokens the renders were baked with; a deck whose tokens have changed since is treated as unbaked. */
  stock: string;
  inks: DeckSpec['inks'];
}

const BAKED = baked as unknown as Record<string, BakedDeck>;

const sameInks = (a: DeckSpec['inks'], b: DeckSpec['inks']) =>
  a.black === b.black && a.red === b.red && a.blue === b.blue && a.green === b.green;

/**
 * The baked render of a court photo, if there is one:
 *   <dir>/<CODE>.<treatment>.jpg      in the two-colour ink
 *   <dir>/<CODE>.<treatment>.4c.jpg   in the four-colour ink, where that differs
 * Null for 'natural', an unbaked deck or court, or renders baked with other tokens.
 */
export function bakedPhoto(deck: DeckSpec, code: string, treatment: PhotoTreatment, fourColour: boolean): string | null {
  if (treatment === 'natural') return null;
  const b = BAKED[deck.id];
  if (!b || !b.treatments.includes(treatment) || !b.codes.includes(code)) return null;
  if (b.stock !== deck.stock || !sameInks(b.inks, deck.inks)) return null;
  const four = fourColour && b.four.includes(code);
  return `${b.dir}/${code}.${treatment}${four ? '.4c' : ''}.jpg`;
}

// Pip centres as [x, y] fractions of the card, by rank index (0 = ace … 9 = ten).
// Pips below the middle are turned 180 degrees.
const L = 0.32;
const C = 0.5;
const R = 0.68;
export const PIPS: [number, number][][] = [
  [[C, 0.5]],
  [[C, 0.2], [C, 0.8]],
  [[C, 0.2], [C, 0.5], [C, 0.8]],
  [[L, 0.2], [R, 0.2], [L, 0.8], [R, 0.8]],
  [[L, 0.2], [R, 0.2], [C, 0.5], [L, 0.8], [R, 0.8]],
  [[L, 0.2], [R, 0.2], [L, 0.5], [R, 0.5], [L, 0.8], [R, 0.8]],
  [[L, 0.2], [R, 0.2], [C, 0.35], [L, 0.5], [R, 0.5], [L, 0.8], [R, 0.8]],
  [[L, 0.2], [R, 0.2], [C, 0.35], [L, 0.5], [R, 0.5], [C, 0.65], [L, 0.8], [R, 0.8]],
  [[L, 0.2], [R, 0.2], [L, 0.4], [R, 0.4], [C, 0.5], [L, 0.6], [R, 0.6], [L, 0.8], [R, 0.8]],
  [[L, 0.2], [R, 0.2], [C, 0.3], [L, 0.4], [R, 0.4], [L, 0.6], [R, 0.6], [C, 0.7], [L, 0.8], [R, 0.8]],
];
