// The decks' tokens as plain data (handoff decks.js and deck-photo-spec.md), with no
// imports so the baking script (scripts/bake-deck.mjs) can read them under Node.
// decks.ts adds the React side and the card helpers.
import type { PhotoTreatment } from './photoTreatment';

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
  /** How the full face shows court photos. The mini-slot (under 90 px) always shows the tinted render. */
  photoTreatment: PhotoTreatment;
  /** Card code (rank + S/H/D/C, e.g. 'QH', 'AS') to a 4:5 photo, as uploaded (natural). */
  photos: Partial<Record<string, string>>;
}

const BESLEY = "'Besley', Georgia, serif";
const GROTESK = "'Familjen Grotesk', system-ui, sans-serif";

export const COURT_CODES: string[] = ['J', 'Q', 'K'].flatMap((r) => ['S', 'H', 'D', 'C'].map((s) => r + s));

/** Court photos laid out as /decks/<id>/KS.jpg, QH.jpg, JD.jpg… */
function courtPhotos(id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of COURT_CODES) out[code] = `/decks/${id}/${code}.jpg`;
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
  photoTreatment: 'tinted',
  photos: {},
};

export const DECKS: Record<string, DeckSpec> = {
  // Lily is the family dog: the Enamel deck's tokens, her photos on all twelve
  // courts and the back. The owner asked for her photos as they are, so the full
  // face stays natural until the designer has seen the tinted and tritone sheet
  // (design-handback-2 §1). The mini-slot still shows the baked tinted render.
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
    photoTreatment: 'tinted',
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
    photoTreatment: 'tinted',
    photos: {},
  },
};

/**
 * Two-colour: spades and clubs black, hearts and diamonds red.
 * Four-colour: spades black, hearts red, diamonds blue, clubs green.
 * s: 0 spades, 1 hearts, 2 diamonds, 3 clubs.
 */
export function suitInk(deck: DeckSpec, s: number, fourColour: boolean): string {
  const i = deck.inks;
  if (fourColour) return [i.black, i.red, i.blue, i.green][s];
  return s === 1 || s === 2 ? i.red : i.black;
}
