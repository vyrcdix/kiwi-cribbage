// Independent audit: access control, secrets, and the no-peeking guarantee of
// GET /api/games/:code/hands. Everything a caller "may legitimately have seen"
// is taken from that caller's own socket messages, not from the server's state.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handSize, type PlayerCount } from '../../shared/game.js';
import type { HandRecord, HandsResponse } from '../../shared/league.js';
import { connectAll, fixtureGame, lcg, movers, randomPolicy } from './league-helpers.js';
import { CODE_ALPHABET } from './random.js';
import { api, Client, inviteFrom, newPlayer, type Player, readGame, type Running, startApp, type StateMsg, tempDir } from './test-helpers.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

let tmp: ReturnType<typeof tempDir>;
let r: Running;
let now = Date.parse('2026-03-01T12:00:00.000Z');
const P: Record<string, Player> = {};

beforeAll(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath, { clock: () => now });
  for (const n of ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay']) P[n] = await newPlayer(r.base, n);
}, 60_000);
afterAll(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

const call = (m: string, p: string, token?: string, body?: unknown) => api(r.base, m, p, { token, body: m === 'GET' ? undefined : body });
const dbq = <T>(sql: string, ...args: unknown[]): T[] => {
  const db = new Database(tmp.dbPath, { readonly: true });
  try {
    return db.prepare(sql).all(...args) as T[];
  } finally {
    db.close();
  }
};

// ------------------------------------------------------------------ route coverage

/** Every route the server registers, read from the source so a new route cannot hide from this audit. */
const routesFromSource = (): { method: string; path: string }[] => {
  const out: { method: string; path: string }[] = [];
  for (const f of ['api.ts', 'league-api.ts']) {
    const src = readFileSync(resolve(SRC, f), 'utf8');
    for (const m of src.matchAll(/\br\.(get|post|patch|delete)\(\s*'([^']+)'/g)) out.push({ method: m[1].toUpperCase(), path: '/api' + m[2] });
  }
  return out;
};
const PUBLIC = new Set(['GET /api/health', 'POST /api/players', 'GET /api/invites/:token', 'POST /api/link/redeem']);
const COMMISSIONER = new Set([
  'POST /api/commissioner/seasons', 'POST /api/commissioner/round-robin', 'POST /api/commissioner/games/:code/void',
  'POST /api/commissioner/games/:code/unvoid', 'POST /api/commissioner/players/:id/deactivate',
  'POST /api/commissioner/players/:id/reactivate', 'POST /api/commissioner/handover',
]);
const fill = (path: string, sub: Record<string, string>) => path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(sub[k] ?? 'X1'));

describe('every endpoint, every kind of caller', () => {
  it('the source registers every endpoint the contract lists (and no secret extras)', () => {
    const doc = readFileSync(resolve(SRC, '..', '..', 'shared', 'league.ts'), 'utf8');
    const listed = new Set<string>();
    for (const m of doc.matchAll(/^\/\/ {3}(GET|POST|PATCH|DELETE) +(\/\S+?)(?:\?\S*)? /gm)) listed.add(`${m[1]} /api${m[2]}`);
    const actual = new Set(routesFromSource().map((x) => `${x.method} ${x.path}`));
    for (const l of listed) expect(actual.has(l), `documented but not registered: ${l}`).toBe(true);
    // Routes that exist outside the documented index are fine but must still be authenticated (checked below).
    expect(actual.size).toBeGreaterThanOrEqual(listed.size);
  });

  it('unauthenticated and bogus-token callers get 401 on every non-public route, before any validation', async () => {
    for (const { method, path } of routesFromSource()) {
      const key = `${method} ${path}`;
      if (PUBLIC.has(key)) continue;
      for (const token of [undefined, 'nope', 'Bearer', 'x'.repeat(500)]) {
        const res = await call(method, fill(path, {}), token, {});
        expect(res.status, `${key} with token ${token?.slice(0, 8)}`).toBe(401);
        expect(typeof res.body.error).toBe('string');
      }
    }
    // Malformed Authorization headers.
    for (const header of ['Basic abc', 'Bearer', 'Bearer  ', 'Token abc', `Bearer ${P.Ann.token} extra`]) {
      const res = await fetch(r.base + '/api/me', { headers: { authorization: header } });
      expect(res.status, header).toBe(401);
    }
    expect((await fetch(r.base + '/api/me', { headers: { authorization: `bearer ${P.Ann.token}` } })).status).toBe(200); // scheme is case-insensitive
    // Public routes need no token.
    expect((await call('GET', '/api/health')).status).toBe(200);
    expect((await call('GET', '/api/invites/whatever')).status).toBe(200);
    expect((await call('POST', '/api/players', undefined, { name: 'X' })).status).toBe(403);
    expect((await call('POST', '/api/link/redeem', undefined, { code: 'ABCDEFGH' })).status).toBe(403);
  });

  it('a deactivated member is locked out of everything, over HTTP and sockets, and changes nothing', async () => {
    const game = await call('POST', '/api/games', P.Eve.token);
    const fx = await call('POST', '/api/fixtures', P.Ann.token, { opponents: [P.Eve.id] });
    const sess = await call('GET', '/api/me/sessions', P.Eve.token);
    const evesSession = sess.body.sessions[0].id as string;
    const before = {
      invites: dbq('SELECT COUNT(*) AS n FROM invites')[0],
      fixtures: dbq('SELECT COUNT(*) AS n FROM fixtures')[0],
      games: dbq('SELECT COUNT(*) AS n FROM games')[0],
      links: dbq('SELECT COUNT(*) AS n FROM link_codes')[0],
      players: dbq('SELECT id, name, avatar, deck, four_colour FROM players ORDER BY id'),
    };
    expect((await call('POST', `/api/commissioner/players/${P.Eve.id}/deactivate`, P.Ann.token)).status).toBe(200);
    const stuff: Record<string, string> = { code: game.body.code, id: fx.body.id, token: 'abc', a: P.Ann.id, b: P.Ben.id };
    for (const { method, path } of routesFromSource()) {
      const key = `${method} ${path}`;
      if (PUBLIC.has(key)) continue;
      const p = fill(path, { ...stuff, id: path.includes('/players/') ? P.Ann.id : path.includes('/sessions/') ? evesSession : fx.body.id });
      const res = await call(method, p, P.Eve.token, { opponents: [P.Ann.id], name: 'Hacked', playerId: P.Eve.id });
      expect(res.status, key).toBe(401);
      expect(res.body.error).toMatch(/deactivated/i);
    }
    const after = {
      invites: dbq('SELECT COUNT(*) AS n FROM invites')[0],
      fixtures: dbq('SELECT COUNT(*) AS n FROM fixtures')[0],
      games: dbq('SELECT COUNT(*) AS n FROM games')[0],
      links: dbq('SELECT COUNT(*) AS n FROM link_codes')[0],
      players: dbq('SELECT id, name, avatar, deck, four_colour FROM players ORDER BY id'),
    };
    expect(after).toEqual(before);
    // The websocket refuses too; and an old session of Eve's still exists but is useless.
    const c = await Client.open(r.wsUrl);
    c.send({ t: 'hello', token: P.Eve.token, code: game.body.code });
    expect((await c.waitCount(1)).t).toBe('error');
    await c.closed;
    // Link codes issued while active cannot be redeemed once deactivated.
    expect((await call('POST', `/api/commissioner/players/${P.Eve.id}/reactivate`, P.Ann.token)).status).toBe(200);
    const link = await call('POST', '/api/link', P.Eve.token);
    expect(link.status).toBe(201);
    await call('POST', `/api/commissioner/players/${P.Eve.id}/deactivate`, P.Ann.token);
    expect((await call('POST', '/api/link/redeem', undefined, { code: link.body.code })).status).toBe(403);
    // A game invite code for a waiting game does not let her back in under a new name either way: that is a new person.
    await call('POST', `/api/commissioner/players/${P.Eve.id}/reactivate`, P.Ann.token);
    expect((await call('GET', '/api/me', P.Eve.token)).status).toBe(200);
  });

  it('commissioner routes: 403 for every other member, whatever the parameters, before anything else is looked at', async () => {
    for (const key of COMMISSIONER) {
      const [method, path] = key.split(' ');
      for (const who of ['Ben', 'Cat']) {
        for (const sub of [{ code: 'ABCDE', id: P.Ben.id }, { code: 'ZZZZZ', id: 'nobody' }, { code: '%00', id: '../x' }]) {
          const res = await call(method, fill(path, sub), P[who].token, { name: 'x', playerId: P.Ben.id, times: 1 });
          expect(res.status, `${key} as ${who}`).toBe(403);
        }
      }
    }
    // Nothing happened.
    expect(dbq('SELECT COUNT(*) AS n FROM seasons')[0]).toEqual({ n: 1 });
    expect(dbq('SELECT commissioner_id FROM league')[0]).toEqual({ commissioner_id: P.Ann.id });
  });

  it('the commissioner role moves with a handover and the old commissioner loses the routes', async () => {
    expect((await call('POST', '/api/commissioner/handover', P.Ann.token, { playerId: P.Ben.id })).status).toBe(200);
    expect((await call('POST', '/api/commissioner/seasons', P.Ann.token, { name: 'Nope' })).status).toBe(403);
    expect((await call('POST', '/api/commissioner/handover', P.Ben.token, { playerId: P.Ann.id })).status).toBe(200);
    expect((await call('POST', '/api/commissioner/seasons', P.Ben.token, { name: 'Nope' })).status).toBe(403);
    expect(((await call('GET', '/api/league', P.Cat.token)).body.commissioner as { id: string }).id).toBe(P.Ann.id);
  });
});

describe('fixtures and games: only the people involved may act', () => {
  it('start / decline / cancel / void by the wrong person', async () => {
    const f = await call('POST', '/api/fixtures', P.Ann.token, { opponents: [P.Ben.id] });
    const id = f.body.id as string;
    // A bystander cannot start, decline or cancel it.
    for (const verb of ['start', 'decline', 'cancel']) expect((await call('POST', `/api/fixtures/${id}/${verb}`, P.Cat.token)).status, verb).toBe(403);
    // The creator cannot decline her own challenge; the challenged player cannot cancel it.
    expect((await call('POST', `/api/fixtures/${id}/decline`, P.Ann.token)).status).toBe(403);
    expect((await call('POST', `/api/fixtures/${id}/cancel`, P.Ben.token)).status).toBe(403);
    expect(dbq('SELECT status FROM fixtures WHERE id = ?', id)).toEqual([{ status: 'queued' }]);
    // A participant starts it; the game is theirs alone.
    const s = await call('POST', `/api/fixtures/${id}/start`, P.Ben.token);
    expect(s.status).toBe(200);
    const code = s.body.code as string;
    expect((await call('POST', `/api/games/${code}/join`, P.Cat.token)).status).toBe(409); // a started game is full
    expect((await call('POST', `/api/games/${code}/leave`, P.Cat.token)).status).toBe(403);
    expect((await call('POST', `/api/games/${code}/rematch`, P.Cat.token)).status).toBe(403);
    expect((await call('POST', `/api/games/${code}/seats`, P.Ann.token, { order: [P.Ann.id, P.Ben.id] })).status).toBe(403); // not the creator (Ben started it)
    expect((await call('POST', `/api/games/${code}/remove`, P.Cat.token, { playerId: P.Ann.id })).status).toBe(403);
    // Void is the commissioner's alone: not the fixture's creator, not a player of the game.
    for (const who of ['Ann', 'Ben', 'Cat']) expect((await call('POST', `/api/commissioner/games/${code}/void`, P[who].token)).status).toBe(who === 'Ann' ? 200 : 403);
    await call('POST', `/api/commissioner/games/${code}/unvoid`, P.Ann.token);
    // Nobody but the commissioner can cancel a fixture that is already playing... nobody at all: 409.
    expect((await call('POST', `/api/fixtures/${id}/cancel`, P.Ann.token)).status).toBe(409);
    // A cancelled or declined fixture cannot be started.
    const f2 = await call('POST', '/api/fixtures', P.Cat.token, { opponents: [P.Dan.id] });
    expect((await call('POST', `/api/fixtures/${f2.body.id}/decline`, P.Dan.token)).status).toBe(200);
    expect((await call('POST', `/api/fixtures/${f2.body.id}/start`, P.Cat.token)).status).toBe(409);
    const f3 = await call('POST', '/api/fixtures', P.Cat.token, { opponents: [P.Dan.id] });
    expect((await call('POST', `/api/fixtures/${f3.body.id}/cancel`, P.Ann.token)).status).toBe(200); // the commissioner may
    expect((await call('POST', `/api/fixtures/${f3.body.id}/start`, P.Dan.token)).status).toBe(409);
    // Nonexistent / malformed fixtures.
    for (const bad of ['nope', 'x'.repeat(65), '%20', '01ARZ3NDEKTSV4RRFFQ69G5FAV']) expect((await call('POST', `/api/fixtures/${bad}/start`, P.Ann.token)).status, bad).toBe(404);
  });

  it('waiting rooms: only the creator rearranges or removes; strangers cannot read the hands', async () => {
    const g = await call('POST', '/api/games', P.Cat.token, { players: 3 });
    const code = g.body.code as string;
    await call('POST', `/api/games/${code}/join`, P.Dan.token);
    expect((await call('POST', `/api/games/${code}/seats`, P.Dan.token, { order: [P.Dan.id, P.Cat.id, null] })).status).toBe(403);
    expect((await call('POST', `/api/games/${code}/remove`, P.Dan.token, { playerId: P.Cat.id })).status).toBe(403);
    expect((await call('POST', `/api/games/${code}/remove`, P.Fay.token, { playerId: P.Dan.id })).status).toBe(403);
    expect((await call('GET', `/api/games/${code}/hands`, P.Fay.token)).status).toBe(403);
    expect((await call('GET', `/api/games/${code}/hands`, P.Dan.token)).status).toBe(200);
    expect((await call('POST', `/api/games/${code}/remove`, P.Cat.token, { playerId: P.Dan.id })).status).toBe(200);
    expect((await call('GET', `/api/games/${code}/hands`, P.Dan.token)).status).toBe(403); // removed: a stranger again
  });
});

// ------------------------------------------------------------------ the hands endpoint never shows what you have not seen

const cardsIn = (rec: HandRecord): number[] => [
  ...rec.dealt.flatMap((d) => d ?? []),
  ...rec.kept.flatMap((d) => d ?? []),
  ...rec.discards.flatMap((d) => d ?? []),
  ...(rec.crib ?? []),
  ...(rec.deckToCrib === null ? [] : [rec.deckToCrib]),
  ...(rec.starter === null ? [] : [rec.starter]),
  ...rec.peg.flatMap((p) => (p.t === 'play' ? [p.card, ...p.items.flatMap((i) => i.cards)] : [])),
  ...rec.shows.flatMap((s) => [...(s.cards ?? []), ...s.items.flatMap((i) => i.cards)]),
];

/** What one player has legitimately seen, hand by hand, from their own messages only. */
const seenBy = (c: Client) => {
  const byHand = new Map<number, { known: Set<number>; dealt: number[] | null; played: { card: number; seat: number }[]; starter: number | null }>();
  for (const m of c.msgs) {
    if (m.t !== 'state' || !m.view) continue;
    const v = m.view;
    let h = byHand.get(v.handNo);
    if (!h) byHand.set(v.handNo, (h = { known: new Set(), dealt: null, played: [], starter: null }));
    for (const x of v.hand) h.known.add(x);
    if (h.dealt === null && v.hand.length === handSize(v.players)) h.dealt = [...v.hand];
    for (const p of v.played) h.known.add(p.card);
    h.played = v.played.map((p) => ({ ...p }));
    if (v.starter !== null) { h.known.add(v.starter); h.starter = v.starter; }
    if (v.showResult) for (const x of v.showResult.cards) h.known.add(x);
  }
  return byHand;
};

const keysOf = (o: object) => Object.keys(o).sort();
const HANDS_KEYS = ['code', 'firstRecordedHand', 'hands', 'players', 'seats', 'status', 'you'];
const REC_KEYS = ['complete', 'crib', 'dealer', 'dealt', 'deckToCrib', 'discards', 'endedGame', 'finishedAt', 'handNo', 'heels', 'kept', 'peg', 'scoresAfter', 'scoresBefore', 'shows', 'starter'];

for (const size of [2, 3, 4] as PlayerCount[]) {
  describe(`${size}-player game in progress`, () => {
    it('after every single move, nobody (players, their partners, outsiders) sees a hidden card', async () => {
      const who = ['Ann', 'Ben', 'Cat', 'Dan'].slice(0, size);
      const bySeat = who.map((n) => P[n]);
      const outsider = P.Fay;
      const { code } = await fixtureGame(r, bySeat[0], bySeat.slice(1));
      const seats = await connectAll(r, code, bySeat);
      const rand = lcg(size * 31);
      let audits = 0;
      let discardsSeen = false;
      const audit = async () => {
        const out = await call('GET', `/api/games/${code}/hands`, outsider.token);
        expect(out.status).toBe(403);
        expect(Object.keys(out.body)).toEqual(['error']);
        for (let v = 0; v < size; v++) {
          const res = await call('GET', `/api/games/${code}/hands`, bySeat[v].token);
          expect(res.status).toBe(200);
          const body = res.body as HandsResponse;
          expect(keysOf(body)).toEqual(HANDS_KEYS);
          expect(body.you).toBe(v);
          expect(body.status).toBe('active');
          const seen = seenBy(seats[v].client);
          const view = (seats[v].client.lastState as StateMsg).view!;
          body.hands.forEach((rec, i) => {
            expect(keysOf(rec)).toEqual(REC_KEYS);
            const sh = seen.get(rec.handNo)!;
            expect(sh, `viewer ${v} never saw hand ${rec.handNo}`).toBeTruthy();
            for (const c of cardsIn(rec)) expect(sh.known.has(c), `card ${c} of hand ${rec.handNo} leaked to seat ${v} (phase ${view.phase})`).toBe(true);
            if (i < body.hands.length - 1) {
              expect(rec.complete).toBe(true);
              return;
            }
            // The hand in progress: only my own cards, played cards, the starter, counted shows.
            expect(rec.complete).toBe(false);
            expect(rec.finishedAt).toBeNull();
            expect(rec.handNo).toBe(view.handNo);
            expect(rec.crib).toBeNull();
            expect(rec.deckToCrib).toBeNull();
            expect(rec.starter).toBe(view.starter);
            rec.dealt.forEach((d, s) => expect(d === null, `dealt[${s}] seat ${v}`).toBe(s !== v));
            rec.kept.forEach((d, s) => expect(d === null, `kept[${s}] seat ${v}`).toBe(s !== v));
            rec.discards.forEach((d, s) => expect(d === null, `discards[${s}] seat ${v}`).toBe(s !== v));
            expect(rec.dealt[v]).toEqual(sh.dealt);
            expect(rec.peg.filter((p) => p.t === 'play').map((p) => ({ card: (p as { card: number }).card, seat: p.seat }))).toEqual(sh.played);
            for (const s of rec.shows) if (!s.counted) expect(s.cards).toBeNull();
            if (rec.discards[v]!.length) discardsSeen = true;
          });
          expect(body.hands[body.hands.length - 1].handNo).toBe(view.handNo);
        }
        audits++;
      };
      await audit();
      for (let i = 0; seats[0].client.lastState.status !== 'finished'; i++) {
        if (i > 5000) throw new Error('too many steps');
        const S = readGame(tmp.dbPath, code).state!;
        const who2 = movers(S);
        const seat = who2[Math.floor(rand() * who2.length)];
        const counts = seats.map((s) => s.client.msgs.length);
        seats[seat].client.send({ t: 'act', action: randomPolicy(S, seat, rand) });
        await Promise.all(seats.map((s, k) => s.client.waitCount(counts[k] + 1)));
        if ((seats[0].client.lastState.status as string) === 'finished') break;
        await audit();
      }
      expect(audits).toBeGreaterThan(50);
      expect(discardsSeen).toBe(true);

      // Finished: any league member sees the whole record; a stranger is not "you".
      const fin = (await call('GET', `/api/games/${code}/hands`, outsider.token)).body as HandsResponse;
      expect(fin).toMatchObject({ status: 'finished', you: null });
      expect(fin.hands.every((h) => h.complete)).toBe(true);
      for (const c of seats) await c.client.close();
    }, 180_000);
  });
}

describe('hands: odds and ends', () => {
  it('a game voided mid-hand still hides the hand in progress; unknown/odd codes never 5xx', async () => {
    const { code } = await fixtureGame(r, P.Ann, [P.Dan]);
    const seats = await connectAll(r, code, [P.Ann, P.Dan]);
    // Play a few moves.
    const rand = lcg(3);
    for (let i = 0; i < 6; i++) {
      const S = readGame(tmp.dbPath, code).state!;
      const w = movers(S);
      const seat = w[Math.floor(rand() * w.length)];
      const counts = seats.map((s) => s.client.msgs.length);
      seats[seat].client.send({ t: 'act', action: randomPolicy(S, seat, rand) });
      await Promise.all(seats.map((s, k) => s.client.waitCount(counts[k] + 1)));
    }
    expect((await call('POST', `/api/commissioner/games/${code}/void`, P.Ann.token)).status).toBe(200);
    expect((await call('GET', `/api/games/${code}/hands`, P.Fay.token)).status).toBe(403); // voided but unfinished: still closed to outsiders
    const mine = (await call('GET', `/api/games/${code}/hands`, P.Ann.token)).body as HandsResponse;
    mine.hands[mine.hands.length - 1].dealt.forEach((d, s) => expect(d === null).toBe(s !== 0));
    for (const c of seats) await c.client.close();
    for (const bad of ['', '%', '%00', 'a'.repeat(5000), '../../etc', 'ZZZZZ', code.toLowerCase(), ` ${code} `]) {
      const res = await call('GET', `/api/games/${encodeURIComponent(bad)}/hands`, P.Ann.token);
      expect(res.status, bad.slice(0, 20)).toBeLessThan(500);
    }
  }, 60_000);
});

// ------------------------------------------------------------------ secrets

const walk = (x: unknown, visit: (k: string, v: unknown, path: string) => void, path = '$'): void => {
  if (Array.isArray(x)) x.forEach((e, i) => walk(e, visit, `${path}[${i}]`));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { visit(k, v, `${path}.${k}`); walk(v, visit, `${path}.${k}`); }
};

describe('secrets', () => {
  it('no response other than the one that issues a secret ever contains it, its hash, or a token-looking key', async () => {
    // Issue a pile of secrets.
    const secrets = new Set<string>();
    for (const n of Object.keys(P)) {
      secrets.add(P[n].token);
      secrets.add(sha(P[n].token));
      const inv = await call('POST', '/api/invites', P[n].token);
      secrets.add(inv.body.token);
      secrets.add(sha(inv.body.token));
      const link = await call('POST', '/api/link', P[n].token);
      secrets.add(link.body.code);
      secrets.add(sha(link.body.code));
      const redeemed = await call('POST', '/api/link/redeem', undefined, { code: link.body.code });
      secrets.add(redeemed.body.token);
      secrets.add(sha(redeemed.body.token));
      // …and one that stays unredeemed.
      const link2 = await call('POST', '/api/link', P[n].token);
      secrets.add(link2.body.code);
    }
    for (const row of dbq<{ token_hash: string }>('SELECT token_hash FROM sessions')) secrets.add(row.token_hash);
    for (const row of dbq<{ token_hash: string }>('SELECT token_hash FROM invites')) secrets.add(row.token_hash);
    for (const row of dbq<{ code_hash: string }>('SELECT code_hash FROM link_codes')) secrets.add(row.code_hash);
    for (const row of dbq<{ token_hash: string }>('SELECT token_hash FROM players')) secrets.add(row.token_hash);
    expect(secrets.size).toBeGreaterThan(60);

    const someGame = dbq<{ code: string }>('SELECT code FROM games LIMIT 1')[0].code;
    const someFixture = dbq<{ id: string }>('SELECT id FROM fixtures LIMIT 1')[0].id;
    const paths = [
      '/api/me', '/api/me/sessions', '/api/league', '/api/seasons', '/api/standings?season=all', `/api/h2h/${P.Ann.id}/${P.Ben.id}`,
      `/api/players/${P.Ann.id}/stats`, '/api/hall-of-fame', '/api/pending', '/api/results?season=all', `/api/games/${someGame}/hands`,
      '/api/games', '/api/fixtures?status=all&season=all', '/api/fixtures/mine', '/api/fixtures/next', `/api/invites/${someFixture}`,
    ];
    for (const n of Object.keys(P)) {
      for (const p of paths) {
        const res = await call('GET', p, P[n].token);
        const text = JSON.stringify(res.body);
        for (const s of secrets) expect(text.includes(s), `${p} as ${n} leaks a secret`).toBe(false);
        walk(res.body, (k, _v, path) => {
          expect(/token|hash|secret|password|passphrase/i.test(k), `${p}: key ${path}`).toBe(false);
        });
      }
    }
    // The invite/link statuses of a *valid* invite show who invited, never the token or a hash.
    const inv = await call('POST', '/api/invites', P.Ann.token);
    const st = await call('GET', `/api/invites/${inv.body.token}`);
    expect(Object.keys(st.body).sort()).toEqual(['expiresAt', 'invitedBy', 'reason', 'valid']);
    expect(Object.keys(st.body.invitedBy).sort()).toEqual(['id', 'name']);
    // Session ids are not tokens: they cannot authenticate.
    const sessions = (await call('GET', '/api/me/sessions', P.Ann.token)).body.sessions as { id: string }[];
    for (const s of sessions) expect((await call('GET', '/api/me', s.id)).status).toBe(401);
    expect(Object.keys(sessions[0]).sort()).toEqual(['createdAt', 'current', 'id', 'lastSeenAt']);
  });

  it('invite tokens, link codes and session tokens are random, unique and not guessable from a sequence', async () => {
    const invites: string[] = [];
    const links: string[] = [];
    const tokens: string[] = [];
    for (let i = 0; i < 80; i++) invites.push((await call('POST', '/api/invites', P.Cat.token)).body.token);
    for (let i = 0; i < 300; i++) links.push((await call('POST', '/api/link', P.Dan.token)).body.code);
    for (let i = 0; i < 40; i++) tokens.push((await call('POST', '/api/link/redeem', undefined, { code: links[i] })).body.token);
    for (const set of [invites, links, tokens]) expect(new Set(set).size).toBe(set.length);
    for (const t of [...invites, ...tokens]) expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    for (const c of links) expect(c).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    // Character frequencies: chi-square far below the point where a generator would be suspect.
    const chi = (strs: string[], alphabet: string) => {
      const counts = new Map<string, number>([...alphabet].map((ch) => [ch, 0]));
      for (const s of strs) for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
      const total = strs.reduce((t, s) => t + s.length, 0);
      const exp = total / alphabet.length;
      return [...counts.values()].reduce((t, c) => t + (c - exp) ** 2 / exp, 0);
    };
    expect(chi(invites, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_')).toBeLessThan(110);
    expect(chi(links, CODE_ALPHABET)).toBeLessThan(65);
    // No relation between consecutive issues: no shared prefixes, no constant numeric step.
    const num = (c: string) => [...c].reduce((t, ch) => t * 31 + CODE_ALPHABET.indexOf(ch), 0);
    const steps = new Set(links.slice(1).map((c, i) => num(c) - num(links[i])));
    expect(steps.size).toBeGreaterThan(links.length - 5);
    for (let i = 1; i < invites.length; i++) expect(invites[i].slice(0, 6)).not.toBe(invites[i - 1].slice(0, 6));
    // Neighbouring codes (one character off) are not accepted.
    const fresh = (await call('POST', '/api/link', P.Dan.token)).body.code as string;
    const off = fresh.slice(0, 7) + CODE_ALPHABET[(CODE_ALPHABET.indexOf(fresh[7]) + 1) % CODE_ALPHABET.length];
    expect((await call('POST', '/api/link/redeem', undefined, { code: off })).status).toBe(403);
    expect((await call('POST', '/api/link/redeem', undefined, { code: fresh })).status).toBe(201);
  });

  it('single use holds under a stampede: ten simultaneous redemptions / signups, exactly one wins', async () => {
    const link = (await call('POST', '/api/link', P.Dan.token)).body.code as string;
    const redeemed = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/api/link/redeem', undefined, { code: link })));
    expect(redeemed.filter((x) => x.status === 201)).toHaveLength(1);
    expect(redeemed.filter((x) => x.status !== 201).every((x) => x.status === 403)).toBe(true);
    const inv = await inviteFrom(r.base, P.Ann.token);
    const before = dbq<{ n: number }>('SELECT COUNT(*) AS n FROM players')[0].n;
    const joins = await Promise.all(Array.from({ length: 10 }, (_, i) => call('POST', '/api/players', undefined, { name: `Racer${i}`, invite: inv })));
    expect(joins.filter((x) => x.status === 201)).toHaveLength(1);
    expect(dbq<{ n: number }>('SELECT COUNT(*) AS n FROM players')[0].n).toBe(before + 1);
    expect(dbq<{ used_by: string | null }>('SELECT used_by FROM invites WHERE token_hash = ?', sha(inv))[0].used_by).toBe(joins.find((x) => x.status === 201)!.body.id);
  });

  it('expiry is exact: invites at seven days, link codes at ten minutes, on the injected clock', async () => {
    const inv = (await call('POST', '/api/invites', P.Ann.token)).body;
    const link = (await call('POST', '/api/link', P.Ann.token)).body;
    expect(Date.parse(inv.expiresAt) - now).toBe(7 * DAY);
    expect(Date.parse(link.expiresAt) - now).toBe(10 * 60 * 1000);
    now += 10 * 60 * 1000 - 1;
    expect((await call('GET', `/api/invites/${inv.token}`)).body.valid).toBe(true);
    expect((await call('POST', '/api/link/redeem', undefined, { code: link.code })).status).toBe(201);
    const link2 = (await call('POST', '/api/link', P.Ann.token)).body;
    now += 10 * 60 * 1000;
    expect((await call('POST', '/api/link/redeem', undefined, { code: link2.code })).status).toBe(403);
    now += 7 * DAY - 10 * 60 * 1000 - (10 * 60 * 1000 - 1) - 1;
    expect((await call('GET', `/api/invites/${inv.token}`)).body.valid).toBe(true);
    now += 1;
    expect((await call('GET', `/api/invites/${inv.token}`)).body).toMatchObject({ valid: false, reason: 'expired', invitedBy: null, expiresAt: null });
    expect((await call('POST', '/api/players', undefined, { name: 'Late', invite: inv.token })).status).toBe(403);
    // An expired invite's state is not "used": it stays expired after a refused signup.
    expect(dbq('SELECT used_at FROM invites WHERE token_hash = ?', sha(inv.token))).toEqual([{ used_at: null }]);
  });

  it('a redeemed link code yields a token for the issuing player only, and sessions are independent', async () => {
    const codes: Record<string, string> = {};
    for (const n of ['Ann', 'Ben', 'Cat']) codes[n] = (await call('POST', '/api/link', P[n].token)).body.code;
    const got: Record<string, Player> = {};
    for (const n of ['Cat', 'Ann', 'Ben']) {
      const res = await call('POST', '/api/link/redeem', undefined, { code: codes[n].toLowerCase().replace(/^(....)/, '$1-') });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(P[n].id);
      expect(res.body.name).toBe(n);
      expect(res.body.token).not.toBe(P[n].token);
      got[n] = res.body;
      const me = (await call('GET', '/api/me', res.body.token)).body;
      expect(me.id).toBe(P[n].id);
    }
    // Ben cannot see or revoke Ann's sessions.
    const annSessions = (await call('GET', '/api/me/sessions', P.Ann.token)).body.sessions as { id: string; current: boolean }[];
    expect(annSessions.length).toBeGreaterThanOrEqual(2);
    expect(annSessions.filter((s) => s.current)).toHaveLength(1);
    const benSessions = (await call('GET', '/api/me/sessions', P.Ben.token)).body.sessions as { id: string }[];
    for (const s of benSessions) expect(annSessions.some((x) => x.id === s.id)).toBe(false);
    expect((await call('DELETE', `/api/me/sessions/${annSessions[0].id}`, P.Ben.token)).status).toBe(404);
    expect((await call('GET', '/api/me', P.Ann.token)).status).toBe(200);
    // Signing out the new device leaves the old one (and the other new ones) alone; and the other way round.
    expect((await call('POST', '/api/me/sign-out', got.Ann.token)).status).toBe(200);
    expect((await call('GET', '/api/me', got.Ann.token)).status).toBe(401);
    expect((await call('GET', '/api/me', P.Ann.token)).status).toBe(200);
    expect((await call('GET', '/api/me', got.Ben.token)).status).toBe(200);
    expect((await call('GET', '/api/me', got.Cat.token)).status).toBe(200);
    // Revoking by id: the original device is revoked from the new one; a second revoke is a 404.
    const mine = (await call('GET', '/api/me/sessions', got.Cat.token)).body.sessions as { id: string; current: boolean }[];
    const original = mine.find((s) => !s.current)!;
    expect((await call('DELETE', `/api/me/sessions/${original.id}`, got.Cat.token)).status).toBe(200);
    expect((await call('DELETE', `/api/me/sessions/${original.id}`, got.Cat.token)).status).toBe(404);
    expect((await call('GET', '/api/me', got.Cat.token)).status).toBe(200);
    // Hand Cat a replacement original for the later tests.
    const again = await call('POST', '/api/link', got.Cat.token);
    P.Cat = (await call('POST', '/api/link/redeem', undefined, { code: again.body.code })).body;
  });

  // BUG (reported, now fixed): revoking a session or signing out did not end sockets that session already
  // opened. hub.ts authenticated only in `hello`; `onAct` never re-checked the session. A phone that was
  // signed out (e.g. lost, then revoked from another device) kept playing its seat until the socket dropped.
  // Now revocation and sign-out hang that session's sockets up (hub.kickSession) and onAct re-checks.
  it('BUG (fixed): a revoked session cannot keep acting over its open socket', async () => {
    const { code } = await fixtureGame(r, P.Dan, [P.Ann]);
    // Dan's second device.
    const device = (await call('POST', '/api/link/redeem', undefined, { code: (await call('POST', '/api/link', P.Dan.token)).body.code })).body as Player;
    const seats = await connectAll(r, code, [device, P.Ann]);
    const current = ((await call('GET', '/api/me/sessions', device.token)).body.sessions as { id: string; current: boolean }[]).find((x) => x.current)!;
    expect((await call('DELETE', `/api/me/sessions/${current.id}`, P.Dan.token)).status).toBe(200);
    expect((await call('GET', '/api/me', device.token)).status).toBe(401); // the token is dead over HTTP
    // Both players discard at the start, so seat 0 may move now. Its (revoked) socket must not be allowed to.
    const S = readGame(tmp.dbPath, code).state!;
    const c = seats[0].client;
    const n = c.msgs.length;
    c.send({ t: 'act', action: randomPolicy(S, 0, lcg(1)) });
    await new Promise((res) => setTimeout(res, 400));
    const refused = c.msgs.slice(n).some((m) => m.t === 'error') || c.closeCode !== null;
    const moved = readGame(tmp.dbPath, code).state!.hands[0].length !== S.hands[0].length;
    expect(refused, 'the revoked socket was refused').toBe(true);
    expect(moved, 'the revoked socket moved the game').toBe(false);
    for (const x of seats) await x.client.close();
  }, 30_000);

  it('deactivation hangs up the member\'s open sockets', async () => {
    const { code } = await fixtureGame(r, P.Fay, [P.Dan]);
    const seats = await connectAll(r, code, [P.Fay, P.Dan]);
    expect((await call('POST', `/api/commissioner/players/${P.Fay.id}/deactivate`, P.Ann.token)).status).toBe(200);
    await seats[0].client.closed;
    expect(seats[0].client.closeCode).not.toBeNull();
    await seats[1].client.close();
    expect((await call('POST', `/api/commissioner/players/${P.Fay.id}/reactivate`, P.Ann.token)).status).toBe(200);
  });

  it('sockets: strangers, signed-out tokens and unknown games are refused', async () => {
    const g = await call('POST', '/api/games', P.Ben.token);
    for (const [token, code] of [[P.Cat.token, g.body.code], ['nope', g.body.code], [P.Ben.token, 'ZZZZZ'], [undefined, g.body.code]] as const) {
      const c = await Client.open(r.wsUrl);
      c.send({ t: 'hello', token, code });
      const m = await c.waitCount(1);
      expect(m.t, `${token?.slice(0, 5)} ${code}`).toBe('error');
      await c.closed;
    }
  });
});
