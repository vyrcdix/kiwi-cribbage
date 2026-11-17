import { describe, expect, it } from 'vitest';
import { card } from '../../shared/cards';
import { scoreHand } from '../../shared/scoring';
import { showRows } from './callouts';
import { countAloud, numberWord } from './countAloud';

// Ranks are 0-based (0 = ace, 10 = jack); suits 0 spades, 1 hearts, 2 diamonds, 3 clubs.
const count = (hand: number[][], starter: number[]) => countAloud(scoreHand(hand.map(([r, s]) => card(r, s)), card(starter[0], starter[1])).items);
const said = (c: ReturnType<typeof countAloud>) => c.steps.map((s) => `${s.phrase} | ${s.reason}`);

describe('countAloud', () => {
  it('two fifteens and a run: fifteen two, fifteen four, and a run of three is seven', () => {
    const c = count([[2, 0], [3, 1], [4, 2], [12, 3]], [7, 0]); // 3 4 5 K, starter 8
    expect(said(c)).toEqual([
      'Fifteen two | 5 + K = 15',
      'fifteen four | 3 + 4 + 8 = 15',
      'and a run of three is seven | 3 · 4 · 5',
    ]);
    expect(c.totalPhrase).toBe('Seven.');
  });

  it('a pair royal is counted a pair at a time', () => {
    const c = count([[8, 0], [8, 1], [8, 2], [1, 3]], [11, 0]); // 9 9 9 2, starter Q
    expect(c.steps.map((s) => s.phrase)).toEqual(['A pair is two', 'and another pair is four', 'and another pair is six']);
    expect(c.steps.map((s) => s.reason)).toEqual(['two 9s', 'two 9s', 'two 9s']);
    expect(c.steps.map((s) => s.cards.length)).toEqual([2, 2, 2]);
    expect(c.totalPhrase).toBe('Six.');
  });

  it('a hand worth nothing is nineteen', () => {
    const c = count([[1, 0], [3, 1], [5, 2], [7, 3]], [11, 0]); // 2 4 6 8, starter Q
    expect(c.steps).toEqual([]);
    expect(c.total).toBe(0);
    expect(c.totalPhrase).toBe('Nineteen — nothing this time');
  });

  it('the 29', () => {
    const c = count([[4, 0], [4, 1], [4, 3], [10, 2]], [4, 2]); // 5 5 5 J♦, starter 5♦
    expect(c.total).toBe(29);
    expect(c.steps.map((s) => s.phrase)).toEqual([
      'Fifteen two', 'fifteen four', 'fifteen six', 'fifteen eight',
      'fifteen ten', 'fifteen twelve', 'fifteen fourteen', 'fifteen sixteen',
      'and a pair is eighteen', 'and another pair is twenty', 'and another pair is twenty-two',
      'and another pair is twenty-four', 'and another pair is twenty-six', 'and another pair is twenty-eight',
      'and his nobs is twenty-nine',
    ]);
    expect(c.steps[0].reason).toMatch(/= 15$/);
    expect(c.steps[14].reason).toBe('jack of the starter’s suit');
    expect(c.totalPhrase).toBe('Twenty-nine.');
  });

  it('flushes, and the traditional order whatever order the items arrive in', () => {
    const items = scoreHand([card(1, 1), card(3, 1), card(6, 1), card(10, 1)], card(8, 1)).items; // 2 4 7 J 9, all hearts
    const c = countAloud([...items].reverse());
    const kinds = c.steps.map((s) => s.kind);
    expect(kinds.indexOf('flush')).toBeLessThan(kinds.indexOf('nobs'));
    expect(c.steps.find((s) => s.kind === 'flush')!.reason).toBe('five hearts');
  });

  it('numbers in words', () => {
    expect([0, 7, 15, 20, 21, 29].map(numberWord)).toEqual(['zero', 'seven', 'fifteen', 'twenty', 'twenty-one', 'twenty-nine']);
  });
});

describe('showRows (folding a long show)', () => {
  const lines = (() => {
    const r = scoreHand([card(4, 0), card(4, 1), card(4, 3), card(10, 2)], card(4, 2));
    let running = 0;
    return r.items.map((it) => ({ name: it.kind, detail: '', running: (running += it.points), cards: it.cards, kind: it.kind, points: it.points }));
  })();

  it('leaves six or fewer alone', () => {
    expect(showRows(lines, 5).length).toBe(6);
  });
  it('a finished 29 folds to three lines', () => {
    const rows = showRows(lines, -1);
    expect(rows.map((r) => `${r.name}: ${r.detail} → ${r.running}`)).toEqual([
      'Fifteens: eight of them: 16 → 16',
      'Pairs: six of them: 12 → 28',
      'nobs:  → 29',
    ]);
  });
  it('the step being counted is never folded', () => {
    const rows = showRows(lines, 7);
    expect(rows[rows.length - 1]).toMatchObject({ current: true, count: 1, running: 16 });
    expect(rows.length).toBeLessThanOrEqual(6);
  });
});
