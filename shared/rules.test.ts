// Independent rules review of the game flow (two-player, six-card cribbage, ACC rules).
import { describe, expect, it } from 'vitest';
import { type Card, card, fullDeck, value } from './cards';
import { type Action, type GameState, type Seat, applyAction, newGame, other, viewFor } from './game';

const RK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const c = (s: string): Card => card(RK.indexOf(s.slice(0, -1)), 'shdc'.indexOf(s.slice(-1)));
const cs = (s: string): Card[] => (s ? s.split(' ').map(c) : []);

/** A shuffle function returning the given cards first, then the rest of the deck in order. */
const rigged = (...decks: string[]) => {
  const queue = decks.map((d) => {
    const first = cs(d);
    return [...first, ...fullDeck().filter((x) => !first.includes(x))];
  });
  return () => queue.shift() ?? fullDeck();
};
const idShuffle = () => fullDeck();

interface Opts {
  dealer?: Seat;
  hands: [string, string];
  starter?: string;
  count?: number;
  pile?: Array<[string, Seat]>;
  turn?: Seat;
  scores?: [number, number];
  crib?: string;
  kept?: [string, string];
  phase?: GameState['phase'];
}
/** Hand-build a mid-hand state (default: pegging). */
function mk(o: Opts): GameState {
  const s = structuredClone(newGame(idShuffle).state);
  s.dealer = o.dealer ?? 0;
  s.phase = o.phase ?? 'peg';
  s.hands = [cs(o.hands[0]), cs(o.hands[1])];
  s.kept = o.kept ? [cs(o.kept[0]), cs(o.kept[1])] : [[...s.hands[0]], [...s.hands[1]]];
  s.crib = cs(o.crib ?? '2s 3s 4s 6h');
  s.starter = c(o.starter ?? 'Ks');
  s.pile = (o.pile ?? []).map(([x, who]) => ({ card: c(x), seat: who }));
  s.played = [...s.pile];
  s.count = s.pile.reduce((n, p) => n + value(p.card), 0);
  if (o.count !== undefined) s.count = o.count;
  s.turn = o.turn ?? other(s.dealer);
  s.scores = o.scores ?? [0, 0];
  s.back = [...s.scores];
  s.goSaid = [false, false];
  s.showStep = 0;
  s.showResult = null;
  s.acks = [false, false];
  return s;
}
const play = (s: GameState, seat: Seat, x: string) => applyAction(s, seat, { t: 'play', card: c(x) }, idShuffle);
const ack = (s: GameState, seat: Seat) => applyAction(s, seat, { t: 'ack' }, idShuffle);
const kinds = (ev: { t: string }[], t: string) => ev.filter((e) => e.t === t);

