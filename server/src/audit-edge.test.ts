// Independent audit: awkward corners of seasons, fixtures and the league lists.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Card } from '../../shared/cards.js';
import { type Action, applyAction, type GameState, newGame, type PlayerCount } from '../../shared/game.js';
import type { Fixture, FixturesResponse, LeagueResponse, RoundRobinResponse, StandingsResponse } from '../../shared/league.js';
import { connectAll, Decks, fixtureGame, lcg, movers, randomPolicy, seededDeck } from './league-helpers.js';
import { api, newPlayer, type Player, type Running, startApp, tempDir } from './test-helpers.js';

let tmp: ReturnType<typeof tempDir>;
let r: Running;
const decks = new Decks(9);
const P: Record<string, Player> = {};

beforeAll(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath, { shuffle: decks.shuffle });
  for (const n of ['Ann', 'Ben', 'Cat', 'Dan']) P[n] = await newPlayer(r.base, n);
}, 30_000);
afterAll(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

const call = (m: string, p: string, token?: string, body?: unknown) => api(r.base, m, p, { token, body: m === 'GET' ? undefined : body });

/** A complete 2-player game (a script of moves) from a deterministic seed. */
const script = (seed: number, size: PlayerCount = 2): { decks: Card[][]; actions: { seat: number; action: Action }[] } => {
  const rand = lcg(seed);
  const decks: Card[][] = [];
  const shuffle = () => { const d = seededDeck(rand); decks.push([...d]); return d; };
  let s: GameState = newGame(shuffle, 121, size).state;
  const actions: { seat: number; action: Action }[] = [];
  while (s.phase !== 'over') {
    const w = movers(s);
    const seat = w[Math.floor(rand() * w.length)];
    const action = randomPolicy(s, seat, rand);
    s = applyAction(s, seat, action, shuffle).state;
    actions.push({ seat, action });
  }
  return { decks, actions };
};

const playOut = async (who: Player[], seed: number) => {
  const sc = script(seed);
  decks.clear();
  decks.push(...sc.decks);
  const { code, fixtureId } = await fixtureGame(r, who[0], who.slice(1));
  const seats = await connectAll(r, code, who);
  for (const { seat, action } of sc.actions) {
    const counts = seats.map((s) => s.client.msgs.length);
    seats[seat].client.send({ t: 'act', action });
    await Promise.all(seats.map((s, k) => s.client.waitCount(counts[k] + 1)));
  }
  for (const s of seats) await s.client.close();
  decks.clear();
  return { code, fixtureId };
};

describe('seasons and fixtures', () => {
  it('queued fixtures move into a new season; a game started before the rollover keeps its fixture and season', async () => {
    const queued = await call('POST', '/api/fixtures', P.Ann.token, { opponents: [P.Cat.id] });
    const playing = await call('POST', '/api/fixtures', P.Ben.token, { opponents: [P.Dan.id] });
    const started = await call('POST', `/api/fixtures/${playing.body.id}/start`, P.Ben.token);
    expect((await call('POST', '/api/commissioner/seasons', P.Ann.token, { name: 'Two' })).status).toBe(201);
    const open = (await call('GET', '/api/fixtures', P.Ann.token)).body as FixturesResponse;
    expect(open.fixtures.find((f) => f.id === queued.body.id)!.seasonId).toBe(2);
    expect(open.fixtures.find((f) => f.id === playing.body.id)!.seasonId).toBe(1);
    const g = (await call('GET', '/api/pending', P.Ann.token)).body.games.find((x: { code: string }) => x.code === started.body.code);
    expect(g.seasonId).toBe(1);
    // Cleanup so the next tests start from a quiet queue.
    await call('POST', `/api/fixtures/${queued.body.id}/cancel`, P.Ann.token);
    await call('POST', `/api/commissioner/games/${started.body.code}/void`, P.Ann.token);
    await call('POST', `/api/fixtures/${playing.body.id}/cancel`, P.Ann.token);
  });

  // BUG (reported, now fixed): voiding a finished game of an earlier season put its fixture back in the queue,
  // but the fixture kept the OLD season id (startSeason only re-homes fixtures that were queued at the
  // rollover). The default fixture list for the current season (?status=all) then never showed it, and a round
  // robin in the current season did not see it as "an unplayed fixture this season", so it created a second
  // Ann v Ben fixture while the requeued one was still waiting. A requeued fixture now joins the current season.
  it('BUG (fixed): a fixture requeued by a void after a rollover belongs to the current season', async () => {
    const { code, fixtureId } = await playOut([P.Ann, P.Ben], 101);
    const cur = (await call('GET', '/api/seasons', P.Ann.token)).body.current.id as number;
    expect((await call('POST', '/api/commissioner/seasons', P.Ann.token, { name: 'Three' })).status).toBe(201);
    const next = (await call('GET', '/api/seasons', P.Ann.token)).body.current.id as number;
    expect(next).toBe(cur + 1);
    expect((await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token)).status).toBe(200);
    const all = (await call('GET', '/api/fixtures?status=all', P.Ann.token)).body as FixturesResponse; // current season by default
    const fx = all.fixtures.find((f) => f.id === fixtureId);
    expect(fx, 'the requeued fixture is listed for the current season').toBeTruthy();
    const rr = (await call('POST', '/api/commissioner/round-robin', P.Ann.token, {})).body as RoundRobinResponse;
    const duplicate = rr.created.filter((f: Fixture) => f.players === 2 && f.seats.map((s) => s.id).sort().join() === [P.Ann.id, P.Ben.id].sort().join());
    expect(duplicate, 'round robin skips a pair that already has a queued fixture').toHaveLength(0);
  }, 60_000);

  it('whatever a void does to a fixture, a fixture and its game never disagree about each other', async () => {
    const { code, fixtureId } = await playOut([P.Cat, P.Dan], 102);
    const fx = async () => ((await call('GET', '/api/fixtures?status=all&season=all', P.Ann.token)).body as FixturesResponse).fixtures.find((f) => f.id === fixtureId)!;
    expect(await fx()).toMatchObject({ status: 'done', gameCode: code });
    await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token);
    expect(await fx()).toMatchObject({ status: 'queued', gameCode: null, closedAt: null, closedBy: null });
    // Cancelled while requeued, then the original unvoided: stays cancelled (the commissioner's decision stands).
    await call('POST', `/api/fixtures/${fixtureId}/cancel`, P.Ann.token);
    await call('POST', `/api/commissioner/games/${code}/unvoid`, P.Ann.token);
    expect(await fx()).toMatchObject({ status: 'cancelled' });
    const st = (await call('GET', '/api/standings?season=all', P.Ann.token)).body as StandingsResponse;
    expect(st.games).toBeGreaterThanOrEqual(1); // the game counts even though its fixture is cancelled
  }, 60_000);

  it('the league list is active members first, then by name; a rename is reflected everywhere', async () => {
    await call('PATCH', '/api/me', P.Dan.token, { name: 'aaron' });
    await call('POST', `/api/commissioner/players/${P.Cat.id}/deactivate`, P.Ann.token);
    const league = (await call('GET', '/api/league', P.Ann.token)).body as LeagueResponse;
    expect(league.members.map((m) => `${m.name}${m.active ? '' : '!'}`)).toEqual(['aaron', 'Ann', 'Ben', 'Cat!']);
    expect(league.commissioner!.id).toBe(P.Ann.id);
    const standings = (await call('GET', '/api/standings?season=all', P.Ann.token)).body as StandingsResponse;
    expect(standings.rows.map((x) => x.player.name)).not.toContain('Cat');
    await call('POST', `/api/commissioner/players/${P.Cat.id}/reactivate`, P.Ann.token);
  });

  it('a new season starts with everyone unplayed and sharing first place', async () => {
    expect((await call('POST', '/api/commissioner/seasons', P.Ann.token, { name: 'Fresh' })).status).toBe(201);
    const st = (await call('GET', '/api/standings', P.Ann.token)).body as StandingsResponse;
    expect(st.games).toBe(0);
    expect(st.rows.every((x) => x.rank === 1 && x.played === 0)).toBe(true); // surprising on a league table, but consistent with the documented rule
  });
});
