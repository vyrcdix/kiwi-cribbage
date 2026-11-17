import { describe, expect, it } from 'vitest';
import { chipLabels } from './seating';

// Four players: seats 0 and 2 are partners, as are 1 and 3. Three: every seat its own team.
describe('chipLabels (handoff v3 §3)', () => {
  it('is one letter when nothing repeats within a team', () => {
    expect(chipLabels(4, ['Margaret', 'Bob', 'Carol', 'Dave'])).toEqual(['M', 'B', 'C', 'D']);
    // The same letter on different teams is told apart by colour.
    expect(chipLabels(4, ['Dave', 'Dot', 'Carol', 'Bob'])).toEqual(['D', 'D', 'C', 'B']);
    expect(chipLabels(3, ['Dave', 'Dot', 'Di'])).toEqual(['D', 'D', 'D']);
  });

  it('takes the first letter that differs when partners share an initial', () => {
    expect(chipLabels(4, ['Dave', 'Bob', 'Dot', 'Carol'])).toEqual(['Da', 'B', 'Do', 'C']);
    expect(chipLabels(4, ['Margaret B.', 'Bob', 'Margaret T.', 'Carol'])).toEqual(['MB', 'B', 'MT', 'C']);
  });

  it('falls back to the seat number for two plain Margarets, and survives odd names', () => {
    expect(chipLabels(4, ['Margaret', 'Bob', 'Margaret', 'Carol'])).toEqual(['M1', 'B', 'M3', 'C']);
    expect(chipLabels(4, ['', '🐶', 'élan', 'Zoë'])).toEqual(['?', '?', 'É', 'Z']);
  });
});
