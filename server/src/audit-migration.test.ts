// Independent audit of migration 0003: a database frozen at 0001 + 0002 with
// finished, in-progress and waiting games of every size, upgraded by booting
// the app. Nothing may be lost, every old token must work, and the standings
// computed from the migrated rows must equal a hand count of the old records.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAction, type GameState, newGame, type PlayerCount } from '../../shared/game.js';
import type { HandsResponse, PlayerStats, ResultsResponse, StandingsResponse } from '../../shared/league.js';
import { connectAll, drive, lcg, movers, randomPolicy, seededDeck } from './league-helpers.js';
import { hashToken } from './random.js';
import { api, type Player, readGame, type Running, startApp, tempDir } from './test-helpers.js';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const sql = (f: string) => readFileSync(resolve(MIGRATIONS, f), 'utf8');

let tmp: ReturnType<typeof tempDir>;
let r: Running | null = null;
beforeEach(() => { tmp = tempDir(); });
afterEach(async () => {
  await r?.server.shutdown();
  r = null;
  tmp.cleanup();
});

const peopleSpec = [
  // Ann and Ben share a creation time exactly: the earlier row (Ann) must become commissioner.
  { id: 'AAA', name: 'Ann', at: '2025-12-01T00:00:00.000Z' },
  { id: 'BBB', name: 'Ben', at: '2025-12-01T00:00:00.000Z' },
  { id: 'CCC', name: 'Cat', at: '2025-12-02T00:00:00.000Z' },
  { id: 'DDD', name: 'Dan', at: '2025-12-03T00:00:00.000Z' },
  { id: 'EEE', name: 'Eve', at: '2025-12-04T00:00:00.000Z' },
];
const tokenOf = (id: string) => `old-token-${id}-xxxxxxxxxxxxxxxxxxxxxx`;
const ids = Object.fromEntries(peopleSpec.map((p) => [p.name, p.id]));

interface OldFinished { code: string; players: PlayerCount; seats: string[]; scores: number[]; winner: number; at: string }
const skunkOf = (sc: number) => (sc < 61 ? 2 : sc < 91 ? 1 : 0);

/** Games finished before the league existed, in the order they finished. */
const finished: OldFinished[] = [
  { code: 'OLD01', players: 2, seats: ['Ann', 'Ben'], scores: [121, 85], winner: 0, at: '2026-01-01T10:00:00.000Z' },
  { code: 'OLD02', players: 2, seats: ['Ben', 'Ann'], scores: [121, 50], winner: 0, at: '2026-01-02T10:00:00.000Z' },
  { code: 'OLD03', players: 2, seats: ['Cat', 'Dan'], scores: [121, 100], winner: 0, at: '2026-01-03T10:00:00.000Z' },
  { code: 'OLD04', players: 2, seats: ['Dan', 'Cat'], scores: [90, 121], winner: 1, at: '2026-01-04T10:00:00.000Z' },
  { code: 'OLD05', players: 2, seats: ['Ann', 'Eve'], scores: [60, 121], winner: 1, at: '2026-01-05T10:00:00.000Z' },
  { code: 'TRI06', players: 3, seats: ['Ann', 'Ben', 'Cat'], scores: [121, 90, 90], winner: 0, at: '2026-01-06T10:00:00.000Z' },
  { code: 'TRI07', players: 3, seats: ['Dan', 'Eve', 'Ann'], scores: [40, 121, 100], winner: 1, at: '2026-01-07T10:00:00.000Z' },
  { code: 'QUA08', players: 4, seats: ['Ann', 'Ben', 'Cat', 'Dan'], scores: [121, 55], winner: 0, at: '2026-01-08T10:00:00.000Z' },
  { code: 'QUA09', players: 4, seats: ['Eve', 'Ann', 'Dan', 'Ben'], scores: [70, 121], winner: 1, at: '2026-01-09T10:00:00.000Z' },
];

