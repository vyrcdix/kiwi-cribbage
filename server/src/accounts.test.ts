// Membership, invites, devices (sessions and link codes) and profiles.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Me } from '../../shared/league.js';
import { CODE_ALPHABET } from './random.js';
import { api, Client, inviteFrom, newPlayer, type Player, type Running, startApp, tempDir } from './test-helpers.js';

let tmp: ReturnType<typeof tempDir>;
let r: Running;
let now: number;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  tmp = tempDir();
  now = Date.parse('2026-06-01T12:00:00.000Z');
  r = await startApp(tmp.dbPath, { clock: () => now });
});
afterEach(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

const create = (body: unknown) => api(r.base, 'POST', '/api/players', { body });
const meOf = async (token: string) => (await api(r.base, 'GET', '/api/me', { token })).body as Me;

describe('joining the league', () => {
  it('the first player needs no invite and becomes commissioner; after that an invite or a waiting game is required', async () => {
    const first = await create({ name: 'Alice' });
    expect(first.status).toBe(201);
    expect(await meOf(first.body.token)).toMatchObject({ name: 'Alice', commissioner: true, active: true });

    const refused = await create({ name: 'Bob' });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/invite/i);
    for (const body of [{ name: 'Bob', invite: 'nope' }, { name: 'Bob', code: 'ZZZZZ' }, { name: 'Bob', invite: '' }, { name: 'Bob', code: '' }]) {
      expect((await create(body)).status, JSON.stringify(body)).toBe(403);
    }
    for (const body of [{ name: 'Bob', invite: 42 }, { name: 'Bob', code: ['ABCDE'] }, { name: 'Bob', invite: null }]) {
      expect((await create(body)).status, JSON.stringify(body)).toBe(400);
    }

    // The game invite link: a code of a game waiting for players lets a brand-new person in.
    const game = await api(r.base, 'POST', '/api/games', { token: first.body.token });
    const bob = await create({ name: 'Bob', code: game.body.code.toLowerCase() });
    expect(bob.status).toBe(201);
    expect(await meOf(bob.body.token)).toMatchObject({ name: 'Bob', commissioner: false });
    // …and they can then take their seat.
    expect((await api(r.base, 'POST', `/api/games/${game.body.code}/join`, { token: bob.body.token })).body.seat).toBe(1);
    // Now the game is active: its code no longer admits anyone.
    expect((await create({ name: 'Carol', code: game.body.code })).status).toBe(403);
    // A voided waiting game doesn't either.
    const g2 = await api(r.base, 'POST', '/api/games', { token: first.body.token });
    await api(r.base, 'POST', `/api/commissioner/games/${g2.body.code}/void`, { token: first.body.token });
    expect((await create({ name: 'Carol', code: g2.body.code })).status).toBe(403);
  });

  it('league invites: any member, single use, seven days', async () => {
    const a = await newPlayer(r.base, 'Alice');
    const b = await newPlayer(r.base, 'Bob');
    expect((await api(r.base, 'POST', '/api/invites')).status).toBe(401);
    const inv = await api(r.base, 'POST', '/api/invites', { token: b.token });
    expect(inv.status).toBe(201);
    expect(inv.body.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(inv.body.expiresAt).toBe(new Date(now + 7 * DAY).toISOString());

    const status = await api(r.base, 'GET', `/api/invites/${inv.body.token}`);
    expect(status.body).toEqual({ valid: true, reason: null, invitedBy: { id: b.id, name: 'Bob' }, expiresAt: inv.body.expiresAt });
    expect((await api(r.base, 'GET', '/api/invites/bogus')).body).toEqual({ valid: false, reason: 'unknown', invitedBy: null, expiresAt: null });

    const c = await create({ name: 'Carol', invite: inv.body.token });
    expect(c.status).toBe(201);
    const again = await create({ name: 'Dan', invite: inv.body.token });
    expect(again).toEqual({ status: 403, body: { error: 'That invite link has already been used' } });
    expect((await api(r.base, 'GET', `/api/invites/${inv.body.token}`)).body.reason).toBe('used');

    // Expiry: fine a millisecond before seven days, refused at seven days.
    const late = await inviteFrom(r.base, a.token);
    const later = await inviteFrom(r.base, a.token);
    now += 7 * DAY - 1;
    expect((await create({ name: 'Dan', invite: late })).status).toBe(201);
    now += 1;
    expect(await create({ name: 'Erin', invite: later })).toEqual({ status: 403, body: { error: 'That invite link has expired' } });
    expect((await api(r.base, 'GET', `/api/invites/${later}`)).body.reason).toBe('expired');
  });
});

describe('devices', () => {
  it('a signed-in device gets a ten-minute, one-time code; a new device redeems it for its own token', async () => {
    const a = await newPlayer(r.base, 'Alice');
    expect((await api(r.base, 'POST', '/api/link')).status).toBe(401);
    const link = await api(r.base, 'POST', '/api/link', { token: a.token });
    expect(link.status).toBe(201);
    expect(link.body.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    expect(link.body.expiresAt).toBe(new Date(now + 10 * 60 * 1000).toISOString());

    // Typed sloppily on the phone: lower case, a dash and spaces.
    const typed = ` ${link.body.code.slice(0, 4).toLowerCase()}-${link.body.code.slice(4)} `;
    const phone = await api(r.base, 'POST', '/api/link/redeem', { body: { code: typed } });
    expect(phone.status).toBe(201);
    expect(phone.body).toMatchObject({ id: a.id, name: 'Alice' });
    expect(phone.body.token).not.toBe(a.token);
    expect((await meOf(phone.body.token)).id).toBe(a.id);
    expect((await meOf(a.token)).id).toBe(a.id);
    // Single use.
    expect((await api(r.base, 'POST', '/api/link/redeem', { body: { code: link.body.code } })).status).toBe(403);

    // Expiry at ten minutes.
    const l2 = await api(r.base, 'POST', '/api/link', { token: a.token });
    const l3 = await api(r.base, 'POST', '/api/link', { token: a.token });
    now += 10 * 60 * 1000 - 1;
    expect((await api(r.base, 'POST', '/api/link/redeem', { body: { code: l2.body.code } })).status).toBe(201);
    now += 1;
    expect((await api(r.base, 'POST', '/api/link/redeem', { body: { code: l3.body.code } })).status).toBe(403);

    for (const body of [{}, { code: 12345678 }, { code: null }, []]) {
      expect((await api(r.base, 'POST', '/api/link/redeem', { body })).status, JSON.stringify(body)).toBe(400);
    }
    for (const code of ['', 'ABC', 'x'.repeat(41), 'ZZZZZZZZ', '????????']) {
      expect((await api(r.base, 'POST', '/api/link/redeem', { body: { code } })).status, code).toBe(403);
    }
  });

  it('sessions: list, sign out this device, revoke another; the rest keep working', async () => {
    const a = await newPlayer(r.base, 'Alice');
    const b = await newPlayer(r.base, 'Bob');
    const code = (await api(r.base, 'POST', '/api/link', { token: a.token })).body.code;
    const phone = (await api(r.base, 'POST', '/api/link/redeem', { body: { code } })).body.token as string;
    const code2 = (await api(r.base, 'POST', '/api/link', { token: a.token })).body.code;
    const tablet = (await api(r.base, 'POST', '/api/link/redeem', { body: { code: code2 } })).body.token as string;

    const list = await api(r.base, 'GET', '/api/me/sessions', { token: phone });
    expect(list.body.sessions).toHaveLength(3);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const phoneId = list.body.sessions.find((s: { current: boolean }) => s.current).id as string;

    // Sign out the phone: its token stops working, the laptop's doesn't.
    expect((await api(r.base, 'POST', '/api/me/sign-out', { token: phone })).body).toEqual({ ok: true });
    expect((await api(r.base, 'GET', '/api/me', { token: phone })).status).toBe(401);
    expect((await api(r.base, 'GET', '/api/me', { token: a.token })).status).toBe(200);
    const ws = await Client.open(r.wsUrl);
    ws.send({ t: 'hello', token: phone, code: 'ABCDE' });
    expect(await ws.waitCount(1)).toEqual({ t: 'error', message: 'Not signed in' });

    // Revoke the tablet from the laptop; nobody else can revoke Alice's sessions.
    const left = (await api(r.base, 'GET', '/api/me/sessions', { token: a.token })).body.sessions as { id: string; current: boolean }[];
    expect(left.map((s) => s.id)).not.toContain(phoneId);
    const tabletId = left.find((s) => !s.current)!.id;
    expect((await api(r.base, 'DELETE', `/api/me/sessions/${tabletId}`, { token: b.token })).status).toBe(404);
    expect((await api(r.base, 'GET', '/api/me', { token: tablet })).status).toBe(200);
    expect((await api(r.base, 'DELETE', `/api/me/sessions/${tabletId}`, { token: a.token })).body).toEqual({ ok: true });
    expect((await api(r.base, 'GET', '/api/me', { token: tablet })).status).toBe(401);
    expect((await api(r.base, 'DELETE', `/api/me/sessions/${tabletId}`, { token: a.token })).status).toBe(404);
    expect((await api(r.base, 'DELETE', '/api/me/sessions/..%2F..', { token: a.token })).status).toBe(404);
    expect((await api(r.base, 'POST', '/api/me/sign-out')).status).toBe(401);
  });
});

describe('profile', () => {
  it('PATCH /api/me updates name, avatar, deck and four-colour suits; lists show them', async () => {
    const a = await newPlayer(r.base, 'Alice');
    const b = await newPlayer(r.base, 'Bob');
    const res = await api(r.base, 'PATCH', '/api/me', {
      token: a.token,
      body: { name: '  Ali  ', avatar: { emoji: '🐶', colour: '#AABBCC' }, deck: 'classic', fourColour: true },
    });
    expect(res.status).toBe(200);
    const want = { id: a.id, name: 'Ali', avatar: { emoji: '🐶', colour: '#aabbcc' }, deck: 'classic', fourColour: true, active: true, commissioner: true };
    expect(res.body).toMatchObject(want);
    expect(await meOf(a.token)).toMatchObject(want);
    // Flags and keycaps are emoji too; null clears.
    for (const emoji of ['🇳🇿', '1️⃣', '👩‍👩‍👧', '❤️']) {
      expect((await api(r.base, 'PATCH', '/api/me', { token: b.token, body: { avatar: { emoji, colour: '#123456' } } })).status, emoji).toBe(200);
    }
    expect((await api(r.base, 'PATCH', '/api/me', { token: a.token, body: { avatar: null, deck: null } })).body).toMatchObject({ avatar: null, deck: null, fourColour: true });

    const league = await api(r.base, 'GET', '/api/league', { token: b.token });
    expect(league.body.members.find((m: { id: string }) => m.id === a.id)).toEqual({ ...want, avatar: null, deck: null });
    expect(league.body.commissioner.id).toBe(a.id);

    const bad: unknown[] = [
      {}, { nope: 1 }, { name: '' }, { name: '   ' }, { name: 'x'.repeat(25) }, { name: 42 }, { name: 'a\u0000b' }, { name: 'a\nb' },
      { avatar: '🐶' }, { avatar: { emoji: 'ab', colour: '#123456' } }, { avatar: { emoji: '🐶🐶', colour: '#123456' } },
      { avatar: { emoji: '🐶', colour: 'red' } }, { avatar: { emoji: '🐶', colour: '#12345' } }, { avatar: { emoji: '🐶', colour: '#123456', x: 1 } },
      { avatar: { emoji: 'A', colour: '#123456' } }, { avatar: [] }, { avatar: { emoji: '🐶'.repeat(20), colour: '#123456' } },
      { deck: 'Lily' }, { deck: '' }, { deck: 'x'.repeat(33) }, { deck: 5 }, { deck: '../x' },
      { fourColour: 'yes' }, { fourColour: 1 }, { fourColour: null }, [], [1],
    ];
    for (const body of bad) {
      const res2 = await api(r.base, 'PATCH', '/api/me', { token: b.token, body });
      expect(res2.status, JSON.stringify(body)).toBe(400);
      expect(typeof res2.body.error).toBe('string');
    }
    expect((await api(r.base, 'PATCH', '/api/me', { token: b.token, rawBody: '{bad' })).status).toBe(400);
    expect((await api(r.base, 'PATCH', '/api/me', { body: { name: 'X' } })).status).toBe(401);
    expect((await meOf(b.token)).name).toBe('Bob');
  });
});

describe('deactivated members', () => {
  it('cannot sign in anywhere until reactivated; history is kept', async () => {
    const a = await newPlayer(r.base, 'Alice');
    const b = await newPlayer(r.base, 'Bob');
    const c = await newPlayer(r.base, 'Carol');
    const game = (await api(r.base, 'POST', '/api/games', { token: b.token })).body.code as string;
    const sock = await Client.connect(r.wsUrl, b.token, game);

    expect((await api(r.base, 'POST', `/api/commissioner/players/${b.id}/deactivate`, { token: c.token })).status).toBe(403);
    const off = await api(r.base, 'POST', `/api/commissioner/players/${b.id}/deactivate`, { token: a.token });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ id: b.id, active: false });
    await sock.closed;
    expect(sock.closeCode).toBe(1008);

    const meRes = await api(r.base, 'GET', '/api/me', { token: b.token });
    expect(meRes).toEqual({ status: 401, body: { error: 'Your membership has been deactivated' } });
    expect((await api(r.base, 'POST', '/api/invites', { token: b.token })).status).toBe(401);
    expect((await api(r.base, 'POST', '/api/link', { token: b.token })).status).toBe(401);
    const ws = await Client.open(r.wsUrl);
    ws.send({ t: 'hello', token: b.token, code: game });
    expect(await ws.waitCount(1)).toEqual({ t: 'error', message: 'Your membership has been deactivated' });

    // Still listed (inactive), and their game still exists.
    const league = (await api(r.base, 'GET', '/api/league', { token: a.token })).body;
    expect(league.members.find((m: { id: string }) => m.id === b.id).active).toBe(false);
    expect(league.members[league.members.length - 1].id).toBe(b.id);

    // A link code made before deactivation can't be used either.
    const back = await api(r.base, 'POST', `/api/commissioner/players/${b.id}/reactivate`, { token: a.token });
    expect(back.body.active).toBe(true);
    const code = (await api(r.base, 'POST', '/api/link', { token: b.token })).body.code;
    await api(r.base, 'POST', `/api/commissioner/players/${b.id}/deactivate`, { token: a.token });
    expect((await api(r.base, 'POST', '/api/link/redeem', { body: { code } })).status).toBe(403);
    await api(r.base, 'POST', `/api/commissioner/players/${b.id}/reactivate`, { token: a.token });
    expect((await api(r.base, 'GET', '/api/me', { token: b.token })).status).toBe(200);
    expect((await api(r.base, 'GET', '/api/games', { token: b.token })).body.games.map((g: { code: string }) => g.code)).toEqual([game]);
  });
});

