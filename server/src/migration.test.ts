// Data written before multi-player support keeps working: a database at
// migration 0001 (games.p0/p1, scalar scores, old-shape state JSON) is migrated
// on startup and its games can still be listed, opened and finished.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fullDeck, value } from '../../shared/cards.js';
import { applyAction, type GameState, newGame, viewFor } from '../../shared/game.js';
import { hashToken } from './random.js';
import { nowIso } from './time.js';
import { upgradeState } from './store.js';
import { api, bothOnline, Client, playToEnd, readGame, type Running, startApp, type StateMsg, tempDir } from './test-helpers.js';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const shuffler = (rand: () => number) => () => {
  const d = fullDeck();
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

/** What the pre-multi-player engine stored for the same two-player state. */
const toLegacy = (s: GameState): Record<string, unknown> => {
  const { players: _p, goSaid, skunk, ...rest } = s;
  return { ...rest, goSaid: goSaid.some(Boolean), skunk: s.winner === null ? 0 : skunk[1 - s.winner] };
};

/** Random two-player play, yielding every state along the way. */
function* playthrough(seed: number): Generator<GameState> {
  const rand = rng(seed);
  const shuffle = shuffler(rand);
  let { state } = newGame(shuffle);
  yield state;
  while (state.phase !== 'over') {
    let done = false;
    for (const seat of [0, 1]) {
      const h = state.hands[seat];
      let action = null;
      if (state.phase === 'discard' && h.length === 6) action = { t: 'discard' as const, cards: [h[0], h[5]] };
      else if (state.phase === 'cut' && seat !== state.dealer) action = { t: 'cut' as const };
      else if (state.phase === 'peg' && state.turn === seat) action = { t: 'play' as const, card: h.find((x) => state.count + value(x) <= 31)! };
      else if (state.phase === 'show' && !state.acks[seat]) action = { t: 'ack' as const };
      if (action) {
        state = applyAction(state, seat, action, shuffle).state;
        done = true;
        break;
      }
    }
    if (!done) throw new Error('stuck');
    yield state;
  }
}

describe('upgradeState', () => {
  it('turns every legacy two-player state back into exactly the current state', () => {
    let withGo = 0;
    for (let g = 0; g < 30; g++) {
      for (const s of playthrough(g + 1)) {
        if (s.goSaid.some(Boolean)) withGo++;
        expect(upgradeState(JSON.parse(JSON.stringify(toLegacy(s))))).toEqual(s);
      }
    }
    expect(withGo).toBeGreaterThan(20);
  });
});

describe('migration 0002 on existing data', () => {
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

  it('carries over seats, scores, results and in-progress games', async () => {
    // A database exactly as the two-player release left it.
    const db = new Database(tmp.dbPath);
    db.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.exec(readFileSync(resolve(MIGRATIONS, '0001_init.sql'), 'utf8'));
    db.prepare('INSERT INTO migrations VALUES (?, ?)').run('0001_init.sql', nowIso());
    const people = ['Alice', 'Bob', 'Carol'].map((name, i) => ({ id: `P${i}`, name, token: `token-${name}-xxxxxxxxxxxxxxxx` }));
    for (const p of people)
      db.prepare('INSERT INTO players (id, name, avatar, token_hash, created_at) VALUES (?, ?, NULL, ?, ?)').run(p.id, p.name, hashToken(p.token), nowIso());
    const [a, b, c] = people;

    // An in-progress game, paused mid-count with a go said if we can find one.
    let live: GameState | null = null;
    for (const s of playthrough(99)) {
      if (s.phase === 'peg' && s.goSaid.some(Boolean)) { live = s; break; }
    }
    expect(live).not.toBeNull();
    const ins = db.prepare(
      `INSERT INTO games (code, p0, p1, status, state, score0, score1, winner, skunk, next_code, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run('WAITS', c.id, null, 'waiting', null, 0, 0, null, 0, null, '2026-01-01T00:00:00.000Z', null);
    ins.run('LIVES', a.id, b.id, 'active', JSON.stringify(toLegacy(live!)), live!.scores[0], live!.scores[1], null, 0, null, '2026-01-02T00:00:00.000Z', null);
    ins.run('ENDED', a.id, b.id, 'finished', null, 80, 121, b.id, 1, 'LIVES', '2026-01-03T00:00:00.000Z', '2026-01-03T01:00:00.000Z');
    db.close();

    r = await startApp(tmp.dbPath);

    const waits = readGame(tmp.dbPath, 'WAITS');
    expect(waits.row).toMatchObject({ players: 2, creator: c.id, status: 'waiting', scores: '[0,0]', winner_team: null });
    expect(waits.seats).toEqual([c.id, null]);
    const ended = readGame(tmp.dbPath, 'ENDED');
    expect(ended.row).toMatchObject({ players: 2, creator: a.id, status: 'finished', scores: '[80,121]', winner_team: 1, next_code: 'LIVES' });
    expect(ended.seatRows.map((x) => [x.seat, x.player_id, x.place, x.skunk])).toEqual([[0, a.id, 2, 1], [1, b.id, 1, 0]]);

    const list = await api(r.base, 'GET', '/api/games', { token: a.token });
    expect(list.body.games.map((g: { code: string }) => g.code)).toEqual(['ENDED', 'LIVES']);
    expect(list.body.games[0]).toMatchObject({
      status: 'finished', players: 2, you: 0, creator: true, opponents: [{ id: b.id, name: 'Bob' }],
      scores: [80, 121], winner: 1, skunk: [1, 0], place: 2,
    });
    expect(list.body.games[1]).toMatchObject({ status: 'active', you: 0, scores: live!.scores, winner: null, place: null });

    // Carol's waiting game can still be joined.
    const joined = await api(r.base, 'POST', '/api/games/WAITS/join', { token: a.token });
    expect(joined.body).toEqual({ code: 'WAITS', seat: 1 });
    expect(readGame(tmp.dbPath, 'WAITS').row.status).toBe('active');

    // The paused game resumes exactly where it was and plays to the end.
    const ca = await Client.connect(r.wsUrl, a.token, 'LIVES');
    const cb = await Client.connect(r.wsUrl, b.token, 'LIVES');
    expect((ca.msgs[0] as StateMsg).view).toEqual(JSON.parse(JSON.stringify(viewFor(live!, 0))));
    await bothOnline([ca, cb]);
    await playToEnd([{ player: { ...a }, client: ca }, { player: { ...b }, client: cb }]);
    const done = readGame(tmp.dbPath, 'LIVES');
    expect(done.row.status).toBe('finished');
    expect(done.state!.players).toBe(2);
    expect(done.seatRows.map((x) => x.place).sort()).toEqual([1, 2]);
  }, 60_000);
});
