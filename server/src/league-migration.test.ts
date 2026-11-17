// Migration 0003 on a database created under 0001 + 0002 with real data:
// players keep their tokens, the earliest becomes commissioner, every game
// lands in Season 1, finished games count in the standings, and an
// in-progress game resumes and records its hands from the next deal on.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAction, type GameState, newGame, viewFor } from '../../shared/game.js';
import type { HandsResponse, PlayerStats, StandingsResponse } from '../../shared/league.js';
import { connectAll, Decks, drive, lcg, observe, randomPolicy, seededDeck } from './league-helpers.js';
import { hashToken } from './random.js';
import { api, inviteFrom, readGame, type Running, startApp, type StateMsg, tempDir } from './test-helpers.js';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let tmp: ReturnType<typeof tempDir>;
let r: Running | null = null;
beforeEach(() => {
  tmp = tempDir();
});
afterEach(async () => {
  await r?.server.shutdown();
  r = null;
  tmp.cleanup();
});

/** A two-player game played (randomly, seeded) until `stop` holds; the state as the old server saved it (no hand log). */
const oldState = (seed: number, stop: (s: GameState) => boolean, players: 2 | 3 = 2): GameState => {
  const rand = lcg(seed);
  const shuffle = () => seededDeck(rand);
  let s = newGame(shuffle, 121, players).state;
  while (!stop(s)) {
    const seat = [...Array(players).keys()].find((p) => {
      if (s.phase === 'discard') return s.hands[p].length > 4;
      if (s.phase === 'cut') return p === (s.dealer + 1) % players;
      if (s.phase === 'peg') return p === s.turn;
      return !s.acks[p];
    })!;
    s = applyAction(s, seat, randomPolicy(s, seat, rand), shuffle).state;
  }
  const { handLog: _drop, ...old } = s;
  return old as GameState;
};

