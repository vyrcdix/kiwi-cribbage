// Regression tests for the fixes made after the independent audit (the audit-*
// files pin the reported bugs; these cover the rest of each fix and the
// "surprising" behaviours that were changed).
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { card, sortHand } from '../../shared/cards.js';
import { isAvatar, isSingleEmoji, type InviteStatus, type PlayerStats } from '../../shared/league.js';
import { connectAll, drive, fixtureGame, lcg, randomPolicy } from './league-helpers.js';
import { clientKey } from './ratelimit.js';
import { best, type HandRec, honourOccurrences } from './stats.js';
import { parseAvatar } from './store.js';
import { api, Client, inviteFrom, newPlayer, type Player, readGame, type Running, startApp, tempDir } from './test-helpers.js';

let tmp: ReturnType<typeof tempDir>;
let r: Running;
const P: Record<string, Player> = {};

beforeAll(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath);
  for (const n of ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay']) P[n] = await newPlayer(r.base, n);
}, 30_000);
afterAll(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

const call = (m: string, p: string, token?: string, body?: unknown) => api(r.base, m, p, { token, body: m === 'GET' ? undefined : body });
const join = async (name: unknown) => call('POST', '/api/players', undefined, { name, invite: await inviteFrom(r.base, P.Ann.token) });
const newDevice = async (p: Player): Promise<Player> =>
  (await call('POST', '/api/link/redeem', undefined, { code: (await call('POST', '/api/link', p.token)).body.code })).body as Player;
const currentSession = async (token: string): Promise<string> =>
  ((await call('GET', '/api/me/sessions', token)).body.sessions as { id: string; current: boolean }[]).find((s) => s.current)!.id;

// ------------------------------------------------------------------ 1. sorted cards, old rows included

describe('stored hands and cribs come back sorted', () => {
  const C = (rk: number, s: number) => card(rk, s);
  const row = (over: Partial<HandRec>): HandRec => ({
    game_code: 'AAAAA', hand_no: 1, seat: 0, player_id: 'p', is_dealer: 1, hand_points: 4, hand_cards: '[]',
    crib_points: 29, crib_cards: null, starter: C(4, 3), peg_points: 0, pegged_out: 1, heels: 0, finished_at: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('a row stored unsorted (before the fix) is sorted on the way out', () => {
    // As an older server stored a three-player crib: the deck card first, then the discards by seat.
    const crib = [C(12, 1), C(4, 0), C(10, 0), C(4, 1)];
    const kept = [C(9, 2), C(0, 3), C(5, 1), C(2, 0)];
    expect(crib).not.toEqual(sortHand(crib));
    expect(kept).not.toEqual(sortHand(kept));
    const h = row({ hand_cards: JSON.stringify(kept), crib_cards: JSON.stringify(crib) });
    expect(best([h], true)!.cards).toEqual(sortHand(crib));
    expect(best([h], false)!.cards).toEqual(sortHand(kept));
    const occ = honourOccurrences([], [h], 'p')['twenty-nine'];
    expect(occ).toHaveLength(1);
    expect(occ[0].cards).toEqual(sortHand(crib));
  });

  it('new records store the crib sorted', async () => {
    const { code } = await fixtureGame(r, P.Eve, [P.Fay]);
    const seats = await connectAll(r, code, [P.Eve, P.Fay]);
    await drive(tmp.dbPath, code, seats, { seed: 5, until: (s) => s.handNo >= 2 });
    for (const s of seats) await s.client.close();
    const db = new Database(tmp.dbPath, { readonly: true });
    try {
      const rows = db.prepare('SELECT hand_cards, crib_cards FROM hand_seats WHERE game_code = ?').all(code) as { hand_cards: string; crib_cards: string | null }[];
      expect(rows.length).toBeGreaterThan(0);
      for (const x of rows) {
        expect(JSON.parse(x.hand_cards)).toEqual(sortHand(JSON.parse(x.hand_cards)));
        if (x.crib_cards) expect(JSON.parse(x.crib_cards)).toEqual(sortHand(JSON.parse(x.crib_cards)));
      }
    } finally {
      db.close();
    }
    await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token);
  }, 30_000);
});

// ------------------------------------------------------------------ 2. sessions and open sockets

describe('signing a device out ends its sockets, and only its sockets', () => {
  const moveFrom = async (c: Client, code: string, seat: number) => {
    const S = readGame(tmp.dbPath, code).state!;
    const n = c.msgs.length;
    c.send({ t: 'act', action: randomPolicy(S, seat, lcg(3)) });
    return c.waitCount(n + 1);
  };

  for (const how of ['revoke', 'sign-out'] as const) {
    it(`${how}: that device is hung up and refused; the player's other device plays on`, async () => {
      const { code } = await fixtureGame(r, P.Ben, [P.Cat]);
      const phone = await newDevice(P.Ben);
      const seats = await connectAll(r, code, [P.Ben, P.Cat]);
      const lost = await Client.connect(r.wsUrl, phone.token, code);
      if (how === 'revoke') expect((await call('DELETE', `/api/me/sessions/${await currentSession(phone.token)}`, P.Ben.token)).status).toBe(200);
      else expect((await call('POST', '/api/me/sign-out', phone.token)).status).toBe(200);
      await lost.closed;
      expect(lost.closeCode).toBe(1008);
      expect(lost.msgs.some((m) => m.t === 'error')).toBe(true);
      // Ben's other device and Cat are still connected and Ben can still move.
      expect(seats[0].client.closeCode).toBeNull();
      expect(seats[1].client.closeCode).toBeNull();
      const reply = await moveFrom(seats[0].client, code, 0);
      expect(reply.t).toBe('state');
      for (const s of seats) await s.client.close();
      await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token);
    });
  }

  it('a socket whose session disappears behind the hub\'s back cannot move either', async () => {
    const { code } = await fixtureGame(r, P.Ben, [P.Cat]);
    const phone = await newDevice(P.Ben);
    const seats = await connectAll(r, code, [phone, P.Cat]);
    const sid = await currentSession(phone.token);
    const db = new Database(tmp.dbPath);
    try {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    } finally {
      db.close();
    }
    const before = readGame(tmp.dbPath, code).state!;
    const reply = await moveFrom(seats[0].client, code, 0);
    expect(reply).toMatchObject({ t: 'error', message: 'Not signed in' });
    await seats[0].client.closed;
    expect(readGame(tmp.dbPath, code).state).toEqual(before);
    await seats[1].client.close();
    await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token);
  });

  it('deactivation hangs up every device of that member and nobody else', async () => {
    const { code } = await fixtureGame(r, P.Dan, [P.Cat]);
    const phone = await newDevice(P.Dan);
    const seats = await connectAll(r, code, [P.Dan, P.Cat]);
    const second = await Client.connect(r.wsUrl, phone.token, code);
    expect((await call('POST', `/api/commissioner/players/${P.Dan.id}/deactivate`, P.Ann.token)).status).toBe(200);
    await seats[0].client.closed;
    await second.closed;
    expect(seats[1].client.closeCode).toBeNull();
    await seats[1].client.close();
    expect((await call('POST', `/api/commissioner/players/${P.Dan.id}/reactivate`, P.Ann.token)).status).toBe(200);
    await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token);
  });
});