const teamOf = (n: number, seat: number) => (n === 4 ? seat % 2 : seat);
/** A hand count of standings from old records only. */
const expectedRows = (games: OldFinished[]) => {
  const rows = peopleSpec.map((p) => {
    let played = 0, won = 0, mp = 0, sg = 0, st = 0, dsg = 0, dst = 0, pf = 0, pa = 0;
    const results: boolean[] = [];
    for (const g of games) {
      const seat = g.seats.indexOf(p.name);
      if (seat < 0) continue;
      const team = teamOf(g.players, seat);
      const teams = Array.from({ length: g.players === 4 ? 2 : g.players }, (_, t) => t);
      const w = team === g.winner;
      const worst = Math.max(...teams.filter((t) => t !== g.winner).map((t) => skunkOf(g.scores[t])));
      played++;
      results.push(w);
      if (w) { won++; mp += 2 + worst; if (worst >= 1) sg++; if (worst === 2) dsg++; }
      else { if (skunkOf(g.scores[team]) >= 1) st++; if (skunkOf(g.scores[team]) === 2) dst++; }
      pf += g.scores[team];
      pa += Math.max(...teams.filter((t) => t !== team).map((t) => g.scores[t]));
    }
    return { id: p.id, name: p.name, played, won, lost: played - won, matchPoints: mp, winRate: played ? won / played : 0, skunksGiven: sg, skunksTaken: st, doubleSkunksGiven: dsg, doubleSkunksTaken: dst, pointsFor: pf, pointsAgainst: pa, last: results[results.length - 1] };
  });
  rows.sort((a, b) => (b.played > 0 ? 1 : 0) - (a.played > 0 ? 1 : 0) || b.matchPoints - a.matchPoints || b.winRate - a.winRate || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) || a.name.localeCompare(b.name));
  return rows;
};

/** An engine state played randomly until `stop`, as a 0002-era server would have saved it (no hand log). */
const stateAt = (seed: number, players: PlayerCount, stop: (s: GameState) => boolean): GameState => {
  const rand = lcg(seed);
  const shuffle = () => seededDeck(rand);
  let s = newGame(shuffle, 121, players).state;
  while (!stop(s)) {
    const w = movers(s);
    const seat = w[Math.floor(rand() * w.length)];
    s = applyAction(s, seat, randomPolicy(s, seat, rand), shuffle).state;
  }
  const { handLog: _h, ...old } = s;
  return old as GameState;
};

/** The two-player shape before multi-player support: no `players`, one goSaid flag, a scalar skunk. */
const veryOld = (s: GameState): unknown => {
  const { players: _p, goSaid: _g, skunk: _s, ...rest } = s as unknown as Record<string, unknown>;
  return { ...rest, goSaid: false, skunk: 0 };
};

