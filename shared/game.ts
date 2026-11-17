// The whole game as a pure state machine. The server owns a GameState, feeds
// it actions, and sends each player a redacted PlayerView — the client never
// sees another player's hand (a partner's included), the crib, or the deck.
//
// Two, three (cut-throat) or four (partnership) players. Seats run clockwise
// 0 → 1 → 2 (→ 3). Scores, back pegs and the winner belong to a *team*: in two-
// and three-player games every player is a team of one; in four-player games
// seats 0 & 2 play seats 1 & 3. Hands, acks and stats belong to a seat.
import { type Card, JACK, rank, sortHand, value } from './cards.js';
import { type ScoreItem, scoreHand, scorePegPlay } from './scoring.js';

export type PlayerCount = 2 | 3 | 4;
/** A seat at the table, 0 … players − 1, clockwise. */
export type Seat = number;
/** A side that shares one score: 0 … teamCount − 1. */
export type Team = number;
export type Phase = 'discard' | 'cut' | 'peg' | 'show' | 'over';
/** 0 none, 1 skunk (under 91 of 121), 2 double skunk (under 61). */
export type SkunkLevel = 0 | 1 | 2;
export interface Play { card: Card; seat: Seat }
export interface ShowResult { seat: Seat; crib: boolean; cards: Card[]; items: ScoreItem[]; total: number }
export interface SeatStats { peg: number; hand: number; crib: number; best: number }

/**
 * One step of the pegging, in order, as the hand log keeps it:
 * - `play`: a card played, the count after it, and what it scored (items may be empty);
 * - `go`: the seat said go (cannot play; no points by itself);
 * - `point`: one point for the go, or for the last card, to the seat that played last.
 * `points` are the full rule values; at the very end of a game the board is
 * capped at the target, so the last score may count for less on the board.
 */
export type PegEntry =
  | { t: 'play'; seat: Seat; card: Card; count: number; items: ScoreItem[]; points: number }
  | { t: 'go'; seat: Seat }
  | { t: 'point'; seat: Seat; kind: 'go' | 'last'; points: number };

/**
 * Everything that happened in the current hand, kept by the engine so the
 * server can store a record of every hand (for statistics and replays). It is
 * part of GameState only — never sent in a PlayerView.
 */
export interface HandLog {
  handNo: number;
  dealer: Seat;
  /** By team, when the hand was dealt. */
  scoresBefore: number[];
  /** By seat: the cards dealt, sorted. */
  dealt: Card[][];
  /** By seat: the card(s) that seat put in the crib (empty until it discards). */
  discards: Card[][];
  /** Three players: the card dealt straight from the deck into the crib. */
  deckToCrib: Card | null;
  starter: Card | null;
  /** Points the dealer took for his heels (a jack turned up): 0 or 2. */
  heels: number;
  peg: PegEntry[];
  /** Hands then the crib, in counting order, as far as the count got. */
  shows: ShowResult[];
}

// ---- table geometry (pure helpers, shared with server and client) ----

export const isPlayerCount = (n: unknown): n is PlayerCount => n === 2 || n === 3 || n === 4;
export const teamCount = (players: PlayerCount): number => (players === 4 ? 2 : players);
export const teamOf = (players: PlayerCount, seat: Seat): Team => (players === 4 ? seat % 2 : seat);
export const teamSeats = (players: PlayerCount, team: Team): Seat[] =>
  Array.from({ length: players }, (_, s) => s).filter((s) => teamOf(players, s) === team);
/** The next seat clockwise: the player on this seat's left. */
export const leftOf = (players: PlayerCount, seat: Seat): Seat => (seat + 1) % players;
/** Cards dealt to each player. */
export const handSize = (players: PlayerCount): number => (players === 2 ? 6 : 5);
/** Cards each player puts in the crib. */
export const discardCount = (players: PlayerCount): number => (players === 2 ? 2 : 1);
/** Whose hand is counted at show step `step` (the crib, step === players, is the dealer's). */
export const showSeat = (players: PlayerCount, dealer: Seat, step: number): Seat =>
  step >= players ? dealer : (dealer + 1 + step) % players;
