// Presence: "consider" from one player becomes "presence" for everyone else at
// the table, as a scrambled slot that gives nothing away about the card.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '../../shared/game.js';
import { Client, legalMove, playUntil, readGame, type Running, setupGame, setupTable, sleep, startApp, tempDir } from './test-helpers.js';

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

type Presence = Extract<ServerMsg, { t: 'presence' }>;
const presences = (c: Client, from = 0) => c.msgs.slice(from).filter((m): m is Presence => m.t === 'presence');
const nextPresence = async (c: Client, from: number) => (await c.waitFor((m) => m.t === 'presence', from)) as Presence;

describe('presence', () => {
  it('reaches the other player, not the sender, and leaves the game untouched', async () => {
    const { code, ca, cb } = await setupGame(r);
    const before = readGame(tmp.dbPath, code).row.state;
    const hand = ca.lastState.view!.hand;
    const na = ca.msgs.length;
    const nb = cb.msgs.length;

    ca.send({ t: 'consider', card: hand[2] });
    const p = await nextPresence(cb, nb);
    expect(p.seat).toBe(ca.lastState.you);
    expect(Number.isInteger(p.slot)).toBe(true);
    expect(p.slot).toBeGreaterThanOrEqual(0);
    expect(p.slot).toBeLessThan(hand.length);
    expect(Object.keys(p).sort()).toEqual(['seat', 'slot', 't']);

    ca.send({ t: 'consider', card: null });
    await cb.waitFor((m) => m.t === 'presence' && m.slot === null, nb + 1);
    await sleep(30);
    expect(ca.msgs.length).toBe(na);
    expect(cb.msgs.length).toBe(nb + 2);
    expect(readGame(tmp.dbPath, code).row.state).toBe(before);
  });

  it('gives each held card its own slot, the same every time, and not in hand order', async () => {
    // Hands are held sorted; if slots followed that order the lift would hint at rank.
    // Over several tables, at least one scramble must differ from the identity.
    let scrambled = false;
    for (let round = 0; round < 4 && !scrambled; round++) {
      const { ca, cb } = await setupGame(r);
      const hand = ca.lastState.view!.hand;
      const slots: number[] = [];
      for (const card of hand) {
        const n = cb.msgs.length;
        ca.send({ t: 'consider', card });
        slots.push((await nextPresence(cb, n)).slot!);
        await sleep(130);
      }
      expect([...slots].sort((x, y) => x - y)).toEqual(hand.map((_, i) => i));
      // Asking again about the first card gives the same slot.
      const n = cb.msgs.length;
      ca.send({ t: 'consider', card: hand[0] });
      expect((await nextPresence(cb, n)).slot).toBe(slots[0]);
      if (slots.some((s, i) => s !== i)) scrambled = true;
      await Promise.all([ca.close(), cb.close()]);
    }
    expect(scrambled).toBe(true);
  });

  it('treats a card you do not hold, or a discard already made, as none', async () => {
    const { ca, cb, seats } = await setupGame(r);
    const mine = ca.lastState.view!.hand;
    const theirs = cb.lastState.view!.hand;
    const nb = cb.msgs.length;
    const na = ca.msgs.length;

    // Not in your hand: nothing to relay (it was already "none"), and no error.
    ca.send({ t: 'consider', card: theirs.find((c) => !mine.includes(c))! });
    await sleep(60);
    expect(presences(cb, nb)).toEqual([]);
    expect(ca.msgs.length).toBe(na);

    // Lift a card, then discard: once the discard is in, considering means none.
    ca.send({ t: 'consider', card: mine[0] });
    expect((await nextPresence(cb, nb)).slot).not.toBeNull();
    ca.send({ t: 'act', action: legalMove(ca.lastState.view)! });
    await ca.waitFor((m) => m.t === 'state' && m.view!.discarded[m.you], na);
    const n2 = cb.msgs.length;
    await sleep(150);
    ca.send({ t: 'consider', card: ca.lastState.view!.hand[0] });
    expect((await nextPresence(cb, n2)).slot).toBeNull();
    void seats;
  });

  it('works while pegging and never names a card', async () => {
    const { ca, cb, seats } = await setupGame(r);
    await playUntil(seats, (m) => m.view?.phase === 'peg');
    const hand = cb.lastState.view!.hand;
    const n = ca.msgs.length;
    cb.send({ t: 'consider', card: hand[hand.length - 1] });
    const p = await nextPresence(ca, n);
    expect(p.seat).toBe(cb.lastState.you);
    expect(p.slot).toBeLessThan(hand.length);
    expect(ca.raw.slice(n).filter((t) => t.includes('"presence"')).every((t) => !t.includes('card'))).toBe(true);
  });

  it('goes to every other seat at a bigger table, and clears when the socket closes', async () => {
    const { clients } = await setupTable(r, 4);
    const [c0, c1, c2, c3] = clients;
    const counts = clients.map((c) => c.msgs.length);
    c2.send({ t: 'consider', card: c2.lastState.view!.hand[1] });
    for (const c of [c0, c1, c3]) {
      const p = await nextPresence(c, counts[clients.indexOf(c)]);
      expect(p.seat).toBe(2);
      expect(p.slot).not.toBeNull();
    }
    await sleep(30);
    expect(presences(c2, counts[2])).toEqual([]);

    await c2.close();
    for (const c of [c0, c1, c3]) {
      await c.waitFor((m) => m.t === 'presence' && m.seat === 2 && m.slot === null, counts[clients.indexOf(c)]);
    }
  });

  it('rejects junk, and quietly drops a flood without hanging up', async () => {
    const { ca, cb } = await setupGame(r);
    for (const card of [52, -1, 1.5, '3', {}, undefined]) {
      const n = ca.msgs.length;
      ca.send({ t: 'consider', card });
      expect(await ca.waitCount(n + 1)).toEqual({ t: 'error', message: 'Malformed message' });
    }
    const hand = ca.lastState.view!.hand;
    const na = ca.msgs.length;
    const nb = cb.msgs.length;
    for (let i = 0; i < 200; i++) ca.send({ t: 'consider', card: hand[i % hand.length] });
    await sleep(150);
    const got = presences(cb, nb).length;
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThanOrEqual(12);
    expect(ca.msgs.length).toBe(na);
    expect(ca.closeCode).toBeNull();
    // Still playable afterwards.
    ca.send({ t: 'act', action: legalMove(ca.lastState.view)! });
    await ca.waitFor((m) => m.t === 'state', na);
  });
});
