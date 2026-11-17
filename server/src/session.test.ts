import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bothOnline,
  Client,
  playToEnd,
  playUntil,
  readGame,
  rowScores,
  type Running,
  type Seated,
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

describe('persistence', () => {
  it('resumes a game exactly after the server restarts on the same DB', async () => {
    const { a, b, code, ca, cb, seats } = await setupGame(r);
    await playUntil(seats, (m) => m.view!.handNo >= 2 && m.view!.phase === 'peg' && m.view!.played.length >= 1);
    const beforeA = ca.lastState.view;
    const beforeB = cb.lastState.view;
    const beforeRow = readGame(tmp.dbPath, code).row;
    expect(beforeRow.status).toBe('active');

    await ca.close();
    await cb.close();
    await r.server.shutdown();

    // A brand-new app process-equivalent on the same file.
    r = await startApp(tmp.dbPath);
    const ca2 = await Client.connect(r.wsUrl, a.token, code);
    const first = ca2.msgs[0] as StateMsg;
    expect(first).toMatchObject({ t: 'state', status: 'active', you: 0, events: [], online: [true, false] });
    expect(first.view).toEqual(beforeA);
    const cb2 = await Client.connect(r.wsUrl, b.token, code);
    expect((cb2.msgs[0] as StateMsg).view).toEqual(beforeB);
    await bothOnline([ca2, cb2]);
    expect(readGame(tmp.dbPath, code).row.state).toBe(beforeRow.state);

    const seats2: [Seated, Seated] = [
      { player: a, client: ca2 },
      { player: b, client: cb2 },
    ];
    await playToEnd(seats2);
    expect(ca2.lastState.status).toBe('finished');
    const { row } = readGame(tmp.dbPath, code);
    expect(row.status).toBe('finished');
    const w = ca2.lastState.view!.winner!;
    expect(row.winner_team).toBe(w);
    expect(rowScores(row)).toEqual(cb2.lastState.view!.scores);
    expect(readGame(tmp.dbPath, code).seatRows.map((sr) => [sr.player_id, sr.place])).toEqual([
      [a.id, w === 0 ? 1 : 2],
      [b.id, w === 1 ? 1 : 2],
    ]);
  }, 60_000);

  it('keeps score columns current on every action', async () => {
    const { code, ca, seats } = await setupGame(r);
    for (let i = 0; i < 60; i++) {
      await step(seats);
      const { row } = readGame(tmp.dbPath, code);
      expect(rowScores(row)).toEqual(ca.lastState.view!.scores);
    }
  }, 60_000);
});

describe('reconnect and presence', () => {
  it('a player who drops mid-hand gets the current state back and can continue', async () => {
    const { a, b, code, ca, cb, seats } = await setupGame(r);
    await playUntil(seats, (m) => m.view!.phase === 'peg' && m.view!.played.length >= 2);
    const before = cb.lastState.view;

    // B drops; A sees the presence dot go out.
    let n = ca.msgs.length;
    await cb.close();
    const gone = (await ca.waitFor((m) => m.t === 'state', n)) as StateMsg;
    expect(gone.online).toEqual([true, false]);
    expect(gone.events).toEqual([]);

    // B comes back and sees exactly where things stood.
    n = ca.msgs.length;
    const cb2 = await Client.connect(r.wsUrl, b.token, code.toLowerCase());
    const back = cb2.msgs[0] as StateMsg;
    expect(back).toMatchObject({ t: 'state', code, you: 1, events: [], online: [true, true] });
    expect(back.view).toEqual(before);
    const lit = (await ca.waitFor((m) => m.t === 'state', n)) as StateMsg;
    expect(lit.online).toEqual([true, true]);

    // A second socket for B (another tab): both of B's sockets get every update.
    const cb3 = await Client.connect(r.wsUrl, b.token, code);
    await bothOnline([ca, cb2, cb3]);
    const seats2: [Seated, Seated] = [seats[0], { player: b, client: cb2 }];
    const n3 = cb3.msgs.length;
    await step(seats2);
    await cb3.waitCount(n3 + 1);
    expect((cb3.last as StateMsg).view).toEqual(cb2.lastState.view);

    // Closing one of B's tabs keeps B online.
    n = ca.msgs.length;
    await cb3.close();
    const still = (await ca.waitFor((m) => m.t === 'state', n)) as StateMsg;
    expect(still.online).toEqual([true, true]);
    await bothOnline([ca, cb2]);

    await playToEnd(seats2);
    expect(ca.lastState.status).toBe('finished');
    const after = readGame(tmp.dbPath, code);
    expect(after.row.winner_team).toBe(ca.lastState.view!.winner);
    expect(after.seats).toEqual([a.id, b.id]);
  }, 60_000);

  it('terminates sockets that stop answering pings, and unauthenticated idlers', async () => {
    await r.server.shutdown();
    r = await startApp(tmp.dbPath, { pingIntervalMs: 50, helloTimeoutMs: 150 });
    const { ca, cb } = await setupGame(r);

    // Freeze B's socket so it can't pong; the server should cut it off and tell A.
    const n = ca.msgs.length;
    (cb.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    const dropped = (await ca.waitFor((m) => m.t === 'state' && !m.online[1], n, 3000)) as StateMsg;
    expect(dropped.online).toEqual([true, false]);
    // A answers pings automatically and stays connected.
    await sleep(200);
    expect(ca.closeCode).toBeNull();

    const idle = await Client.open(r.wsUrl);
    expect((await idle.waitCount(1, 3000))).toEqual({ t: 'error', message: 'Expected hello' });
    await idle.closed;
  });
});