describe('cut for first deal and the deal', () => {
  it('low card deals; ace is low; the first card is seat 0\'s', () => {
    expect(newGame(rigged('As 2s', '')).state.dealer).toBe(0);
    expect(newGame(rigged('Kh 2s', '')).state.dealer).toBe(1);
    expect(newGame(rigged('2s Kh', '')).state.dealer).toBe(0);
  });
  it('equal ranks cut again (implementation: skip to next differing rank, suit never breaks ties)', () => {
    const { state } = newGame(rigged('5s 5h 5d 9c', ''));
    expect(state.firstCut).toEqual([c('5s'), c('9c')]);
    expect(state.dealer).toBe(0);
  });
  it('deals 6/6 from the shuffle, first deck card becomes the starter, non-dealer leads and cuts', () => {
    const deal = '2s 3s 4s 5s 6s 7s 2h 3h 4h 5h 6h 7h Jd 9c';
    const shuffle = rigged('As Kh', deal); // seat 0 holds the ace -> dealer 0
    let { state } = newGame(shuffle);
    expect(state.dealer).toBe(0);
    expect(state.hands[0]).toEqual(cs('2s 3s 4s 5s 6s 7s'));
    expect(state.hands[1]).toEqual(cs('2h 3h 4h 5h 6h 7h'));
    expect(state.turn).toBe(1);
    state = applyAction(state, 0, { t: 'discard', cards: [c('2s'), c('3s')] }, shuffle).state;
    expect(state.phase).toBe('discard');
    state = applyAction(state, 1, { t: 'discard', cards: [c('2h'), c('3h')] }, shuffle).state;
    expect(state.phase).toBe('cut');
    expect(state.crib.length).toBe(4);
    expect(() => applyAction(state, 0, { t: 'cut' }, shuffle)).toThrow(); // dealer may not cut
    const cut = applyAction(state, 1, { t: 'cut' }, shuffle);
    expect(cut.state.starter).toBe(c('Jd'));
    expect(cut.state.scores).toEqual([2, 0]); // heels to dealer
    expect(cut.state.phase).toBe('peg');
    expect(cut.state.turn).toBe(1); // non-dealer leads
    expect(() => play(cut.state, 0, '4s')).toThrow();
    expect(play(cut.state, 1, '4h').state.turn).toBe(0);
  });
  it('rejects discarding the same card twice / a card not held / discarding in the wrong phase', () => {
    const s = mk({ phase: 'discard', hands: ['2s 3s 4s 5s 6s 7s', '2h 3h 4h 5h 6h 7h'] });
    expect(() => applyAction(s, 0, { t: 'discard', cards: [c('2s'), c('2s')] }, idShuffle)).toThrow();
    expect(() => applyAction(s, 0, { t: 'discard', cards: [c('2s'), c('2h')] }, idShuffle)).toThrow();
    expect(() => applyAction(s, 0, { t: 'ack' }, idShuffle)).toThrow();
  });
});

