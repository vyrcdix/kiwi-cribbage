import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { value } from '../../shared/cards.js';
import { CODE_ALPHABET } from './random.js';
import {
  api,
  Client,
  newPlayer,
  playToEnd,
  playUntil,
  readGame,
  type Running,
  setupGame,
  sleep,
  startApp,
  type StateMsg,
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

/** Send something, expect exactly an error back, and no state change or broadcast. */
const expectRejected = async (
  code: string,
  actor: Client,
  bystander: Client,
  msg: unknown,
  message?: string,
) => {
  const before = readGame(tmp.dbPath, code).row.state;
  const na = actor.msgs.length;
  const nb = bystander.msgs.length;
  actor.send(msg);
  const reply = await actor.waitCount(na + 1);
  expect(reply.t, `reply to ${JSON.stringify(msg)}`).toBe('error');
  if (message) expect(reply).toEqual({ t: 'error', message });
  else expect(typeof (reply as { message: string }).message).toBe('string');
  await sleep(20);
  expect(actor.msgs.length).toBe(na + 1);
  expect(bystander.msgs.length).toBe(nb);
  expect(actor.closeCode).toBeNull();
  expect(readGame(tmp.dbPath, code).row.state).toBe(before);
};

describe('illegal, out-of-turn and malformed actions', () => {
  it('get an error and leave the state untouched', async () => {
    const { code, ca, cb, seats } = await setupGame(r);
    const va = ca.lastState.view!;

    // Wrong phase / not your card.
    await expectRejected(code, ca, cb, { t: 'act', action: { t: 'play', card: va.hand[0] } }, 'Not pegging now');
    await expectRejected(code, ca, cb, { t: 'act', action: { t: 'cut' } }, 'Not time to cut');
    await expectRejected(code, ca, cb, { t: 'act', action: { t: 'ack' } }, 'Nothing to continue');
    const notMine = cb.lastState.view!.hand.slice(0, 2);
    await expectRejected(code, ca, cb, { t: 'act', action: { t: 'discard', cards: notMine } }, 'Pick two cards from your hand');
    await expectRejected(code, ca, cb, { t: 'act', action: { t: 'discard', cards: [va.hand[0], va.hand[0]] } }, 'Pick two cards from your hand');

    // Malformed / hostile input.
    const malformed: unknown[] = [
      'not json',
      '',
      '[]',
      'null',
      '42',
      '"act"',
      { t: 'act' },
      { t: 'act', action: null },
      { t: 'act', action: 'discard' },
      { t: 'act', action: [] },
      { t: 'act', action: { t: 'discard' } },
      { t: 'act', action: { t: 'discard', cards: 5 } },
      { t: 'act', action: { t: 'discard', cards: 'ab' } },
      { t: 'act', action: { t: 'discard', cards: [va.hand[0]] } },
      { t: 'act', action: { t: 'discard', cards: [va.hand[0], va.hand[1], va.hand[2]] } },
      { t: 'act', action: { t: 'discard', cards: { 0: va.hand[0], 1: va.hand[1], length: 2 } } },
      { t: 'act', action: { t: 'discard', cards: [String(va.hand[0]), String(va.hand[1])] } },
      { t: 'act', action: { t: 'discard', cards: [va.hand[0] + 0.5, va.hand[1]] } },
      { t: 'act', action: { t: 'discard', cards: [-1, 52] } },
      { t: 'act', action: { t: 'discard', cards: [null, null] } },
      { t: 'act', action: { t: 'play', card: '3' } },
      { t: 'act', action: { t: 'play', card: 1e308 } },
      { t: 'act', action: { t: 'play', card: { valueOf: 3 } } },
      { t: 'act', action: { t: 'bogus' } },
      { t: 'act', action: { t: '__proto__' } },
      { t: 'act', action: { t: 'toString' } },
      '{"t":"act","action":{"__proto__":{"t":"cut"}}}',
      { t: 'nope' },
      { t: 'hello', token: 'x', code },
      '['.repeat(5000) + ']'.repeat(5000),
    ];
    for (const m of malformed) await expectRejected(code, ca, cb, m);

    // A binary frame is rejected too.
    {
      const n = ca.msgs.length;
      ca.ws.send(Buffer.from([1, 2, 3]), { binary: true });
      expect((await ca.waitCount(n + 1)).t).toBe('error');
    }

    // The game still works: both discard, then the dealer may not cut.
    const vb = cb.lastState.view!;
    const isState = (m: unknown): m is StateMsg => (m as StateMsg).t === 'state' && (m as StateMsg).view !== null;
    ca.send({ t: 'act', action: { t: 'discard', cards: va.hand.slice(0, 2) } });
    await ca.waitFor((m) => isState(m) && m.view!.discarded[0]);
    await cb.waitFor((m) => isState(m) && m.view!.discarded[0]);
    await expectRejected(code, ca, cb, { t: 'act', action: { t: 'discard', cards: va.hand.slice(2, 4) } }, 'Already discarded');
    cb.send({ t: 'act', action: { t: 'discard', cards: vb.hand.slice(0, 2) } });
    await ca.waitFor((m) => isState(m) && m.view!.phase === 'cut');
    await cb.waitFor((m) => isState(m) && m.view!.phase === 'cut');
    await sleep(20);
    const dealer = ca.lastState.view!.dealer;
    const [dc, pc] = dealer === 0 ? [ca, cb] : [cb, ca];
    await expectRejected(code, dc, pc, { t: 'act', action: { t: 'cut' } }, 'The non-dealer cuts');

    // Pegging: out of turn, and over 31 if it comes up.
    const seats2 = seats;
    await playUntil(seats2, (m) => m.view!.phase === 'peg' && m.view!.oppHandCount > 0 && m.view!.hand.length > 0);
    const turn = ca.lastState.view!.turn;
    const [onTurn, offTurn] = turn === 0 ? [ca, cb] : [cb, ca];
    const offView = offTurn.lastState.view!;
    await expectRejected(code, offTurn, onTurn, { t: 'act', action: { t: 'play', card: offView.hand[0] } }, 'Not your turn');
    const onView = onTurn.lastState.view!;
    const bust = onView.hand.find((c) => onView.count + value(c) > 31);
    if (bust !== undefined) {
      await expectRejected(code, onTurn, offTurn, { t: 'act', action: { t: 'play', card: bust } }, 'That would go over 31');
    }
    await expectRejected(code, onTurn, offTurn, { t: 'act', action: { t: 'play', card: offView.hand[0] } }, 'That card is not in your hand');

    // And the game can still be finished.
    await playToEnd(seats);
    expect(readGame(tmp.dbPath, code).row.status).toBe('finished');
  }, 60_000);

  it('rejects acting in a waiting game, and anything before hello', async () => {
    const a = await newPlayer(r.base, 'Alice');
    const { body } = await api(r.base, 'POST', '/api/games', { token: a.token });
    const ca = await Client.connect(r.wsUrl, a.token, body.code);
    const n = ca.msgs.length;
    ca.send({ t: 'act', action: { t: 'cut' } });
    expect(await ca.waitCount(n + 1)).toEqual({ t: 'error', message: 'Waiting for an opponent' });

    const early = await Client.open(r.wsUrl);
    early.send({ t: 'act', action: { t: 'cut' } });
    expect((await early.waitCount(1)).t).toBe('error');
    await early.closed;

    const junk = await Client.open(r.wsUrl);
    junk.send('garbage');
    expect((await junk.waitCount(1)).t).toBe('error');
    await junk.closed;

    // Oversized frames are dropped and that socket closed; the server carries on.
    const big = await Client.open(r.wsUrl);
    big.send('x'.repeat(200_000));
    await big.closed;
    expect((await api(r.base, 'GET', '/api/health')).body).toEqual({ ok: true });
  });

  it('ignores non-/ws upgrade paths', async () => {
    await expect(Client.open(r.wsUrl.replace('/ws', '/nope'))).rejects.toThrow();
  });
});

describe('auth and membership', () => {
  it('players and /api/me', async () => {
    expect((await api(r.base, 'GET', '/api/health')).body).toEqual({ ok: true });

    const created = await api(r.base, 'POST', '/api/players', { body: { name: '  Alice  ' } });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Alice');
    expect(typeof created.body.id).toBe('string');
    expect(created.body.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Object.keys(created.body).sort()).toEqual(['id', 'name', 'token']);

    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(25) }, { name: 42 }, { name: null }, []]) {
      const res = await api(r.base, 'POST', '/api/players', { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof res.body.error).toBe('string');
    }
    expect((await api(r.base, 'POST', '/api/players', { body: { name: 'x'.repeat(24) } })).status).toBe(201);
    const badJson = await api(r.base, 'POST', '/api/players', { rawBody: '{nope' });
    expect(badJson.status).toBe(400);
    expect(typeof badJson.body.error).toBe('string');

    const meRes = await api(r.base, 'GET', '/api/me', { token: created.body.token });
    expect(meRes).toEqual({ status: 200, body: { id: created.body.id, name: 'Alice' } });
    for (const token of [undefined, 'bogus', created.body.token + 'x']) {
      const res = await api(r.base, 'GET', '/api/me', { token });
      expect(res.status).toBe(401);
      expect(typeof res.body.error).toBe('string');
    }
    expect((await api(r.base, 'POST', '/api/games')).status).toBe(401);
    expect((await api(r.base, 'GET', '/api/games', { token: 'bogus' })).status).toBe(401);
    expect((await api(r.base, 'GET', '/api/nope')).status).toBe(404);

    // Only the hash is stored.
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(tmp.dbPath, { readonly: true });
    const row = db.prepare('SELECT token_hash FROM players WHERE id = ?').get(created.body.id) as { token_hash: string };
    db.close();
    expect(row.token_hash).not.toContain(created.body.token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creating, listing and joining games', async () => {
    const a = await newPlayer(r.base, 'Alice');
    const b = await newPlayer(r.base, 'Bob');
    const c = await newPlayer(r.base, 'Carol');

    const g = await api(r.base, 'POST', '/api/games', { token: a.token });
    expect(g.status).toBe(201);
    expect(g.body.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{5}$`));
    const code = g.body.code as string;

    const waiting = readGame(tmp.dbPath, code).row;
    expect(waiting).toMatchObject({ p0: a.id, p1: null, status: 'waiting', state: null });

    let list = await api(r.base, 'GET', '/api/games', { token: a.token });
    expect(list.body.games).toEqual([
      expect.objectContaining({ code, status: 'waiting', you: 0, opponent: null, scores: [0, 0], winner: null, skunk: 0, finishedAt: null }),
    ]);
    expect((await api(r.base, 'GET', '/api/games', { token: b.token })).body.games).toEqual([]);

    // Creator joining is idempotent.
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: a.token })).body).toEqual({ code, seat: 0 });
    expect((await api(r.base, 'POST', '/api/games/ZZZZZ/join', { token: b.token })).status).toBe(404);
    expect((await api(r.base, 'POST', '/api/games/ZZZZZ/join', { token: b.token })).body.error).toBeTruthy();
    expect((await api(r.base, 'POST', `/api/games/${code}/join`)).status).toBe(401);

    // Lower-case code joins.
    const j = await api(r.base, 'POST', `/api/games/${code.toLowerCase()}/join`, { token: b.token });
    expect(j).toEqual({ status: 200, body: { code, seat: 1 } });
    const active = readGame(tmp.dbPath, code);
    expect(active.row).toMatchObject({ p1: b.id, status: 'active', score0: 0, score1: 0 });
    expect(active.state!.phase).toBe('discard');
    // Re-join is idempotent and doesn't redeal.
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: b.token })).body).toEqual({ code, seat: 1 });
    expect(readGame(tmp.dbPath, code).row.state).toBe(active.row.state);

    const full = await api(r.base, 'POST', `/api/games/${code}/join`, { token: c.token });
    expect(full).toEqual({ status: 409, body: { error: 'Game is full' } });

    // Newest first, capped at 30.
    const g2 = await api(r.base, 'POST', '/api/games', { token: b.token });
    list = await api(r.base, 'GET', '/api/games', { token: b.token });
    expect(list.body.games.map((x: any) => x.code)).toEqual([g2.body.code, code]);
    expect(list.body.games[1]).toMatchObject({ you: 1, opponent: { id: a.id, name: 'Alice' }, status: 'active' });
    for (let i = 0; i < 31; i++) await api(r.base, 'POST', '/api/games', { token: c.token });
    expect((await api(r.base, 'GET', '/api/games', { token: c.token })).body.games).toHaveLength(30);
  });

  it('websocket hello: bad token, unknown game, non-member', async () => {
    const { code } = await setupGame(r);
    const c = await newPlayer(r.base, 'Carol');

    const cases: Array<[unknown, string]> = [
      [{ t: 'hello', token: 'bogus', code }, 'Not signed in'],
      [{ t: 'hello', code }, 'Not signed in'],
      [{ t: 'hello', token: c.token, code: 'ZZZZZ' }, 'No such game'],
      [{ t: 'hello', token: c.token, code: 42 }, 'No such game'],
      [{ t: 'hello', token: c.token, code }, 'You are not in this game'],
    ];
    for (const [hello, message] of cases) {
      const cl = await Client.open(r.wsUrl);
      cl.send(hello);
      expect(await cl.waitCount(1)).toEqual({ t: 'error', message });
      await cl.closed;
      expect(cl.closeCode).toBe(1008);
    }
  });

  it('rematch rules and idempotency', async () => {
    const { a, b, code, ca, cb, seats } = await setupGame(r);
    const c = await newPlayer(r.base, 'Carol');

    // Not finished yet.
    const early = await api(r.base, 'POST', `/api/games/${code}/rematch`, { token: a.token });
    expect(early.status).toBe(409);
    expect(typeof early.body.error).toBe('string');
    // Waiting game: also not finished.
    const w = await api(r.base, 'POST', '/api/games', { token: c.token });
    expect((await api(r.base, 'POST', `/api/games/${w.body.code}/rematch`, { token: c.token })).status).toBe(409);

    await playToEnd(seats);
    expect(ca.lastState.status).toBe('finished');
    expect(ca.lastState.next).toBeNull();

    expect((await api(r.base, 'POST', `/api/games/${code}/rematch`, { token: c.token })).status).toBe(403);
    expect((await api(r.base, 'POST', `/api/games/${code}/rematch`)).status).toBe(401);
    expect((await api(r.base, 'POST', '/api/games/ZZZZZ/rematch', { token: a.token })).status).toBe(404);

    // B asks first: B becomes seat 0 of the new game.
    const na = ca.msgs.length;
    const nb = cb.msgs.length;
    const rm = await api(r.base, 'POST', `/api/games/${code.toLowerCase()}/rematch`, { token: b.token });
    expect(rm.status).toBe(200);
    const next = rm.body.code as string;
    expect(next).toMatch(/^[A-Z2-9]{5}$/);
    expect(next).not.toBe(code);

    // Both clients in the old room learn about it.
    for (const [cl, n] of [[ca, na], [cb, nb]] as const) {
      const m = (await cl.waitFor((x) => x.t === 'state', n)) as StateMsg;
      expect(m.next).toBe(next);
      expect(m.status).toBe('finished');
      expect(m.events).toEqual([]);
    }

    // Idempotent for either player.
    expect((await api(r.base, 'POST', `/api/games/${code}/rematch`, { token: b.token })).body).toEqual({ code: next });
    expect((await api(r.base, 'POST', `/api/games/${code}/rematch`, { token: a.token })).body).toEqual({ code: next });
    await sleep(30);
    expect(ca.msgs.filter((m) => m.t === 'state' && m.next === next)).toHaveLength(1);

    const old = readGame(tmp.dbPath, code).row;
    expect(old.next_code).toBe(next);
    const fresh = readGame(tmp.dbPath, next);
    expect(fresh.row).toMatchObject({ p0: b.id, p1: a.id, status: 'active', next_code: null, winner: null });
    expect(fresh.state!.phase).toBe('discard');
    expect(fresh.state!.handNo).toBe(1);

    // New game is playable straight away; A is seat 1 there.
    const listA = await api(r.base, 'GET', '/api/games', { token: a.token });
    expect(listA.body.games[0]).toMatchObject({ code: next, status: 'active', you: 1, opponent: { id: b.id, name: 'Bob' } });
    const ra = await Client.connect(r.wsUrl, a.token, next);
    expect(ra.msgs[0]).toMatchObject({ t: 'state', code: next, status: 'active', you: 1, next: null });
    expect((ra.msgs[0] as StateMsg).view!.hand).toHaveLength(6);
    const rb = await Client.connect(r.wsUrl, b.token, next);
    await sleep(30);
    await step([
      { player: b, client: rb },
      { player: a, client: ra },
    ]);
    // Joining a rematch game as a third party is refused.
    expect((await api(r.base, 'POST', `/api/games/${next}/join`, { token: c.token })).status).toBe(409);
  }, 60_000);
});
