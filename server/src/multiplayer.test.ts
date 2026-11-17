// Three- and four-player games end to end: creating, seating (and rearranging
// seats while waiting), late joiners, persistence across a restart, rematches.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { teamOf, viewFor } from '../../shared/game.js';
import {
  api,
  bothOnline,
  Client,
  legalMove,
  newPlayer,
  playToEnd,
  playUntil,
  readGame,
  type Running,
  type Seated,
  sleep,
  startApp,
  type StateMsg,
  setupTable,
  step,
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

const ids = (m: StateMsg) => m.players.map((p) => p?.id ?? null);

describe('creating and joining', () => {
  it('validates the player count; defaults to two', async () => {
    const a = await newPlayer(r.base, 'Alice');
    for (const body of [{ players: 1 }, { players: 5 }, { players: '3' }, { players: 2.5 }, { players: [3] }]) {
      const res = await api(r.base, 'POST', '/api/games', { token: a.token, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe('players must be 2, 3 or 4');
    }
    expect((await api(r.base, 'POST', '/api/games', { token: a.token })).body.players).toBe(2);
    for (const players of [2, 3, 4]) {
      const res = await api(r.base, 'POST', '/api/games', { token: a.token, body: { players } });
      expect(res.status).toBe(201);
      expect(res.body.players).toBe(players);
      const { row, seats } = readGame(tmp.dbPath, res.body.code);
      expect(row).toMatchObject({ players, creator: a.id, status: 'waiting' });
      expect(row.scores).toBe(JSON.stringify(players === 3 ? [0, 0, 0] : [0, 0]));
      expect(seats).toEqual([a.id, ...Array(players - 1).fill(null)]);
    }
  });

  it('three players: each joiner takes the next seat, the third starts the game, a fourth is refused', async () => {
    const [a, b, c, d] = await Promise.all(['Alice', 'Bob', 'Carol', 'Dave'].map((n) => newPlayer(r.base, n)));
    const code = (await api(r.base, 'POST', '/api/games', { token: a.token, body: { players: 3 } })).body.code as string;
    const ca = await Client.connect(r.wsUrl, a.token, code);

    // Acting while waiting is refused.
    let n = ca.msgs.length;
    ca.send({ t: 'act', action: { t: 'cut' } });
    expect(await ca.waitCount(n + 1)).toEqual({ t: 'error', message: 'Waiting for players' });

    n = ca.msgs.length;
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: b.token })).body).toEqual({ code, seat: 1 });
    const seen = (await ca.waitFor((m) => m.t === 'state', n)) as StateMsg;
    expect(seen).toMatchObject({ status: 'waiting', view: null, events: [] });
    expect(ids(seen)).toEqual([a.id, b.id, null]);
    expect(readGame(tmp.dbPath, code).row.status).toBe('waiting');
    // Re-joining is idempotent.
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: b.token })).body).toEqual({ code, seat: 1 });

    // B waits in the room too; C's arrival deals the opening to both.
    const cb = await Client.connect(r.wsUrl, b.token, code);
    expect(cb.lastState.online).toEqual([true, true, false]);
    const nb = cb.msgs.length;
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: c.token })).body).toEqual({ code, seat: 2 });
    for (const [cl, from] of [[ca, 0], [cb, nb]] as const) {
      const opening = (await cl.waitFor((m) => m.t === 'state' && m.status === 'active', from)) as StateMsg;
      expect(opening.events.map((e) => e.t)).toEqual(['firstcut', 'deal']);
      expect(ids(opening)).toEqual([a.id, b.id, c.id]);
      expect(opening.view!.hand).toHaveLength(5);
    }
    const full = await api(r.base, 'POST', `/api/games/${code}/join`, { token: d.token });
    expect(full).toEqual({ status: 409, body: { error: 'Game is full' } });

    // Discards are one card: two is refused, one is accepted.
    const hand = ca.lastState.view!.hand;
    n = ca.msgs.length;
    ca.send({ t: 'act', action: { t: 'discard', cards: hand.slice(0, 2) } });
    expect(await ca.waitCount(n + 1)).toEqual({ t: 'error', message: 'Pick one card from your hand' });
    n = ca.msgs.length;
    ca.send({ t: 'act', action: { t: 'discard', cards: hand.slice(0, 3) } });
    expect(await ca.waitCount(n + 1)).toEqual({ t: 'error', message: 'Malformed action' });
    ca.send({ t: 'act', action: { t: 'discard', cards: [hand[0]] } });
    const after = (await ca.waitFor((m) => m.t === 'state' && m.view !== null && m.view.discarded[0], n)) as StateMsg;
    expect(after.view!.hand).toHaveLength(4);
    expect(after.view!.cribCount).toBe(2);
  }, 30_000);

  it('a late joiner (the last seat) gets the current state on connecting, mid-game too', async () => {
    const { code, people, clients, seats } = await setupTable(r, 4);
    // Dave's socket drops; the others play on until the game waits on Dave, then Dave comes back.
    await clients[3].close();
    const three = seats.slice(0, 3);
    let moves = 0;
    while (three.some((s) => legalMove(s.client.lastState.view))) {
      await step(three);
      moves++;
    }
    expect(moves).toBeGreaterThanOrEqual(3); // at least the other three discards
    const now = readGame(tmp.dbPath, code).state!;
    expect(legalMove(viewFor(now, 3))).not.toBeNull();
    const back = await Client.connect(r.wsUrl, people[3].token, code);
    const first = back.msgs[0] as StateMsg;
    expect(first).toMatchObject({ status: 'active', you: 3, events: [] });
    expect(first.view!.hand).toEqual(now.hands[3]);
    expect(first.view!.handNo).toBe(now.handNo);
    const all: Seated[] = [...seats.slice(0, 3), { player: people[3], client: back }];
    await bothOnline(all.map((s) => s.client));
    await playToEnd(all);
    expect(readGame(tmp.dbPath, code).row.status).toBe('finished');
  }, 60_000);
});