describe('pegging: go, 31, last card', () => {
  it('go: stuck player says go, other keeps playing several cards, one go point at the end, opponent leads next', () => {
    // dealer 0, pone 1.  pile K(1) Q(0) = 20.  Seat 1 holds 8 and 7; seat 0 holds A A 4.
    let s = mk({ hands: ['Ad Ac 4d', '8s 7s'], pile: [['Kh', 1], ['Qh', 0]], turn: 1 });
    let r = play(s, 1, '8s'); // 28
    expect(r.state.turn).toBe(0);
    expect(kinds(r.events, 'go')).toHaveLength(0);
    r = play(r.state, 0, 'Ad'); // 29; seat 1's 7 cannot play -> go for seat 1
    expect(kinds(r.events, 'go')).toEqual([{ t: 'go', seat: 1 }]);
    expect(r.state.turn).toBe(0);
    expect(r.state.count).toBe(29);
    expect(r.state.scores).toEqual([0, 0]); // no go point yet: seat 0 still playing
    r = play(r.state, 0, 'Ac'); // 30, pair for 2; 4 cannot play, 7 cannot -> go point to seat 0
    expect(kinds(r.events, 'go')).toHaveLength(0); // go already announced once
    expect(r.state.scores).toEqual([2 + 1, 0]);
    expect(r.state.count).toBe(0);
    expect(r.state.pile).toEqual([]);
    expect(r.state.turn).toBe(1); // opponent of the go-scorer leads
    r = play(r.state, 1, '7s'); // seat 1 plays last card
    expect(r.state.turn).toBe(0);
    r = play(r.state, 0, '4d'); // last card of the hand: 1 point
    expect(r.state.scores[0]).toBe(4);
    expect(r.state.phase).toBe('show');
    const lastItem = kinds(r.events, 'score').find((e: any) => e.why === 'peg') as any;
    expect(lastItem.items[0].kind).toBe('last');
  });
  it('cannot play a card that would pass 31, and there is no pass action', () => {
    const s = mk({ hands: ['5d', '9s 2d'], pile: [['Kh', 1], ['Qh', 0], ['Jd', 1]], turn: 0 });
    expect(() => play(s, 0, '5d')).toThrow();
    expect(() => applyAction(s, 0, { t: 'pass' } as unknown as Action, idShuffle)).toThrow();
  });
  it('31 scores 2 only (no extra go point) and the other player leads the new count', () => {
    const s = mk({ hands: ['Td', '4s'].map((x) => x.replace('T', '10')) as [string, string], pile: [['Kh', 1], ['Qs', 0], ['Ad', 1]], turn: 0 });
    const r = play(s, 0, '10d');
    expect(r.state.scores).toEqual([2, 0]);
    expect(r.state.count).toBe(0);
    expect(r.state.turn).toBe(1);
    expect(kinds(r.events, 'go')).toHaveLength(0);
    const items = (kinds(r.events, 'score')[0] as any).items;
    expect(items.map((i: any) => i.kind)).toEqual(['thirtyone']);
  });
  it('31 on the very last card scores 2, not 3', () => {
    const s = mk({ hands: ['10d', ''], pile: [['Kh', 1], ['Qs', 0], ['Ad', 1]], turn: 0 });
    const r = play(s, 0, '10d');
    expect(r.state.scores[0]).toBe(2);
    expect(r.state.phase).toBe('show');
  });
  it('after 31 the opponent leads; if the opponent is out of cards the same player leads again', () => {
    const s = mk({ hands: ['10d 4h', ''], pile: [['Kh', 1], ['Qs', 0], ['Ad', 1]], turn: 0 });
    const r = play(s, 0, '10d');
    expect(r.state.count).toBe(0);
    expect(r.state.turn).toBe(0);
  });
  it('a player out of cards while the other still holds several: no go events, other keeps playing, then one go point', () => {
    let s = mk({ hands: ['2d 9c 8c 7c', '5h'], turn: 1 });
    let r = play(s, 1, '5h'); // count 5
    expect(r.state.turn).toBe(0);
    r = play(r.state, 0, '2d'); // 7 ; seat 1 empty
    expect(r.state.turn).toBe(0);
    expect(kinds(r.events, 'go')).toHaveLength(0);
    r = play(r.state, 0, '9c'); // 16 (and no 15)
    expect(r.state.turn).toBe(0);
    r = play(r.state, 0, '8c'); // 24: pair? no. 8 and 9 and 2... 2,9,8 not a run
    expect(r.state.turn).toBe(0);
    expect(r.state.count).toBe(24);
    r = play(r.state, 0, '7c'); // 31 -> 2 ; run 9 8 7 = 3
    expect(r.state.phase).toBe('show');
    expect(r.state.scores[0]).toBe(2 + 3); // thirty-one + run of three; no last card point on top
  });
  it('go point is awarded when the other player is empty and this player is stuck (not last card)', () => {
    const s = mk({ hands: ['10d 9c', '9h'], pile: [['Kh', 0], ['Qs', 1]], turn: 1 }); // count 20
    let r = play(s, 1, '9h'); // 29; seat 1 empty; seat 0 holds 10, 9 -> stuck
    expect(r.state.scores[1]).toBe(1); // go for seat 1 (last to play), seat 0 still holds cards
    expect(r.state.count).toBe(0);
    expect(r.state.turn).toBe(0);
    const item = (kinds(r.events, 'score')[0] as any).items[0];
    expect(item.kind).toBe('go');
  });
  it('last card: fifteen on the last card scores 2 + 1', () => {
    const s = mk({ hands: ['5d', ''], pile: [['Kh', 1]], turn: 0 });
    const r = play(s, 0, '5d');
    expect(r.state.scores[0]).toBe(3);
  });
  it('pairs only count since the last reset: a 5 after a go-reset does not pair with the last 5 before it', () => {
    const s = mk({ hands: ['10d 9c', '5s 5h'], pile: [['Kh', 1], ['Qs', 0]], turn: 1 }); // count 20
    let r = play(s, 1, '5s'); // 25; seat 0 cannot play (35, 34) -> go; seat 1's other 5 -> 30 playable
    expect(r.state.turn).toBe(1);
    r = play(r.state, 1, '5h'); // 30, pair with 5s (legit, same pile) = 2
    expect(r.state.scores[1]).toBe(2 + 1); // pair + go
    expect(r.state.count).toBe(0);
    expect(r.state.turn).toBe(0);
    r = play(r.state, 0, '10d'); // new count
    expect(r.state.count).toBe(10);
  });
});

