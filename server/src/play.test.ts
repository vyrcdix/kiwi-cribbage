import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type GameState,
  type PlayerCount,
  placings,
  type Seat,
  skunkLevel,
  teamCount,
  teamOf,
} from '../../shared/game.js';
import {
  api,
  type Client,
  playToEnd,
  readGame,
  rowScores,
  type Running,
  setupGame,
  setupTable,
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

/** The recorded result agrees with the final view, seat by seat. */
const expectRecordedResult = (code: string, final: StateMsg) => {
  const v = final.view!;
  const { row, seatRows } = readGame(tmp.dbPath, code);
  expect(row.status).toBe('finished');
  expect(row.winner_team).toBe(v.winner);
  expect(rowScores(row)).toEqual(v.scores);
  expect(row.finished_at).toBeTruthy();
  const places = placings(v.scores, v.winner);
  expect(seatRows).toHaveLength(v.players);
  for (const sr of seatRows) {
    const team = teamOf(v.players, sr.seat);
    expect(sr.player_id).toBe(final.players[sr.seat]!.id);
    expect(sr.place).toBe(places[team]);
    expect(sr.skunk).toBe(v.skunk[team]);
  }
  return row;
};

describe('a full game', () => {
  it('two players play to 121 with random legal moves', async () => {
    const { a, b, code, ca, cb, seats } = await setupGame(r);

    // A was waiting in the room when B joined, so A saw the opening events.
    const waiting = ca.msgs[0] as StateMsg;
    expect(waiting).toMatchObject({ t: 'state', code, status: 'waiting', you: 0, view: null, next: null, creator: a.id });
    expect(waiting.players).toEqual([{ id: a.id, name: 'Alice' }, null]);
    expect(waiting.online).toEqual([true, false]);
    const opening = ca.msgs.find((m) => m.t === 'state' && m.status === 'active') as StateMsg;
    expect(opening.events.map((e) => e.t)).toEqual(['firstcut', 'deal']);
    expect(opening.players).toEqual([
      { id: a.id, name: 'Alice' },
      { id: b.id, name: 'Bob' },
    ]);
    expect(opening.view!.hand).toHaveLength(6);
    expect(opening.view!.players).toBe(2);
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
    expect(fa.view!.scores[1 - winner]).toBeLessThan(121);
    expect(fa.view!.skunk[winner]).toBe(0);
    expect(fa.view!.skunk[1 - winner]).toBe(skunkLevel(fa.view!.scores[1 - winner], 121));
    expect(fa.events.some((e) => e.t === 'win')).toBe(true);

    const row = expectRecordedResult(code, fa);

    // Further actions are refused.
    const n = ca.msgs.length;
    ca.send({ t: 'act', action: { t: 'ack' } });
    expect(await ca.waitCount(n + 1)).toEqual({ t: 'error', message: 'This game is over' });

    // The lobby list reflects the result, by seat and team.
    const list = await api(r.base, 'GET', '/api/games', { token: b.token });
    expect(list.status).toBe(200);
    expect(list.body.games).toHaveLength(1);
    expect(list.body.games[0]).toEqual({
      code,
      status: 'finished',
      players: 2,
      you: 1,
      team: 1,
      creator: false,
      seats: [{ id: a.id, name: 'Alice' }, { id: b.id, name: 'Bob' }],
      partner: null,
      opponents: [{ id: a.id, name: 'Alice' }],
      scores: fa.view!.scores,
      winner,
      skunk: fa.view!.skunk,
      place: winner === 1 ? 1 : 2,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      // League additions.
      waitingOnYou: false,
      lastMoveAt: row.last_move_at,
      seasonId: 1,
      fixtureId: null,
      voided: false,
    });
  }, 60_000);

  for (const players of [3, 4] as const) {
    it(`${players} players play to 121 over real sockets`, async () => {
      const { code, people, clients, seats } = await setupTable(r, players);
      const first = clients[0].msgs[0] as StateMsg;
      expect(first).toMatchObject({ status: 'waiting', you: 0, view: null, creator: people[0].id });
      expect(first.players).toEqual([{ id: people[0].id, name: 'Alice' }, ...Array(players - 1).fill(null)]);
      expect(first.online).toEqual([true, ...Array(players - 1).fill(false)]);
      // The creator watched each seat fill, then the opening.
      const fills = clients[0].msgs.filter((m): m is StateMsg => m.t === 'state').map((m) => m.players.filter(Boolean).length);
      expect(fills.slice(0, players)).toEqual(Array.from({ length: players }, (_, i) => i + 1));
      const opening = clients[0].msgs.find((m) => m.t === 'state' && m.status === 'active') as StateMsg;
      expect(opening.events.map((e) => e.t)).toEqual(['firstcut', 'deal']);
      expect(opening.view!.players).toBe(players);
      expect(opening.view!.hand).toHaveLength(5);
      expect(opening.view!.handCounts).toEqual(Array(players).fill(5));
      expect(opening.view!.cribCount).toBe(players === 3 ? 1 : 0);
      expect(opening.view!.scores).toEqual(Array(teamCount(players)).fill(0));
      clients.forEach((cl, i) => expect(cl.lastState.you).toBe(i));

      let steps = 0;
      await playToEnd(seats, () => {
        steps++;
        for (const cl of clients) expect(cl.lastState.view!.scores).toEqual(clients[0].lastState.view!.scores);
      });
      expect(steps).toBeGreaterThan(60);
      const finals = clients.map((cl) => cl.lastState);
      for (const f of finals) {
        expect(f.status).toBe('finished');
        expect(f.view!.phase).toBe('over');
        expect(f.view!.winner).toBe(finals[0].view!.winner);
      }
      const v = finals[0].view!;
      const w = v.winner!;
      expect(v.scores.filter((s) => s === 121)).toHaveLength(1);
      expect(v.scores[w]).toBe(121);
      v.scores.forEach((s, t) => expect(v.skunk[t]).toBe(t === w ? 0 : skunkLevel(s, 121)));
      expectRecordedResult(code, finals[0]);

      // Every player's lobby list agrees, with partners and opponents by team.
      for (let seat = 0; seat < players; seat++) {
        const list = await api(r.base, 'GET', '/api/games', { token: people[seat].token });
        const g = list.body.games[0];
        expect(g).toMatchObject({ code, status: 'finished', players, you: seat, team: teamOf(players, seat), creator: seat === 0, scores: v.scores, winner: w, skunk: v.skunk });
        expect(g.seats.map((p: { id: string }) => p.id)).toEqual(people.map((p) => p.id));
        expect(g.place).toBe(placings(v.scores, w)[teamOf(players, seat)]);
        if (players === 4) {
          expect(g.partner).toEqual({ id: people[(seat + 2) % 4].id, name: people[(seat + 2) % 4].name });
          expect(g.opponents.map((p: { id: string }) => p.id)).toEqual([1, 3, 0, 2].slice(seat % 2 ? 2 : 0, seat % 2 ? 4 : 2).map((s) => people[s].id));
        } else {
          expect(g.partner).toBeNull();
          expect(g.opponents.map((p: { id: string }) => p.id)).toEqual(people.filter((_, s) => s !== seat).map((p) => p.id));
        }
      }
    }, 90_000);
  }
});

// ---- hidden-information audit ----

const MSG_KEYS = ['t', 'code', 'status', 'players', 'online', 'creator', 'you', 'view', 'events', 'next'];
const VIEW_KEYS = [
  'you', 'players', 'target', 'handNo', 'dealer', 'firstCut', 'scores', 'back', 'phase', 'hand', 'handCounts',
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
  score: ['t', 'seat', 'team', 'items', 'points', 'why'],
  win: ['t', 'team', 'skunk'],
};

const keysExactly = (o: object, keys: string[]) => expect(Object.keys(o).sort()).toEqual([...keys].sort());
const isCardNum = (c: unknown) => expect(Number.isInteger(c) && (c as number) >= 0 && (c as number) < 52).toBe(true);
const arrayOf = (xs: unknown, n: number, type: string) => {
  expect(Array.isArray(xs) && xs.length === n).toBe(true);
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
  const n = msg.players.length;
  for (const p of msg.players) if (p) keysExactly(p, ['id', 'name']);
  arrayOf(msg.online, n, 'boolean');
  const v = msg.view as any;
  if (v) {
    keysExactly(v, VIEW_KEYS);
    expect(v.players).toBe(n);
    const teams = teamCount(n as PlayerCount);
    for (const k of ['scores', 'back', 'skunk']) arrayOf(v[k], teams, 'number');
    for (const k of ['discarded', 'acks']) arrayOf(v[k], n, 'boolean');
    arrayOf(v.handCounts, n, 'number');
    for (const k of ['you', 'target', 'handNo', 'dealer', 'cribCount', 'turn', 'count', 'showStep'])
      expect(typeof v[k]).toBe('number');
    expect(v.stats).toHaveLength(n);
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
  /** Messages checked while some other player (partner included) still held unplayed cards. */
  withHiddenCards = 0;

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
      expect(raw).not.toMatch(/"(deck|hands|kept|goSaid)"\s*:/);
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
      expect(v.hand).toEqual(S.hands[this.seat]);
      expect(v.handCounts).toEqual(S.hands.map((h) => h.length));
      expect(firstCut.slice(0, S.players)).toEqual(S.firstCut);
      const others = S.hands.filter((_, p) => p !== this.seat).flat();
      const hidden = new Set([...others, ...S.deck, ...(S.showResult?.crib ? [] : S.crib)]);
      for (const c of cards) expect(hidden.has(c), `hidden card ${c} leaked in ${S.phase}`).toBe(false);
      this.checked++;
      if (others.length > 0) this.withHiddenCards++;
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
      expect(au.withHiddenCards).toBeGreaterThan(20);
    }
  }, 60_000);

  for (const players of [3, 4] as const) {
    it(`${players} players: no seat ever receives another seat’s hidden cards (partner included), the crib or the deck`, async () => {
      const { code, clients, seats } = await setupTable(r, players);
      const auditors = clients.map((cl, seat) => new Auditor(cl, seat));
      const audit = () => {
        const { state } = readGame(tmp.dbPath, code);
        for (const au of auditors) au.check(state);
      };
      audit();
      await playToEnd(seats, audit);
      expect(clients[0].lastState.status).toBe('finished');
      for (const au of auditors) {
        expect(au.checked).toBeGreaterThan(60);
        expect(au.withHiddenCards).toBeGreaterThan(30);
      }
    }, 90_000);
  }
});
