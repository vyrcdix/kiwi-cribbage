// Hostile input on every endpoint: nothing a client sends may produce a 5xx
// or take the process down; every refusal is JSON { error }.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAll, Decks, drive, fixtureGame } from './league-helpers.js';
import { api, newPlayer, type Player, type Running, startApp, tempDir } from './test-helpers.js';

let tmp: ReturnType<typeof tempDir>;
let r: Running;
let A: Player, B: Player;
let finished: string;
let fixture: string;

beforeAll(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath, { shuffle: new Decks(3).shuffle });
  A = await newPlayer(r.base, 'Alice');
  B = await newPlayer(r.base, 'Bob');
  const g = await fixtureGame(r, A, [B]);
  const seats = await connectAll(r, g.code, [A, B]);
  await drive(tmp.dbPath, g.code, seats, { seed: 1 });
  for (const s of seats) await s.client.close();
  finished = g.code;
  fixture = (await api(r.base, 'POST', '/api/fixtures', { token: B.token, body: { opponents: [A.id] } })).body.id;
}, 60_000);
afterAll(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

const deep = (n: number): unknown => (n === 0 ? 1 : { a: deep(n - 1) });
const BODIES: unknown[] = [
  undefined, null, [], [1, 2], 'str', 0, true, {}, { name: null }, { name: ['x'] }, { name: { toString: 1 } },
  { opponents: { length: 1, 0: 'x' } }, { opponents: [null] }, { opponents: [[]] }, { partner: {} }, { playerId: ['a'] },
  { code: {} }, { invite: { $ne: null } }, { times: 1e308 }, { times: -0 }, { reason: ['x'] }, { avatar: { emoji: {}, colour: [] } },
  { order: [{}] }, { players: '4' }, { __proto__: { admin: true } }, JSON.parse('{"__proto__":{"x":1},"constructor":{"prototype":{}}}'),
  { name: 'x'.repeat(10_000) }, deep(200),
];
const RAW = ['{bad', '[', '"\\u0000"', 'null', '1e400', '{"a":' + '['.repeat(3000) + ']'.repeat(3000) + '}'];
const IDS = ['ZZZZZ', '%00', '..%2F..', 'x'.repeat(300), '%F0%9F%90%B6', '__proto__'];
const QUERIES = ['', '?season=', '?season[]=1&season[]=2', '?season[a]=1', '?season=1e3', '?season=-1', '?season=999999999999',
  '?status[]=open', '?player=', '?player[]=x', '?player=NOPE', '?season=all&status=all&player=' + 'x'.repeat(100)];

const routes = (id: string, q = ''): [string, string][] => [
  // (sign-out is left out: it would end the session the fuzzing uses)
  ['POST', '/api/players'], ['GET', '/api/me'], ['PATCH', '/api/me'], ['GET', '/api/me/sessions'],
  ['DELETE', `/api/me/sessions/${id}`], ['POST', '/api/invites'], ['GET', `/api/invites/${id}`], ['POST', '/api/link'],
  ['POST', '/api/link/redeem'], ['GET', '/api/league'], ['GET', '/api/seasons'], ['GET', `/api/standings${q}`],
  ['GET', `/api/h2h/${id}/${id}${q}`], ['GET', `/api/h2h/${A.id}/${id}${q}`], ['GET', `/api/players/${id}/stats${q}`],
  ['GET', `/api/hall-of-fame${q}`], ['GET', '/api/pending'], ['GET', `/api/results${q}`], ['GET', `/api/games/${id}/hands`],
  ['POST', '/api/games'], ['GET', '/api/games'], ['POST', `/api/games/${id}/join`], ['POST', `/api/games/${id}/seats`],
  ['POST', `/api/games/${id}/remove`], ['POST', `/api/games/${id}/leave`], ['POST', `/api/games/${id}/rematch`],
  ['POST', '/api/fixtures'], ['GET', `/api/fixtures${q}`], ['GET', '/api/fixtures/mine'], ['GET', '/api/fixtures/next'],
  ['POST', `/api/fixtures/${id}/start`], ['POST', `/api/fixtures/${id}/decline`], ['POST', `/api/fixtures/${id}/cancel`],
  ['POST', '/api/commissioner/seasons'], ['POST', '/api/commissioner/round-robin'], ['POST', `/api/commissioner/games/${id}/void`],
  ['POST', `/api/commissioner/games/${id}/unvoid`], ['POST', `/api/commissioner/players/${id}/deactivate`],
  ['POST', `/api/commissioner/players/${id}/reactivate`], ['POST', '/api/commissioner/handover'],
];

const ok = (res: { status: number; body: unknown }, what: string) => {
  expect(res.status, what).toBeLessThan(500);
  if (res.status >= 400) expect(typeof (res.body as { error?: unknown })?.error, what).toBe('string');
};

describe('hostile input', () => {
  it('bodies, raw payloads, path ids and query strings never cause a 5xx', async () => {
    let n = 0;
    for (const id of [...IDS, finished, fixture, B.id]) {
      for (const [method, path] of routes(id)) {
        for (const body of method === 'GET' ? [undefined] : BODIES) {
          // Mostly the commissioner (the widest permissions), sometimes nobody.
          ok(await api(r.base, method, path, { token: n % 7 === 0 ? undefined : A.token, body }), `${method} ${path} ${JSON.stringify(body)?.slice(0, 80)}`);
          n++;
        }
        if (method !== 'GET') for (const rawBody of RAW) ok(await api(r.base, method, path, { token: A.token, rawBody }), `${method} ${path} raw`);
      }
    }
    for (const q of QUERIES) for (const [method, path] of routes(B.id, q)) if (method === 'GET') ok(await api(r.base, method, path, { token: B.token }), `${path}`);
    for (const auth of ['Bearer', 'Bearer ' + 'x'.repeat(5000), 'Basic abc', 'Bearer a b', 'bearer ' + A.token + ' ']) {
      const res = await fetch(r.base + '/api/me', { headers: { authorization: auth } });
      expect(res.status).toBeLessThan(500);
    }
    expect(n).toBeGreaterThan(4_000);
    // Still alive, still sane — and A is still commissioner of a league with these two in it.
    expect((await api(r.base, 'GET', '/api/health')).body).toEqual({ ok: true });
    expect((await api(r.base, 'GET', '/api/me', { token: B.token })).status).toBe(200);
  }, 240_000);
});