describe('his heels', () => {
  const cutState = (starter: string, dScore: number, oScore: number, dealer: Seat = 0) => {
    const s = mk({ phase: 'cut', hands: ['2s 4s 6s 8s', '2h 4h 6h 8h'], dealer, scores: dealer === 0 ? [dScore, oScore] : [oScore, dScore] });
    s.deck = [c(starter), c('3d')];
    return s;
  };
  it('jack starter scores 2 for the dealer, in either seat', () => {
    for (const dealer of [0, 1] as Seat[]) {
      const r = applyAction(cutState('Jc', 10, 10, dealer), other(dealer), { t: 'cut' }, idShuffle);
      expect(r.state.scores[dealer]).toBe(12);
      expect(r.state.scores[other(dealer)]).toBe(10);
      expect(r.state.stats[dealer].peg).toBe(2);
      expect(kinds(r.events, 'score')).toHaveLength(1);
    }
  });
  it('no heels for other cards (including Q and 10)', () => {
    for (const st of ['Qc', '10c', 'Ac', 'Kc']) {
      expect(applyAction(cutState(st, 0, 0), 1, { t: 'cut' }, idShuffle).state.scores).toEqual([0, 0]);
    }
  });
  it('dealer wins on heels at 119 -> 121; game over immediately, phase over', () => {
    const r = applyAction(cutState('Jh', 119, 40), 1, { t: 'cut' }, idShuffle);
    expect(r.state.scores[0]).toBe(121);
    expect(r.state.winner).toBe(0);
    expect(r.state.phase).toBe('over');
    expect(r.state.skunk).toEqual([0, 2]);
    expect(() => play(r.state, 1, '2h')).toThrow();
  });
  it('heels at 120 caps at 121', () => {
    const r = applyAction(cutState('Jh', 120, 100), 1, { t: 'cut' }, idShuffle);
    expect(r.state.scores[0]).toBe(121);
    expect(r.state.skunk).toEqual([0, 0]);
  });
});

describe('winning, cap, skunk', () => {
  const heelsWin = (loser: number) => {
    const s = mk({ phase: 'cut', hands: ['2s 4s 6s 8s', '2h 4h 6h 8h'], scores: [119, loser] });
    s.deck = [c('Jh')];
    return applyAction(s, 1, { t: 'cut' }, idShuffle).state;
  };
  it('skunk boundaries: 91 none, 90 skunk, 61 skunk, 60 double skunk', () => {
    expect(heelsWin(120).skunk).toEqual([0, 0]);
    expect(heelsWin(91).skunk).toEqual([0, 0]);
    expect(heelsWin(90).skunk).toEqual([0, 1]);
    expect(heelsWin(61).skunk).toEqual([0, 1]);
    expect(heelsWin(60).skunk).toEqual([0, 2]);
    expect(heelsWin(0).skunk).toEqual([0, 2]);
  });
  it('winning mid-pegging ends the game at once, score capped, back peg kept, hands untouched', () => {
    const s = mk({ hands: ['9c 9d', '5h 4d'], pile: [['Kh', 0]], turn: 1, scores: [30, 118] });
    const r = play(s, 1, '5h'); // fifteen = 2 -> 120 ... need 121: use 119
    expect(r.state.scores[1]).toBe(120);
    const s2 = mk({ hands: ['9c 9d', '5h 4d'], pile: [['Kh', 0]], turn: 1, scores: [30, 120] });
    const r2 = play(s2, 1, '5h'); // 122 -> capped
    expect(r2.state.scores[1]).toBe(121);
    expect(r2.state.back[1]).toBe(120);
    expect(r2.state.phase).toBe('over');
    expect(r2.state.winner).toBe(1);
    expect(r2.state.skunk).toEqual([2, 0]);
    expect(r2.state.hands[0]).toEqual(cs('9c 9d'));
    expect(() => play(r2.state, 0, '9c')).toThrow();
    expect(() => ack(r2.state, 0)).toThrow();
    expect(viewFor(r2.state, 0).winner).toBe(1);
  });
  it('winning on a go point', () => {
    const s = mk({ hands: ['10d', '9h'], pile: [['Kh', 0], ['Qs', 1]], turn: 1, scores: [0, 120] });
    const r = play(s, 1, '9h');
    expect(r.state.scores[1]).toBe(121);
    expect(r.state.phase).toBe('over');
  });
  it('winning on the last card', () => {
    const s = mk({ hands: ['', '9h'], pile: [['Kh', 0]], turn: 1, scores: [0, 120] });
    const r = play(s, 1, '9h');
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(1);
  });
  it('stats record only the points actually pegged at the finish', () => {
    const s = mk({ hands: ['9c', '4h 4d 4c'], pile: [['4s', 0]], turn: 1, scores: [0, 120] }); // 4s then 4h: pair 2
    const r = play(s, 1, '4h');
    expect(r.state.scores[1]).toBe(121);
    expect(r.state.stats[1].peg).toBe(1); // a pair for 2, but only 1 hole was left
  });
});

