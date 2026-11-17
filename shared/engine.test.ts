import { describe, expect, it } from 'vitest';
import { type Card, card, fullDeck, value } from './cards';
import { type Action, type GameState, type Seat, applyAction, newGame, other, viewFor } from './game';
import { scoreHand, scorePegPlay } from './scoring';

// Tiny card parser: "5h" "10s" "Jd" "Ac".
const c = (s: string): Card => {
  const r = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(s.slice(0, -1).toUpperCase());
  const su = 'shdc'.indexOf(s.slice(-1));
  if (r < 0 || su < 0) throw new Error(`bad card ${s}`);
  return card(r, su);
};
const cs = (s: string) => s.split(' ').map(c);
const hand = (h: string, starter: string, crib = false) => scoreHand(cs(h), c(starter), crib).total;

describe('scoreHand', () => {
  it('scores the perfect 29', () => expect(hand('5h 5d 5c Js', '5s')).toBe(29));
  it('scores 28', () => expect(hand('5h 5d 5c 5s', 'Ks')).toBe(28));
  it('scores double-double runs at 24', () => {
    expect(hand('4h 4d 5c 5s', '6s')).toBe(24);
    expect(hand('7h 7d 8c 8s', '9s')).toBe(24);
  });
  it('scores a zero hand', () => expect(hand('2h 4d 6c 8s', 'Ks')).toBe(0));
  it('counts a run of five once', () => expect(hand('Ah 2d 3c 4s', '5s')).toBe(7)); // run 5 + one fifteen
  it('counts a triple run', () => expect(hand('3h 3d 3c 4s', '5s')).toBe(21)); // three runs 9 + pair royal 6 + three fifteens 6
  it('does not wrap runs around the king', () => expect(hand('Qh Kd Ac 2s', '7s')).toBe(0));
  it('counts a four-card flush in hand but not crib', () => {
    expect(hand('2h 4h 6h 8h', 'Ks')).toBe(4);
    expect(hand('2h 4h 6h 8h', 'Ks', true)).toBe(0);
    expect(hand('2h 4h 6h 8h', 'Kh')).toBe(5);
    expect(hand('2h 4h 6h 8h', 'Kh', true)).toBe(5);
  });
  it('does not count a flush made with the starter', () => expect(hand('2h 4h 6h 8s', 'Kh')).toBe(0));
  it('counts his nobs only for a jack in hand', () => {
    expect(hand('Jh 2d 4c 8s', 'Kh')).toBe(1);
    expect(hand('Kh 2d 4c 8s', 'Jh')).toBe(0);
  });
});

describe('scorePegPlay', () => {
  const pts = (s: string) => scorePegPlay(cs(s)).reduce((n, it) => n + it.points, 0);
  it('fifteen and thirty-one', () => {
    expect(pts('7h 8d')).toBe(2);
    expect(pts('Kh Qd Jc As')).toBe(2);
  });
  it('pairs, pair royal, double pair royal', () => {
    expect(pts('4h 4d')).toBe(2);
    expect(pts('4h 4d 4c')).toBe(6);
    expect(pts('4h 4d 4c 4s')).toBe(12);
    expect(pts('4h 9d 4c')).toBe(0);
  });
  it('runs in any order', () => {
    expect(pts('4h 6d 5c')).toBe(3 + 2); // run of three, and 15
    expect(pts('2h 4d 3c As')).toBe(4);
    expect(pts('2h 3d 3c 4s')).toBe(0); // the pair breaks it
  });
  it('a later card can extend past an interruption', () => expect(pts('9h 3d 2c As')).toBe(3 + 2));
});

// A deterministic shuffle so the playthroughs are reproducible.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const shuffler = (rand: () => number) => () => {
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

