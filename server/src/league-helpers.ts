// Test plumbing for the league: scripted / seeded decks, a driver that plays
// a game over real sockets choosing moves from the authoritative state, and an
// observer that works out every hand's facts from the states and events seen
// along the way — independently of the server's hand records and statistics.
import { type Card, fullDeck, value } from '../../shared/cards.js';
import {
  type Action,
  discardCount,
  type GameEvent,
  type GameState,
  handSize,
  leftOf,
  type PlayerCount,
  type Shuffle,
} from '../../shared/game.js';
import { scoreHand } from '../../shared/scoring.js';
import { api, bothOnline, Client, type Player, readGame, type Running, type Seated } from './test-helpers.js';

export const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

export const seededDeck = (rand: () => number): Card[] => {
  const d = fullDeck();
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

/** Scripted decks first (in order), then a seeded shuffle. Pass `decks.shuffle` to startApp. */
export class Decks {
  private queue: Card[][] = [];
  private rand: () => number;
  constructor(seed = 1) {
    this.rand = lcg(seed);
  }
  push(...decks: Card[][]): void {
    this.queue.push(...decks);
  }
  get pending(): number {
    return this.queue.length;
  }
  /** Drop scripted decks a finished game did not use. */
  clear(): void {
    this.queue = [];
  }
  readonly shuffle: Shuffle = () => [...(this.queue.shift() ?? seededDeck(this.rand))];
}

/** A full deck with these cards first, in this order, then the rest. */
export const deckStarting = (first: Card[]): Card[] => [...first, ...fullDeck().filter((c) => !first.includes(c))];
/** A two-player deal: seat 0's six, seat 1's six, then the starter. */
export const twoPlayerDeal = (seat0: Card[], seat1: Card[], starter: Card): Card[] => deckStarting([...seat0, ...seat1, starter]);

export type Policy = (s: GameState, seat: number, rand: () => number) => Action;

const pick = <T>(xs: T[], rand: () => number): T => xs[Math.floor(rand() * xs.length)];

/** A random legal move for `seat`, from the full state. */
export const randomPolicy: Policy = (s, seat, rand) => {
  switch (s.phase) {
    case 'discard': {
      const hand = [...s.hands[seat]];
      const cards: Card[] = [];
      for (let k = 0; k < discardCount(s.players); k++) cards.push(hand.splice(Math.floor(rand() * hand.length), 1)[0]);
      return { t: 'discard', cards };
    }
    case 'cut':
      return { t: 'cut' };
    case 'peg':
      return { t: 'play', card: pick(s.hands[seat].filter((c) => s.count + value(c) <= 31), rand) };
    default:
      return { t: 'ack' };
  }
};

/** Keep these cards when dealt them (discard the rest); otherwise play randomly. */
export const keepPolicy = (keep: Record<number, Card[]>): Policy => (s, seat, rand) => {
  const k = keep[seat];
  if (s.phase === 'discard' && k && k.every((c) => s.hands[seat].includes(c)))
    return { t: 'discard', cards: s.hands[seat].filter((c) => !k.includes(c)) };
  return randomPolicy(s, seat, rand);
};

/** Who can move, worked out by brute force (independent of seatsToAct). */
export const movers = (s: GameState): number[] => {
  const out: number[] = [];
  for (let p = 0; p < s.players; p++) {
    if (s.phase === 'discard' && s.hands[p].length === handSize(s.players)) out.push(p);
    if (s.phase === 'cut' && p === leftOf(s.players, s.dealer)) out.push(p);
    if (s.phase === 'peg' && p === s.turn && s.hands[p].some((c) => s.count + value(c) <= 31)) out.push(p);
    if (s.phase === 'show' && !s.acks[p]) out.push(p);
  }
  return out;
};

/** Connect every seat's player (in seat order) to a game and wait until all are online. */
export const connectAll = async (r: Running, code: string, bySeat: Player[]): Promise<Seated[]> => {
  const clients: Client[] = [];
  for (const p of bySeat) clients.push(await Client.connect(r.wsUrl, p.token, code));
  await bothOnline(clients);
  return bySeat.map((player, i) => ({ player, client: clients[i] }));
};

/** Challenge and start a fixture: `others` follow the creator in seat order (4 players: [opp, partner, opp]). */
export const fixtureGame = async (r: Running, creator: Player, others: Player[]): Promise<{ code: string; fixtureId: string }> => {
  const body = others.length === 3 ? { opponents: [others[0].id, others[2].id], partner: others[1].id } : { opponents: others.map((o) => o.id) };
  const f = await api(r.base, 'POST', '/api/fixtures', { token: creator.token, body });
  if (f.status !== 201) throw new Error(`fixture failed ${f.status} ${JSON.stringify(f.body)}`);
  const s = await api(r.base, 'POST', `/api/fixtures/${f.body.id}/start`, { token: creator.token });
  if (s.status !== 200) throw new Error(`start failed ${s.status} ${JSON.stringify(s.body)}`);
  return { code: s.body.code as string, fixtureId: f.body.id as string };
};

export interface Driven {
  /** Every authoritative state, from before the first move to the last. */
  states: GameState[];
  /** Every event seat 0 received, in order. */
  events: GameEvent[];
}

/**
 * Play over the sockets until `until` holds (default: the game is over). Each
 * step a seat that can move (brute force) is chosen and its move sent; we wait
 * for every client to get the broadcast and read the authoritative state back.
 */
export const drive = async (
  dbPath: string,
  code: string,
  seats: Seated[],
  opts: { policy?: Policy; seed?: number; until?: (s: GameState) => boolean } = {},
): Promise<Driven> => {
  const rand = lcg(opts.seed ?? 7);
  const policy = opts.policy ?? randomPolicy;
  const until = opts.until ?? ((s: GameState) => s.phase === 'over');
  const evFrom = seats[0].client.msgs.length;
  let S = readGame(dbPath, code).state!;
  const states = [S];
  for (let i = 0; !until(S); i++) {
    if (i > 5000) throw new Error('drive: too many steps');
    const who = movers(S);
    if (who.length === 0) throw new Error('drive: nobody can move');
    const seat = pick(who, rand);
    const action = policy(S, seat, rand);
    const counts = seats.map((x) => x.client.msgs.length);
    seats[seat].client.send({ t: 'act', action });
    const reply = await seats[seat].client.waitCount(counts[seat] + 1);
    if (reply.t !== 'state') throw new Error(`move ${JSON.stringify(action)} rejected: ${JSON.stringify(reply)}`);
    await Promise.all(seats.map((x, k) => x.client.waitCount(counts[k] + 1)));
    S = readGame(dbPath, code).state!;
    states.push(S);
  }
  const events: GameEvent[] = [];
  for (const m of seats[0].client.msgs.slice(evFrom)) if (m.t === 'state') events.push(...m.events);
  return { states, events };
};

export interface ShowObs {
  seat: number;
  crib: boolean;
  total: number;
  cards: Card[];
}

/** One hand as seen from outside the records. */
export interface HandObs {
  handNo: number;
  dealer: number;
  dealt: Card[][];
  kept: Card[][];
  crib: Card[];
  starter: Card | null;
  /** Card and seat of every play, in order. */
  played: { card: Card; seat: number }[];
  shows: ShowObs[];
  /** Pegging points by seat (full values from the score events). */
  peg: number[];
  heels: number;
  /** All cards were played (the show was reached). */
  peggedOut: boolean;
  scoresAfter: number[];
}

/** Work out every hand from the states and events of a driven game (states must start at a hand's deal). */
export function observe(d: Driven, players: PlayerCount): HandObs[] {
  const hands = new Map<number, HandObs>();
  for (const s of d.states) {
    let h = hands.get(s.handNo);
    if (!h) {
      h = {
        handNo: s.handNo, dealer: s.dealer, dealt: s.hands.map((x) => [...x]), kept: [], crib: [], starter: null, played: [],
        shows: [], peg: Array(players).fill(0), heels: 0, peggedOut: false, scoresAfter: [...s.scores],
      };
      hands.set(s.handNo, h);
    }
    if (s.kept.every((k) => k.length === 4)) h.kept = s.kept.map((k) => [...k]);
    if (s.phase !== 'discard') h.crib = [...s.crib];
    if (s.starter !== null) h.starter = s.starter;
    if (s.played.length >= h.played.length) h.played = s.played.map((p) => ({ ...p }));
    h.scoresAfter = [...s.scores];
    if (s.showResult) {
      h.peggedOut = true;
      const sr = s.showResult;
      if (!h.shows.some((x) => x.seat === sr.seat && x.crib === sr.crib)) {
        // Cross-check the engine's count with the scorer on the actual cards.
        const cards = sr.crib ? s.crib : s.kept[sr.seat];
        const total = scoreHand(cards, s.starter!, sr.crib).total;
        if (total !== sr.total) throw new Error('show total disagrees with scoreHand');
        h.shows.push({ seat: sr.seat, crib: sr.crib, total: sr.total, cards: [...sr.cards] });
      }
    }
  }
  let hand = d.states[0].handNo;
  for (const e of d.events) {
    if (e.t === 'deal') hand = e.handNo;
    if (e.t !== 'score') continue;
    const h = hands.get(hand)!;
    if (e.why === 'peg') h.peg[e.seat] += e.points;
    if (e.why === 'heels') h.heels += e.points;
  }
  return [...hands.values()].sort((a, b) => a.handNo - b.handNo);
}
