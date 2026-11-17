// The fixture queue: challenges, the round robin, starting, finishing,
// declining and cancelling, and how voids, deactivations and seasons touch it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSummary } from '../../shared/game.js';
import type { Fixture } from '../../shared/league.js';
import { connectAll, Decks, drive } from './league-helpers.js';
import { api, newPlayer, type Player, readGame, type Running, startApp, tempDir } from './test-helpers.js';

let tmp: ReturnType<typeof tempDir>;
let r: Running;
let A: Player, B: Player, C: Player, D: Player, E: Player;

beforeEach(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath, { shuffle: new Decks(11).shuffle });
  [A, B, C, D, E] = await Promise.all(['Alice', 'Bob', 'Carol', 'Dave', 'Erin'].map((n) => newPlayer(r.base, n)));
});
afterEach(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

const challenge = (by: Player, body: unknown) => api(r.base, 'POST', '/api/fixtures', { token: by.token, body });
const ids = (f: Fixture) => f.seats.map((p) => p.id);
const mine = async (p: Player) => (await api(r.base, 'GET', '/api/fixtures/mine', { token: p.token })).body.fixtures as Fixture[];
const next = async (p: Player) => (await api(r.base, 'GET', '/api/fixtures/next', { token: p.token })).body.fixture as Fixture | null;
const act = (p: Player, f: { id: string }, what: 'start' | 'decline' | 'cancel') =>
  api(r.base, 'POST', `/api/fixtures/${f.id}/${what}`, { token: p.token });

describe('challenges', () => {
  it('one, two or three others: seats in table order, partners opposite', async () => {
    const two = await challenge(A, { opponents: [B.id] });
    expect(two.status).toBe(201);
    expect(two.body).toMatchObject({ kind: 'challenge', players: 2, status: 'queued', seasonId: 1, gameCode: null, closedBy: null, closedAt: null });
    expect(ids(two.body)).toEqual([A.id, B.id]);
    expect(two.body.createdBy.id).toBe(A.id);
    const three = await challenge(A, { opponents: [C.id, B.id] });
    expect(ids(three.body)).toEqual([A.id, C.id, B.id]);
    const four = await challenge(A, { opponents: [B.id, D.id], partner: C.id });
    expect(ids(four.body)).toEqual([A.id, B.id, C.id, D.id]);

    const bad: unknown[] = [
      {}, { opponents: [] }, { opponents: B.id }, { opponents: [B.id, C.id, D.id] }, { opponents: [5] }, { opponents: [''] },
      { opponents: [B.id], partner: C.id }, { opponents: [B.id, B.id] }, { opponents: [A.id] }, { opponents: [B.id, C.id], partner: B.id },
      { opponents: [B.id, C.id], partner: A.id }, { opponents: [B.id], extra: 1 }, { opponents: [B.id, C.id], partner: 7 }, [],
    ];
    for (const body of bad) {
      const res = await challenge(A, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof res.body.error).toBe('string');
    }
    expect((await challenge(A, { opponents: ['NOBODY'] })).status).toBe(404);
    await api(r.base, 'POST', `/api/commissioner/players/${E.id}/deactivate`, { token: A.token });
    expect((await challenge(A, { opponents: [E.id] })).status).toBe(409);
    expect((await api(r.base, 'POST', '/api/fixtures', { body: { opponents: [B.id] } })).status).toBe(401);
  });

  it('queues in order; anyone sees the league queue; start, finish, next', async () => {
    const f1 = (await challenge(A, { opponents: [B.id] })).body as Fixture;
    const f2 = (await challenge(C, { opponents: [A.id] })).body as Fixture;
    const f3 = (await challenge(B, { opponents: [A.id, C.id] })).body as Fixture;
    const f4 = (await challenge(D, { opponents: [E.id] })).body as Fixture;
    expect((await mine(A)).map((f) => f.id)).toEqual([f1.id, f2.id, f3.id]);
    expect((await mine(E)).map((f) => f.id)).toEqual([f4.id]);
    const league = await api(r.base, 'GET', '/api/fixtures', { token: E.token });
    expect(league.body.fixtures.map((f: Fixture) => f.id)).toEqual([f1.id, f2.id, f3.id, f4.id]);
    expect((await next(A))!.id).toBe(f1.id);
    const forC = await api(r.base, 'GET', `/api/fixtures?player=${C.id}`, { token: E.token });
    expect(forC.body.fixtures.map((f: Fixture) => f.id)).toEqual([f2.id, f3.id]);
    expect((await api(r.base, 'GET', '/api/fixtures?player=NOPE', { token: E.token })).status).toBe(404);

    // Only participants start; the game has everyone seated and dealt.
    expect((await act(C, f1, 'start')).status).toBe(403);
    const started = await act(B, f1, 'start');
    expect(started.status).toBe(200);
    const code = started.body.code as string;
    expect(started.body.fixture).toMatchObject({ id: f1.id, status: 'playing', gameCode: code });
    expect((await act(A, f1, 'start')).body.code).toBe(code); // idempotent
    const g = readGame(tmp.dbPath, code);
    expect(g.row).toMatchObject({ status: 'active', players: 2, fixture_id: f1.id, creator: B.id });
    expect(g.seats).toEqual([A.id, B.id]);
    expect(((await api(r.base, 'GET', '/api/games', { token: A.token })).body.games as GameSummary[])[0]).toMatchObject({ code, fixtureId: f1.id, status: 'active' });
    expect((await next(A))!.id).toBe(f2.id); // next = the next one not yet started
    expect((await mine(A)).map((f) => f.status)).toEqual(['playing', 'queued', 'queued']);

    const seats = await connectAll(r, code, [A, B]);
    await drive(tmp.dbPath, code, seats, { seed: 1 });
    for (const s of seats) await s.client.close();
    const after = await api(r.base, 'GET', '/api/fixtures?status=all', { token: C.token });
    expect(after.body.fixtures.find((f: Fixture) => f.id === f1.id)).toMatchObject({ status: 'done', gameCode: code, closedAt: readGame(tmp.dbPath, code).row.finished_at });
    expect((await api(r.base, 'GET', '/api/fixtures', { token: C.token })).body.fixtures.map((f: Fixture) => f.id)).toEqual([f2.id, f3.id, f4.id]);
    expect((await mine(A)).map((f) => f.id)).toEqual([f2.id, f3.id]);
    expect((await next(A))!.id).toBe(f2.id);
    expect((await act(A, f1, 'start')).status).toBe(409);
    expect((await act(A, { id: 'NOPE' }, 'start')).status).toBe(404);
    expect((await act(A, { id: '../x' }, 'start')).status).toBe(404);

    // Three players start straight into a three-player game.
    const s3 = await act(C, f3, 'start');
    expect(readGame(tmp.dbPath, s3.body.code).seats).toEqual([B.id, A.id, C.id]);
    expect(readGame(tmp.dbPath, s3.body.code).state!.players).toBe(3);
    expect(await next(E)).toMatchObject({ id: f4.id });
    await act(E, f4, 'decline');
    expect(await next(E)).toBeNull();
  }, 60_000);

  it('decline (a challenged player) and cancel (creator or commissioner)', async () => {
    const f = (await challenge(B, { opponents: [C.id, D.id] })).body as Fixture;
    expect((await act(B, f, 'decline')).status).toBe(403); // the challenger
    expect((await act(E, f, 'decline')).status).toBe(403); // not in it
    const dec = await act(D, f, 'decline');
    expect(dec.body).toMatchObject({ status: 'declined', closedBy: { id: D.id } });
    expect((await act(C, f, 'decline')).status).toBe(409);
    expect((await act(C, f, 'start')).status).toBe(409);
    expect((await act(B, f, 'cancel')).status).toBe(409);

    const g = (await challenge(B, { opponents: [C.id] })).body as Fixture;
    expect((await act(C, g, 'cancel')).status).toBe(403);
    expect((await act(B, g, 'cancel')).body).toMatchObject({ status: 'cancelled', closedBy: { id: B.id } });
    const h = (await challenge(B, { opponents: [C.id] })).body as Fixture;
    expect((await act(A, h, 'cancel')).body).toMatchObject({ status: 'cancelled', closedBy: { id: A.id } }); // the commissioner
    const k = (await challenge(B, { opponents: [C.id] })).body as Fixture;
    await act(C, k, 'start');
    expect((await act(B, k, 'cancel')).status).toBe(409);
    expect((await act(C, k, 'decline')).status).toBe(409);
    expect((await mine(C)).map((x) => x.id)).toEqual([k.id]);
  });
});

describe('round robin', () => {
  it('every pair of active members once, skipping pairs with an unplayed fixture; idempotent; N times', async () => {
    await api(r.base, 'POST', `/api/commissioner/players/${E.id}/deactivate`, { token: A.token });
    const existing = (await challenge(B, { opponents: [A.id] })).body as Fixture;
    expect((await api(r.base, 'POST', '/api/commissioner/round-robin', { token: B.token })).status).toBe(403);
    for (const body of [{ times: 0 }, { times: 11 }, { times: 1.5 }, { times: '2' }, { times: null }, { rounds: 1 }, []]) {
      expect((await api(r.base, 'POST', '/api/commissioner/round-robin', { token: A.token, body })).status, JSON.stringify(body)).toBe(400);
    }

    const rr = await api(r.base, 'POST', '/api/commissioner/round-robin', { token: A.token });
    expect(rr.status).toBe(201);
    const created = rr.body.created as Fixture[];
    expect(rr.body.skippedPairs).toBe(1);
    expect(created).toHaveLength(5); // 4 active members: 6 pairs, A–B already queued
    const pair = (f: Fixture) => ids(f).sort().join('|');
    const want = [[A, C], [A, D], [B, C], [B, D], [C, D]].map((p) => p.map((x) => x.id).sort().join('|')).sort();
    expect(created.map(pair).sort()).toEqual(want);
    for (const f of created) expect(f).toMatchObject({ kind: 'round-robin', players: 2, status: 'queued', seasonId: 1, createdBy: { id: A.id } });
    expect(created.flatMap(ids)).not.toContain(E.id);
    // Round order: the first two fixtures that don't involve A–B share nobody (a round of disjoint pairs).
    const league = (await api(r.base, 'GET', '/api/fixtures', { token: D.token })).body.fixtures as Fixture[];
    expect(league[0].id).toBe(existing.id);
    expect(league.slice(1).map((f) => f.id)).toEqual(created.map((f) => f.id));

    // Again: nothing new.
    const again = await api(r.base, 'POST', '/api/commissioner/round-robin', { token: A.token });
    expect(again.body).toEqual({ created: [], skippedPairs: 6 });

    // Play one; it no longer blocks its pair.
    const cd = created.find((f) => pair(f) === [C.id, D.id].sort().join('|'))!;
    const code = (await act(C, cd, 'start')).body.code;
    const seats = await connectAll(r, code, cd.seats.map((p) => [C, D].find((x) => x.id === p.id)!));
    expect((await api(r.base, 'POST', '/api/commissioner/round-robin', { token: A.token })).body.created).toHaveLength(0); // playing still blocks
    await drive(tmp.dbPath, code, seats, { seed: 2 });
    for (const s of seats) await s.client.close();
    const third = await api(r.base, 'POST', '/api/commissioner/round-robin', { token: A.token });
    expect(third.body.created.map(pair)).toEqual([[C.id, D.id].sort().join('|')]);
    expect(third.body.skippedPairs).toBe(5);

    // Twice round, from scratch: each pair twice, seats swapped the second time.
    for (const f of (await api(r.base, 'GET', '/api/fixtures', { token: A.token })).body.fixtures as Fixture[])
      if (f.status === 'queued') await act(A, f, 'cancel');
    const twice = await api(r.base, 'POST', '/api/commissioner/round-robin', { token: A.token, body: { times: 2 } });
    expect(twice.body.created).toHaveLength(12);
    expect(twice.body.skippedPairs).toBe(0);
    const byPair = new Map<string, string[][]>();
    for (const f of twice.body.created as Fixture[]) byPair.set(pair(f), [...(byPair.get(pair(f)) ?? []), ids(f)]);
    expect(byPair.size).toBe(6);
    for (const [, list] of byPair) {
      expect(list).toHaveLength(2);
      expect(list[1]).toEqual([...list[0]].reverse());
    }
    // Each round is disjoint pairs: in the first two created, nobody appears twice.
    const firstRound = (twice.body.created as Fixture[]).slice(0, 2).flatMap(ids);
    expect(new Set(firstRound).size).toBe(4);
  }, 60_000);
});

describe('fixtures and the rest of the league', () => {
  it('deactivation cancels queued fixtures; voiding a fixture game requeues it; unvoid relinks', async () => {
    const f1 = (await challenge(A, { opponents: [E.id] })).body as Fixture;
    const f2 = (await challenge(E, { opponents: [B.id, C.id], partner: D.id })).body as Fixture;
    const f3 = (await challenge(B, { opponents: [C.id] })).body as Fixture;
    await api(r.base, 'POST', `/api/commissioner/players/${E.id}/deactivate`, { token: A.token });
    const all = (await api(r.base, 'GET', '/api/fixtures?status=all', { token: B.token })).body.fixtures as Fixture[];
    expect(all.map((f) => [f.id, f.status, f.closedBy?.id ?? null])).toEqual([
      [f1.id, 'cancelled', A.id],
      [f2.id, 'cancelled', A.id],
      [f3.id, 'queued', null],
    ]);

    const code = (await act(B, f3, 'start')).body.code as string;
    const seats = await connectAll(r, code, [B, C]);
    await drive(tmp.dbPath, code, seats, { seed: 3 });
    for (const s of seats) await s.client.close();
    expect((await api(r.base, 'GET', '/api/fixtures?status=all', { token: B.token })).body.fixtures[2].status).toBe('done');
    await api(r.base, 'POST', `/api/commissioner/games/${code}/void`, { token: A.token });
    const requeued = (await mine(B))[0];
    expect(requeued).toMatchObject({ id: f3.id, status: 'queued', gameCode: null, closedAt: null });
    await api(r.base, 'POST', `/api/commissioner/games/${code}/unvoid`, { token: A.token });
    expect((await api(r.base, 'GET', '/api/fixtures?status=all', { token: B.token })).body.fixtures[2]).toMatchObject({ status: 'done', gameCode: code });

    // Void again and replay it: the new game is linked; unvoiding the old one leaves the fixture alone.
    await api(r.base, 'POST', `/api/commissioner/games/${code}/void`, { token: A.token });
    const replay = (await act(C, f3, 'start')).body.code as string;
    expect(replay).not.toBe(code);
    await api(r.base, 'POST', `/api/commissioner/games/${code}/unvoid`, { token: A.token });
    expect((await mine(B))[0]).toMatchObject({ id: f3.id, status: 'playing', gameCode: replay });
    expect((await api(r.base, 'GET', '/api/fixtures?season=all&status=bogus', { token: B.token })).status).toBe(400);
  }, 60_000);
});