describe('arranging seats while waiting', () => {
  it('creator only, waiting only, every seated player exactly once; joiners fill the lowest open seat', async () => {
    const [a, b, c, d, e] = await Promise.all(['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map((n) => newPlayer(r.base, n)));
    const code = (await api(r.base, 'POST', '/api/games', { token: a.token, body: { players: 4 } })).body.code as string;
    const seatsPath = `/api/games/${code}/seats`;
    await api(r.base, 'POST', `/api/games/${code}/join`, { token: b.token });
    const ca = await Client.connect(r.wsUrl, a.token, code);
    const cb = await Client.connect(r.wsUrl, b.token, code);
    await sleep(30);
    expect(cb.lastState).toMatchObject({ you: 1, creator: a.id });

    // Not the creator / not signed in / no such game.
    expect((await api(r.base, 'POST', seatsPath, { token: b.token, body: { order: [b.id, null, a.id, null] } })).status).toBe(403);
    expect((await api(r.base, 'POST', seatsPath, { token: e.token, body: { order: [a.id, b.id, null, null] } })).status).toBe(403);
    expect((await api(r.base, 'POST', seatsPath, { body: { order: [a.id, b.id, null, null] } })).status).toBe(401);
    expect((await api(r.base, 'POST', '/api/games/ZZZZZ/seats', { token: a.token, body: { order: [] } })).status).toBe(404);

    // Malformed orders.
    const bad: unknown[] = [
      undefined, null, 'ab', {}, [a.id, b.id], [a.id, b.id, null, null, null], [a.id, null, null, null],
      [a.id, a.id, b.id, null], [a.id, b.id, c.id, null], [a.id, b.id, 5, null], [a.id, b.id, '', null],
    ];
    for (const order of bad) {
      const res = await api(r.base, 'POST', seatsPath, { token: a.token, body: { order } });
      expect(res.status, JSON.stringify(order)).toBe(400);
      expect(typeof res.body.error).toBe('string');
    }
    expect(readGame(tmp.dbPath, code).seats).toEqual([a.id, b.id, null, null]);

    // Alice puts Bob opposite her (seat 2): partners.
    const nb = cb.msgs.length;
    const moved = await api(r.base, 'POST', seatsPath, { token: a.token, body: { order: [a.id, null, b.id, null] } });
    expect(moved).toEqual({ status: 200, body: { players: [{ id: a.id, name: 'Alice' }, null, { id: b.id, name: 'Bob' }, null] } });
    const bSees = (await cb.waitFor((m) => m.t === 'state', nb)) as StateMsg;
    expect(bSees.you).toBe(2);
    expect(ids(bSees)).toEqual([a.id, null, b.id, null]);
    expect(bSees.online).toEqual([true, false, true, false]);
    expect(((await ca.waitFor((m) => m.t === 'state' && m.players[2]?.id === b.id)) as StateMsg).you).toBe(0);

    // Carol fills the lowest open seat (1); the creator may move themself too.
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: c.token })).body).toEqual({ code, seat: 1 });
    expect((await api(r.base, 'POST', seatsPath, { token: a.token, body: { order: [null, c.id, b.id, a.id] } })).status).toBe(200);
    expect(readGame(tmp.dbPath, code).seats).toEqual([null, c.id, b.id, a.id]);
    expect((await api(r.base, 'POST', seatsPath, { token: a.token, body: { order: [a.id, c.id, b.id, null] } })).status).toBe(200);

    // Dave takes the last seat (3) and the game starts: Alice & Bob (0, 2) against Carol & Dave (1, 3).
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: d.token })).body).toEqual({ code, seat: 3 });
    const opening = (await cb.waitFor((m) => m.t === 'state' && m.status === 'active', nb)) as StateMsg;
    expect(ids(opening)).toEqual([a.id, c.id, b.id, d.id]);
    expect(opening.you).toBe(2);
    expect(teamOf(4, opening.you)).toBe(teamOf(4, 0));
    const listB = await api(r.base, 'GET', '/api/games', { token: b.token });
    expect(listB.body.games[0]).toMatchObject({ you: 2, team: 0, partner: { id: a.id, name: 'Alice' } });
    expect(listB.body.games[0].opponents.map((p: { id: string }) => p.id)).toEqual([c.id, d.id]);

    // Once started, seats are fixed.
    const late = await api(r.base, 'POST', seatsPath, { token: a.token, body: { order: [b.id, c.id, a.id, d.id] } });
    expect(late.status).toBe(409);
    expect(readGame(tmp.dbPath, code).seats).toEqual([a.id, c.id, b.id, d.id]);
  }, 30_000);

  it('three players: rearranging decides the order of play', async () => {
    const [a, b] = await Promise.all(['Alice', 'Bob'].map((n) => newPlayer(r.base, n)));
    const code = (await api(r.base, 'POST', '/api/games', { token: a.token, body: { players: 3 } })).body.code as string;
    await api(r.base, 'POST', `/api/games/${code}/join`, { token: b.token });
    // Bob moves to Alice's right (seat 2), leaving seat 1 for whoever joins next.
    const res = await api(r.base, 'POST', `/api/games/${code}/seats`, { token: a.token, body: { order: [a.id, null, b.id] } });
    expect(res.status).toBe(200);
    expect(readGame(tmp.dbPath, code).seats).toEqual([a.id, null, b.id]);
  });
});