describe('migration 0003 on existing data', () => {
  it('keeps tokens, picks the commissioner, fills Season 1, counts results and resumes play', async () => {
    const db = new Database(tmp.dbPath);
    db.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const f of ['0001_init.sql', '0002_multiplayer.sql']) {
      db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
      db.prepare('INSERT INTO migrations VALUES (?, ?)').run(f, '2026-01-01T00:00:00.000Z');
    }
    // Carol was created first (by time), though inserted last.
    const people = [
      { id: 'P0', name: 'Alice', token: 'token-alice-xxxxxxxxxxxxxxxxxxxxxx', at: '2026-01-02T00:00:00.000Z' },
      { id: 'P1', name: 'Bob', token: 'token-bob-xxxxxxxxxxxxxxxxxxxxxxxx', at: '2026-01-03T00:00:00.000Z' },
      { id: 'P2', name: 'Carol', token: 'token-carol-xxxxxxxxxxxxxxxxxxxxxx', at: '2026-01-01T00:00:00.000Z' },
    ];
    for (const p of people)
      db.prepare('INSERT INTO players (id, name, avatar, token_hash, created_at) VALUES (?, ?, NULL, ?, ?)').run(p.id, p.name, hashToken(p.token), p.at);
    const [a, b, c] = people;

    const game = db.prepare(
      `INSERT INTO games (code, players, creator, status, state, scores, winner_team, next_code, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const seat = db.prepare('INSERT INTO game_players (game_code, seat, player_id, place, skunk) VALUES (?, ?, ?, ?, ?)');
    // Finished: Alice beat Bob with a skunk (85); Bob beat Alice clean; a three-hander Carol won, Alice double-skunked (58).
    game.run('FINA1', 2, a.id, 'finished', null, '[121,85]', 0, null, '2026-02-01T10:00:00.000Z', '2026-02-01T11:00:00.000Z');
    seat.run('FINA1', 0, a.id, 1, 0); seat.run('FINA1', 1, b.id, 2, 1);
    game.run('FINB2', 2, b.id, 'finished', null, '[121,100]', 0, null, '2026-02-02T10:00:00.000Z', '2026-02-02T11:00:00.000Z');
    seat.run('FINB2', 0, b.id, 1, 0); seat.run('FINB2', 1, a.id, 2, 0);
    game.run('FINC3', 3, c.id, 'finished', null, '[121,58,95]', 0, null, '2026-02-03T10:00:00.000Z', '2026-02-03T11:00:00.000Z');
    seat.run('FINC3', 0, c.id, 1, 0); seat.run('FINC3', 1, a.id, 3, 2); seat.run('FINC3', 2, b.id, 2, 0);
    // In progress, mid-pegging of hand 2, saved without a hand log.
    const live = oldState(5, (s) => s.handNo === 2 && s.phase === 'peg' && s.played.length >= 2);
    game.run('LIVE4', 2, a.id, 'active', JSON.stringify(live), JSON.stringify(live.scores), null, null, '2026-02-04T10:00:00.000Z', null);
    seat.run('LIVE4', 0, a.id, null, 0); seat.run('LIVE4', 1, b.id, null, 0);
    // Waiting for a second player.
    game.run('WAIT5', 2, c.id, 'waiting', null, '[0,0]', null, null, '2026-02-05T10:00:00.000Z', null);
    seat.run('WAIT5', 0, c.id, null, 0);
    db.close();

    const decks = new Decks(77);
    r = await startApp(tmp.dbPath, { shuffle: decks.shuffle });

    // Every old token still signs in; Carol (earliest) is commissioner.
    for (const p of people) {
      const me = await api(r.base, 'GET', '/api/me', { token: p.token });
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ id: p.id, name: p.name, commissioner: p.id === c.id, active: true, avatar: null, deck: null, fourColour: false });
    }
    const check = new Database(tmp.dbPath, { readonly: true });
    expect(check.prepare("SELECT name FROM migrations WHERE name = '0003_league.sql'").get()).toBeTruthy();
    expect(check.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 3 });
    expect(check.prepare('SELECT DISTINCT season_id FROM games').all()).toEqual([{ season_id: 1 }]);
    expect(check.prepare("SELECT last_move_at FROM games WHERE code = 'FINA1'").get()).toEqual({ last_move_at: '2026-02-01T11:00:00.000Z' });
    check.close();
    const seasons = (await api(r.base, 'GET', '/api/seasons', { token: a.token })).body;
    expect(seasons.current).toEqual({ id: 1, name: 'Season 1', startedAt: '2026-02-01T10:00:00.000Z', endedAt: null, current: true });

    // Standings from the old results alone.
    const st = (await api(r.base, 'GET', '/api/standings', { token: b.token })).body as StandingsResponse;
    expect(st.games).toBe(3);
    const row = (id: string) => st.rows.find((x) => x.player.id === id)!;
    expect(row(a.id)).toMatchObject({ played: 3, won: 1, lost: 2, matchPoints: 3, skunksGiven: 1, skunksTaken: 1, doubleSkunksTaken: 1, pointsFor: 121 + 100 + 58, pointsAgainst: 85 + 121 + 121 });
    expect(row(b.id)).toMatchObject({ played: 3, won: 1, lost: 2, matchPoints: 2, skunksTaken: 1, pointsFor: 85 + 121 + 95, pointsAgainst: 121 + 100 + 121 });
    expect(row(c.id)).toMatchObject({ played: 1, won: 1, matchPoints: 4, doubleSkunksGiven: 1, pointsFor: 121, pointsAgainst: 95 });
    expect(st.rows.map((x) => x.player.id)).toEqual([a.id, c.id, b.id].sort((x, y) => row(y).matchPoints - row(x).matchPoints));
    const stats = (await api(r.base, 'GET', `/api/players/${a.id}/stats`, { token: b.token })).body as PlayerStats;
    expect(stats.averages).toMatchObject({ hands: 0, hand: null });
    expect(stats.honours.find((h) => h.kind === 'kiwi')!.count).toBe(1);
    expect((await api(r.base, 'GET', `/api/games/FINA1/hands`, { token: c.token })).body).toMatchObject({ hands: [], firstRecordedHand: null });

    // The live game: no record of the hand it was in, then every hand from the next deal.
    const pend = (await api(r.base, 'GET', '/api/pending', { token: c.token })).body.games;
    expect(pend.map((g: { code: string }) => g.code).sort()).toEqual(['LIVE4', 'WAIT5']);
    expect((await api(r.base, 'GET', '/api/games/LIVE4/hands', { token: a.token })).body.hands).toEqual([]);
    const pa = { id: a.id, name: a.name, token: a.token };
    const pb = { id: b.id, name: b.name, token: b.token };
    const seats = await connectAll(r, 'LIVE4', [pa, pb]);
    expect((seats[0].client.msgs[0] as StateMsg).view).toEqual(JSON.parse(JSON.stringify(viewFor(live, 0))));
    const d = await drive(tmp.dbPath, 'LIVE4', seats, { seed: 9 });
    const hands = (await api(r.base, 'GET', '/api/games/LIVE4/hands', { token: c.token })).body as HandsResponse;
    const obs = observe(d, 2).filter((h) => h.handNo >= 3);
    expect(hands.firstRecordedHand).toBe(3);
    expect(hands.hands.map((h) => h.handNo)).toEqual(obs.map((h) => h.handNo));
    hands.hands.forEach((h, i) => expect(h.shows.filter((s) => s.counted).map((s) => s.total)).toEqual(obs[i].shows.map((s) => s.total)));
    expect(readGame(tmp.dbPath, 'LIVE4').row.status).toBe('finished');
    const st2 = (await api(r.base, 'GET', '/api/standings', { token: b.token })).body as StandingsResponse;
    expect(st2.games).toBe(4);
    const stats2 = (await api(r.base, 'GET', `/api/players/${a.id}/stats`, { token: b.token })).body as PlayerStats;
    expect(stats2.averages.hands).toBe(obs.filter((h) => h.shows.some((s) => s.seat === 0 && !s.crib)).length);

    // The waiting game's link still brings in someone new; old members can invite.
    const dan = await api(r.base, 'POST', '/api/players', { body: { name: 'Dan', code: 'WAIT5' } });
    expect(dan.status).toBe(201);
    expect((await api(r.base, 'POST', '/api/games/WAIT5/join', { token: dan.body.token })).body.seat).toBe(1);
    const invite = await inviteFrom(r.base, b.token);
    expect((await api(r.base, 'POST', '/api/players', { body: { name: 'Erin', invite } })).status).toBe(201);

    // A restart applies nothing twice, and heals rows an older server might
    // have written meanwhile (a game with no season or last-move time).
    for (const s of seats) await s.client.close();
    await r.server.shutdown();
    const old = new Database(tmp.dbPath);
    old.prepare(`INSERT INTO games (code, players, creator, status, state, scores, created_at) VALUES ('OLDGM', 2, ?, 'waiting', NULL, '[0,0]', ?)`).run(a.id, new Date().toISOString());
    old.prepare('INSERT INTO game_players (game_code, seat, player_id) VALUES (?, 0, ?)').run('OLDGM', a.id);
    old.close();
    r = await startApp(tmp.dbPath);
    expect(readGame(tmp.dbPath, 'OLDGM').row).toMatchObject({ season_id: 1, last_move_at: expect.any(String) });
    expect((await api(r.base, 'GET', '/api/pending', { token: a.token })).body.games.find((g: { code: string }) => g.code === 'OLDGM').seasonId).toBe(1);
    expect((await api(r.base, 'GET', '/api/me', { token: a.token })).status).toBe(200);
    expect((await api(r.base, 'GET', '/api/seasons', { token: a.token })).body.seasons).toHaveLength(1);
  }, 60_000);

  it('an empty database: the first player is commissioner of Season 1', async () => {
    r = await startApp(tmp.dbPath);
    const first = await api(r.base, 'POST', '/api/players', { body: { name: 'Solo' } });
    expect((await api(r.base, 'GET', '/api/me', { token: first.body.token })).body.commissioner).toBe(true);
    expect((await api(r.base, 'GET', '/api/seasons', { token: first.body.token })).body.current.id).toBe(1);
  });
});