/** Skunk lines sit at three-quarters and half of the way home (91 / 61 of 121). */
export const skunkLevel = (score: number, target: number): SkunkLevel =>
  score < Math.ceil(target / 2) ? 2 : score < Math.ceil((target * 3) / 4) ? 1 : 0;
/**
 * Finishing place of every team (1 = first), ranked by score; equal scores
 * share a place. The winner is always first.
 */
export const placings = (scores: number[], winner: Team | null): number[] =>
  scores.map((sc, t) => (t === winner ? 1 : 1 + scores.filter((o, u) => u === winner || o > sc).length));

export interface GameState {
  players: PlayerCount;
  target: number;
  handNo: number;
  dealer: Seat;
  /** The cut for first deal, one card per seat — low card deals. */
  firstCut: Card[];
  /** By team. */
  scores: number[];
  /** By team: score before the most recent points, where the back peg sits. */
  back: number[];
  phase: Phase;
  deck: Card[];
  /** By seat: cards still held — dealt, then after discarding, fewer as pegging goes. */
  hands: Card[][];
  /** By seat: the four cards each player kept, for the show. */
  kept: Card[][];
  crib: Card[];
  starter: Card | null;
  turn: Seat;
  count: number;
  /** Cards played since the count last reset. */
  pile: Play[];
  /** Every card played this hand. */
  played: Play[];
  /** By seat: has said go during the current count. */
  goSaid: boolean[];
  /** 0 … players − 1: the hands clockwise from the dealer's left (dealer last); players = the crib. */
  showStep: number;
  showResult: ShowResult | null;
  /** By seat. */
  acks: boolean[];
  winner: Team | null;
  /** By team; the winner's entry is always 0. */
  skunk: SkunkLevel[];
  /** By seat. */
  stats: SeatStats[];
  /**
   * The current hand's log (absent on states saved before hand logging existed,
   * until their next deal). Server-side only.
   */
  handLog?: HandLog;
}

export type Action =
  | { t: 'discard'; cards: Card[] }
  | { t: 'cut' }
  | { t: 'play'; card: Card }
  | { t: 'ack' };

export type ScoreWhy = 'peg' | 'heels' | 'hand' | 'crib';
export type GameEvent =
  | { t: 'firstcut'; cards: Card[]; dealer: Seat }
  | { t: 'deal'; dealer: Seat; handNo: number }
  | { t: 'discard'; seat: Seat }
  | { t: 'starter'; card: Card }
  | { t: 'play'; seat: Seat; card: Card; count: number }
  | { t: 'go'; seat: Seat }
  | { t: 'score'; seat: Seat; team: Team; items: ScoreItem[]; points: number; why: ScoreWhy }
  | { t: 'win'; team: Team; skunk: SkunkLevel[] };

export interface PlayerView {
  you: Seat;
  players: PlayerCount;
  target: number;
  handNo: number;
  dealer: Seat;
  firstCut: Card[];
  scores: number[];
  back: number[];
  phase: Phase;
  hand: Card[];
  /** By seat (yours included): how many cards each player holds. */
  handCounts: number[];
  discarded: boolean[];
  cribCount: number;
  starter: Card | null;
  turn: Seat;
  count: number;
  pile: Play[];
  played: Play[];
  showStep: number;
  showResult: ShowResult | null;
  acks: boolean[];
  winner: Team | null;
  skunk: SkunkLevel[];
  stats: SeatStats[];
}

export class GameError extends Error {}
export type Shuffle = () => Card[];
/** Two-player shorthand: the other seat. */
export const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

const fail = (msg: string): never => { throw new GameError(msg); };
const newStats = (): SeatStats => ({ peg: 0, hand: 0, crib: 0, best: 0 });
const fill = <T>(n: number, f: () => T): T[] => Array.from({ length: n }, f);
const words = ['', 'one', 'two'];

