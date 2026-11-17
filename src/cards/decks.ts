// Deck definitions. Everything about how a card looks is chosen here and drawn
// by CardView; game screens only ever say "draw card N" or "draw a back".
//
// A deck may supply photo images for any subset of faces (e.g. just the court
// cards) and/or the back. Anything it doesn't supply is drawn in CSS/SVG, and
// any image that fails to load falls back to the drawn version.
import { createContext } from 'react';
import { type Card, RANKS, rank, suit } from '../../shared/cards';

/** Court cards as photos: /decks/<id>/KS.jpg, QH.jpg, JD.jpg… (rank + S/H/D/C). */
const courtPhotos = (id: string) => (card: Card): string | undefined =>
  rank(card) >= 10 ? `/decks/${id}/${RANKS[rank(card)]}${'SHDC'[suit(card)]}.jpg` : undefined;

export interface DeckSpec {
  id: string;
  name: string;
  /** Image URL for the card back (5:7). Omit to use the drawn pattern. */
  back?: string;
  /** Image URL for a face (5:7), or undefined to draw that face. */
  face?: (card: Card) => string | undefined;
  /** Extra class on every card of this deck, for deck-specific CSS tweaks. */
  className?: string;
}

export const DECKS: Record<string, DeckSpec> = {
  // Lily is the family dog: on the back of every card, and all twelve royals.
  lily: { id: 'lily', name: 'Lily', back: '/decks/lily/back.jpg', face: courtPhotos('lily') },
  classic: { id: 'classic', name: 'Classic' },
};

export const DEFAULT_DECK = 'lily';

export const getDeck = (id: string | undefined): DeckSpec => DECKS[id ?? DEFAULT_DECK] ?? DECKS[DEFAULT_DECK];

/** Which deck the cards below this provider use. A later phase can let players pick. */
export const DeckContext = createContext<string>(DEFAULT_DECK);