const build = (): { liveStates: Record<string, GameState | unknown> } => {
  const db = new Database(tmp.dbPath);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  // ---- 0001: players and two-player games with p0 / p1 / winner / skunk ----
  db.exec(sql('0001_init.sql'));
  db.prepare('INSERT INTO migrations VALUES (?, ?)').run('0001_init.sql', '2026-01-01T00:00:00.000Z');
  for (const p of peopleSpec) db.prepare('INSERT INTO players (id, name, avatar, token_hash, created_at) VALUES (?, ?, NULL, ?, ?)').run(p.id, p.name, hashToken(tokenOf(p.id)), p.at);
  const old = db.prepare('INSERT INTO games (code, p0, p1, status, state, score0, score1, winner, skunk, next_code, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const g of finished.filter((x) => x.players === 2)) {
    const [a, b] = g.seats.map((n) => ids[n]);
    const loserScore = g.scores[g.winner === 0 ? 1 : 0];
    old.run(g.code, a, b, 'finished', null, g.scores[0], g.scores[1], g.winner === 0 ? a : b, skunkOf(loserScore), null, g.at.replace('T10', 'T09'), g.at);
  }
  // A two-player game in the very old state shape, mid-pegging; one waiting for an opponent.
  const liveOld = stateAt(21, 2, (s) => s.handNo === 2 && s.phase === 'peg' && s.played.length >= 2 && s.goSaid.every((x) => !x));
  old.run('LIVE2', ids.Cat, ids.Eve, 'active', JSON.stringify(veryOld(liveOld)), liveOld.scores[0], liveOld.scores[1], null, 0, null, '2026-02-01T10:00:00.000Z', null);
  old.run('WAIT2', ids.Dan, null, 'waiting', null, 0, 0, null, 0, null, '2026-02-02T10:00:00.000Z', null);
  // ---- 0002 ----
  db.exec(sql('0002_multiplayer.sql'));
  db.prepare('INSERT INTO migrations VALUES (?, ?)').run('0002_multiplayer.sql', '2026-01-02T00:00:00.000Z');
  // ---- games written by a 0002-era server: 3 and 4 players ----
  const ins = db.prepare('INSERT INTO games (code, players, creator, status, state, scores, winner_team, next_code, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const seat = db.prepare('INSERT INTO game_players (game_code, seat, player_id, place, skunk) VALUES (?, ?, ?, ?, ?)');
  for (const g of finished.filter((x) => x.players > 2)) {
    ins.run(g.code, g.players, ids[g.seats[0]], 'finished', null, JSON.stringify(g.scores), g.winner, null, g.at.replace('T10', 'T09'), g.at);
    g.seats.forEach((n, s) => {
      const t = teamOf(g.players, s);
      const place = t === g.winner ? 1 : 1 + g.scores.filter((x, u) => u === g.winner || x > g.scores[t]).length;
      seat.run(g.code, s, ids[n], place, t === g.winner ? 0 : skunkOf(g.scores[t]));
    });
  }
  const live3 = stateAt(22, 3, (s) => s.handNo === 2 && s.phase === 'show');
  const live4 = stateAt(23, 4, (s) => s.handNo === 1 && s.phase === 'peg' && s.played.length >= 5);
  ins.run('LIVE3', 3, ids.Ben, 'active', JSON.stringify(live3), JSON.stringify(live3.scores), null, null, '2026-02-03T10:00:00.000Z', null);
  ['Ben', 'Dan', 'Eve'].forEach((n, s) => seat.run('LIVE3', s, ids[n], null, 0));
  ins.run('LIVE4', 4, ids.Ann, 'active', JSON.stringify(live4), JSON.stringify(live4.scores), null, null, '2026-02-04T10:00:00.000Z', null);
  ['Ann', 'Cat', 'Ben', 'Eve'].forEach((n, s) => seat.run('LIVE4', s, ids[n], null, 0));
  ins.run('WAIT3', 3, ids.Eve, 'waiting', null, '[0,0,0]', null, null, '2026-02-05T10:00:00.000Z', null);
  seat.run('WAIT3', 0, ids.Eve, null, 0);
  ins.run('WAIT4', 4, ids.Cat, 'waiting', null, '[0,0]', null, null, '2026-02-06T10:00:00.000Z', null);
  seat.run('WAIT4', 0, ids.Cat, null, 0);
  seat.run('WAIT4', 1, ids.Dan, null, 0);
  db.close();
  return { liveStates: { LIVE2: liveOld, LIVE3: live3, LIVE4: live4 } };
};

const snapshot = () => {
  const db = new Database(tmp.dbPath, { readonly: true });
  try {
    return {
      players: db.prepare('SELECT id, name, avatar, token_hash, created_at FROM players ORDER BY id').all(),
      games: db.prepare('SELECT code, players, creator, status, state, scores, winner_team, next_code, created_at, finished_at FROM games ORDER BY code').all(),
      seats: db.prepare('SELECT game_code, seat, player_id, place, skunk FROM game_players ORDER BY game_code, seat').all(),
    };
  } finally {
    db.close();
  }
};

const pl = (name: string): Player => ({ id: ids[name], name, token: tokenOf(ids[name]) });

describe('migration 0003 on a populated 0001 + 0002 database', () => {
  it('loses nothing, keeps every token, and the standings equal a hand count of the old records', async () => {
    build();
    const before = snapshot();
    expect(before.games).toHaveLength(finished.length + 6);
    r = await startApp(tmp.dbPath);
    const after = snapshot();
    expect(after).toEqual(before); // every old row, byte for byte (state JSON included)

    // Tokens.
    for (const p of peopleSpec) {
      const me = await api(r.base, 'GET', '/api/me', { token: tokenOf(p.id) });
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ id: p.id, name: p.name, commissioner: p.id === 'AAA', active: true });
    }
    expect((await api(r.base, 'GET', '/api/me', { token: 'old-token-AAA' })).status).toBe(401);
    const db = new Database(tmp.dbPath, { readonly: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 5 });
    expect(db.prepare('SELECT commissioner_id FROM league').get()).toEqual({ commissioner_id: 'AAA' });
    expect(db.prepare('SELECT DISTINCT season_id FROM games').all()).toEqual([{ season_id: 1 }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM games WHERE last_move_at IS NULL").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM hands').get()).toEqual({ n: 0 });
    db.close();

    // Standings, all time and for Season 1 (the same thing), every field.
    const want = expectedRows(finished);
    for (const q of ['', '?season=1', '?season=all']) {
      const st = (await api(r.base, 'GET', '/api/standings' + q, { token: tokenOf('AAA') })).body as StandingsResponse;
      expect(st.games).toBe(finished.length);
      expect(st.rows.map((x) => x.player.id)).toEqual(want.map((w) => w.id));
      st.rows.forEach((row, i) => {
        const w = want[i];
        expect(row, w.name).toMatchObject({
          played: w.played, won: w.won, lost: w.lost, matchPoints: w.matchPoints, winRate: w.winRate, skunksGiven: w.skunksGiven, skunksTaken: w.skunksTaken,
          doubleSkunksGiven: w.doubleSkunksGiven, doubleSkunksTaken: w.doubleSkunksTaken, pointsFor: w.pointsFor, pointsAgainst: w.pointsAgainst,
        });
        if (w.played) expect(row.streak!.result).toBe(w.last ? 'W' : 'L');
      });
    }
    // Results lists every old game, newest first, with the right skunks and seats.
    const res = (await api(r.base, 'GET', '/api/results', { token: tokenOf('BBB') })).body as ResultsResponse;
    expect(res.games.map((g) => g.code)).toEqual([...finished].reverse().map((g) => g.code));
    for (const g of res.games) {
      const o = finished.find((x) => x.code === g.code)!;
      expect(g.scores).toEqual(o.scores);
      expect(g.winnerTeam).toBe(o.winner);
      expect(g.seats.map((p) => p.name)).toEqual(o.seats);
      expect(g.skunk).toEqual(o.scores.map((sc, t) => (t === o.winner ? 0 : skunkOf(sc))));
      expect(g.finishedAt).toBe(o.at);
      expect(g.voided).toBe(false);
    }
    // Old games have no hand records: honest nulls, not zeros.
    const ps = (await api(r.base, 'GET', `/api/players/${ids.Ann}/stats`, { token: tokenOf('CCC') })).body as PlayerStats;
    expect(ps.averages).toEqual({ hand: null, handTotal: 0, hands: 0, crib: null, cribTotal: 0, cribs: 0, pegging: null, peggingTotal: 0, peggingHands: 0 });
    expect(ps.bestHand).toBeNull();
    expect(ps.bestCrib).toBeNull();
    expect(ps.honours.find((h) => h.kind === 'kiwi')!.count).toBe(want.find((w) => w.name === 'Ann')!.skunksTaken);
    expect(ps.honours.find((h) => h.kind === 'twenty-nine')!.count).toBe(0);
    expect(ps.overall.played).toBe(want.find((w) => w.name === 'Ann')!.played);
    for (const g of finished) {
      const h = (await api(r.base, 'GET', `/api/games/${g.code}/hands`, { token: tokenOf('EEE') })).body as HandsResponse;
      expect(h).toMatchObject({ status: 'finished', hands: [], firstRecordedHand: null });
    }
    // The games list shows old games from each player's side, with places and skunk levels.
    const mine = (await api(r.base, 'GET', '/api/games', { token: tokenOf('DDD') })).body.games as { code: string; you: number; place: number | null; skunk: number[]; status: string; voided: boolean; seasonId: number }[];
    for (const g of mine.filter((x) => x.status === 'finished')) {
      const o = finished.find((x) => x.code === g.code)!;
      expect(g.you).toBe(o.seats.indexOf('Dan'));
      expect(g.skunk).toEqual(o.scores.map((sc, t) => (t === o.winner ? 0 : skunkOf(sc))));
      expect(g.voided).toBe(false);
      expect(g.seasonId).toBe(1);
    }
    // Pending: the three live games and three waiting rooms, with their seats.
    const pend = (await api(r.base, 'GET', '/api/pending', { token: tokenOf('AAA') })).body.games as { code: string; status: string; players: number; openSeats: number; seats: ({ name: string } | null)[]; waitingOn: unknown[]; idleSeconds: number }[];
    expect(pend.map((g) => g.code).sort()).toEqual(['LIVE2', 'LIVE3', 'LIVE4', 'WAIT2', 'WAIT3', 'WAIT4']);
    const by = Object.fromEntries(pend.map((g) => [g.code, g]));
    expect(by.WAIT2.seats.map((s) => s?.name ?? null)).toEqual(['Dan', null]);
    expect(by.WAIT3.openSeats).toBe(2);
    expect(by.WAIT4.seats.map((s) => s?.name ?? null)).toEqual(['Cat', 'Dan', null, null]);
    expect(by.LIVE4.seats.map((s) => s!.name)).toEqual(['Ann', 'Cat', 'Ben', 'Eve']);
    for (const c of ['LIVE2', 'LIVE3', 'LIVE4']) { expect(by[c].status).toBe('active'); expect(by[c].waitingOn.length).toBeGreaterThan(0); }
    expect(by.LIVE2.idleSeconds).toBeGreaterThan(0);

    // A restart applies nothing twice.
    await r.server.shutdown();
    r = await startApp(tmp.dbPath);
    expect(snapshot()).toEqual(before);
    expect((await api(r.base, 'GET', '/api/standings', { token: tokenOf('AAA') })).body.games).toBe(finished.length);
  }, 60_000);

  it('the in-progress games (two-player in the oldest shape, three and four players) resume, finish, and join the standings', async () => {
    const { liveStates } = build();
    r = await startApp(tmp.dbPath);
    const played: OldFinished[] = [...finished];
    for (const [code, who] of [['LIVE2', ['Cat', 'Eve']], ['LIVE3', ['Ben', 'Dan', 'Eve']], ['LIVE4', ['Ann', 'Cat', 'Ben', 'Eve']]] as [string, string[]][]) {
      const startHand = (liveStates[code] as GameState).handNo;
      const seats = await connectAll(r, code, who.map(pl));
      // The first view is exactly what the saved state shows (the upgrade did not disturb the game).
      const first = seats[0].client.msgs[0];
      expect(first.t === 'state' && first.view).toBeTruthy();
      if (code !== 'LIVE2' && first.t === 'state') expect(first.view!.scores).toEqual((liveStates[code] as GameState).scores);
      await drive(tmp.dbPath, code, seats, { seed: 40 + startHand });
      for (const s of seats) await s.client.close();
      const g = readGame(tmp.dbPath, code);
      expect(g.row.status).toBe('finished');
      const st = g.state!;
      expect(st.players).toBe(who.length);
      played.push({ code, players: who.length as PlayerCount, seats: who, scores: st.scores, winner: st.winner!, at: g.row.finished_at! });
      // Hands: nothing before the next deal; everything from it, with whole hands only.
      const hands = (await api(r.base, 'GET', `/api/games/${code}/hands`, { token: tokenOf('EEE') })).body as HandsResponse;
      if (hands.hands.length) {
        expect(hands.firstRecordedHand).toBeGreaterThan(startHand);
        expect(hands.hands.map((h) => h.handNo)).toEqual(hands.hands.map((_, i) => hands.firstRecordedHand! + i));
        expect(hands.hands[hands.hands.length - 1].complete).toBe(true);
      } else expect(hands.firstRecordedHand).toBeNull();
    }
    const want = expectedRows(played);
    const st = (await api(r.base, 'GET', '/api/standings', { token: tokenOf('AAA') })).body as StandingsResponse;
    expect(st.games).toBe(played.length);
    expect(st.rows.map((x) => x.player.id)).toEqual(want.map((w) => w.id));
    st.rows.forEach((row, i) => expect(row, want[i].name).toMatchObject({ played: want[i].played, won: want[i].won, matchPoints: want[i].matchPoints, pointsFor: want[i].pointsFor, pointsAgainst: want[i].pointsAgainst }));
    // Hand statistics exist only for hands recorded after migration, and are never negative nonsense.
    const stats = (await api(r.base, 'GET', `/api/players/${ids.Eve}/stats`, { token: tokenOf('AAA') })).body as PlayerStats;
    expect(stats.averages.hands).toBeGreaterThanOrEqual(0);
    if (stats.averages.hands) expect(stats.averages.hand).toBe(stats.averages.handTotal / stats.averages.hands);
    expect((await api(r.base, 'GET', '/api/pending', { token: tokenOf('AAA') })).body.games.map((g: { code: string }) => g.code).sort()).toEqual(['WAIT2', 'WAIT3', 'WAIT4']);
  }, 120_000);

  it('the waiting rooms still fill and start: by login, by signing up through the game link, and in every size', async () => {
    build();
    r = await startApp(tmp.dbPath);
    // WAIT2 (the old p1-NULL row): Eve joins and the game starts with two seated players.
    expect((await api(r.base, 'POST', '/api/games/WAIT2/join', { token: tokenOf('EEE') })).body.seat).toBe(1);
    expect(readGame(tmp.dbPath, 'WAIT2').row.status).toBe('active');
    // WAIT3 gets a brand-new person through the game link and an old member.
    const newbie = await api(r.base, 'POST', '/api/players', { body: { name: 'Fay', code: 'wait3' } });
    expect(newbie.status).toBe(201);
    expect((await api(r.base, 'POST', '/api/games/WAIT3/join', { token: newbie.body.token })).body.seat).toBe(1);
    expect(readGame(tmp.dbPath, 'WAIT3').row.status).toBe('waiting');
    expect((await api(r.base, 'POST', '/api/games/WAIT3/join', { token: tokenOf('AAA') })).body.seat).toBe(2);
    expect(readGame(tmp.dbPath, 'WAIT3').row.status).toBe('active');
    // WAIT4 had two seated; two more start it. The creator (Cat) arranges seats first.
    expect((await api(r.base, 'POST', '/api/games/WAIT4/seats', { token: tokenOf('CCC'), body: { order: [ids.Cat, ids.Dan, null, null] } })).status).toBe(200);
    expect((await api(r.base, 'POST', '/api/games/WAIT4/join', { token: tokenOf('AAA') })).body.seat).toBe(2);
    expect((await api(r.base, 'POST', '/api/games/WAIT4/join', { token: tokenOf('BBB') })).body.seat).toBe(3);
    const w4 = readGame(tmp.dbPath, 'WAIT4');
    expect(w4.row.status).toBe('active');
    expect(w4.state!.players).toBe(4);
    // Everyone's old token still plays; the new game dealt exactly 5 cards each.
    expect(w4.state!.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
    // A league invite works from an old member, and the commissioner (earliest row) can use the tools.
    const inv = await api(r.base, 'POST', '/api/invites', { token: tokenOf('DDD') });
    expect((await api(r.base, 'POST', '/api/players', { body: { name: 'Gus', invite: inv.body.token } })).status).toBe(201);
    expect((await api(r.base, 'POST', '/api/commissioner/seasons', { token: tokenOf('AAA'), body: { name: 'Autumn' } })).status).toBe(201);
    expect((await api(r.base, 'POST', '/api/commissioner/seasons', { token: tokenOf('BBB'), body: { name: 'Nope' } })).status).toBe(403);
    // Old finished games stay in Season 1 and out of the new season's standings.
    const s2 = (await api(r.base, 'GET', '/api/standings', { token: tokenOf('AAA') })).body as StandingsResponse;
    expect(s2.games).toBe(0);
    const s1 = (await api(r.base, 'GET', '/api/standings?season=1', { token: tokenOf('AAA') })).body as StandingsResponse;
    expect(s1.games).toBe(finished.length);
  }, 60_000);

  it('migrating an empty 0001 + 0002 database, and one with players but no games', async () => {
    const db = new Database(tmp.dbPath);
    db.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const f of ['0001_init.sql', '0002_multiplayer.sql']) {
      db.exec(sql(f));
      db.prepare('INSERT INTO migrations VALUES (?, ?)').run(f, '2026-01-01T00:00:00.000Z');
    }
    for (const p of peopleSpec.slice(0, 2)) db.prepare('INSERT INTO players (id, name, avatar, token_hash, created_at) VALUES (?, ?, NULL, ?, ?)').run(p.id, p.name, hashToken(tokenOf(p.id)), p.at);
    db.close();
    r = await startApp(tmp.dbPath);
    expect((await api(r.base, 'GET', '/api/seasons', { token: tokenOf('AAA') })).body.current).toMatchObject({ id: 1, name: 'Season 1', startedAt: '2025-12-01T00:00:00.000Z' }); // from the earliest player
    expect((await api(r.base, 'GET', '/api/standings', { token: tokenOf('BBB') })).body).toMatchObject({ games: 0 });
    const st = (await api(r.base, 'GET', '/api/standings', { token: tokenOf('BBB') })).body as StandingsResponse;
    expect(st.rows.map((x) => x.rank)).toEqual([1, 1]); // nobody has played: equal, so equal rank
    expect(st.rows.every((x) => x.played === 0 && x.streak === null && x.winRate === 0)).toBe(true);
  });
});
