// Exhaustive: all C(52,4) x 48 = 12,994,800 (hand, starter) pairs through the real scoreHand.
// Gated: run with EXHAUSTIVE=1 npx vitest run shared/handdistribution
import { describe, expect, it } from 'vitest';
import { scoreHand } from './scoring';

const EXPECTED: Record<number, number> = {
  0: 1009008, 1: 99792, 2: 2813796, 3: 505008, 4: 2855676, 5: 697508, 6: 1800268, 7: 751324,
  8: 1137236, 9: 361224, 10: 388740, 11: 51680, 12: 317340, 13: 19656, 14: 90100, 15: 9168,
  16: 58248, 17: 11196, 18: 2708, 19: 0, 20: 8068, 21: 2496, 22: 444, 23: 356, 24: 3680,
  25: 0, 26: 0, 27: 0, 28: 76, 29: 4,
};

describe.skipIf(!process.env.EXHAUSTIVE)('exhaustive hand-score distribution', () => {
  it('matches the published distribution over all 12,994,800 hands', () => {
    const t0 = Date.now();
    const tally = new Array<number>(30).fill(0);
    let n = 0;
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++) {
            const hand = [a, b, c, d];
            for (let s = 0; s < 52; s++) {
              if (s === a || s === b || s === c || s === d) continue;
              tally[scoreHand(hand, s, false).total]++;
              n++;
            }
          }
    const secs = (Date.now() - t0) / 1000;
    console.log(`DISTRIBUTION n=${n} secs=${secs}\n` + tally.map((v, i) => `${i}: ${v} (expected ${EXPECTED[i]})`).join('\n'));
    expect(n).toBe(12994800);
    for (let i = 0; i < 30; i++) expect(tally[i], `score ${i}`).toBe(EXPECTED[i]);
  }, 3_600_000);
});