describe('the show', () => {
  // seat 1 = pone, seat 0 = dealer. Starter 5s.
  const showState = (scores: [number, number], over: Partial<Opts> = {}) =>
    mk({
      hands: ['', '5h'], turn: 1, dealer: 0, starter: '5s', scores,
      kept: ['Ah 3d 6c 9s', '5h 5d 5c Js'], crib: '2h 4h 6h 8h', ...over,
    });
  it('order: non-dealer hand, dealer hand, crib to the dealer; dealer alternates; new deal state clean', () => {
    // last play by pone (seat 1) of 5h as the final card
    let r = play(showState([0, 0]), 1, '5h'); // count 5; last card point for seat 1
    let s = r.state;
    expect(s.phase).toBe('show');
    expect(s.showStep).toBe(0);
    expect(s.showResult).toMatchObject({ seat: 1, crib: false, total: 29 });
    expect(s.scores[1]).toBe(1 + 29);
    s = ack(s, 1).state;
    expect(s.showStep).toBe(0); // waits for both
    s = ack(s, 0).state;
    expect(s.showStep).toBe(1);
    expect(s.showResult).toMatchObject({ seat: 0, crib: false });
    const dealerPts = s.showResult!.total;
    expect(s.scores[0]).toBe(dealerPts);
    s = ack(ack(s, 0).state, 1).state;
    expect(s.showStep).toBe(2);
    expect(s.showResult).toMatchObject({ seat: 0, crib: true });
    // crib 2h 4h 6h 8h + 5s starter: 4-flush in crib does not count; 2+4... fifteens: 2+4+... computed below
    expect(s.showResult!.items.some((i) => i.kind === 'flush')).toBe(false);
    const cribPts = s.showResult!.total;
    expect(s.scores[0]).toBe(dealerPts + cribPts);
    const after = ack(ack(s, 1).state, 0);
    expect(after.state.dealer).toBe(1);
    expect(after.state.handNo).toBe(2);
    expect(after.state.phase).toBe('discard');
    expect(after.state.turn).toBe(0); // new non-dealer
    expect(after.state.hands[0]).toHaveLength(6);
    expect(after.state.crib).toEqual([]);
    expect(after.state.starter).toBeNull();
    expect(after.state.showResult).toBeNull();
    expect(after.state.scores).toEqual(s.scores);
  });
  it('a win during the non-dealer count ends the game before the dealer counts', () => {
    const r = play(showState([100, 119 - 1 + 0]), 1, '5h'); // pone: 118 +1 last +29 -> capped
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(1);
    expect(r.state.scores[1]).toBe(121);
    expect(r.state.showResult).toMatchObject({ seat: 1, crib: false });
    expect(r.state.scores[0]).toBe(100); // dealer never counted
    expect(() => ack(r.state, 0)).toThrow();
  });
  it('pone reaching 121 first wins even if the dealer would also have passed 121 (dealer has not counted)', () => {
    const r = play(showState([119, 100]), 1, '5h');
    expect(r.state.winner).toBe(1);
    expect(r.state.scores[0]).toBe(119);
  });
  it('a win on the dealer hand skips the crib', () => {
    const s0 = play(showState([110, 0], { kept: ['5h 5d 5c Js', '2h 4d 6c 8s'], starter: '5s' }), 1, '5h').state;
    // pone hand scores 0 (+1 last card); dealer then counts 29 and wins
    expect(s0.phase).toBe('show');
    const s1 = ack(ack(s0, 0).state, 1).state;
    expect(s1.phase).toBe('over');
    expect(s1.winner).toBe(0);
    expect(s1.showResult).toMatchObject({ seat: 0, crib: false });
    expect(s1.scores[0]).toBe(121);
  });
  it('a win in the crib', () => {
    const s0 = play(showState([0, 0], { kept: ['2h 4d 6c 8s', '2d 4c 6s 8d'], crib: '5h 5d 5c Js' }), 1, '5h').state;
    let s = s0;
    s = { ...structuredClone(s), scores: [100, s.scores[1]] };
    s = ack(ack(s, 0).state, 1).state; // dealer hand
    s = ack(ack(s, 0).state, 1).state; // crib
    expect(s.showResult!.crib).toBe(true);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
  });
  it('crib flush rule: four-card flush is worth 0 in the crib, 5 only with a matching starter', () => {
    const base = (starter: string) => {
      const s = showState([0, 0], { starter, kept: ['Ah 3d 6c 9s', '2d 4c 6s 8d'], crib: '2h 4h 6h 8h' });
      let r = play(s, 1, '5h').state;
      r = ack(ack(r, 0).state, 1).state;
      r = ack(ack(r, 0).state, 1).state;
      return r.showResult!;
    };
    expect(base('Ks').items.some((i) => i.kind === 'flush')).toBe(false);
    const withFlush = base('Kh');
    expect(withFlush.items.find((i) => i.kind === 'flush')!.points).toBe(5);
  });
  it('ack only valid during show; one seat acking twice does not advance', () => {
    let s = play(showState([0, 0]), 1, '5h').state;
    s = ack(ack(s, 1).state, 1).state;
    expect(s.showStep).toBe(0);
    expect(() => ack(mk({ hands: ['2s', '3s'] }), 0)).toThrow();
  });
  it('dealer alternates every hand in a played-out game', () => {
    const rand = (() => { let x = 5; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32; })();
    const shuffle = () => { const d = fullDeck(); for (let i = 51; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };
    let { state } = newGame(shuffle, 400); // long game: many hands
    let hands = 1, dealer = state.dealer;
    for (let n = 0; n < 20000 && hands < 8; n++) {
      let act: Action | null = null; let who: Seat = 0;
      for (const sd of [0, 1] as Seat[]) {
        const h = state.hands[sd];
        if (state.phase === 'discard' && h.length === 6) { act = { t: 'discard', cards: [h[0], h[1]] }; who = sd; break; }
        if (state.phase === 'cut' && sd !== state.dealer) { act = { t: 'cut' }; who = sd; break; }
        if (state.phase === 'peg' && state.turn === sd) { act = { t: 'play', card: h.find((x) => state.count + value(x) <= 31)! }; who = sd; break; }
        if (state.phase === 'show' && !state.acks[sd]) { act = { t: 'ack' }; who = sd; break; }
      }
      expect(act).not.toBeNull();
      const prevHand = state.handNo;
      state = applyAction(state, who, act!, shuffle).state;
      if (state.handNo !== prevHand) { hands++; expect(state.dealer).toBe(other(dealer)); dealer = state.dealer; expect(state.turn).toBe(other(dealer)); }
    }
    expect(hands).toBe(8);
  });
});

describe('views', () => {
  it('opponent cards, crib and deck are never in a view; crib/hands only revealed through showResult', () => {
    const s = mk({ hands: ['2s 4s', '5h 6h'] });
    const v = JSON.parse(JSON.stringify(viewFor(s, 0)));
    expect(v.hand).toEqual(s.hands[0]);
    expect(v.handCounts).toEqual([2, 2]);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(s.hands[1]));
    expect(Object.keys(v)).not.toEqual(expect.arrayContaining(['crib', 'deck', 'kept', 'hands']));
  });
});