describe('waiting rooms', () => {
  it('the creator removes a seated player; players leave; the last one out deletes the game', async () => {
    const [a, b, c, d] = await Promise.all(['Alice', 'Bob', 'Carol', 'Dave'].map((n) => newPlayer(r.base, n))) as Player[];
    const code = (await api(r.base, 'POST', '/api/games', { token: a.token, body: { players: 4 } })).body.code as string;
    for (const p of [b, c]) await api(r.base, 'POST', `/api/games/${code}/join`, { token: p.token });
    const ca = await Client.connect(r.wsUrl, a.token, code);
    const cb = await Client.connect(r.wsUrl, b.token, code);
    const rm = `/api/games/${code}/remove`;

    expect((await api(r.base, 'POST', rm, { token: b.token, body: { playerId: c.id } })).status).toBe(403);
    expect((await api(r.base, 'POST', rm, { token: a.token, body: { playerId: d.id } })).status).toBe(404);
    expect((await api(r.base, 'POST', rm, { token: a.token, body: { playerId: a.id } })).status).toBe(400);
    for (const body of [{}, { playerId: 5 }, { playerId: '' }, { playerId: 'x'.repeat(65) }, []]) {
      expect((await api(r.base, 'POST', rm, { token: a.token, body })).status, JSON.stringify(body)).toBe(400);
    }
    const n = ca.msgs.length;
    const removed = await api(r.base, 'POST', rm, { token: a.token, body: { playerId: b.id } });
    expect(removed.body).toEqual({ code, deleted: false, seats: [{ id: a.id, name: 'Alice' }, null, { id: c.id, name: 'Carol' }, null], creator: a.id });
    await cb.closed;
    expect(cb.msgs[cb.msgs.length - 1]).toEqual({ t: 'error', message: 'You were removed from this game' });
    const seen = await ca.waitFor((m) => m.t === 'state' && m.players[1] === null, n);
    expect(seen).toBeTruthy();
    // Bob can come back; Dave fills the table later.
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: b.token })).body.seat).toBe(1);

    // The creator leaves: the next seated player takes over.
    const left = await api(r.base, 'POST', `/api/games/${code}/leave`, { token: a.token });
    expect(left.body).toMatchObject({ deleted: false, creator: b.id });
    expect((await api(r.base, 'POST', `/api/games/${code}/leave`, { token: a.token })).status).toBe(403);
    expect((await api(r.base, 'POST', `/api/games/${code}/leave`, { token: c.token })).body).toMatchObject({ deleted: false, creator: b.id, seats: [null, { id: b.id, name: 'Bob' }, null, null] });
    const gone = await api(r.base, 'POST', `/api/games/${code}/leave`, { token: b.token });
    expect(gone.body).toEqual({ code, deleted: true, seats: [], creator: null });
    expect((await api(r.base, 'POST', `/api/games/${code}/join`, { token: d.token })).status).toBe(404);

    // Not once the game has started.
    const g2 = (await api(r.base, 'POST', '/api/games', { token: a.token })).body.code;
    await api(r.base, 'POST', `/api/games/${g2}/join`, { token: d.token });
    expect((await api(r.base, 'POST', `/api/games/${g2}/leave`, { token: d.token })).status).toBe(409);
    expect((await api(r.base, 'POST', `/api/games/${g2}/remove`, { token: a.token, body: { playerId: d.id } })).status).toBe(409);
    expect((await api(r.base, 'POST', '/api/games/ZZZZZ/leave', { token: a.token })).status).toBe(404);
    await ca.close();
  });
});
