// Three-player (cut-throat) and four-player (partnership) rules, in the style of
// rules.test.ts: hand-built states, a rigged shuffle, and random playthroughs.
import { describe, expect, it } from 'vitest';
import { type Card, card, fullDeck, value } from './cards';
import {
  type Action, type GameEvent, type GameState, type PlayerCount, type Seat,
  applyAction, discardCount, handSize, leftOf, newGame, placings, showSeat, skunkLevel, teamCount, teamOf,
  teamSeats, viewFor,
} from './game';
import { scoreHand } from './scoring';

const RK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const c = (s: string): Card => {
  const r = RK.indexOf(s.slice(0, -1));
  const su = 'shdc'.indexOf(s.slice(-1));
  if (r < 0 || su < 0) throw new Error(`bad card ${s}`);
  return card(r, su);
};
const cs = (s: string): Card[] => (s ? s.split(' ').filter(Boolean).map(c) : []);

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
  players: PlayerCount;
  dealer?: Seat;
  hands: string[];
  starter?: string;
  pile?: Array<[string, Seat]>;
  turn?: Seat;
  scores?: number[];
  crib?: string;
  kept?: string[];
  phase?: GameState['phase'];
}
/** Hand-build a mid-hand state (default: pegging). */
function mk(o: Opts): GameState {
  const n = o.players;
  const s = structuredClone(newGame(idShuffle, 121, n).state);
  s.dealer = o.dealer ?? 0;
  s.phase = o.phase ?? 'peg';
  s.hands = o.hands.map(cs);
  s.kept = o.kept ? o.kept.map(cs) : s.hands.map((h) => [...h]);
  s.crib = cs(o.crib ?? '2s 3s 4s 6h');
  s.starter = c(o.starter ?? 'Ks');
  s.pile = (o.pile ?? []).map(([x, who]) => ({ card: c(x), seat: who }));
  s.played = [...s.pile];
  s.count = s.pile.reduce((t, p) => t + value(p.card), 0);
  s.turn = o.turn ?? leftOf(n, s.dealer);
  s.scores = o.scores ?? Array(teamCount(n)).fill(0);
  s.back = [...s.scores];
  s.goSaid = Array(n).fill(false);
  s.showStep = 0;
  s.showResult = null;
  s.acks = Array(n).fill(false);
  return s;
}
const play = (s: GameState, seat: Seat, x: string) => applyAction(s, seat, { t: 'play', card: c(x) }, idShuffle);
const ack = (s: GameState, seat: Seat) => applyAction(s, seat, { t: 'ack' }, idShuffle);
const ackAll = (s: GameState) => {
  let r = { state: s, events: [] as GameEvent[] };
  for (let p = 0; p < s.players; p++) {
    const next = ack(r.state, p);
    r = { state: next.state, events: [...r.events, ...next.events] };
  }
  return r;
};
const kinds = <T extends GameEvent['t']>(ev: GameEvent[], t: T) =>
  ev.filter((e): e is Extract<GameEvent, { t: T }> => e.t === t);
const total = (h: string, st: string, crib = false) => scoreHand(cs(h), c(st), crib).total;

