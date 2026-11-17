// The engine's hand log (the raw material of every stored hand record), the
// seatsToAct helpers, and handRecordFrom's redaction, over many random games.
import { describe, expect, it } from 'vitest';
import { fullDeck, sortHand, value } from './cards';
import {
  type Action, applyAction, discardCount, type GameEvent, type GameState, handSize, newGame, type PlayerCount,
  seatsToAct, seatsToActInView, teamOf, viewFor,
} from './game';
import { handRecordFrom } from './league';
import { scoreHand } from './scoring';

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const shuffler = (rand: () => number) => () => {
  const d = fullDeck();
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

/** Every action that could be tried for a seat (most will be illegal). */
const candidates = (s: GameState, seat: number): Action[] => [
  { t: 'discard', cards: s.hands[seat].slice(0, discardCount(s.players)) },
  { t: 'cut' },
  ...s.hands[seat].map((card) => ({ t: 'play' as const, card })),
  { t: 'ack' },
];
/** The action is accepted and changes something (a repeated ack is accepted but changes nothing). */
const legal = (s: GameState, seat: number, a: Action, shuffle: () => number[]) => {
  try {
    return JSON.stringify(applyAction(s, seat, a, shuffle).state) !== JSON.stringify(s);
  } catch {
    return false;
  }
};

function* games(players: PlayerCount, count: number, seed: number) {
  for (let g = 0; g < count; g++) {
    const rand = lcg(seed + g);
    const shuffle = shuffler(rand);
    let { state, events } = newGame(shuffle, 121, players);
    yield { state, events, shuffle, done: false };
    while (state.phase !== 'over') {
      const who = seatsToAct(state);
      const seat = who[Math.floor(rand() * who.length)];
      let action: Action;
      if (state.phase === 'discard') {
        const h = [...state.hands[seat]];
        const cards = [];
        for (let k = 0; k < discardCount(players); k++) cards.push(h.splice(Math.floor(rand() * h.length), 1)[0]);
        action = { t: 'discard', cards };
      } else if (state.phase === 'cut') action = { t: 'cut' };
      else if (state.phase === 'peg') {
        const ok = state.hands[seat].filter((c) => state.count + value(c) <= 31);
        action = { t: 'play', card: ok[Math.floor(rand() * ok.length)] };
      } else action = { t: 'ack' };
      ({ state, events } = applyAction(state, seat, action, shuffle));
      yield { state, events, shuffle, done: state.phase === 'over' };
    }
  }
}

for (const players of [2, 3, 4] as const) {
  describe(`${players} players`, () => {
    it('the hand log matches the hand, event for event', () => {
      let hands = 0;
      let log = null as GameState['handLog'] | null;
      let peg: number[] = [];
      let heels = 0;
      const check = (s: GameState) => {
        const L = s.handLog!;
        expect(L.handNo).toBe(s.handNo);
        expect(L.dealer).toBe(s.dealer);
        L.dealt.forEach((d, p) => {
          expect(d).toHaveLength(handSize(players));
          expect(d).toEqual(sortHand(d));
          if (L.discards[p].length) expect(sortHand([...s.kept[p], ...L.discards[p]])).toEqual(d);
        });
        if (s.phase !== 'discard') expect(sortHand(s.crib)).toEqual(sortHand([...(L.deckToCrib === null ? [] : [L.deckToCrib]), ...L.discards.flat()]));
        expect(L.deckToCrib === null).toBe(players !== 3);
        expect(L.starter).toBe(s.starter);
        expect(L.heels).toBe(heels);
        expect(L.peg.filter((e) => e.t === 'play').map((e) => ({ card: e.card, seat: e.seat }))).toEqual(s.played);
        const sum = Array(players).fill(0);
        for (const e of L.peg) if (e.t !== 'go') sum[e.seat] += e.points;
        expect(sum).toEqual(peg);
        for (const sh of L.shows) expect(sh.total).toBe(scoreHand(sh.cards, s.starter!, sh.crib).total);
      };
      for (const { state, events } of games(players, 15, 100 * players)) {
        for (const e of events as GameEvent[]) {
          if (e.t === 'deal') { peg = Array(players).fill(0); heels = 0; hands++; }
          if (e.t === 'score' && e.why === 'peg') peg[e.seat] += e.points;
          if (e.t === 'score' && e.why === 'heels') heels += e.points;
        }
        check(state);
        if (state.showResult) expect(state.handLog!.shows[state.handLog!.shows.length - 1]).toEqual(state.showResult);
        log = state.handLog;
      }
      expect(log).toBeTruthy();
      expect(hands).toBeGreaterThan(60);
    });

    it('seatsToAct is exactly the seats with a legal move, and the view agrees', () => {
      let states = 0;
      for (const { state, shuffle } of games(players, 4, 500 * players)) {
        const brute = [...Array(players).keys()].filter((p) => candidates(state, p).some((a) => legal(state, p, a, shuffle)));
        expect(seatsToAct(state)).toEqual(brute);
        for (let p = 0; p < players; p++) expect(seatsToActInView(viewFor(state, p))).toEqual(brute);
        states++;
      }
      expect(states).toBeGreaterThan(200);
    });

    it('handRecordFrom: in progress, a seat sees only its own cards, plays, the starter and counted shows', () => {
      let checked = 0;
      for (const { state } of games(players, 4, 900 * players)) {
        if (state.phase === 'over') continue;
        for (let you = 0; you < players; you++) {
          const rec = handRecordFrom(state.handLog!, players, { scoresAfter: state.scores, complete: false, endedGame: false, finishedAt: null, visibleTo: you });
          const legit = new Set([
            ...state.handLog!.dealt[you], ...state.played.map((p) => p.card),
            ...(state.starter === null ? [] : [state.starter]), ...state.handLog!.shows.flatMap((sh) => sh.cards),
          ]);
          const seen = [
            ...rec.dealt.flatMap((d) => d ?? []), ...rec.kept.flatMap((d) => d ?? []), ...rec.discards.flatMap((d) => d ?? []),
            ...(rec.crib ?? []), ...(rec.deckToCrib === null ? [] : [rec.deckToCrib]), ...(rec.starter === null ? [] : [rec.starter]),
            ...rec.peg.flatMap((e) => (e.t === 'play' ? [e.card] : [])), ...rec.shows.flatMap((sh) => sh.cards ?? []),
          ];
          for (const c of seen) expect(legit.has(c)).toBe(true);
          rec.dealt.forEach((d, p) => expect(d === null).toBe(p !== you));
          expect(rec.scoresAfter).toEqual(state.scores);
          expect(rec.scoresBefore.length).toBe(teamOf(players, players - 1) + 1);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(200);
    });
  });
}
