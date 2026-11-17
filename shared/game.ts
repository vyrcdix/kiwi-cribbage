// The whole game as a pure state machine. The server owns a GameState, feeds
// it actions, and sends each player a redacted PlayerView — the client never
// sees the opponent's hand, the crib, or the deck.
import { type Card, JACK, rank, sortHand, value } from './cards.js';
import { type ScoreItem, scoreHand, scorePegPlay } from './scoring.js';

export type Seat = 0 | 1;
export type Phase = 'discard' | 'cut' | 'peg' | 'show' | 'over';
export interface Play { card: Card; seat: Seat }
export interface ShowResult { seat: Seat; crib: boolean; cards: Card[]; items: ScoreItem[]; total: number }
export interface SeatStats { peg: number; hand: number; crib: number; best: number }

export interface GameState {
  target: number;
  handNo: number;
  dealer: Seat;
  /** The cut for first deal — low card deals. */
  firstCut: [Card, Card];
  scores: [number, number];
  /** Score before the most recent points: where the back peg sits. */
  back: [number, number];
  phase: Phase;
  deck: Card[];
  /** Cards still held: 6 after the deal, 4 after discarding, fewer as pegging goes. */
  hands: [Card[], Card[]];
  /** The four cards each player kept, for the show. */
  kept: [Card[], Card[]];
  crib: Card[];
  starter: Card | null;
  turn: Seat;
  count: number;
  /** Cards played since the count last reset. */
  pile: Play[];
  /** Every card played this hand. */
  played: Play[];
  goSaid: boolean;
  /** 0 = non-dealer's hand, 1 = dealer's hand, 2 = crib. */
  showStep: 0 | 1 | 2;
  showResult: ShowResult | null;
  acks: [boolean, boolean];
  winner: Seat | null;
  /** 0 none, 1 skunk (loser under 91), 2 double skunk (under 61). */
  skunk: 0 | 1 | 2;
  stats: [SeatStats, SeatStats];
}

export type Action =
  | { t: 'discard'; cards: [Card, Card] }
  | { t: 'cut' }
  | { t: 'play'; card: Card }
  | { t: 'ack' };

export type ScoreWhy = 'peg' | 'heels' | 'hand' | 'crib';
export type GameEvent =
  | { t: 'firstcut'; cards: [Card, Card]; dealer: Seat }
  | { t: 'deal'; dealer: Seat; handNo: number }
  | { t: 'discard'; seat: Seat }
  | { t: 'starter'; card: Card }
  | { t: 'play'; seat: Seat; card: Card; count: number }
  | { t: 'go'; seat: Seat }
  | { t: 'score'; seat: Seat; items: ScoreItem[]; points: number; why: ScoreWhy }
  | { t: 'win'; seat: Seat; skunk: 0 | 1 | 2 };

export interface PlayerView {
  you: Seat;
  target: number;
  handNo: number;
  dealer: Seat;
  firstCut: [Card, Card];
  scores: [number, number];
  back: [number, number];
  phase: Phase;
  hand: Card[];
  oppHandCount: number;
  discarded: [boolean, boolean];
  cribCount: number;
  starter: Card | null;
  turn: Seat;
  count: number;
  pile: Play[];
  played: Play[];
  showStep: 0 | 1 | 2;
  showResult: ShowResult | null;
  acks: [boolean, boolean];
  winner: Seat | null;
  skunk: 0 | 1 | 2;
  stats: [SeatStats, SeatStats];
}

export class GameError extends Error {}
export type Shuffle = () => Card[];
export const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

const fail = (msg: string): never => { throw new GameError(msg); };
const newStats = (): SeatStats => ({ peg: 0, hand: 0, crib: 0, best: 0 });