export function newGame(
  shuffle: Shuffle, target = 121, players: PlayerCount = 2,
): { state: GameState; events: GameEvent[] } {
  if (!isPlayerCount(players)) fail('A game is for 2, 3 or 4 players');
  // Cut for deal: each seat in turn takes the next card; a rank already cut
  // is a tie and is skipped (cut again). Low card (ace low) deals.
  const d = shuffle();
  const firstCut: Card[] = [];
  for (const c of d) {
    if (firstCut.length === players) break;
    if (!firstCut.some((x) => rank(x) === rank(c))) firstCut.push(c);
  }
  let dealer: Seat = 0;
  for (let s = 1; s < players; s++) if (rank(firstCut[s]) < rank(firstCut[dealer])) dealer = s;
  const teams = teamCount(players);
  const state: GameState = {
    players, target, handNo: 0, dealer, firstCut,
    scores: fill(teams, () => 0), back: fill(teams, () => 0), phase: 'discard',
    deck: [], hands: fill(players, () => []), kept: fill(players, () => []), crib: [], starter: null,
    turn: leftOf(players, dealer), count: 0, pile: [], played: [], goSaid: fill(players, () => false),
    showStep: 0, showResult: null, acks: fill(players, () => false),
    winner: null, skunk: fill(teams, () => 0 as SkunkLevel), stats: fill(players, newStats),
  };
  const events: GameEvent[] = [{ t: 'firstcut', cards: [...firstCut], dealer }];
  deal(state, shuffle, events);
  return { state, events };
}

function deal(s: GameState, shuffle: Shuffle, events: GameEvent[]): void {
  const d = shuffle();
  const n = s.players;
  const size = handSize(n);
  s.handNo += 1;
  s.hands = fill(n, () => []).map((_, i) => sortHand(d.slice(i * size, (i + 1) * size)));
  let next = n * size;
  // Three players: one card goes straight from the deck into the crib.
  s.crib = n === 3 ? [d[next++]] : [];
  s.deck = d.slice(next);
  s.kept = fill(n, () => []);
  s.starter = null;
  s.count = 0;
  s.pile = [];
  s.played = [];
  s.goSaid = fill(n, () => false);
  s.showStep = 0;
  s.showResult = null;
  s.acks = fill(n, () => false);
  s.turn = leftOf(n, s.dealer);
  s.phase = 'discard';
  s.handLog = {
    handNo: s.handNo, dealer: s.dealer, scoresBefore: [...s.scores],
    dealt: s.hands.map((h) => [...h]), discards: fill(n, () => []),
    deckToCrib: n === 3 ? s.crib[0] : null, starter: null, heels: 0, peg: [], shows: [],
  };
  events.push({ t: 'deal', dealer: s.dealer, handNo: s.handNo });
}

/** Add points to the seat's team; returns true if that ended the game. */
function award(s: GameState, seat: Seat, items: ScoreItem[], why: ScoreWhy, events: GameEvent[]): boolean {
  const points = items.reduce((n, it) => n + it.points, 0);
  if (points === 0) return false;
  const team = teamOf(s.players, seat);
  s.back[team] = s.scores[team];
  s.scores[team] = Math.min(s.target, s.scores[team] + points);
  // Stats record points actually pegged, so the last score of a game is
  // capped at the finish; the best hand keeps its full value.
  const gained = s.scores[team] - s.back[team];
  const st = s.stats[seat];
  if (why === 'hand') { st.hand += gained; st.best = Math.max(st.best, points); }
  else if (why === 'crib') st.crib += gained;
  else st.peg += gained;
  events.push({ t: 'score', seat, team, items, points, why });
  if (s.scores[team] < s.target) return false;
  s.winner = team;
  s.phase = 'over';
  s.skunk = s.scores.map((sc, t) => (t === team ? 0 : skunkLevel(sc, s.target)));
  events.push({ t: 'win', team, skunk: [...s.skunk] });
  return true;
}

function runShowStep(s: GameState, events: GameEvent[]): void {
  const crib = s.showStep === s.players;
  const seat = showSeat(s.players, s.dealer, s.showStep);
  const cards = sortHand(crib ? s.crib : s.kept[seat]);
  const { items, total } = scoreHand(cards, s.starter!, crib);
  s.showResult = { seat, crib, cards, items, total };
  s.handLog?.shows.push(structuredClone(s.showResult));
  s.acks = fill(s.players, () => false);
  award(s, seat, items, crib ? 'crib' : 'hand', events);
}