// ------------------------------------------------------------------ 3, 4. names

describe('names and other free text', () => {
  it('refuses invisible-only names, bidirectional controls and lone surrogates (400)', async () => {
    const refused = [
      '­', '️', '́', 'ᅟ', 'ﾠ', 'ㅤㅤ', '⠀', '​‌‍', '⁠', '\u{E0041}', '͏',
      'Ann‮', '‮nna', 'a‪b', 'a‭b', 'a⁦b⁩', 'a⁧b', 'a⁨b',
      'Bad\ud800Name', 'Bad\udc00Name', '\ud83d', 'x\ude00',
    ];
    for (const name of refused) expect((await join(name)).status, JSON.stringify(name)).toBe(400);
    expect((await call('PATCH', '/api/me', P.Eve.token, { name: '​' })).status).toBe(400);
    expect((await call('PATCH', '/api/me', P.Eve.token, { name: 'Eve‮' })).status).toBe(400);
    expect((await call('GET', '/api/me', P.Eve.token)).body.name).toBe('Eve');
  });

  it('still accepts names with something visible in them', async () => {
    for (const name of ['Zoë', 'Zoë', '\u{1F468}‍\u{1F469}‍\u{1F467}', 'a​b', 'שרה', 'مريم', 'J‏o', '\u{1F600}']) {
      const res = await join(name);
      expect(res.status, JSON.stringify(name)).toBe(201);
      expect(res.body.name).toBe(name);
    }
  });

  it('season names follow the same rules', async () => {
    for (const name of ['​', '⠀', 'S‮']) expect((await call('POST', '/api/commissioner/seasons', P.Ann.token, { name })).status).toBe(400);
  });
});

