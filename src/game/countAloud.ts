// The show counted the way players count aloud at a table, carrying the total
// forward: "Fifteen two, fifteen four, and a pair is six, and a run of three is
// nine… Nine." Pure, so it can be tested; the table and the replay both use it.
//
// Traditional order: fifteens, pairs, runs, flush, nobs. A pair royal or a double
// run is still counted one combination at a time, so each pair or each run gets
// its own step and lights its own cards.
import { type Card, RANKS, SUIT_NAMES, rank, suit } from '../../shared/cards';
import type { ScoreItem } from '../../shared/scoring';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty'];

/** 0 … 39 in words: "seven", "twenty-nine". */
export function numberWord(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 40) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  return String(n);
}

export const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const ORDER = ['fifteen', 'pair', 'run', 'flush', 'nobs'];
const RANK_PLURAL = ['aces', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', 'jacks', 'queens', 'kings'];

export interface CountStep {
  kind: string;
  /** As said aloud, in sentence case: "Fifteen two", "fifteen four", "and a pair is six". */
  phrase: string;
  /** Why it scores, in small text under the phrase: "7 + 8 = 15", "two 8s", "5 · 6 · 7". */
  reason: string;
  /** Running total after this step. */
  running: number;
  points: number;
  /** The cards that make it (the starter included when it takes part). */
  cards: Card[];
}

export interface CountAloud {
  steps: CountStep[];
  total: number;
  /** The last beat: "Fourteen.", or for nothing "Nineteen. Nothing this time.". */
  totalPhrase: string;
}

const byRank = (cards: Card[]) => [...cards].sort((a, b) => rank(a) - rank(b) || suit(a) - suit(b));

function reasonFor(it: ScoreItem): string {
  const cards = byRank(it.cards);
  switch (it.kind) {
    case 'fifteen':
      return `${cards.map((c) => RANKS[rank(c)]).join(' + ')} = 15`;
    case 'pair':
      return `two ${RANK_PLURAL[rank(cards[0])]}`;
    case 'run':
      return cards.map((c) => RANKS[rank(c)]).join(' · ');
    case 'flush':
      return `${numberWord(cards.length)} ${SUIT_NAMES[suit(cards[0])]}`;
    case 'nobs':
      return 'jack of the starter’s suit';
    default:
      return '';
  }
}

/** Items (from scoreHand) in, the spoken steps out. */
export function countAloud(items: ScoreItem[]): CountAloud {
  const sorted = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (ORDER.indexOf(a.it.kind) - ORDER.indexOf(b.it.kind)) || a.i - b.i)
    .map((x) => x.it);
  let running = 0;
  const steps = sorted.map((it, k): CountStep => {
    running += it.points;
    const again = k > 0 && sorted[k - 1].kind === it.kind;
    const and = k > 0 ? 'and ' : '';
    let said: string;
    switch (it.kind) {
      case 'fifteen':
        said = `fifteen ${numberWord(running)}`;
        break;
      case 'pair':
        said = `${and}${again ? 'another pair' : 'a pair'} is ${numberWord(running)}`;
        break;
      case 'run':
        said = `${and}${again ? 'another run' : 'a run'} of ${numberWord(it.cards.length)} is ${numberWord(running)}`;
        break;
      case 'flush':
        said = `${and}a flush is ${numberWord(running)}`;
        break;
      case 'nobs':
        said = `${and}his nobs is ${numberWord(running)}`;
        break;
      default:
        said = `${and}${it.kind} is ${numberWord(running)}`;
    }
    return { kind: it.kind, phrase: k === 0 ? capitalise(said) : said, reason: reasonFor(it), running, points: it.points, cards: it.cards };
  });
  const total = running;
  return { steps, total, totalPhrase: total === 0 ? 'Nineteen. Nothing this time.' : `${capitalise(numberWord(total))}.` };
}