describe('table geometry helpers', () => {
  it('teams: one per player in 2 and 3 player games, partners opposite in 4', () => {
    expect([0, 1].map((s) => teamOf(2, s))).toEqual([0, 1]);
    expect([0, 1, 2].map((s) => teamOf(3, s))).toEqual([0, 1, 2]);
    expect([0, 1, 2, 3].map((s) => teamOf(4, s))).toEqual([0, 1, 0, 1]);
    expect([teamCount(2), teamCount(3), teamCount(4)]).toEqual([2, 3, 2]);
    expect(teamSeats(4, 0)).toEqual([0, 2]);
    expect(teamSeats(4, 1)).toEqual([1, 3]);
    expect(teamSeats(3, 2)).toEqual([2]);
  });
  it('clockwise, deal sizes, show order', () => {
    expect([0, 1, 2].map((s) => leftOf(3, s))).toEqual([1, 2, 0]);
    expect([0, 1, 2, 3].map((s) => leftOf(4, s))).toEqual([1, 2, 3, 0]);
    expect([handSize(2), handSize(3), handSize(4)]).toEqual([6, 5, 5]);
    expect([discardCount(2), discardCount(3), discardCount(4)]).toEqual([2, 1, 1]);
    expect([0, 1, 2, 3].map((st) => showSeat(3, 1, st))).toEqual([2, 0, 1, 1]);
    expect([0, 1, 2, 3, 4].map((st) => showSeat(4, 3, st))).toEqual([0, 1, 2, 3, 3]);
    expect([0, 1, 2].map((st) => showSeat(2, 0, st))).toEqual([1, 0, 0]);
  });
  it('placings rank by score, ties share a place, winner first', () => {
    expect(placings([121, 80, 50], 0)).toEqual([1, 2, 3]);
    expect(placings([50, 121, 80], 1)).toEqual([3, 1, 2]);
    expect(placings([121, 70, 70], 0)).toEqual([1, 2, 2]);
    expect(placings([100, 121], 1)).toEqual([2, 1]);
    expect(placings([0, 0, 0], null)).toEqual([1, 1, 1]);
  });
});

