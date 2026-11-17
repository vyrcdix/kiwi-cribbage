// Seasons, commissioner tools, voided games, pending games and results.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSummary } from '../../shared/game.js';
import type { PendingGame, StandingsResponse } from '../../shared/league.js';
import { connectAll, Decks, drive, fixtureGame, movers, randomPolicy } from './league-helpers.js';
import { api, Client, newPlayer, type Player, readGame, type Running, startApp, tempDir } from './test-helpers.js';

let tmp: ReturnType<typeof tempDir>;
let r: Running;
let now: number;
let A: Player, B: Player, C: Player, D: Player;

beforeEach(async () => {
  tmp = tempDir();
  now = Date.parse('2026-03-01T09:00:00.000Z');
  r = await startApp(tmp.dbPath, { clock: () => now, shuffle: new Decks(5).shuffle });
  A = await newPlayer(r.base, 'Alice');
  B = await newPlayer(r.base, 'Bob');
  C = await newPlayer(r.base, 'Carol');
  D = await newPlayer(r.base, 'Dave');
});
afterEach(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

/** Play a two-player fixture game to the end; returns its code. */
const finishGame = async (x: Player, y: Player, seed = 1) => {
  const { code } = await fixtureGame(r, x, [y]);
  const seats = await connectAll(r, code, [x, y]);
  await drive(tmp.dbPath, code, seats, { seed });
  for (const s of seats) await s.client.close();
  return code;
};
const standings = async (q = '') => (await api(r.base, 'GET', `/api/standings${q}`, { token: A.token })).body as StandingsResponse;
const rowOf = (s: StandingsResponse, p: Player) => s.rows.find((x) => x.player.id === p.id);

describe('seasons', () => {
  it('a first season exists; the commissioner rolls over; games belong to the season they were created in', async () => {
    const s = await api(r.base, 'GET', '/api/seasons', { token: B.token });
    expect(s.body.current).toMatchObject({ id: 1, name: 'Season 1', endedAt: null, current: true });
    expect(s.body.seasons).toHaveLength(1);

    // A game started in season 1 and finished after the rollover still counts in season 1.
    const { code: early } = await fixtureGame(r, A, [B]);
    const queued = (await api(r.base, 'POST', '/api/fixtures', { token: C.token, body: { opponents: [D.id] } })).body.id as string;

    expect((await api(r.base, 'POST', '/api/commissioner/seasons', { token: B.token, body: { name: 'Spring' } })).status).toBe(403);
    expect((await api(r.base, 'POST', '/api/commissioner/seasons', { body: { name: 'Spring' } })).status).toBe(401);
    for (const body of [{}, { name: '' }, { name: 'x'.repeat(41) }, { name: 7 }, { name: 'Spring', extra: 1 }, []]) {
      expect((await api(r.base, 'POST', '/api/commissioner/seasons', { token: A.token, body })).status, JSON.stringify(body)).toBe(400);
    }
    now += 1000;
    const next = await api(r.base, 'POST', '/api/commissioner/seasons', { token: A.token, body: { name: ' Spring ' } });
    expect(next.status).toBe(201);
    expect(next.body).toEqual({ id: 2, name: 'Spring', startedAt: new Date(now).toISOString(), endedAt: null, current: true });
    const all = (await api(r.base, 'GET', '/api/league', { token: D.token })).body;
    expect(all.season.id).toBe(2);
    expect(all.seasons.map((x: { id: number; current: boolean; endedAt: string | null }) => [x.id, x.current, x.endedAt])).toEqual([
      [1, false, new Date(now).toISOString()],
      [2, true, null],
    ]);
    // Still-queued fixtures carry over into the new season.
    const fx = (await api(r.base, 'GET', '/api/fixtures', { token: D.token })).body.fixtures;
    expect(fx.filter((f: { status: string }) => f.status === 'queued').map((f: { id: string; seasonId: number }) => [f.id, f.seasonId])).toEqual([[queued, 2]]);
    // …while the one already being played stays in its season, and stays listed.
    expect(fx.filter((f: { status: string }) => f.status === 'playing').map((f: { seasonId: number; gameCode: string }) => [f.seasonId, f.gameCode])).toEqual([[1, early]]);
    expect((await api(r.base, 'GET', '/api/fixtures?season=current', { token: D.token })).body.fixtures.map((f: { id: string }) => f.id)).toEqual([queued]);

    const seats = await connectAll(r, early, [A, B]);
    await drive(tmp.dbPath, early, seats, { seed: 3 });
    const late = await finishGame(C, D);
    const games = (await api(r.base, 'GET', '/api/games', { token: A.token })).body.games as GameSummary[];
    expect(games.find((g) => g.code === early)!.seasonId).toBe(1);
    expect(readGame(tmp.dbPath, late).row.season_id).toBe(2);

    expect((await standings('?season=1')).games).toBe(1);
    expect(rowOf(await standings('?season=1'), A)!.played).toBe(1);
    expect((await standings()).games).toBe(1);
    expect(rowOf(await standings(), A)!.played).toBe(0);
    expect(rowOf(await standings(), C)!.played).toBe(1);
    expect((await standings('?season=all')).games).toBe(2);
    expect((await standings('?season=current')).season!.id).toBe(2);
    const res = await api(r.base, 'GET', '/api/results?season=1', { token: D.token });
    expect(res.body.games.map((g: { code: string }) => g.code)).toEqual([early]);
  }, 60_000);
});

describe('commissioner tools', () => {
  it('everything under /api/commissioner is commissioner-only', async () => {
    const routes: [string, unknown][] = [
      ['/api/commissioner/seasons', { name: 'X' }],
      ['/api/commissioner/round-robin', {}],
      ['/api/commissioner/games/ZZZZZ/void', {}],
      ['/api/commissioner/games/ZZZZZ/unvoid', {}],
      [`/api/commissioner/players/${C.id}/deactivate`, {}],
      [`/api/commissioner/players/${C.id}/reactivate`, {}],
      ['/api/commissioner/handover', { playerId: C.id }],
    ];
    await api(r.base, 'POST', `/api/commissioner/players/${D.id}/deactivate`, { token: A.token });
    for (const [path, body] of routes) {
      expect((await api(r.base, 'POST', path, { body })).status, path).toBe(401);
      expect((await api(r.base, 'POST', path, { token: B.token, body })).status, path).toBe(403);
      expect((await api(r.base, 'POST', path, { token: D.token, body })).status, path).toBe(401);
    }
    expect((await api(r.base, 'GET', '/api/seasons', { token: A.token })).body.seasons).toHaveLength(1);
    expect((await api(r.base, 'GET', '/api/fixtures', { token: A.token })).body.fixtures).toEqual([]);
  });

  it('hands the commissioner role on (active members only)', async () => {
    expect((await api(r.base, 'POST', '/api/commissioner/handover', { token: A.token, body: { playerId: 'NOPE' } })).status).toBe(404);
    expect((await api(r.base, 'POST', '/api/commissioner/handover', { token: A.token, body: {} })).status).toBe(400);
    await api(r.base, 'POST', `/api/commissioner/players/${D.id}/deactivate`, { token: A.token });
    expect((await api(r.base, 'POST', '/api/commissioner/handover', { token: A.token, body: { playerId: D.id } })).status).toBe(409);
    expect((await api(r.base, 'POST', `/api/commissioner/players/${A.id}/deactivate`, { token: A.token })).status).toBe(409);
    const res = await api(r.base, 'POST', '/api/commissioner/handover', { token: A.token, body: { playerId: B.id } });
    expect(res.body).toMatchObject({ id: B.id, commissioner: true });
    expect((await api(r.base, 'GET', '/api/me', { token: B.token })).body.commissioner).toBe(true);
    expect((await api(r.base, 'GET', '/api/me', { token: A.token })).body.commissioner).toBe(false);
    expect((await api(r.base, 'POST', '/api/commissioner/seasons', { token: A.token, body: { name: 'X' } })).status).toBe(403);
    expect((await api(r.base, 'POST', `/api/commissioner/players/${D.id}/reactivate`, { token: B.token })).body.active).toBe(true);
    expect((await api(r.base, 'GET', '/api/league', { token: C.token })).body.commissioner.id).toBe(B.id);
  });

  it('voids and unvoids games: out of every statistic, visibly marked, play stops', async () => {
    const done = await finishGame(A, B);
    const winner = readGame(tmp.dbPath, done).state!.winner === 0 ? A : B;
    expect(rowOf(await standings(), winner)!.won).toBe(1);

    expect((await api(r.base, 'POST', `/api/commissioner/games/${done}/void`, { token: A.token, body: { reason: 'x'.repeat(201) } })).status).toBe(400);
    expect((await api(r.base, 'POST', `/api/commissioner/games/${done}/void`, { token: A.token, body: { reason: 5 } })).status).toBe(400);
    const v = await api(r.base, 'POST', `/api/commissioner/games/${done.toLowerCase()}/void`, { token: A.token, body: { reason: 'Played on one phone' } });
    expect(v.body).toEqual({ code: done, voided: true, voidReason: 'Played on one phone', voidedAt: new Date(now).toISOString() });
    expect((await api(r.base, 'POST', `/api/commissioner/games/${done}/void`, { token: A.token })).status).toBe(409);
    expect(rowOf(await standings(), winner)!.played).toBe(0);
    expect((await standings()).games).toBe(0);
    for (const p of [A, B]) {
      const s = (await api(r.base, 'GET', `/api/players/${p.id}/stats`, { token: C.token })).body;
      expect(s.overall.played).toBe(0);
      expect(s.averages.hands).toBe(0);
    }
    expect((await api(r.base, 'GET', `/api/h2h/${A.id}/${B.id}`, { token: C.token })).body.played).toBe(0);
    const results = (await api(r.base, 'GET', '/api/results', { token: C.token })).body.games;
    expect(results).toEqual([expect.objectContaining({ code: done, voided: true, voidReason: 'Played on one phone' })]);
    expect((await api(r.base, 'GET', '/api/games', { token: A.token })).body.games[0]).toMatchObject({ code: done, voided: true });
    expect((await api(r.base, 'GET', `/api/games/${done}/hands`, { token: C.token })).status).toBe(200);

    const un = await api(r.base, 'POST', `/api/commissioner/games/${done}/unvoid`, { token: A.token });
    expect(un.body).toEqual({ code: done, voided: false, voidReason: null, voidedAt: null });
    expect((await api(r.base, 'POST', `/api/commissioner/games/${done}/unvoid`, { token: A.token })).status).toBe(409);
    expect(rowOf(await standings(), winner)!.won).toBe(1);

    // An active game: voiding stops play (and takes it off the pending list) until unvoided.
    const { code } = await fixtureGame(r, C, [D]);
    const seats = await connectAll(r, code, [C, D]);
    const n = seats[0].client.msgs.length;
    await api(r.base, 'POST', `/api/commissioner/games/${code}/void`, { token: A.token });
    expect(await seats[0].client.waitCount(n + 1)).toEqual({ t: 'error', message: 'This game was voided by the commissioner' });
    const S = readGame(tmp.dbPath, code).state!;
    const m = seats[0].client.msgs.length;
    seats[0].client.send({ t: 'act', action: randomPolicy(S, 0, Math.random) });
    expect(await seats[0].client.waitCount(m + 1)).toEqual({ t: 'error', message: 'This game was voided by the commissioner' });
    expect((await api(r.base, 'GET', '/api/pending', { token: A.token })).body.games).toEqual([]);
    await api(r.base, 'POST', `/api/commissioner/games/${code}/unvoid`, { token: A.token });
    await drive(tmp.dbPath, code, seats, { seed: 4 });
    expect(readGame(tmp.dbPath, code).row.status).toBe('finished');
    for (const s of seats) await s.client.close();
  }, 60_000);

  it('deactivated members leave the standings, but games against them still count for others', async () => {
    const code = await finishGame(A, D);
    const aWon = readGame(tmp.dbPath, code).state!.winner === 0;
    await api(r.base, 'POST', `/api/commissioner/players/${D.id}/deactivate`, { token: A.token });
    const s = await standings();
    expect(s.rows.map((x) => x.player.id)).not.toContain(D.id);
    expect(rowOf(s, A)).toMatchObject({ played: 1, won: aWon ? 1 : 0 });
    // Their stats and head-to-heads are still there to look at.
    expect((await api(r.base, 'GET', `/api/players/${D.id}/stats`, { token: B.token })).body.overall.played).toBe(1);
    expect((await api(r.base, 'GET', `/api/h2h/${A.id}/${D.id}`, { token: B.token })).body.played).toBe(1);
    await api(r.base, 'POST', `/api/commissioner/players/${D.id}/reactivate`, { token: A.token });
    expect((await standings()).rows.map((x) => x.player.id)).toContain(D.id);
  }, 60_000);
});

describe('pending games', () => {
  it('lists every waiting or active game with who it is waiting on and how long it has been idle', async () => {
    // A three-player game waiting for one more.
    const w = (await api(r.base, 'POST', '/api/games', { token: A.token, body: { players: 3 } })).body.code as string;
    await api(r.base, 'POST', `/api/games/${w}/join`, { token: B.token });
    // An active two-player game.
    now += 60_000;
    const { code } = await fixtureGame(r, C, [D]);
    const seats = await connectAll(r, code, [C, D]);
    now += 90_000;

    const p1 = (await api(r.base, 'GET', '/api/pending', { token: A.token })).body.games as PendingGame[];
    expect(p1.map((g) => g.code)).toEqual([code, w]);
    expect(p1[1]).toMatchObject({
      status: 'waiting', players: 3, openSeats: 1, waitingOn: [], waitingOnSeats: [], phase: null, handNo: 0, scores: [0, 0, 0],
      idleSeconds: 150, seats: [expect.objectContaining({ id: A.id, name: 'Alice' }), expect.objectContaining({ id: B.id }), null],
    });
    expect(p1[0]).toMatchObject({ status: 'active', phase: 'discard', handNo: 1, openSeats: 0, waitingOnSeats: [0, 1], idleSeconds: 90 });
    expect(p1[0].waitingOn.map((p) => p.id)).toEqual([C.id, D.id]);
    expect(p1[0].fixtureId).toBeTruthy();

    // Move by move, waitingOn follows the game; so does GET /api/games' waitingOnYou.
    for (let i = 0; i < 40; i++) {
      const S = readGame(tmp.dbPath, code).state!;
      const g = ((await api(r.base, 'GET', '/api/pending', { token: B.token })).body.games as PendingGame[]).find((x) => x.code === code)!;
      expect(g.waitingOnSeats).toEqual(movers(S));
      expect(g.idleSeconds).toBe(i === 0 ? 90 : 0);
      for (const [i2, p] of [C, D].entries()) {
        const mine = ((await api(r.base, 'GET', '/api/games', { token: p.token })).body.games as GameSummary[]).find((x) => x.code === code)!;
        expect(mine.waitingOnYou).toBe(movers(S).includes(i2));
        expect(mine.lastMoveAt).toBe(new Date(i === 0 ? now - 90_000 : now).toISOString());
      }
      // Exactly one move.
      let k = 0;
      await drive(tmp.dbPath, code, seats, { seed: i, until: () => k++ >= 1 });
    }
    const { row } = readGame(tmp.dbPath, code);
    expect(row.last_move_at).toBe(new Date(now).toISOString());
    for (const s of seats) await s.client.close();
    const ws = await Client.connect(r.wsUrl, A.token, w);
    await ws.close();
  }, 60_000);
});