describe('persistence and rematch with more players', () => {
  for (const players of [3, 4] as const) {
    it(`${players} players: a restart mid-game resumes exactly`, async () => {
      const { code, people, clients, seats } = await setupTable(r, players);
      await playUntil(seats, (m) => m.view!.handNo >= 2 && m.view!.phase === 'peg' && m.view!.played.length >= 2);
      const before = clients.map((cl) => cl.lastState.view);
      const beforeRow = readGame(tmp.dbPath, code).row;
      for (const cl of clients) await cl.close();
      await r.server.shutdown();

      r = await startApp(tmp.dbPath);
      const again: Client[] = [];
      for (const p of people) again.push(await Client.connect(r.wsUrl, p.token, code));
      again.forEach((cl, i) => {
        expect(cl.msgs[0]).toMatchObject({ t: 'state', status: 'active', you: i, events: [] });
        expect((cl.msgs[0] as StateMsg).view).toEqual(before[i]);
      });
      await bothOnline(again);
      expect(readGame(tmp.dbPath, code).row.state).toBe(beforeRow.state);
      const seats2: Seated[] = people.map((player, i) => ({ player, client: again[i] }));
      await playToEnd(seats2);
      expect(readGame(tmp.dbPath, code).row.status).toBe('finished');
    }, 90_000);
  }

  it('four players: a rematch keeps the same players in the same seats, whoever asks', async () => {
    const { code, people, clients, seats } = await setupTable(r, 4);
    await playToEnd(seats);
    const ns = clients.map((cl) => cl.msgs.length);
    const rm = await api(r.base, 'POST', `/api/games/${code}/rematch`, { token: people[3].token });
    expect(rm.status).toBe(200);
    const next = rm.body.code as string;
    for (let i = 0; i < 4; i++) expect(((await clients[i].waitFor((m) => m.t === 'state', ns[i])) as StateMsg).next).toBe(next);
    expect((await api(r.base, 'POST', `/api/games/${code}/rematch`, { token: people[1].token })).body).toEqual({ code: next });
    const fresh = readGame(tmp.dbPath, next);
    expect(fresh.row).toMatchObject({ players: 4, creator: people[0].id, status: 'active' });
    expect(fresh.seats).toEqual(people.map((p) => p.id));
    expect(fresh.state!.players).toBe(4);
    expect(fresh.state!.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
    const again: Seated[] = [];
    for (const p of people) again.push({ player: p, client: await Client.connect(r.wsUrl, p.token, next) });
    await bothOnline(again.map((s) => s.client));
    for (let i = 0; i < 6; i++) await step(again);
  }, 90_000);
});
