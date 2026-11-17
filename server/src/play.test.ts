import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type GameState, other, type Seat } from '../../shared/game.js';
import {
  api,
  type Client,
  playToEnd,
  readGame,
  type Running,
  setupGame,
  startApp,
  type StateMsg,
  tempDir,
} from './test-helpers.js';

let tmp: ReturnType<typeof tempDir>;
let r: Running;

beforeEach(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath);
});

afterEach(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

describe('a full game', () => {
  it('two players play to 121 with random legal moves', async () => {
    const { a, b, code, ca, cb, seats } = await setupGame(r);

    // A was waiting in the room when B joined, so A saw the opening events.
    const waiting = ca.msgs[0] as StateMsg;
    expect(waiting).toMatchObject({ t: 'state', code, status: 'waiting', you: 0, view: null, next: null });
    expect(waiting.players).toEqual([{ id: a.id, name: 'Alice' }, null]);
    expect(waiting.online).toEqual([true, false]);
    const opening = ca.msgs.find((m) => m.t === 'state' && m.status === 'active') as StateMsg;
    expect(opening.events.map((e) => e.t)).toEqual(['firstcut', 'deal']);
    expect(opening.players).toEqual([
      { id: a.id, name: 'Alice' },
      { id: b.id, name: 'Bob' },
    ]);
    expect(opening.view!.hand).toHaveLength(6);
    // B's hello reply carries no events.
    expect((cb.msgs[0] as StateMsg).events).toEqual([]);
    expect((cb.msgs[0] as StateMsg).you).toBe(1);

    let steps = 0;
    await playToEnd(seats, () => {
      steps++;
      expect(ca.lastState.view!.scores).toEqual(cb.lastState.view!.scores);
    });

    const fa = ca.lastState;
    const fb = cb.lastState;
    expect(steps).toBeGreaterThan(50);
    expect(fa.status).toBe('finished');
    expect(fb.status).toBe('finished');
    expect(fa.view!.phase).toBe('over');
    expect(fa.view!.scores).toEqual(fb.view!.scores);
    const winner = fa.view!.winner!;
    expect(winner === 0 || winner === 1).toBe(true);
    expect(fb.view!.winner).toBe(winner);
    expect(fa.view!.scores[winner]).toBe(121);
    expect(fa.view!.scores[other(winner)]).toBeLessThan(121);
    expect(fa.events.some((e) => e.t === 'win')).toBe(true);

    const { row } = readGame(tmp.dbPath, code);
    expect(row.status).toBe('finished');
    expect(row.winner).toBe(winner === 0 ? a.id : b.id);
    expect([row.score0, row.score1]).toEqual(fa.view!.scores);
    expect(row.skunk).toBe(fa.view!.skunk);
    expect(row.finished_at).toBeTruthy();

    // Further actions are refused.
    const n = ca.msgs.length;
    ca.send({ t: 'act', action: { t: 'ack' } });
    expect(await ca.waitCount(n + 1)).toEqual({ t: 'error', message: 'This game is over' });

    // The lobby list reflects the result, by seat.
    const list = await api(r.base, 'GET', '/api/games', { token: b.token });
    expect(list.status).toBe(200);
    expect(list.body.games).toHaveLength(1);
    expect(list.body.games[0]).toEqual({
      code,
      status: 'finished',
      you: 1,
      opponent: { id: a.id, name: 'Alice' },
      scores: fa.view!.scores,
      winner,
      skunk: fa.view!.skunk,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    });
  }, 60_000);
});

// ---- hidden-information audit ----

const MSG_KEYS = ['t', 'code', 'status', 'players', 'online', 'you', 'view', 'events', 'next'];
const VIEW_KEYS = [
  'you', 'target', 'handNo', 'dealer', 'firstCut', 'scores', 'back', 'phase', 'hand', 'oppHandCount',
  'discarded', 'cribCount', 'starter', 'turn', 'count', 'pile', 'played', 'showStep', 'showResult',
  'acks', 'winner', 'skunk', 'stats',
];
const EVENT_KEYS: Record<string, string[]> = {
  firstcut: ['t', 'cards', 'dealer'],
  deal: ['t', 'dealer', 'handNo'],
  discard: ['t', 'seat'],
  starter: ['t', 'card'],
  play: ['t', 'seat', 'card', 'count'],
  go: ['t', 'seat'],
  score: ['t', 'seat', 'items', 'points', 'why'],
  win: ['t', 'seat', 'skunk'],
};

const keysExactly = (o: object, keys: string[]) => expect(Object.keys(o).sort()).toEqual([...keys].sort());
const isCardNum = (c: unknown) => expect(Number.isInteger(c) && (c as number) >= 0 && (c as number) < 52).toBe(true);
const pairOf = (xs: unknown, type: string) => {
  expect(Array.isArray(xs) && xs.length === 2).toBe(true);
  for (const x of xs as unknown[]) expect(typeof x).toBe(type);
};

/**
 * Walk a state message against a strict whitelist of its shape and return every
 * card it mentions (firstCut separately: it is public for the whole game).
 */
function cardsIn(msg: StateMsg): { cards: number[]; firstCut: number[] } {
  const cards: number[] = [];
  const firstCut: number[] = [];
  const items = (xs: any[]) => {
    for (const it of xs) {
      keysExactly(it, ['kind', 'cards', 'points']);
      cards.push(...it.cards);
    }
  };
  keysExactly(msg, MSG_KEYS);
  for (const p of msg.players) if (p) keysExactly(p, ['id', 'name']);
  pairOf(msg.online, 'boolean');
  const v = msg.view as any;
  if (v) {
    keysExactly(v, VIEW_KEYS);
    for (const k of ['scores', 'back']) pairOf(v[k], 'number');
    for (const k of ['discarded', 'acks']) pairOf(v[k], 'boolean');
    for (const k of ['you', 'target', 'handNo', 'dealer', 'oppHandCount', 'cribCount', 'turn', 'count', 'showStep', 'skunk'])
      expect(typeof v[k]).toBe('number');
    for (const st of v.stats) keysExactly(st, ['peg', 'hand', 'crib', 'best']);
    firstCut.push(...v.firstCut);
    cards.push(...v.hand);
    if (v.starter !== null) cards.push(v.starter);
    for (const p of [...v.pile, ...v.played]) {
      keysExactly(p, ['card', 'seat']);
      cards.push(p.card);
    }
    if (v.showResult) {
      keysExactly(v.showResult, ['seat', 'crib', 'cards', 'items', 'total']);
      cards.push(...v.showResult.cards);
      items(v.showResult.items);
    }
  }
  for (const e of msg.events as any[]) {
    keysExactly(e, EVENT_KEYS[e.t]);
    if (e.t === 'firstcut') firstCut.push(...e.cards);
    if (e.t === 'starter' || e.t === 'play') cards.push(e.card);
    if (e.t === 'score') items(e.items);
  }
  [...cards, ...firstCut].forEach(isCardNum);
  return { cards, firstCut };
}

class Auditor {
  private idx = 0;
  private handNo = -1;
  private seen = new Set<number>();
  checked = 0;
  /** Messages checked while the opponent still held unplayed cards. */
  withHiddenOppCards = 0;

  constructor(
    private readonly client: Client,
    private readonly seat: Seat,
  ) {}

  /** Check every not-yet-checked message against the authoritative state S. */
  check(S: GameState | null) {
    for (; this.idx < this.client.msgs.length; this.idx++) {
      const msg = this.client.msgs[this.idx];
      const raw = this.client.raw[this.idx];
      if (msg.t !== 'state') continue;
      expect(msg.you).toBe(this.seat);
      expect(raw).not.toMatch(/"(deck|hands|kept)"\s*:/);
      expect(raw).not.toMatch(/"crib"\s*:\s*\[/);
      const { cards, firstCut } = cardsIn(msg);
      const v = msg.view;
      if (!v || !S) {
        expect(cards).toEqual([]);
        continue;
      }
      // What this player has legitimately seen during the current hand.
      if (v.handNo !== this.handNo) {
        this.handNo = v.handNo;
        this.seen = new Set();
      }
      const legit = [
        ...v.hand,
        ...(v.starter === null ? [] : [v.starter]),
        ...v.played.map((p) => p.card),
        ...(v.showResult?.cards ?? []),
      ];
      for (const c of legit) this.seen.add(c);
      for (const c of cards) expect(this.seen.has(c), `card ${c} was never legitimately seen`).toBe(true);

      // Cross-check against the server's real state.
      const opp = other(this.seat);
      expect(v.hand).toEqual(S.hands[this.seat]);
      expect(v.oppHandCount).toBe(S.hands[opp].length);
      expect(firstCut.slice(0, 2)).toEqual(S.firstCut);
      const hidden = new Set([...S.hands[opp], ...S.deck, ...(S.showResult?.crib ? [] : S.crib)]);
      for (const c of cards) expect(hidden.has(c), `hidden card ${c} leaked in ${S.phase}`).toBe(false);
      this.checked++;
      if (S.hands[opp].length > 0) this.withHiddenOppCards++;
    }
  }
}

describe('hidden information', () => {
  it('never sends a player the opponent’s hidden cards, the crib, or the deck', async () => {
    const { code, ca, cb, seats } = await setupGame(r);
    const auditors = [new Auditor(ca, 0), new Auditor(cb, 1)];
    const audit = () => {
      const { state } = readGame(tmp.dbPath, code);
      for (const au of auditors) au.check(state);
    };
    audit();
    await playToEnd(seats, audit);
    expect(ca.lastState.status).toBe('finished');
    for (const au of auditors) {
      expect(au.checked).toBeGreaterThan(50);
      expect(au.withHiddenOppCards).toBeGreaterThan(20);
    }
  }, 60_000);
});
