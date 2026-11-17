// A deck is a theme: tokens plus optional photo slots (handoff decks.js and
// deck-photo-spec.md). Everything about how a card looks is chosen here and
// drawn by CardView; game screens only ever say "draw card N" or "draw a back".
import { createContext } from 'react';
import { type Card, RANKS, rank, suit } from '../../shared/cards';

export type PhotoTreatment = 'duotone' | 'natural';

export interface DeckSpec {
  id: string;
  name: string;
  stock: string;
  edge: string;
  /** Every ink must reach 4.5:1 on the stock. blue and green are for four-colour suits. */
  inks: { black: string; red: string; blue: string; green: string };
  back: { ink: string; photo: string | null };
  /** Corner radius as a fraction of the card's width, 0.03 to 0.12. */
  radius: number;
  indexFont: string;
  frame: 'single' | 'double';
  photoTreatment: PhotoTreatment;
  /** Card code (rank + S/H/D/C, e.g. 'QH', 'AS') to a 4:5 photo. */
  photos: Partial<Record<string, string>>;
}

const BESLEY = "'Besley', Georgia, serif";
const GROTESK = "'Familjen Grotesk', system-ui, sans-serif";

/** Court photos laid out as /decks/<id>/KS.jpg, QH.jpg, JD.jpg… */
function courtPhotos(id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of ['J', 'Q', 'K']) for (const s of 'SHDC') out[r + s] = `/decks/${id}/${r}${s}.jpg`;
  return out;
}

const enamel: DeckSpec = {
  id: 'enamel',
  name: 'Enamel',
  stock: '#FCFAF4',
  edge: '#CFC8B6',
  inks: { black: '#1F2723', red: '#BE3228', blue: '#2F6FA8', green: '#1E5C3A' },
  back: { ink: '#2F6B45', photo: null },
  radius: 0.07,
  indexFont: BESLEY,
  frame: 'double',
  photoTreatment: 'duotone',
  photos: {},
};

export const DECKS: Record<string, DeckSpec> = {
  // Lily is the family dog: the Enamel deck's tokens, her photos on all twelve
  // courts and the back. The red-ink duotone washes her out (design-handback-1
  // §1), so this deck keeps the photos natural; frame and vignette still apply.
  lily: {
    ...enamel,
    id: 'lily',
    name: 'Lily',
    back: { ink: enamel.back.ink, photo: '/decks/lily/back.jpg' },
    photoTreatment: 'natural',
    photos: courtPhotos('lily'),
  },
  enamel,
  seed: {
    id: 'seed',
    name: 'Seed Packet',
    stock: '#EDE1C6',
    edge: '#C4B58F',
    inks: { black: '#23402F', red: '#A5402A', blue: '#2F5E82', green: '#4A6424' },
    back: { ink: '#A5402A', photo: null },
    radius: 0.035,
    indexFont: BESLEY,
    frame: 'double',
    photoTreatment: 'duotone',
    photos: {},
  },
  blueplate: {
    id: 'blueplate',
    name: 'Blue Plate',
    stock: '#F3F6F7',
    edge: '#BFCBD2',
    inks: { black: '#1D3555', red: '#C23A2E', blue: '#2F6FA8', green: '#256B4B' },
    back: { ink: '#1D3555', photo: null },
    radius: 0.11,
    indexFont: GROTESK,
    frame: 'double',
    photoTreatment: 'duotone',
    photos: {},
  },
};

export const DECK_ORDER = ['lily', 'enamel', 'seed', 'blueplate'] as const;
export const DEFAULT_DECK = 'lily';

export const getDeck = (id: string | undefined): DeckSpec => DECKS[id ?? DEFAULT_DECK] ?? DECKS[DEFAULT_DECK];

/** Which deck the cards below this provider use. */
export const DeckContext = createContext<string>(DEFAULT_DECK);

export const SUIT_CODES = ['S', 'H', 'D', 'C'] as const;
export const cardCode = (c: Card): string => RANKS[rank(c)] + SUIT_CODES[suit(c)];

/**
 * Two-colour: spades and clubs black, hearts and diamonds red.
 * Four-colour: spades black, hearts red, diamonds blue, clubs green.
 */
export function suitInk(deck: DeckSpec, s: number, fourColour: boolean): string {
  const i = deck.inks;
  if (fourColour) return [i.black, i.red, i.blue, i.green][s];
  return s === 1 || s === 2 ? i.red : i.black;
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