// ------------------------------------------------------------------ 6. avatars

describe('an avatar is one genuine emoji', () => {
  const ACCEPTED = [
    '\u{1F600}', '\u{1F44D}\u{1F3FD}', '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}', '\u{1F3F3}️‍\u{1F308}',
    '\u{1F1F3}\u{1F1FF}', '1️⃣', '#️⃣', '❤️', '\u{1F9D1}\u{1F3FD}‍\u{1F9B0}', '⚽',
    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', // England
    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', // Scotland
  ];
  const REFUSED = [
    '\u{1F600}\u{E0041}\u{E0042}\u{E0043}', '\u{1F600}\u{E007F}', '\u{1F3F4}\u{E0041}\u{E0042}\u{E007F}', // tag payloads
    '©', '©️', '®️', '™', '™️', // text symbols
    '❤', '\u{1F600}︎', '\u{1F600}‍', '\u{1F600}́', '\u{1F600}​', '\u{1F1F3}', '5', '5️', 'a', '',
    '\u{1F600}\u{1F600}',
  ];

  it('the check itself', () => {
    for (const e of ACCEPTED) expect(isSingleEmoji(e), JSON.stringify(e)).toBe(true);
    for (const e of REFUSED) expect(isSingleEmoji(e), JSON.stringify(e)).toBe(false);
  });

  it('PATCH /api/me accepts and refuses accordingly', async () => {
    for (const emoji of ACCEPTED) {
      const res = await call('PATCH', '/api/me', P.Fay.token, { avatar: { emoji, colour: '#123456' } });
      expect(res.status, JSON.stringify(emoji)).toBe(200);
      expect(res.body.avatar).toEqual({ emoji, colour: '#123456' });
    }
    for (const emoji of REFUSED) expect((await call('PATCH', '/api/me', P.Fay.token, { avatar: { emoji, colour: '#123456' } })).status, JSON.stringify(emoji)).toBe(400);
  });

  it('an avatar stored before the check was tightened, with a hidden payload, reads as none', () => {
    const stored = JSON.stringify({ emoji: '\u{1F600}\u{E0041}\u{E0042}', colour: '#aabbcc' });
    expect(isAvatar(JSON.parse(stored))).toBe(true); // the looser contract check let it in
    expect(parseAvatar(stored)).toBeNull();
    expect(parseAvatar(JSON.stringify({ emoji: '\u{1F600}', colour: '#aabbcc' }))).toEqual({ emoji: '\u{1F600}', colour: '#aabbcc' });
  });
});

// ------------------------------------------------------------------ 5. requeued fixtures and unvoid

describe('a requeued fixture', () => {
  it('moves into the current season, and goes back to its game\'s season if the game is unvoided', async () => {
    const { code, fixtureId } = await fixtureGame(r, P.Cat, [P.Eve]);
    const gameSeason = readGame(tmp.dbPath, code).row.season_id;
    expect((await call('POST', '/api/commissioner/seasons', P.Ann.token, { name: 'Later' })).status).toBe(201);
    const current = (await call('GET', '/api/seasons', P.Ann.token)).body.current.id as number;
    expect(current).not.toBe(gameSeason);
    const fx = async () => (await call('GET', '/api/fixtures?status=all&season=all', P.Ann.token)).body.fixtures.find((f: { id: string }) => f.id === fixtureId);
    expect(await fx()).toMatchObject({ status: 'playing', seasonId: gameSeason });
    await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token);
    expect(await fx()).toMatchObject({ status: 'queued', seasonId: current, gameCode: null });
    await call('POST', `/api/commissioner/games/${code}/unvoid`, P.Ann.token);
    expect(await fx()).toMatchObject({ status: 'playing', seasonId: gameSeason, gameCode: code });
    await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token);
    await call('POST', `/api/fixtures/${fixtureId}/cancel`, P.Ann.token);
  });
});