export function applyAction(
  prev: GameState, seat: Seat, action: Action, shuffle: Shuffle,
): { state: GameState; events: GameEvent[] } {
  const s = structuredClone(prev);
  const events: GameEvent[] = [];
  const n = s.players;
  if (!Number.isInteger(seat) || seat < 0 || seat >= n) fail('No such seat');

  switch (action.t) {
    case 'discard': {
      if (s.phase !== 'discard') fail('Not discarding now');
      const hand = s.hands[seat];
      if (hand.length !== handSize(n)) fail('Already discarded');
      const need = discardCount(n);
      const cards = Array.isArray(action.cards) ? action.cards : [];
      const ok = cards.length === need && new Set(cards).size === need && cards.every((c) => hand.includes(c));
      if (!ok) fail(`Pick ${words[need]} card${need > 1 ? 's' : ''} from your hand`);
      s.hands[seat] = hand.filter((c) => !cards.includes(c));
      s.kept[seat] = [...s.hands[seat]];
      s.crib.push(...cards);
      if (s.handLog) s.handLog.discards[seat] = [...cards];
      events.push({ t: 'discard', seat });
      if (s.hands.every((h) => h.length === 4)) s.phase = 'cut';
      break;
    }

    case 'cut': {
      if (s.phase !== 'cut') fail('Not time to cut');
      const cutter = leftOf(n, s.dealer);
      if (seat !== cutter) fail(n === 2 ? 'The non-dealer cuts' : 'The player on the dealer’s left cuts');
      s.starter = s.deck.shift()!;
      if (s.handLog) s.handLog.starter = s.starter;
      events.push({ t: 'starter', card: s.starter });
      s.phase = 'peg';
      s.turn = cutter;
      if (rank(s.starter) === JACK) {
        if (s.handLog) s.handLog.heels = 2;
        award(s, s.dealer, [{ kind: 'heels', cards: [s.starter], points: 2 }], 'heels', events);
      }
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
      const items = scorePegPlay(s.pile.map((p) => p.card));
      s.handLog?.peg.push({
        t: 'play', seat, card: c, count: s.count, items: structuredClone(items),
        points: items.reduce((t, it) => t + it.points, 0),
      });
      if (award(s, seat, items, 'peg', events)) break;

      const canPlay = (p: Seat) => s.hands[p].some((x) => s.count + value(x) <= 31);
      // The count resets; the lead passes to the next player clockwise from
      // the one who played last who still holds cards (possibly that player).
      const reset = () => {
        s.count = 0;
        s.pile = [];
        s.goSaid = fill(n, () => false);
        for (let k = 1; k <= n; k++) {
          const p = (seat + k) % n;
          if (s.hands[p].length) { s.turn = p; break; }
        }
      };
      if (s.count === 31) reset();
      else {
        // Pass clockwise; anyone holding cards who cannot play says go (once per count).
        let next: Seat | null = null;
        for (let k = 1; k < n; k++) {
          const p = (seat + k) % n;
          if (canPlay(p)) { next = p; break; }
          if (s.hands[p].length && !s.goSaid[p]) {
            s.goSaid[p] = true;
            s.handLog?.peg.push({ t: 'go', seat: p });
            events.push({ t: 'go', seat: p });
          }
        }
        if (next !== null) s.turn = next;
        else if (canPlay(seat)) s.turn = seat;
        else {
          const last = s.hands.every((h) => h.length === 0);
          s.handLog?.peg.push({ t: 'point', seat, kind: last ? 'last' : 'go', points: 1 });
          if (award(s, seat, [{ kind: last ? 'last' : 'go', cards: [], points: 1 }], 'peg', events)) break;
          reset();
        }
      }
      if (s.hands.every((h) => h.length === 0)) {
        s.phase = 'show';
        s.showStep = 0;
        runShowStep(s, events);
      }
      break;
    }

    case 'ack': {
      if (s.phase !== 'show') fail('Nothing to continue');
      s.acks[seat] = true;
      if (!s.acks.every(Boolean)) break;
      if (s.showStep < n) {
        s.showStep += 1;
        runShowStep(s, events);
      } else {
        s.dealer = leftOf(n, s.dealer);
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
  const size = handSize(s.players);
  const discarded = (p: Seat) => s.phase !== 'discard' || s.hands[p].length < size;
  return {
    you, players: s.players,
    target: s.target, handNo: s.handNo, dealer: s.dealer, firstCut: s.firstCut,
    scores: s.scores, back: s.back, phase: s.phase,
    hand: s.hands[you],
    handCounts: s.hands.map((h) => h.length),
    discarded: s.hands.map((_, p) => discarded(p)),
    cribCount: s.crib.length,
    starter: s.starter, turn: s.turn, count: s.count, pile: s.pile, played: s.played,
    showStep: s.showStep, showResult: s.showResult, acks: s.acks,
    winner: s.winner, skunk: s.skunk, stats: s.stats,
  };
}

/**
 * The seats that can act right now — who the game is waiting on: everyone who
 * has not yet discarded; the player on the dealer's left to cut; whoever's
 * turn it is to peg; everyone who has not yet tapped on through the show.
 * Empty once the game is over.
 */
export function seatsToAct(s: GameState): Seat[] {
  const all = Array.from({ length: s.players }, (_, p) => p);
  switch (s.phase) {
    case 'discard': return all.filter((p) => s.hands[p].length === handSize(s.players));
    case 'cut': return [leftOf(s.players, s.dealer)];
    case 'peg': return [s.turn];
    case 'show': return all.filter((p) => !s.acks[p]);
    default: return [];
  }
}

/** The same as seatsToAct, worked out from any player's view. */
export function seatsToActInView(v: PlayerView): Seat[] {
  const all = Array.from({ length: v.players }, (_, p) => p);
  switch (v.phase) {
    case 'discard': return all.filter((p) => !v.discarded[p]);
    case 'cut': return [leftOf(v.players, v.dealer)];
    case 'peg': return [v.turn];
    case 'show': return all.filter((p) => !v.acks[p]);
    default: return [];
  }
}

/** Wire protocol shared by server and client. */
export interface PlayerInfo { id: string; name: string }
export type ClientMsg =
  | { t: 'hello'; token: string; code: string }
  | { t: 'act'; action: Action };
/** One row of GET /api/games, from the asking player's point of view. */
export interface GameSummary {
  code: string;
  status: 'waiting' | 'active' | 'finished';
  players: PlayerCount;
  you: Seat;
  team: Team;
  /** You created the game (and may rearrange seats while it waits). */
  creator: boolean;
  /** By seat; null = still open. */
  seats: (PlayerInfo | null)[];
  /** Your partner in a four-player game. */
  partner: PlayerInfo | null;
  /** Everyone seated on another team, in seat order. */
  opponents: PlayerInfo[];
  /** By team. */
  scores: number[];
  winner: Team | null;
  /** By team, once finished. */
  skunk: SkunkLevel[];
  /** Your finishing place (1 = won), once finished. */
  place: number | null;
  createdAt: string;
  finishedAt: string | null;
  // ---- league additions (always sent by the server; optional for older clients) ----
  /** The game can't go on until you act (you have a move to make now). */
  waitingOnYou?: boolean;
  /** When the last move (or seat change) happened. */
  lastMoveAt?: string;
  /** The season the game belongs to. */
  seasonId?: number;
  /** The queued fixture this game was started from, if any. */
  fixtureId?: string | null;
  /** Voided by the commissioner: excluded from every statistic. */
  voided?: boolean;
}
export type ServerMsg =
  | {
      t: 'state';
      code: string;
      status: 'waiting' | 'active' | 'finished';
      /** By seat; length is the player count. null = seat still open. */
      players: (PlayerInfo | null)[];
      /** By seat. */
      online: boolean[];
      /** Player id of whoever created the game (may rearrange seats while waiting). */
      creator: string;
      you: Seat;
      view: PlayerView | null;
      events: GameEvent[];
      /** Code of the rematch, once someone has started one. */
      next: string | null;
    }
  | { t: 'error'; message: string };
