// Differential tests: independent scorers built on different methods
// (value-DP for fifteens, rank multiplicities for pairs, stretch products for runs),
// compared with scoring.ts. Always-on: random hands and random pegging sequences.
// EXHAUSTIVE=1 adds every hand, both crib and non-crib.
import { describe, expect, it } from 'vitest';
import { fullDeck, rank, suit, value } from './cards';
import { scoreHand, scorePegPlay } from './scoring';

function refHand(hand: number[], starter: number, isCrib: boolean): number {
  const all = [...hand, starter];
  const ways = new Array<number>(16).fill(0);
  ways[0] = 1;
  for (const c of all) {
    const v = value(c);
    for (let s = 15; s >= v; s--) ways[s] += ways[s - v];
  }
  let pts = 2 * ways[15];
  const cnt = new Array<number>(13).fill(0);
  for (const c of all) cnt[rank(c)]++;
  for (const m of cnt) pts += m * (m - 1);
  let r = 0;
  while (r < 13) {
    if (cnt[r] === 0) { r++; continue; }
    let e = r, prod = 1;
    while (e < 13 && cnt[e] > 0) { prod *= cnt[e]; e++; }
    if (e - r >= 3) pts += (e - r) * prod;
    r = e;
  }
  const hs = hand.map(suit);
  if (hs.every((x) => x === hs[0])) {
    if (suit(starter) === hs[0]) pts += 5;
    else if (!isCrib) pts += 4;
  }
  if (hand.some((c) => rank(c) === 10 && suit(c) === suit(starter))) pts += 1;
  return pts;
}

function refPeg(pile: number[]): number {
  let pts = 0;
  const total = pile.reduce((n, c) => n + value(c), 0);
  if (total === 15 || total === 31) pts += 2;
  const L = pile.length;
  let k = 0;
  while (k < L && rank(pile[L - 1 - k]) === rank(pile[L - 1])) k++;
  pts += k * (k - 1);
  for (let n = Math.min(L, 7); n >= 3; n--) {
    const ranks = pile.slice(L - n).map(rank);
    if (new Set(ranks).size === n && Math.max(...ranks) - Math.min(...ranks) === n - 1) { pts += n; break; }
  }
  return pts;
}

const lcg = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const shuffled = (rand: () => number) => {
  const d = fullDeck();
  for (let i = 51; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
};
const realPeg = (pile: number[]) => scorePegPlay(pile).reduce((n, it) => n + it.points, 0);

describe('differential: hands', () => {
  it('reference scorer sanity (29 hand, 28, 24)', () => {
    // 5h 5d 5c Jh... jack of spades with starter 5s: ranks 4 in suits 1,2,3 + J spades, starter 5 spades
    expect(refHand([4 + 13, 4 + 26, 4 + 39, 10], 4, false)).toBe(29);
    expect(refHand([4, 4 + 13, 4 + 26, 4 + 39], 12, false)).toBe(28);
  });
  it('matches scoreHand on 20,000 random hands (crib and non-crib)', () => {
    const rand = lcg(12345);
    for (let i = 0; i < 20000; i++) {
      const d = shuffled(rand);
      const hand = d.slice(0, 4), st = d[4];
      for (const crib of [false, true])
        expect(scoreHand(hand, st, crib).total, JSON.stringify({ hand, st, crib })).toBe(refHand(hand, st, crib));
    }
  });
  it('matches scoreHand on 20,000 biased hands (runs, flushes, nobs)', () => {
    const rand = lcg(999);
    for (let i = 0; i < 20000; i++) {
      const base = Math.floor(rand() * 10), suitBias = Math.floor(rand() * 4);
      const pool = fullDeck().filter((c) => (rank(c) >= base && rank(c) <= base + 5) || rank(c) === 10 || rand() < 0.1);
      const pick = new Set<number>();
      while (pick.size < 5)
        pick.add(rand() < 0.4 ? suitBias * 13 + Math.floor(rand() * 13) : pool[Math.floor(rand() * pool.length)]);
      const [a, b, c, d, s] = [...pick];
      for (const crib of [false, true])
        expect(scoreHand([a, b, c, d], s, crib).total, JSON.stringify({ a, b, c, d, s, crib })).toBe(refHand([a, b, c, d], s, crib));
    }
  });
});

describe('differential: pegging', () => {
  const check = (pile: number[]) => expect(realPeg(pile), JSON.stringify(pile)).toBe(refPeg(pile));
  it('matches on every prefix of 20,000 random legal sequences (count <= 31)', () => {
    const rand = lcg(4242);
    for (let i = 0; i < 20000; i++) {
      const pile: number[] = [];
      let count = 0;
      for (const c of shuffled(rand)) {
        if (count + value(c) > 31) continue;
        pile.push(c); count += value(c);
        check(pile);
        if (count === 31) break;
      }
    }
  });
  it('matches on 20,000 low-card-heavy sequences (long runs, pairs of 2/3/4)', () => {
    const rand = lcg(77);
    for (let i = 0; i < 20000; i++) {
      const pile: number[] = [];
      let count = 0;
      const n = 3 + Math.floor(rand() * 10);
      for (let k = 0; k < n; k++) {
        const c = Math.floor(rand() * 4) * 13 + Math.floor(rand() * 8);
        if (pile.includes(c) || count + value(c) > 31) continue;
        pile.push(c); count += value(c);
        check(pile);
      }
    }
  });
  it('matches on all 5040 orderings of A..7 and every prefix (runs up to seven)', () => {
    const perm = (arr: number[], out: number[] = []) => {
      if (!arr.length) { for (let n = 1; n <= 7; n++) check(out.slice(0, n)); return; }
      arr.forEach((x, i) => perm([...arr.slice(0, i), ...arr.slice(i + 1)], [...out, x]));
    };
    perm([0, 1, 2, 3, 4, 5, 6]);
  });
  it('spot checks: seven-card run, four 2s', () => {
    expect(realPeg([0, 14, 28, 42, 4, 18, 32])).toBe(7 + 0); // A 2 3 4 5 6 7 (count 28)
    expect(realPeg([1, 14, 27, 40])).toBe(12);
    expect(realPeg([2, 15, 28])).toBe(6); // 3-3-3 = 9 count, pair royal
    expect(realPeg([3, 16])).toBe(2);
  });
});

describe.skipIf(!process.env.EXHAUSTIVE)('differential: exhaustive hands', () => {
  it('real scoreHand equals reference for all 12,994,800 hands, crib and non-crib', () => {
    const t0 = Date.now();
    let n = 0;
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++) {
            const hand = [a, b, c, d];
            for (let s = 0; s < 52; s++) {
              if (s === a || s === b || s === c || s === d) continue;
              for (const crib of [false, true]) {
                const real = scoreHand(hand, s, crib).total, ref = refHand(hand, s, crib);
                if (real !== ref) throw new Error(`MISMATCH ${JSON.stringify({ hand, s, crib, real, ref })}`);
              }
              n++;
            }
          }
    console.log(`DIFFERENTIAL exhaustive n=${n} secs=${(Date.now() - t0) / 1000}`);
    expect(n).toBe(12994800);
  }, 3_600_000);
});