// ------------------------------------------------------------------ 7. no game with a deactivated member

describe('no new game seats a deactivated member', () => {
  it('rematch is refused with a clear error, and no game is made', async () => {
    const { code } = await fixtureGame(r, P.Cat, [P.Fay]);
    const seats = await connectAll(r, code, [P.Cat, P.Fay]);
    await drive(tmp.dbPath, code, seats, { seed: 11 });
    for (const s of seats) await s.client.close();
    expect(readGame(tmp.dbPath, code).row.status).toBe('finished');
    expect((await call('POST', `/api/commissioner/players/${P.Fay.id}/deactivate`, P.Ann.token)).status).toBe(200);
    const res = await call('POST', `/api/games/${code}/rematch`, P.Cat.token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Fay is no longer an active member');
    expect(readGame(tmp.dbPath, code).row.next_code).toBeNull();
    // Back again: the rematch works.
    expect((await call('POST', `/api/commissioner/players/${P.Fay.id}/reactivate`, P.Ann.token)).status).toBe(200);
    const ok = await call('POST', `/api/games/${code}/rematch`, P.Cat.token);
    expect(ok.status).toBe(200);
    await call('POST', `/api/commissioner/games/${ok.body.code}/void`, P.Ann.token);
  }, 60_000);

  it('a fixture with a deactivated member cannot be started', async () => {
    const f = await call('POST', '/api/fixtures', P.Cat.token, { opponents: [P.Fay.id] });
    expect((await call('POST', `/api/commissioner/players/${P.Fay.id}/deactivate`, P.Ann.token)).status).toBe(200);
    const res = await call('POST', `/api/fixtures/${f.body.id}/start`, P.Cat.token);
    expect(res.status).toBe(409);
    expect(typeof res.body.error).toBe('string');
    const db = new Database(tmp.dbPath, { readonly: true });
    try {
      expect(db.prepare('SELECT code FROM games WHERE fixture_id = ?').all(f.body.id)).toEqual([]);
    } finally {
      db.close();
    }
    expect((await call('POST', `/api/commissioner/players/${P.Fay.id}/reactivate`, P.Ann.token)).status).toBe(200);
  });

  it('joining cannot fill (and so deal) a table that has a deactivated member in it', async () => {
    const g = await call('POST', '/api/games', P.Fay.token);
    expect((await call('POST', `/api/commissioner/players/${P.Fay.id}/deactivate`, P.Ann.token)).status).toBe(200);
    const res = await call('POST', `/api/games/${g.body.code}/join`, P.Cat.token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Fay is no longer an active member');
    expect(readGame(tmp.dbPath, g.body.code).row.status).toBe('waiting');
    expect((await call('POST', `/api/commissioner/players/${P.Fay.id}/reactivate`, P.Ann.token)).status).toBe(200);
    expect((await call('POST', `/api/games/${g.body.code}/join`, P.Cat.token)).status).toBe(200);
    await call('POST', `/api/commissioner/games/${g.body.code}/void`, P.Ann.token);
  });
});

// ------------------------------------------------------------------ 9. invites from deactivated members

describe('an invite issued by a member who is later deactivated', () => {
  it('stops working (and works again if they are reactivated before it expires)', async () => {
    const token = await inviteFrom(r.base, P.Ben.token);
    expect(((await call('GET', `/api/invites/${token}`)).body as InviteStatus).valid).toBe(true);
    expect((await call('POST', `/api/commissioner/players/${P.Ben.id}/deactivate`, P.Ann.token)).status).toBe(200);
    expect((await call('GET', `/api/invites/${token}`)).body).toEqual({ valid: false, reason: 'expired', invitedBy: null, expiresAt: null });
    const refused = await call('POST', '/api/players', undefined, { name: 'Newbie', invite: token });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/no longer valid/);
    expect((await call('POST', `/api/commissioner/players/${P.Ben.id}/reactivate`, P.Ann.token)).status).toBe(200);
    expect((await call('POST', '/api/players', undefined, { name: 'Newbie', invite: token })).status).toBe(201);
  });
});

// ------------------------------------------------------------------ 8. rate limits

describe('rate limits on the public guessable endpoints', () => {
  let rl: Running;
  let rlTmp: ReturnType<typeof tempDir>;
  let now = Date.parse('2026-06-01T00:00:00Z');
  let first: Player;
  const MINUTE = 60_000;

  beforeAll(async () => {
    rlTmp = tempDir();
    rl = await startApp(rlTmp.dbPath, {
      clock: () => now,
      rateLimits: { join: { max: 3, windowMs: 10 * MINUTE }, redeem: { max: 2, windowMs: 10 * MINUTE }, invite: { max: 2, windowMs: 10 * MINUTE } },
    });
    // The first member (from 127.0.0.1: a different address from the ones below).
    first = (await api(rl.base, 'POST', '/api/players', { body: { name: 'First' } })).body as Player;
  });
  afterAll(async () => {
    await rl.server.shutdown();
    rlTmp.cleanup();
  });

  const from = async (ip: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(rl.base + path, {
      method,
      headers: { 'x-forwarded-for': ip, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as { error?: string }, retryAfter: res.headers.get('retry-after') };
  };

  it('POST /api/players: game-code guesses are cut off with 429 JSON, per address, until the window passes', async () => {
    const guesses = ['AAAAA', 'BBBBB', 'CCCCC', 'DDDDD'];
    const got = [];
    for (const code of guesses) got.push(await from('203.0.113.7', 'POST', '/api/players', { name: 'Guess', code }));
    expect(got.map((x) => x.status)).toEqual([403, 403, 403, 429]);
    expect(typeof got[3].body.error).toBe('string');
    expect(Number(got[3].retryAfter)).toBeGreaterThan(0);
    // Even a right answer is refused while limited.
    const game = await api(rl.base, 'POST', '/api/games', { token: first.token });
    expect((await from('203.0.113.7', 'POST', '/api/players', { name: 'Guess', code: game.body.code })).status).toBe(429);
    // Another address has its own allowance.
    expect((await from('198.51.100.9', 'POST', '/api/players', { name: 'Other', code: 'EEEEE' })).status).toBe(403);
    // Ten minutes later the first address may try again.
    now += 10 * MINUTE + 1;
    const joined = await from('203.0.113.7', 'POST', '/api/players', { name: 'Guess', code: game.body.code });
    expect(joined.status).toBe(201);
  });

  it('POST /api/link/redeem and GET /api/invites/:token likewise', async () => {
    for (const want of [403, 403, 429, 429]) expect((await from('192.0.2.1', 'POST', '/api/link/redeem', { code: 'ABCD-EFGH' })).status).toBe(want);
    for (const want of [200, 200, 429]) {
      const res = await from('192.0.2.1', 'GET', '/api/invites/nope');
      expect(res.status).toBe(want);
      if (want === 429) expect(typeof res.body.error).toBe('string');
    }
    // Members' own requests are not limited.
    for (let i = 0; i < 5; i++) expect((await api(rl.base, 'GET', '/api/me', { token: first.token })).status).toBe(200);
  });

  it('client keys: IPv4 as is, IPv4-mapped IPv6 as IPv4, IPv6 by /64', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey(undefined)).toBe('unknown');
  });
});

// ------------------------------------------------------------------ the stats endpoint still agrees

describe('player stats', () => {
  it('bestHand / bestCrib cards are sorted for everyone', async () => {
    for (const p of Object.values(P)) {
      const st = (await call('GET', `/api/players/${p.id}/stats`, P.Ann.token)).body as PlayerStats;
      if (st.bestHand) expect(st.bestHand.cards).toEqual(sortHand(st.bestHand.cards));
      if (st.bestCrib) expect(st.bestCrib.cards).toEqual(sortHand(st.bestCrib.cards));
    }
  });
});