export function newGame(shuffle: Shuffle, target = 121): { state: GameState; events: GameEvent[] } {
  // Cut for deal: low card deals (ace low). Equal ranks cut again.
  const d = shuffle();
  const a = d[0];
  const b = d.find((c) => rank(c) !== rank(a))!;
  const dealer: Seat = rank(a) < rank(b) ? 0 : 1;
  const state: GameState = {
    target, handNo: 0, dealer, firstCut: [a, b],
    scores: [0, 0], back: [0, 0], phase: 'discard',
    deck: [], hands: [[], []], kept: [[], []], crib: [], starter: null,
    turn: other(dealer), count: 0, pile: [], played: [], goSaid: false,
    showStep: 0, showResult: null, acks: [false, false],
    winner: null, skunk: 0, stats: [newStats(), newStats()],
  };
  const events: GameEvent[] = [{ t: 'firstcut', cards: [a, b], dealer }];
  deal(state, shuffle, events);
  return { state, events };
}

function deal(s: GameState, shuffle: Shuffle, events: GameEvent[]): void {
  const d = shuffle();
  s.handNo += 1;
  s.hands = [sortHand(d.slice(0, 6)), sortHand(d.slice(6, 12))];
  s.deck = d.slice(12);
  s.kept = [[], []];
  s.crib = [];
  s.starter = null;
  s.count = 0;
  s.pile = [];
  s.played = [];
  s.goSaid = false;
  s.showStep = 0;
  s.showResult = null;
  s.acks = [false, false];
  s.turn = other(s.dealer);
  s.phase = 'discard';
  events.push({ t: 'deal', dealer: s.dealer, handNo: s.handNo });
}

/** Add points; returns true if that ended the game. */
function award(s: GameState, seat: Seat, items: ScoreItem[], why: ScoreWhy, events: GameEvent[]): boolean {
  const points = items.reduce((n, it) => n + it.points, 0);
  if (points === 0) return false;
  s.back[seat] = s.scores[seat];
  s.scores[seat] = Math.min(s.target, s.scores[seat] + points);
  // Stats record points actually pegged, so the last score of a game is
  // capped at the finish; the best hand keeps its full value.
  const gained = s.scores[seat] - s.back[seat];
  const st = s.stats[seat];
  if (why === 'hand') { st.hand += gained; st.best = Math.max(st.best, points); }
  else if (why === 'crib') st.crib += gained;
  else st.peg += gained;
  events.push({ t: 'score', seat, items, points, why });
  if (s.scores[seat] < s.target) return false;
  s.winner = seat;
  s.phase = 'over';
  const loser = s.scores[other(seat)];
  // Skunk lines sit at three-quarters and half of the way home (91 / 61 of 121).
  s.skunk = loser < Math.ceil(s.target / 2) ? 2 : loser < Math.ceil((s.target * 3) / 4) ? 1 : 0;
  events.push({ t: 'win', seat, skunk: s.skunk });
  return true;
}

function runShowStep(s: GameState, events: GameEvent[]): void {
  const pone = other(s.dealer);
  const seat = s.showStep === 0 ? pone : s.dealer;
  const crib = s.showStep === 2;
  const cards = sortHand(crib ? s.crib : s.kept[seat]);
  const { items, total } = scoreHand(cards, s.starter!, crib);
  s.showResult = { seat, crib, cards, items, total };
  s.acks = [false, false];
  award(s, seat, items, crib ? 'crib' : 'hand', events);
}