/** Any legal action for this seat, or null if they have nothing to do. */
export function legalAction(s: GameState, seat: Seat, rand: () => number): Action | null {
  const h = s.hands[seat];
  if (s.phase === 'discard' && h.length === 6) {
    const i = Math.floor(rand() * 6);
    const j = (i + 1 + Math.floor(rand() * 5)) % 6;
    return { t: 'discard', cards: [h[i], h[j]] };
  }
  if (s.phase === 'cut' && seat !== s.dealer) return { t: 'cut' };
  if (s.phase === 'peg' && s.turn === seat) {
    const ok = h.filter((x) => s.count + value(x) <= 31);
    return { t: 'play', card: ok[Math.floor(rand() * ok.length)] };
  }
  if (s.phase === 'show' && !s.acks[seat]) return { t: 'ack' };
  return null;
}

describe('game', () => {
  it('plays 100 random games to a clean finish', () => {
    for (let g = 0; g < 100; g++) {
      const rand = rng(g + 1);
      const shuffle = shuffler(rand);
      let { state } = newGame(shuffle);
      let steps = 0;
      while (state.phase !== 'over') {
        const seat: Seat = legalAction(state, 0, rand) ? 0 : 1;
        const action = legalAction(state, seat, rand);
        // Someone must always be able to move — otherwise the game is stuck.
        expect(action, `stuck in ${state.phase} (game ${g})`).not.toBeNull();
        const before = state.scores[0] + state.scores[1];
        state = applyAction(state, seat, action!, shuffle).state;
        expect(state.scores[0] + state.scores[1]).toBeGreaterThanOrEqual(before);
        expect(state.count).toBeLessThanOrEqual(31);
        // Every card is somewhere exactly once during a hand.
        if (state.phase === 'peg') {
          expect(state.hands[0].length + state.hands[1].length + state.played.length).toBe(8);
          expect(state.crib.length).toBe(4);
        }
        expect(++steps).toBeLessThan(5000);
      }
      const w = state.winner!;
      expect(state.scores[w]).toBe(121);
      expect(state.scores[other(w)]).toBeLessThan(121);
      const st = state.stats[w];
      expect(st.peg + st.hand + st.crib).toBeGreaterThanOrEqual(121);
    }
  });

  it('rejects illegal moves', () => {
    const shuffle = shuffler(rng(7));
    const { state } = newGame(shuffle);
    const pone = other(state.dealer);
    expect(() => applyAction(state, 0, { t: 'cut' }, shuffle)).toThrow();
    expect(() => applyAction(state, 0, { t: 'play', card: state.hands[0][0] }, shuffle)).toThrow();
    expect(() => applyAction(state, 0, { t: 'discard', cards: [state.hands[1][0], state.hands[0][0]] }, shuffle)).toThrow();
    let s = applyAction(state, 0, { t: 'discard', cards: [state.hands[0][0], state.hands[0][1]] }, shuffle).state;
    expect(() => applyAction(s, 0, { t: 'discard', cards: [s.hands[0][0], s.hands[0][1]] }, shuffle)).toThrow();
    s = applyAction(s, 1, { t: 'discard', cards: [s.hands[1][0], s.hands[1][1]] }, shuffle).state;
    expect(() => applyAction(s, state.dealer, { t: 'cut' }, shuffle)).toThrow();
    s = applyAction(s, pone, { t: 'cut' }, shuffle).state;
    expect(() => applyAction(s, state.dealer, { t: 'play', card: s.hands[state.dealer][0] }, shuffle)).toThrow();
  });

  it('never leaks hidden cards in a view', () => {
    const shuffle = shuffler(rng(3));
    const { state } = newGame(shuffle);
    const json = JSON.stringify(viewFor(state, 0));
    const v = JSON.parse(json);
    expect(v.hand).toEqual(state.hands[0]);
    expect(v).not.toHaveProperty('hands');
    expect(v).not.toHaveProperty('deck');
    expect(v).not.toHaveProperty('crib');
    expect(v).not.toHaveProperty('kept');
  });
});