describe('cut for first deal and the deal', () => {
  it('three players: low card deals, ties skipped, every seat cuts a distinct rank', () => {
    expect(newGame(rigged('Ks Qs As', ''), 121, 3).state.dealer).toBe(2);
    const { state, events } = newGame(rigged('5s 5h 9c 5d 2c', ''), 121, 3);
    expect(state.firstCut).toEqual(cs('5s 9c 2c'));
    expect(state.dealer).toBe(2);
    expect(events[0]).toEqual({ t: 'firstcut', cards: cs('5s 9c 2c'), dealer: 2 });
  });
  it('four players: low card deals among all four', () => {
    const { state } = newGame(rigged('Ks As Qs Js', ''), 121, 4);
    expect(state.firstCut).toEqual(cs('Ks As Qs Js'));
    expect(state.dealer).toBe(1);
    expect(newGame(rigged('Ks Kh Qs Js 10s', ''), 121, 4).state.firstCut).toEqual(cs('Ks Qs Js 10s'));
  });
  it('three players: 5 cards each, one card from the deck into the crib, one-card discards, left of dealer cuts and leads', () => {
    const deal = 'As 2s 3s 4s 5s Ah 2h 3h 4h 5h Ad 2d 3d 4d 5d Kc Jc';
    const shuffle = rigged('Ks Qs As', deal); // dealer 2
    let { state } = newGame(shuffle, 121, 3);
    expect(state.players).toBe(3);
    expect(state.dealer).toBe(2);
    expect(state.hands).toEqual([cs('As 2s 3s 4s 5s'), cs('Ah 2h 3h 4h 5h'), cs('Ad 2d 3d 4d 5d')]);
    expect(state.crib).toEqual([c('Kc')]);
    expect(state.deck[0]).toBe(c('Jc'));
    expect(state.deck).toHaveLength(52 - 16);
    expect(state.scores).toEqual([0, 0, 0]);
    expect(state.turn).toBe(0);
    // The crib card is never in anyone's view.
    for (const p of [0, 1, 2]) {
      const v = viewFor(state, p);
      expect(v.cribCount).toBe(1);
      expect(v.handCounts).toEqual([5, 5, 5]);
      expect(JSON.stringify(v)).not.toContain(String(c('Kc')));
    }

    const disc = (st: GameState, seat: Seat, cards: string) =>
      applyAction(st, seat, { t: 'discard', cards: cs(cards) }, shuffle);
    expect(() => disc(state, 0, 'As 2s')).toThrow('Pick one card from your hand');
    expect(() => disc(state, 0, '')).toThrow('Pick one card from your hand');
    expect(() => disc(state, 0, 'Ah')).toThrow('Pick one card from your hand');
    expect(() => applyAction(state, 0, { t: 'discard' } as unknown as Action, shuffle)).toThrow();
    let r = disc(state, 0, 'As');
    expect(r.events).toEqual([{ t: 'discard', seat: 0 }]);
    state = r.state;
    expect(state.hands[0]).toEqual(cs('2s 3s 4s 5s'));
    expect(viewFor(state, 1).discarded).toEqual([true, false, false]);
    expect(() => disc(state, 0, '2s')).toThrow('Already discarded');
    state = disc(state, 2, 'Ad').state;
    expect(state.phase).toBe('discard');
    state = disc(state, 1, 'Ah').state;
    expect(state.phase).toBe('cut');
    expect(state.crib).toEqual(cs('Kc As Ad Ah'));
    expect(state.kept[1]).toEqual(cs('2h 3h 4h 5h'));

    expect(() => applyAction(state, 2, { t: 'cut' }, shuffle)).toThrow('The player on the dealer’s left cuts');
    expect(() => applyAction(state, 1, { t: 'cut' }, shuffle)).toThrow();
    r = applyAction(state, 0, { t: 'cut' }, shuffle);
    expect(r.state.starter).toBe(c('Jc'));
    expect(r.state.scores).toEqual([0, 0, 2]); // his heels to the dealer
    expect(r.state.stats[2].peg).toBe(2);
    expect(r.state.turn).toBe(0);
    expect(() => play(r.state, 1, '2h')).toThrow('Not your turn');
    expect(play(r.state, 0, '2s').state.turn).toBe(1);
  });
  it('four players: 5 each, no extra crib card, one-card discards, heels to the dealer’s team', () => {
    const deal = 'As 2s 3s 4s 5s Ah 2h 3h 4h 5h Ad 2d 3d 4d 5d Ac 2c 3c 4c 5c Jd';
    const shuffle = rigged('Ks As Qs Js', deal); // dealer 1, cutter 2
    let { state } = newGame(shuffle, 121, 4);
    expect(state.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
    expect(state.hands[3]).toEqual(cs('Ac 2c 3c 4c 5c'));
    expect(state.crib).toEqual([]);
    expect(state.deck).toHaveLength(32);
    expect(state.scores).toEqual([0, 0]);
    expect(state.turn).toBe(2);
    expect(() => applyAction(state, 0, { t: 'discard', cards: cs('As 2s') }, shuffle)).toThrow('Pick one card');
    for (const [seat, x] of [[0, 'As'], [1, 'Ah'], [2, 'Ad'], [3, 'Ac']] as const) {
      expect(state.phase).toBe('discard');
      state = applyAction(state, seat, { t: 'discard', cards: [c(x)] }, shuffle).state;
    }
    expect(state.phase).toBe('cut');
    expect(state.crib).toHaveLength(4);
    for (const seat of [0, 1, 3]) expect(() => applyAction(state, seat, { t: 'cut' }, shuffle)).toThrow();
    const r = applyAction(state, 2, { t: 'cut' }, shuffle);
    expect(r.state.scores).toEqual([0, 2]); // dealer 1 is on team 1 (seats 1 & 3)
    expect(r.state.stats[1].peg).toBe(2);
    expect(kinds(r.events, 'score')).toEqual([
      { t: 'score', seat: 1, team: 1, items: [{ kind: 'heels', cards: [c('Jd')], points: 2 }], points: 2, why: 'heels' },
    ]);
    expect(r.state.turn).toBe(2);
  });
  it('heels for a dealer on team 0 in a four-player game', () => {
    const s = mk({ players: 4, phase: 'cut', dealer: 2, hands: ['2s 4s 6s 8s', '2h 4h 6h 8h', '2d 4d 6d 8d', '2c 4c 6c 8c'], scores: [10, 10] });
    s.deck = [c('Jh'), c('3d')];
    const r = applyAction(s, 3, { t: 'cut' }, idShuffle);
    expect(r.state.scores).toEqual([12, 10]);
    expect(r.state.stats[2].peg).toBe(2);
    expect(r.state.turn).toBe(3);
  });
});

describe('pegging with three and four players', () => {
  it('passes clockwise, skipping a player who cannot play (who says go), and team points go to the team', () => {
    // 4 players, count 19, seat 0 to play.
    const s = mk({
      players: 4, dealer: 3,
      hands: ['3c 2c', 'Kd Qd', '4h 9c', '5d Ks'],
      pile: [['Kh', 2], ['9s', 3]], turn: 0,
    });
    let r = play(s, 0, '3c'); // 22: seat 1 holds only tens -> go; seat 2 can play
    expect(kinds(r.events, 'go')).toEqual([{ t: 'go', seat: 1 }]);
    expect(r.state.turn).toBe(2);
    expect(r.state.goSaid).toEqual([false, true, false, false]);
    r = play(r.state, 2, '4h'); // 26: next is seat 3, who can play
    expect(r.state.turn).toBe(3);
    expect(kinds(r.events, 'go')).toHaveLength(0);
    r = play(r.state, 3, '5d'); // 31 for 2 + run 3-4-5 for 3, to team 1
    expect(r.state.scores).toEqual([0, 5]);
    expect(r.state.stats[3].peg).toBe(5);
    expect(kinds(r.events, 'score')[0]).toMatchObject({ seat: 3, team: 1, points: 5 });
    expect(r.state.count).toBe(0);
    expect(r.state.goSaid).toEqual([false, false, false, false]);
    expect(r.state.turn).toBe(0); // next clockwise from seat 3
  });

  it('go: two players stuck while the third plays several cards; one go point; next clockwise leads', () => {
    const s = mk({
      players: 3, dealer: 2,
      hands: ['2c Ac Ad 9s', 'Kd Jh', 'Qc 10d'],
      pile: [['Kh', 1], ['Qh', 2]], turn: 0, // count 20
    });
    let r = play(s, 0, '2c'); // 22: seats 1 and 2 cannot play — both say go, in clockwise order
    expect(kinds(r.events, 'go')).toEqual([{ t: 'go', seat: 1 }, { t: 'go', seat: 2 }]);
    expect(r.state.turn).toBe(0);
    expect(r.state.scores).toEqual([0, 0, 0]);
    r = play(r.state, 0, 'Ac'); // 23
    expect(kinds(r.events, 'go')).toHaveLength(0); // go is said once per count
    expect(r.state.turn).toBe(0);
    r = play(r.state, 0, 'Ad'); // 24, pair for 2; 9s cannot play -> go for 1
    expect(r.state.scores).toEqual([3, 0, 0]);
    expect(kinds(r.events, 'go')).toHaveLength(0);
    const peg = kinds(r.events, 'score');
    expect(peg.map((e) => e.items.map((i) => i.kind))).toEqual([['pair'], ['go']]);
    expect(r.state.count).toBe(0);
    expect(r.state.pile).toEqual([]);
    expect(r.state.turn).toBe(1); // next clockwise from the go-scorer
    expect(r.state.goSaid).toEqual([false, false, false]);
  });

  it('a player out of cards is skipped silently (no go)', () => {
    const s = mk({ players: 3, hands: ['9s', '', 'Kd 2c'], pile: [['10h', 1], ['10s', 2]], turn: 0 }); // 20
    const r = play(s, 0, '9s'); // 29: seat 1 empty (no go), seat 2 has 2c -> plays
    expect(kinds(r.events, 'go')).toHaveLength(0);
    expect(r.state.turn).toBe(2);
  });

  it('after 31 the lead passes to the next player clockwise who still holds cards; last card scores 1', () => {
    const s = mk({ players: 3, dealer: 0, hands: ['3s', '6d', ''], pile: [['Kh', 1], ['10h', 2], ['5c', 0]], turn: 1 }); // 25
    let r = play(s, 1, '6d'); // 31
    expect(r.state.scores).toEqual([0, 2, 0]);
    expect(r.state.count).toBe(0);
    expect(r.state.turn).toBe(0); // seat 2 is out of cards, so seat 0 leads
    r = play(r.state, 0, '3s');
    const sc = kinds(r.events, 'score').filter((e) => e.why === 'peg');
    expect(sc).toHaveLength(1);
    expect(sc[0]).toMatchObject({ seat: 0, team: 0, points: 1 });
    expect(sc[0].items[0].kind).toBe('last');
    expect(r.state.phase).toBe('show');
  });

  it('after a go the lead skips a next player who is out of cards (four players)', () => {
    // count 25; seat 3 plays the last card that fits; seat 0 is empty, seats 1 and 2 hold tens.
    const s = mk({ players: 4, dealer: 2, hands: ['', 'Kd', 'Qd', '4c 9c'], pile: [['10h', 1], ['10s', 2], ['Ac', 0]], turn: 3 }); // 21
    const r = play(s, 3, '4c'); // 25: seats 1, 2 cannot play -> go; seat 3's 9 cannot -> go point
    expect(kinds(r.events, 'go')).toEqual([{ t: 'go', seat: 1 }, { t: 'go', seat: 2 }]);
    expect(r.state.scores).toEqual([0, 1]);
    expect(r.state.count).toBe(0);
    expect(r.state.turn).toBe(1); // seat 0 has no cards
  });

  it('the player who played last leads again when nobody else holds cards', () => {
    const s = mk({ players: 4, hands: ['9c 9d', '', '', ''], pile: [['10h', 1], ['10s', 2]], turn: 0 }); // 20
    const r = play(s, 0, '9c'); // 29; 9d cannot -> go point; nobody else has cards
    expect(r.state.scores).toEqual([1, 0]);
    expect(r.state.turn).toBe(0);
    expect(r.state.count).toBe(0);
    const r2 = play(r.state, 0, '9d');
    expect(r2.state.stats[0].peg).toBe(2); // last card
    expect(kinds(r2.events, 'score')[0]).toMatchObject({ seat: 0, team: 0, why: 'peg', items: [{ kind: 'last', cards: [], points: 1 }] });
    expect(r2.state.phase).toBe('show');
  });

  it('pairs and runs count across players; both partners’ pegging goes to the team', () => {
    const s = mk({
      players: 4, dealer: 3, scores: [10, 20],
      hands: ['10d Kc', '2c Ks', '2d Qc', 'Jd 9c'],
      pile: [['5h', 3]], turn: 0,
    });
    let r = play(s, 0, '10d'); // 15 for 2 -> team 0
    expect(r.state.scores).toEqual([12, 20]);
    r = play(r.state, 1, '2c'); // 17
    r = play(r.state, 2, '2d'); // 19, pair for 2 -> team 0 again
    expect(r.state.scores).toEqual([14, 20]);
    expect(r.state.back).toEqual([12, 20]);
    expect(r.state.stats.map((x) => x.peg)).toEqual([2, 0, 2, 0]);
    r = play(r.state, 3, '9c'); // 28: seats 0, 1, 2 hold only tens and say go; seat 3's jack cannot play either
    expect(kinds(r.events, 'go')).toEqual([{ t: 'go', seat: 0 }, { t: 'go', seat: 1 }, { t: 'go', seat: 2 }]);
    expect(r.state.scores).toEqual([14, 21]); // the go point to seat 3's team
    expect(r.state.stats.map((x) => x.peg)).toEqual([2, 0, 2, 1]);
    expect(r.state.turn).toBe(0);
  });

  it('three-card pair royal across three different players', () => {
    const s = mk({ players: 3, hands: ['4d 9s', '4c 9h', '4h 9d'], pile: [['4s', 2]], turn: 0 });
    let r = play(s, 0, '4d'); // pair 2
    r = play(r.state, 1, '4c'); // pair royal 6
    expect(r.state.scores).toEqual([2, 6, 0]);
    r = play(r.state, 2, '4h'); // double pair royal 12 (the 4s was seat 2's too)
    expect(r.state.scores).toEqual([2, 6, 12]);
  });
});

describe('the show with three and four players', () => {
  it('three players: counts clockwise from the dealer’s left, dealer last, then the crib; all must continue; deal passes left', () => {
    const kept = ['2h 4d 6c 8s', 'Ah 3d 6h 9s', '7h 8d 9c Qs'];
    const s = mk({ players: 3, dealer: 1, hands: ['', '', '5h'], turn: 2, starter: '5s', kept, crib: '2c 4h 10h Kd' });
    let r = play(s, 2, '5h'); // last card
    expect(r.state.stats[2].peg).toBe(1);
    expect(r.state.phase).toBe('show');
    expect(r.state.showResult).toMatchObject({ seat: 2, crib: false, total: total(kept[2], '5s') });
    expect(r.state.scores[2]).toBe(1 + total(kept[2], '5s'));
    let st = ack(ack(r.state, 2).state, 1).state;
    expect(st.showStep).toBe(0); // waits for everyone
    r = ack(st, 0);
    expect(r.state.showStep).toBe(1);
    expect(r.state.showResult).toMatchObject({ seat: 0, crib: false, total: total(kept[0], '5s') });
    r = ackAll(r.state);
    expect(r.state.showResult).toMatchObject({ seat: 1, crib: false, total: total(kept[1], '5s') });
    r = ackAll(r.state);
    expect(r.state.showStep).toBe(3);
    expect(r.state.showResult).toMatchObject({ seat: 1, crib: true, total: total('2c 4h 10h Kd', '5s', true) });
    expect(r.state.scores[1]).toBe(total(kept[1], '5s') + total('2c 4h 10h Kd', '5s', true));
    expect(r.state.stats[1].crib).toBe(total('2c 4h 10h Kd', '5s', true));
    st = r.state;
    const scores = [...st.scores];
    r = ackAll(st);
    expect(r.state.dealer).toBe(2);
    expect(r.state.turn).toBe(0);
    expect(r.state.handNo).toBe(st.handNo + 1);
    expect(r.state.phase).toBe('discard');
    expect(r.state.hands.map((h) => h.length)).toEqual([5, 5, 5]);
    expect(r.state.crib).toHaveLength(1);
    expect(r.state.scores).toEqual(scores);
    expect(kinds(r.events, 'deal')).toEqual([{ t: 'deal', dealer: 2, handNo: st.handNo + 1 }]);
  });

  it('four players: a win part-way through the show stops the later counts', () => {
    // Dealer 3: count order seats 0, 1, 2, 3, crib. Team 1 (seats 1 & 3) wins on seat 1's 29.
    const kept = ['2h 4d 6c 8s', '5h 5d 5c Js', '3h 3d 3c 4s', 'Ah Ad Ac 2s'];
    const s = mk({ players: 4, dealer: 3, hands: ['', '', '7h', ''], turn: 2, starter: '5s', kept, crib: '9h 9d 9c 10s', scores: [100, 115] });
    let r = play(s, 2, '7h'); // last card, team 0 -> 101
    const t0 = total(kept[0], '5s');
    expect(t0).toBeLessThan(20);
    expect(r.state.scores).toEqual([101 + t0, 115]);
    expect(r.state.showResult!.seat).toBe(0);
    r = ackAll(r.state);
    expect(r.state.showResult).toMatchObject({ seat: 1, total: 29 });
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(1);
    expect(r.state.scores).toEqual([101 + t0, 121]);
    expect(r.state.back).toEqual([101, 115]);
    expect(r.state.stats[1].hand).toBe(6); // capped at the finish
    expect(r.state.stats[1].best).toBe(29);
    expect(r.state.stats[2].hand).toBe(0); // never counted
    expect(r.state.stats[3].hand).toBe(0);
    expect(r.state.skunk).toEqual([0, 0]);
    expect(kinds(r.events, 'win')).toEqual([{ t: 'win', team: 1, skunk: [0, 0] }]);
    expect(() => ack(r.state, 0)).toThrow();
  });

  it('three players: the counting order decides it — a dealer on 119 never gets to count', () => {
    // Dealer 0: order seat 1, seat 2, seat 0.
    const kept = ['5h 5d 5c Js', '2h 4d 6c 8s', '6h 6d 7c 8s']; // the dealer holds 29; seat 2 holds 12
    const s = mk({ players: 3, dealer: 0, hands: ['', '9c', ''], turn: 1, starter: '5s', kept, scores: [119, 70, 110] });
    let r = play(s, 1, '9c'); // last card -> seat 1 on 71
    expect(r.state.showResult!.seat).toBe(1);
    const t1 = total(kept[1], '5s');
    expect(r.state.scores).toEqual([119, 71 + t1, 110]);
    r = ackAll(r.state); // seat 2 counts and passes 121
    expect(total(kept[2], '5s')).toBe(12);
    expect(r.state.winner).toBe(2);
    expect(r.state.phase).toBe('over');
    expect(r.state.scores).toEqual([119, 71 + t1, 121]);
    expect(r.state.skunk).toEqual([0, skunkLevel(71 + t1, 121), 0]);
  });
});

describe('winning and skunks with several losers', () => {
  const heels3 = (scores: number[]) => {
    const s = mk({ players: 3, phase: 'cut', dealer: 0, hands: ['2s 4s 6s 8s', '2h 4h 6h 8h', '2d 4d 6d 8d'], scores });
    s.deck = [c('Jh')];
    return applyAction(s, 1, { t: 'cut' }, idShuffle);
  };
  it('three players: each loser gets their own skunk level, and places rank by score', () => {
    const r = heels3([119, 80, 50]);
    expect(r.state.winner).toBe(0);
    expect(r.state.skunk).toEqual([0, 1, 2]);
    expect(kinds(r.events, 'win')).toEqual([{ t: 'win', team: 0, skunk: [0, 1, 2] }]);
    expect(placings(r.state.scores, r.state.winner)).toEqual([1, 2, 3]);
    expect(heels3([119, 91, 61]).state.skunk).toEqual([0, 0, 1]);
    expect(heels3([119, 60, 95]).state.skunk).toEqual([0, 2, 0]);
    expect(heels3([119, 120, 120]).state.skunk).toEqual([0, 0, 0]);
  });
  it('four players: the losing team is skunked as one', () => {
    const s = mk({ players: 4, phase: 'cut', dealer: 2, hands: ['2s 4s 6s 8s', '2h 4h 6h 8h', '2d 4d 6d 8d', '2c 4c 6c 8c'], scores: [119, 60] });
    s.deck = [c('Jh')];
    const r = applyAction(s, 3, { t: 'cut' }, idShuffle);
    expect(r.state.winner).toBe(0);
    expect(r.state.scores).toEqual([121, 60]);
    expect(r.state.skunk).toEqual([0, 2]);
  });
  it('winning mid-pegging in a three-player game ends it at once', () => {
    const s = mk({ players: 3, hands: ['9c 9d', '5h 4d', '8c'], pile: [['Kh', 0]], turn: 1, scores: [30, 120, 100] });
    const r = play(s, 1, '5h');
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(1);
    expect(r.state.scores).toEqual([30, 121, 100]);
    expect(r.state.skunk).toEqual([2, 0, 0]);
    expect(() => play(r.state, 2, '8c')).toThrow();
  });
});

describe('views', () => {
  it('a partner’s hand is as hidden as an opponent’s', () => {
    const s = mk({ players: 4, hands: ['2s 4s', '5h 6h', '7d 8d', '9c 10c'] });
    for (let you = 0; you < 4; you++) {
      const v = JSON.parse(JSON.stringify(viewFor(s, you)));
      expect(v.hand).toEqual(s.hands[you]);
      expect(v.handCounts).toEqual([2, 2, 2, 2]);
      for (const k of ['crib', 'deck', 'kept', 'hands', 'goSaid']) expect(v).not.toHaveProperty(k);
      const shown = new Set<number>(v.hand);
      for (let p = 0; p < 4; p++) if (p !== you) for (const x of s.hands[p]) expect(shown.has(x)).toBe(false);
    }
  });
});

// ---- random playthroughs ----

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

function legalAction(s: GameState, seat: Seat, rand: () => number): Action | null {
  const h = s.hands[seat];
  if (s.phase === 'discard' && h.length === handSize(s.players)) {
    const pool = [...h];
    const cards: Card[] = [];
    for (let k = 0; k < discardCount(s.players); k++) cards.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    return { t: 'discard', cards };
  }
  if (s.phase === 'cut' && seat === leftOf(s.players, s.dealer)) return { t: 'cut' };
  if (s.phase === 'peg' && s.turn === seat) {
    const ok = h.filter((x) => s.count + value(x) <= 31);
    return ok.length ? { t: 'play', card: ok[Math.floor(rand() * ok.length)] } : null;
  }
  if (s.phase === 'show' && !s.acks[seat]) return { t: 'ack' };
  return null;
}

/** Every card in a view the player could be told about (firstCut aside: it comes from another shuffle). */
const viewCards = (s: GameState, you: Seat): number[] => {
  const v = viewFor(s, you);
  return [
    ...v.hand, ...(v.starter === null ? [] : [v.starter]),
    ...v.pile.map((p) => p.card), ...v.played.map((p) => p.card), ...(v.showResult?.cards ?? []),
    ...(v.showResult?.items.flatMap((i) => i.cards) ?? []),
  ];
};

for (const players of [3, 4] as const) {
  describe(`${players}-player random playthroughs`, () => {
    it('play 60 random games to a clean finish with invariants, and views never leak', () => {
      const n = players;
      const deckAfterDeal = 52 - n * handSize(n) - (n === 3 ? 1 : 0);
      for (let g = 0; g < 60; g++) {
        const rand = rng(1000 * n + g);
        const shuffle = shuffler(rand);
        let { state } = newGame(shuffle, 121, n);
        let steps = 0;
        while (state.phase !== 'over') {
          const movers = Array.from({ length: n }, (_, p) => p).filter((p) => legalAction(state, p, rand) !== null);
          expect(movers.length, `stuck in ${state.phase} (game ${g})`).toBeGreaterThan(0);
          if (state.phase === 'peg') expect(movers).toEqual([state.turn]);
          const seat = movers[Math.floor(rand() * movers.length)];
          const action = legalAction(state, seat, rand)!;
          const before = [...state.scores];
          state = applyAction(state, seat, action, shuffle).state;
          state.scores.forEach((sc, t) => expect(sc).toBeGreaterThanOrEqual(before[t]));
          expect(state.count).toBeLessThanOrEqual(31);
          if (state.phase === 'discard') {
            expect(state.crib.length).toBe((n === 3 ? 1 : 0) + state.hands.filter((h) => h.length === 4).length);
          }
          if (state.phase === 'peg') {
            const held = state.hands.reduce((t, h) => t + h.length, 0);
            expect(held + state.played.length).toBe(4 * n);
            expect(state.crib.length).toBe(4);
            expect(state.deck.length).toBe(deckAfterDeal - 1);
            const all = new Set([...state.hands.flat(), ...state.played.map((p) => p.card), ...state.crib, ...state.deck, state.starter!]);
            expect(all.size).toBe(52);
            expect(state.hands[state.turn].some((x) => state.count + value(x) <= 31)).toBe(true);
          }
          // Hidden-card audit for every seat (partner included), on every step of the first 20 games.
          for (let you = 0; g < 20 && you < n; you++) {
            const hidden = new Set([
              ...state.hands.filter((_, p) => p !== you).flat(),
              ...state.deck,
              ...(state.showResult?.crib ? [] : state.crib),
            ]);
            for (const x of viewCards(state, you)) expect(hidden.has(x), `seat ${you} saw a hidden card`).toBe(false);
          }
          expect(++steps).toBeLessThan(8000);
        }
        const w = state.winner!;
        expect(state.scores.filter((sc) => sc === 121)).toHaveLength(1);
        expect(state.scores[w]).toBe(121);
        state.scores.forEach((sc, t) => {
          if (t !== w) expect(sc).toBeLessThan(121);
          expect(state.skunk[t]).toBe(t === w ? 0 : skunkLevel(sc, 121));
        });
        const teamPts = teamSeats(n, w).reduce((t, p) => t + state.stats[p].peg + state.stats[p].hand + state.stats[p].crib, 0);
        expect(teamPts).toBe(121);
      }
    }, 60_000);

    it('the deal passes clockwise every hand and the player on the dealer’s left leads', () => {
      const rand = rng(77 + players);
      const shuffle = shuffler(rand);
      let { state } = newGame(shuffle, 1000, players);
      let dealer = state.dealer;
      let hands = 1;
      for (let i = 0; i < 20000 && hands < 9; i++) {
        const seat = Array.from({ length: players }, (_, p) => p).find((p) => legalAction(state, p, rand))!;
        const prev = state.handNo;
        state = applyAction(state, seat, legalAction(state, seat, rand)!, shuffle).state;
        if (state.handNo !== prev) {
          hands++;
          expect(state.dealer).toBe(leftOf(players, dealer));
          dealer = state.dealer;
          expect(state.turn).toBe(leftOf(players, dealer));
          expect(state.hands.every((h) => h.length === 5)).toBe(true);
        }
      }
      expect(hands).toBe(9);
    });
  });
}
