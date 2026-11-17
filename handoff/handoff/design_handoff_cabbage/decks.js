// A deck is a theme: tokens plus optional photo slots.
// The three house decks need no photos.

export const DECKS = {
  enamel: {
    name: 'Enamel',
    stock: '#FCFAF4',
    edge: '#CFC8B6',
    inks: { black: '#1F2723', red: '#BE3228', blue: '#2F6FA8', green: '#1E5C3A' },
    back: { ink: '#2F6B45', photo: null },
    radius: 0.07, // fraction of card width
    indexFont: "'Besley', Georgia, serif",
    frame: 'double', // 'single' | 'double'
    photoTreatment: 'duotone', // 'duotone' | 'natural'
    photos: {}, // e.g. { JS: url, QS: url, KS: url, ..., AS: url }
  },
  seed: {
    name: 'Seed Packet',
    stock: '#EDE1C6',
    edge: '#C4B58F',
    inks: { black: '#23402F', red: '#A5402A', blue: '#2F5E82', green: '#4A6424' },
    back: { ink: '#A5402A', photo: null },
    radius: 0.035,
    indexFont: "'Besley', Georgia, serif",
    frame: 'double',
    photoTreatment: 'duotone',
    photos: {},
  },
  blueplate: {
    name: 'Blue Plate',
    stock: '#F3F6F7',
    edge: '#BFCBD2',
    inks: { black: '#1D3555', red: '#C23A2E', blue: '#2F6FA8', green: '#256B4B' },
    back: { ink: '#1D3555', photo: null },
    radius: 0.11,
    indexFont: "'Familjen Grotesk', system-ui, sans-serif",
    frame: 'double',
    photoTreatment: 'duotone',
    photos: {},
  },
};

// Two-colour: spades and clubs black, hearts and diamonds red.
// Four-colour: spades black, hearts red, diamonds blue, clubs green.
export function suitInk(deck, suit, fourColour) {
  const i = deck.inks;
  if (fourColour) return { S: i.black, H: i.red, D: i.blue, C: i.green }[suit];
  return suit === 'H' || suit === 'D' ? i.red : i.black;
}

// Suit glyphs as 24 x 24 paths, so no font or emoji fallback can change them.
export const GLYPH = {
  H: 'M12 21 C5 15 2 11.5 2 7.8 C2 4.9 4.2 3 6.8 3 C9 3 10.9 4.2 12 6.2 C13.1 4.2 15 3 17.2 3 C19.8 3 22 4.9 22 7.8 C22 11.5 19 15 12 21 Z',
  D: 'M12 2 L20.5 12 L12 22 L3.5 12 Z',
  S: 'M12 2 C8 7 3 10 3 14.2 C3 16.9 5 18.6 7.3 18.6 C8.9 18.6 10.3 17.8 11.1 16.6 C10.9 18.9 10.1 20.6 8.6 22 L15.4 22 C13.9 20.6 13.1 18.9 12.9 16.6 C13.7 17.8 15.1 18.6 16.7 18.6 C19 18.6 21 16.9 21 14.2 C21 10 16 7 12 2 Z',
  C: 'M12 2.5 a4.3 4.3 0 1 1 0 8.6 a4.3 4.3 0 1 1 0 -8.6 Z M6.6 9.6 a4.3 4.3 0 1 1 0 8.6 a4.3 4.3 0 1 1 0 -8.6 Z M17.4 9.6 a4.3 4.3 0 1 1 0 8.6 a4.3 4.3 0 1 1 0 -8.6 Z M9.5 9 L14.5 9 L14.5 14 L13 14 L13 16 C13.2 18.8 14 20.6 15.4 22 L8.6 22 C10 20.6 10.8 18.8 11 16 L11 14 L9.5 14 Z',
};

// Pip centres as [x, y] fractions of the card. Pips below the middle are rotated 180 degrees.
const L = 0.32, C = 0.5, R = 0.68;
export const PIPS = {
  A: [[C, 0.5]],
  2: [[C, 0.2], [C, 0.8]],
  3: [[C, 0.2], [C, 0.5], [C, 0.8]],
  4: [[L, 0.2], [R, 0.2], [L, 0.8], [R, 0.8]],
  5: [[L, 0.2], [R, 0.2], [C, 0.5], [L, 0.8], [R, 0.8]],
  6: [[L, 0.2], [R, 0.2], [L, 0.5], [R, 0.5], [L, 0.8], [R, 0.8]],
  7: [[L, 0.2], [R, 0.2], [C, 0.35], [L, 0.5], [R, 0.5], [L, 0.8], [R, 0.8]],
  8: [[L, 0.2], [R, 0.2], [C, 0.35], [L, 0.5], [R, 0.5], [C, 0.65], [L, 0.8], [R, 0.8]],
  9: [[L, 0.2], [R, 0.2], [L, 0.4], [R, 0.4], [C, 0.5], [L, 0.6], [R, 0.6], [L, 0.8], [R, 0.8]],
  10: [[L, 0.2], [R, 0.2], [C, 0.3], [L, 0.4], [R, 0.4], [L, 0.6], [R, 0.6], [C, 0.7], [L, 0.8], [R, 0.8]],
};

export const RANK_NAMES = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
export const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
