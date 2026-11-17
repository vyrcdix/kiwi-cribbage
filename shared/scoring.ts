import { type Card, JACK, rank, suit, value } from './cards.js';

export type ScoreKind =
  | 'fifteen' | 'pair' | 'run' | 'flush' | 'nobs' // hand + pegging
  | 'thirtyone' | 'go' | 'last' | 'heels'; // pegging / the cut

export interface ScoreItem {
  kind: ScoreKind;
  /** The cards that make the combination (empty for go / last card). */
  cards: Card[];
  points: number;
}

const isRun = (ranks: number[]): boolean => {
  const r = [...ranks].sort((a, b) => a - b);
  for (let i = 1; i < r.length; i++) if (r[i] !== r[i - 1] + 1) return false;
  return true;
};

/**
 * Score a four-card hand (or crib) with the starter, in the traditional
 * counting order: fifteens, pairs, runs, flush, nobs.
 */
export function scoreHand(hand: Card[], starter: Card, isCrib = false): { total: number; items: ScoreItem[] } {
  const all = [...hand, starter];
  const items: ScoreItem[] = [];
  const pick = (mask: number) => all.filter((_, i) => (mask >> i) & 1);

  for (let m = 1; m < 32; m++) {
    let sum = 0;
    for (let i = 0; i < 5; i++) if ((m >> i) & 1) sum += value(all[i]);
    if (sum === 15) items.push({ kind: 'fifteen', cards: pick(m), points: 2 });
  }

  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++)
      if (rank(all[i]) === rank(all[j])) items.push({ kind: 'pair', cards: [all[i], all[j]], points: 2 });

  // Only the longest runs count; a double run is two runs of the same length.
  for (const size of [5, 4, 3]) {
    let found = false;
    for (let m = 1; m < 32; m++) {
      const cards = pick(m);
      if (cards.length === size && isRun(cards.map(rank))) {
        items.push({ kind: 'run', cards, points: size });
        found = true;
      }
    }
    if (found) break;
  }

  // A four-card flush counts in the hand but not in the crib.
  if (hand.every((c) => suit(c) === suit(hand[0]))) {
    if (suit(starter) === suit(hand[0])) items.push({ kind: 'flush', cards: all, points: 5 });
    else if (!isCrib) items.push({ kind: 'flush', cards: [...hand], points: 4 });
  }

  const nob = hand.find((c) => rank(c) === JACK && suit(c) === suit(starter));
  if (nob !== undefined) items.push({ kind: 'nobs', cards: [nob], points: 1 });

  return { total: items.reduce((n, it) => n + it.points, 0), items };
}

/**
 * Score the card just played in pegging. `pile` is every card played since
 * the count was last reset, in order, ending with the new card.
 */
export function scorePegPlay(pile: Card[]): ScoreItem[] {
  const items: ScoreItem[] = [];
  const count = pile.reduce((n, c) => n + value(c), 0);
  if (count === 15) items.push({ kind: 'fifteen', cards: [...pile], points: 2 });
  if (count === 31) items.push({ kind: 'thirtyone', cards: [...pile], points: 2 });

  const last = pile[pile.length - 1];
  let same = 1;
  while (same < pile.length && rank(pile[pile.length - 1 - same]) === rank(last)) same++;
  if (same >= 2) items.push({ kind: 'pair', cards: pile.slice(-same), points: same * (same - 1) });

  for (let n = pile.length; n >= 3; n--) {
    const tail = pile.slice(-n);
    if (isRun(tail.map(rank))) {
      items.push({ kind: 'run', cards: tail, points: n });
      break;
    }
  }
  return items;
}

/** "Fifteen for 2", "Pair royal for 6", "Run of four for 4"… */
export function describeItem(it: ScoreItem): string {
  const words = ['', '', '', 'three', 'four', 'five', 'six', 'seven'];
  switch (it.kind) {
    case 'fifteen': return 'Fifteen for 2';
    case 'thirtyone': return 'Thirty-one for 2';
    case 'pair':
      return it.points === 2 ? 'Pair for 2' : it.points === 6 ? 'Pair royal for 6' : 'Double pair royal for 12';
    case 'run': return `Run of ${words[it.points]} for ${it.points}`;
    case 'flush': return `Flush for ${it.points}`;
    case 'nobs': return 'His nobs for 1';
    case 'heels': return 'His heels for 2';
    case 'go': return 'Go for 1';
    case 'last': return 'Last card for 1';
  }
}