export function applyAction(
  prev: GameState, seat: Seat, action: Action, shuffle: Shuffle,
): { state: GameState; events: GameEvent[] } {
  const s = structuredClone(prev);
  const events: GameEvent[] = [];
  const opp = other(seat);

  switch (action.t) {
    case 'discard': {
      if (s.phase !== 'discard') fail('Not discarding now');
      const hand = s.hands[seat];
      if (hand.length !== 6) fail('Already discarded');
      const [a, b] = action.cards ?? [];
      if (a === b || !hand.includes(a) || !hand.includes(b)) fail('Pick two cards from your hand');
      s.hands[seat] = hand.filter((c) => c !== a && c !== b);
      s.kept[seat] = [...s.hands[seat]];
      s.crib.push(a, b);
      events.push({ t: 'discard', seat });
      if (s.hands[opp].length === 4) s.phase = 'cut';
      break;
    }

    case 'cut': {
      if (s.phase !== 'cut') fail('Not time to cut');
      if (seat === s.dealer) fail('The non-dealer cuts');
      s.starter = s.deck.shift()!;
      events.push({ t: 'starter', card: s.starter });
      s.phase = 'peg';
      s.turn = seat;
      if (rank(s.starter) === JACK)
        award(s, s.dealer, [{ kind: 'heels', cards: [s.starter], points: 2 }], 'heels', events);
      break;
    }

    case 'play': {
      if (s.phase !== 'peg') fail('Not pegging now');
      if (s.turn !== seat) fail('Not your turn');
      const c = action.card;
      if (!s.hands[seat].includes(c)) fail('That card is not in your hand');
      if (s.count + value(c) > 31) fail('That would go over 31');
      s.hands[seat] = s.hands[seat].filter((x) => x !== c);
      s.pile.push({ card: c, seat });
      s.played.push({ card: c, seat });
      s.count += value(c);
      events.push({ t: 'play', seat, card: c, count: s.count });
      if (award(s, seat, scorePegPlay(s.pile.map((p) => p.card)), 'peg', events)) break;

      const canPlay = (p: Seat) => s.hands[p].some((x) => s.count + value(x) <= 31);
      const reset = () => {
        s.count = 0;
        s.pile = [];
        s.goSaid = false;
        s.turn = s.hands[opp].length ? opp : seat;
      };
      if (s.count === 31) reset();
      else if (canPlay(opp)) s.turn = opp;
      else {
        if (s.hands[opp].length && !s.goSaid) {
          s.goSaid = true;
          events.push({ t: 'go', seat: opp });
        }
        if (canPlay(seat)) s.turn = seat;
        else {
          const last = s.hands[0].length + s.hands[1].length === 0;
          if (award(s, seat, [{ kind: last ? 'last' : 'go', cards: [], points: 1 }], 'peg', events)) break;
          reset();
        }
      }
      if (s.hands[0].length + s.hands[1].length === 0) {
        s.phase = 'show';
        s.showStep = 0;
        runShowStep(s, events);
      }
      break;
    }

    case 'ack': {
      if (s.phase !== 'show') fail('Nothing to continue');
      s.acks[seat] = true;
      if (!s.acks[opp]) break;
      if (s.showStep < 2) {
        s.showStep = (s.showStep + 1) as 1 | 2;
        runShowStep(s, events);
      } else {
        s.dealer = other(s.dealer);
        deal(s, shuffle, events);
      }
      break;
    }

    default:
      fail('Unknown action');
  }
  return { state: s, events };
}

/** What one player is allowed to see. */
export function viewFor(s: GameState, you: Seat): PlayerView {
  const opp = other(you);
  const discarded = (p: Seat) => s.phase !== 'discard' || s.hands[p].length === 4;
  return {
    you,
    target: s.target, handNo: s.handNo, dealer: s.dealer, firstCut: s.firstCut,
    scores: s.scores, back: s.back, phase: s.phase,
    hand: s.hands[you],
    oppHandCount: s.hands[opp].length,
    discarded: [discarded(0), discarded(1)],
    cribCount: s.crib.length,
    starter: s.starter, turn: s.turn, count: s.count, pile: s.pile, played: s.played,
    showStep: s.showStep, showResult: s.showResult, acks: s.acks,
    winner: s.winner, skunk: s.skunk, stats: s.stats,
  };
}

/** Wire protocol shared by server and client. */
export interface PlayerInfo { id: string; name: string }
export type ClientMsg =
  | { t: 'hello'; token: string; code: string }
  | { t: 'act'; action: Action };
export type ServerMsg =
  | {
      t: 'state';
      code: string;
      status: 'waiting' | 'active' | 'finished';
      players: [PlayerInfo | null, PlayerInfo | null];
      online: [boolean, boolean];
      you: Seat;
      view: PlayerView | null;
      events: GameEvent[];
      /** Code of the rematch, once someone has started one. */
      next: string | null;
    }
  | { t: 'error'; message: string };
