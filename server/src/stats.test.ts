// League statistics end to end: a small league plays real games over the
// sockets (seeded and scripted decks), and every number the API reports —
// standings, head-to-head, player stats, honours, hall of fame — is checked
// against values worked out here from the authoritative states and events,
// independently of the server's hand records and statistics code.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { card } from '../../shared/cards.js';
import type { GameState, PlayerCount } from '../../shared/game.js';
import type { HeadToHead, PlayerStats, StandingRow, StandingsResponse } from '../../shared/league.js';
import {
  connectAll,
  Decks,
  deckStarting,
  drive,
  fixtureGame,
  type HandObs,
  keepPolicy,
  observe,
  type Policy,
  twoPlayerDeal,
} from './league-helpers.js';
import { api, newPlayer, type Player, readGame, type Running, startApp, tempDir } from './test-helpers.js';

const C = (r: number, s: number) => card(r, s);
// 29: three fives and the jack of the starter's suit, the fourth five cut.
const FIVES = [C(4, 0), C(4, 1), C(4, 2)];
const DEAL_29 = twoPlayerDeal([...FIVES, C(10, 3), C(12, 0), C(11, 0)], [C(0, 1), C(1, 2), C(6, 3), C(8, 1), C(2, 2), C(7, 0)], C(4, 3));
// 28: four fives, a jack cut. The other seat keeps A♠ 2♠ 6♠ 10♥, which counts nothing with J♦.
const ZERO = [C(0, 0), C(1, 0), C(5, 0), C(9, 1)];
const DEAL_28 = twoPlayerDeal([...FIVES, C(4, 3), C(12, 0), C(11, 0)], [...ZERO, C(8, 3), C(7, 2)], C(10, 2));
const CUT = deckStarting([C(0, 0), C(1, 1), C(2, 2), C(3, 3)]); // seat 0 cuts the ace and deals

interface Done {
  code: string;
  players: PlayerCount;
  seats: string[];
  final: GameState;
  hands: HandObs[];
  season: number;
}

let tmp: ReturnType<typeof tempDir>;
let r: Running;
const decks = new Decks(2024);
let A: Player, B: Player, Cc: Player, D: Player;
const done: Done[] = [];
let voided: Done;
let unfinished: string;

const play = async (bySeat: Player[], opts: { policy?: Policy; seed: number; season?: number; stopEarly?: boolean } ) => {
  const { code } = await fixtureGame(r, bySeat[0], bySeat.slice(1));
  const seats = await connectAll(r, code, bySeat);
  const d = await drive(tmp.dbPath, code, seats, {
    policy: opts.policy, seed: opts.seed,
    until: opts.stopEarly ? (s) => s.handNo >= 2 && s.phase === 'peg' : undefined,
  });
  for (const s of seats) await s.client.close();
  decks.clear();
  const g: Done = {
    code, players: bySeat.length as PlayerCount, seats: bySeat.map((p) => p.id), final: d.states[d.states.length - 1],
    hands: observe(d, bySeat.length as PlayerCount), season: opts.season ?? 1,
  };
  return g;
};

beforeAll(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath, { shuffle: decks.shuffle });
  A = await newPlayer(r.base, 'Alice');
  B = await newPlayer(r.base, 'Bob');
  Cc = await newPlayer(r.base, 'Carol');
  D = await newPlayer(r.base, 'Dave');

  // Alice is dealt a 29 every hand against Bob.
  decks.push(CUT, ...Array(10).fill(DEAL_29));
  done.push(await play([A, B], { seed: 1, policy: keepPolicy({ 0: [...FIVES, C(10, 3)] }) }));
  done.push(await play([A, B], { seed: 2 }));
  done.push(await play([B, A], { seed: 3 }));
  done.push(await play([Cc, D], { seed: 4 }));
  done.push(await play([A, B, Cc], { seed: 5 }));
  done.push(await play([A, B, Cc, D], { seed: 6 })); // Alice & Carol v Bob & Dave
  done.push(await play([A, Cc, B, D], { seed: 7 })); // Alice & Bob v Carol & Dave
  // Bob is dealt a 28 and Alice a nineteen in the first hand.
  decks.push(CUT, DEAL_28);
  done.push(await play([B, A], { seed: 8, policy: keepPolicy({ 0: [...FIVES, C(4, 3)], 1: ZERO }) }));
  for (let i = 0; i < 3; i++) done.push(await play([D, B], { seed: 20 + i }));

  // A game that is voided, and one left unfinished: neither counts.
  voided = await play([A, Cc], { seed: 9 });
  const v = await api(r.base, 'POST', `/api/commissioner/games/${voided.code}/void`, { token: A.token, body: { reason: 'Test' } });
  expect(v.status).toBe(200);
  unfinished = (await play([B, D], { seed: 10, stopEarly: true })).code;

  // Season two.
  expect((await api(r.base, 'POST', '/api/commissioner/seasons', { token: A.token, body: { name: 'Spring' } })).status).toBe(201);
  done.push(await play([Cc, A], { seed: 11, season: 2 }));
  done.push(await play([A, D, B], { seed: 12, season: 2 }));
}, 240_000);

afterAll(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

// ---- the independent arithmetic ----

const skunkOf = (sc: number) => (sc < 61 ? 2 : sc < 91 ? 1 : 0);

interface Out { g: Done; seat: number; team: number; won: boolean; mp: number; given: number; taken: number; pf: number; pa: number }
const out = (g: Done, pid: string): Out | null => {
  const seat = g.seats.indexOf(pid);
  if (seat < 0) return null;
  const team = g.players === 4 ? seat % 2 : seat;
  const sc = g.final.scores;
  const w = g.final.winner!;
  const won = team === w;
  const worst = Math.max(...sc.map((s, t) => (t === w ? 0 : skunkOf(s))));
  return {
    g, seat, team, won, mp: won ? 2 + worst : 0, given: won ? worst : 0, taken: won ? 0 : skunkOf(sc[team]),
    pf: sc[team], pa: Math.max(...sc.filter((_, t) => t !== team)),
  };
};
const outs = (games: Done[], pid: string) => games.map((g) => out(g, pid)).filter((o): o is Out => o !== null);

const line = (os: Out[]) => {
  const won = os.filter((o) => o.won).length;
  return {
    played: os.length, won, lost: os.length - won, matchPoints: os.reduce((t, o) => t + o.mp, 0),
    winRate: os.length ? won / os.length : 0,
    skunksGiven: os.filter((o) => o.given >= 1).length, skunksTaken: os.filter((o) => o.taken >= 1).length,
    doubleSkunksGiven: os.filter((o) => o.given === 2).length, doubleSkunksTaken: os.filter((o) => o.taken === 2).length,
    pointsFor: os.reduce((t, o) => t + o.pf, 0), pointsAgainst: os.reduce((t, o) => t + o.pa, 0),
  };
};

const streakOf = (rs: boolean[]) => {
  if (!rs.length) return null;
  let n = 0;
  for (let i = rs.length - 1; i >= 0 && rs[i] === rs[rs.length - 1]; i--) n++;
  return { result: rs[rs.length - 1] ? 'W' : 'L', length: n };
};
const longestWins = (rs: boolean[]) => {
  let best = 0, run = 0;
  for (const x of rs) { run = x ? run + 1 : 0; best = Math.max(best, run); }
  return best;
};

/** Every hand-level fact for one player in these games, oldest first. */
const handFacts = (games: Done[], pid: string) => {
  const hands: { code: string; handNo: number; pts: number; cards: number[]; starter: number }[] = [];
  const cribs: typeof hands = [];
  const pegs: number[] = [];
  for (const g of games) {
    const seat = g.seats.indexOf(pid);
    if (seat < 0) continue;
    for (const h of g.hands) {
      for (const s of h.shows) {
        const row = { code: g.code, handNo: h.handNo, pts: s.total, cards: s.cards, starter: h.starter! };
        if (s.seat === seat && !s.crib) hands.push(row);
        if (s.seat === seat && s.crib) cribs.push(row);
      }
      if (h.peggedOut) pegs.push(h.peg[seat]);
    }
  }
  return { hands, cribs, pegs };
};

const avgs = (games: Done[], pid: string) => {
  const f = handFacts(games, pid);
  const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
  const hs = f.hands.map((h) => h.pts);
  const cs = f.cribs.map((h) => h.pts);
  return {
    hand: hs.length ? sum(hs) / hs.length : null, handTotal: sum(hs), hands: hs.length,
    crib: cs.length ? sum(cs) / cs.length : null, cribTotal: sum(cs), cribs: cs.length,
    pegging: f.pegs.length ? sum(f.pegs) / f.pegs.length : null, peggingTotal: sum(f.pegs), peggingHands: f.pegs.length,
  };
};

const bestOf = (rows: { code: string; handNo: number; pts: number; cards: number[]; starter: number }[]) => {
  let top: (typeof rows)[number] | null = null;
  for (const x of rows) if (!top || x.pts > top.pts) top = x;
  return top;
};

const seasonGames = (season: number | 'all') => done.filter((g) => season === 'all' || g.season === season);

const expectedStandings = (games: Done[], members: Player[]) => {
  const rows = members.map((p) => {
    const os = outs(games, p.id);
    const l = line(os);
    return { id: p.id, name: p.name, ...l, pointDifference: l.pointsFor - l.pointsAgainst, streak: streakOf(os.map((o) => o.won)), lastFive: os.slice(-5).reverse().map((o) => o.g.code) };
  });
  rows.sort((a, b) =>
    (b.played > 0 ? 1 : 0) - (a.played > 0 ? 1 : 0) || b.matchPoints - a.matchPoints || b.winRate - a.winRate ||
    b.pointDifference - a.pointDifference || a.name.localeCompare(b.name));
  return rows;
};

const pickRow = (row: StandingRow) => ({
  id: row.player.id, name: row.player.name, played: row.played, won: row.won, lost: row.lost, matchPoints: row.matchPoints,
  winRate: row.winRate, skunksGiven: row.skunksGiven, skunksTaken: row.skunksTaken, doubleSkunksGiven: row.doubleSkunksGiven,
  doubleSkunksTaken: row.doubleSkunksTaken, pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst,
  pointDifference: row.pointDifference, streak: row.streak, lastFive: row.lastFive.map((c) => c.code),
});

describe('the scripted games did what they were meant to', () => {
  it('Alice held 29s and double-skunked Bob; Bob held a 28 and Alice a nineteen', () => {
    const g1 = done[0];
    expect(g1.final.winner).toBe(0);
    expect(skunkOf(g1.final.scores[1])).toBe(2);
    expect(g1.hands.flatMap((h) => h.shows).filter((s) => s.seat === 0 && !s.crib && s.total === 29).length).toBeGreaterThanOrEqual(3);
    const h1 = done[7].hands[0];
    expect(h1.shows.find((s) => s.seat === 0 && !s.crib)!.total).toBe(28);
    expect(h1.shows.find((s) => s.seat === 1 && !s.crib)!.total).toBe(0);
    // Plenty of variety elsewhere: every size, partners, three seasons' worth of rows.
    expect(new Set(done.map((g) => g.players))).toEqual(new Set([2, 3, 4]));
  });
});

describe('standings', () => {
  for (const season of [1, 2, 'all'] as const) {
    it(`season ${season}: every row and the order match an independent count`, async () => {
      const res = await api(r.base, 'GET', `/api/standings?season=${season}`, { token: Cc.token });
      expect(res.status).toBe(200);
      const body = res.body as StandingsResponse;
      const games = seasonGames(season);
      expect(body.games).toBe(games.length);
      expect(body.season === null ? 'all' : body.season.id).toBe(season);
      const want = expectedStandings(games, [A, B, Cc, D]);
      expect(body.rows.map(pickRow)).toEqual(want);
      // Ranks follow the order (ties share a rank).
      body.rows.forEach((row, i) => expect(row.rank).toBe(i === 0 ? 1 : body.rows[i - 1].matchPoints === row.matchPoints && body.rows[i - 1].winRate === row.winRate && body.rows[i - 1].pointDifference === row.pointDifference && body.rows[i - 1].played > 0 === row.played > 0 ? body.rows[i - 1].rank : i + 1));
      // Win rate and lastFive details.
      for (const row of body.rows) {
        for (const chip of row.lastFive) {
          const g = done.find((x) => x.code === chip.code)!;
          const o = out(g, row.player.id)!;
          expect(chip).toMatchObject({ result: o.won ? 'W' : 'L', players: g.players, score: o.pf, opponentScore: o.pa, skunk: o.won ? o.given : o.taken });
        }
      }
    });
  }

  it('the default is the current season; voided and unfinished games never count', async () => {
    const cur = await api(r.base, 'GET', '/api/standings', { token: D.token });
    expect(cur.body.season.id).toBe(2);
    expect(cur.body.games).toBe(seasonGames(2).length);
    const all = (await api(r.base, 'GET', '/api/standings?season=all', { token: D.token })).body as StandingsResponse;
    const codes = new Set(all.rows.flatMap((row) => row.lastFive.map((c) => c.code)));
    expect(codes.has(voided.code)).toBe(false);
    expect(codes.has(unfinished)).toBe(false);
    for (const bad of ['0', '-1', 'x', '1.5', '99999', '%00', 'all%20']) {
      const res = await api(r.base, 'GET', `/api/standings?season=${bad}`, { token: D.token });
      expect([400, 404], bad).toContain(res.status);
      expect(typeof res.body.error).toBe('string');
    }
  });
});

describe('head-to-head', () => {
  it('Alice v Bob: record, timeline, streaks, skunks, averages and best hands from their two-player games', async () => {
    const res = await api(r.base, 'GET', `/api/h2h/${A.id}/${B.id}`, { token: D.token });
    expect(res.status).toBe(200);
    const h = res.body as HeadToHead;
    const singles = done.filter((g) => g.players === 2 && g.seats.includes(A.id) && g.seats.includes(B.id));
    expect(singles.length).toBeGreaterThanOrEqual(4);
    expect(h.played).toBe(singles.length);
    const oa = outs(singles, A.id);
    const ob = outs(singles, B.id);
    let aw = 0, bw = 0;
    expect(h.timeline).toEqual(singles.map((g, i) => {
      if (oa[i].won) aw++; else bw++;
      return {
        code: g.code, finishedAt: readGame(tmp.dbPath, g.code).row.finished_at, seasonId: g.season,
        scores: [oa[i].pf, ob[i].pf], winner: oa[i].won ? A.id : B.id, skunk: oa[i].won ? ob[i].taken : oa[i].taken, record: [aw, bw],
      };
    }));
    for (const [side, mine, theirs, who] of [[h.a, oa, ob, A], [h.b, ob, oa, B]] as const) {
      const l = line(mine);
      const rs = mine.map((o) => o.won);
      const st = streakOf(rs);
      expect(side.player.id).toBe(who.id);
      expect(side).toMatchObject({
        won: l.won, matchPoints: l.matchPoints, skunksGiven: l.skunksGiven, doubleSkunksGiven: l.doubleSkunksGiven,
        skunksTaken: line(theirs).skunksGiven, doubleSkunksTaken: line(theirs).doubleSkunksGiven, pointsFor: l.pointsFor,
        currentStreak: st && st.result === 'W' ? st.length : 0, longestStreak: longestWins(rs),
      });
      expect(side.averages).toEqual(avgs(singles, who.id));
      const top = bestOf(handFacts(singles, who.id).hands)!;
      expect(side.bestHand).toMatchObject({ code: top.code, handNo: top.handNo, points: top.pts, cards: top.cards, starter: top.starter, crib: false });
    }
    expect(h.a.bestHand!.points).toBe(29);
    expect(h.b.doubleSkunksTaken).toBeGreaterThanOrEqual(1);

    // Partners: Alice & Bob on the same side of a four-player game.
    const partner = done.filter((g) => g.players === 4 && g.seats.includes(A.id) && g.seats.includes(B.id) && g.seats.indexOf(A.id) % 2 === g.seats.indexOf(B.id) % 2);
    expect(partner).toHaveLength(1);
    const pw = partner.filter((g) => out(g, A.id)!.won).length;
    expect(h.partners).toEqual({ played: 1, won: pw, lost: 1 - pw, games: partner.map((g) => g.code) });

    // Opponents in bigger games.
    const opp = done.filter((g) => g.players > 2 && g.seats.includes(A.id) && g.seats.includes(B.id) && !partner.includes(g));
    expect(opp.map((g) => g.players).sort()).toEqual([3, 3, 4]);
    const place = (g: Done, seat: number) => {
      const t = g.players === 4 ? seat % 2 : seat;
      const sc = g.final.scores;
      return t === g.final.winner ? 1 : 1 + sc.filter((x, u) => u === g.final.winner || x > sc[t]).length;
    };
    const sum = (f: (g: Done) => boolean) => opp.filter(f).length;
    expect(h.opponents).toEqual({
      played: opp.length,
      threePlayer: sum((g) => g.players === 3),
      fourPlayer: sum((g) => g.players === 4),
      aWon: sum((g) => out(g, A.id)!.won),
      bWon: sum((g) => out(g, B.id)!.won),
      neitherWon: sum((g) => !out(g, A.id)!.won && !out(g, B.id)!.won),
      aAhead: sum((g) => place(g, g.seats.indexOf(A.id)) < place(g, g.seats.indexOf(B.id))),
      bAhead: sum((g) => place(g, g.seats.indexOf(B.id)) < place(g, g.seats.indexOf(A.id))),
      games: opp.map((g) => g.code),
    });
  });

  it('is symmetric, filters by season, and validates its players', async () => {
    const ab = (await api(r.base, 'GET', `/api/h2h/${A.id}/${B.id}`, { token: Cc.token })).body as HeadToHead;
    const ba = (await api(r.base, 'GET', `/api/h2h/${B.id}/${A.id}`, { token: Cc.token })).body as HeadToHead;
    expect(ba.a).toEqual(ab.b);
    expect(ba.b).toEqual(ab.a);
    expect(ba.timeline.map((t) => [t.code, t.scores, t.winner])).toEqual(ab.timeline.map((t) => [t.code, [t.scores[1], t.scores[0]], t.winner]));
    const s2 = (await api(r.base, 'GET', `/api/h2h/${A.id}/${Cc.id}?season=2`, { token: B.token })).body as HeadToHead;
    expect(s2.played).toBe(1);
    expect(s2.season!.id).toBe(2);
    // Alice v Carol all time: the voided game is not there.
    const ac = (await api(r.base, 'GET', `/api/h2h/${A.id}/${Cc.id}`, { token: B.token })).body as HeadToHead;
    expect(ac.timeline.map((t) => t.code)).not.toContain(voided.code);
    expect((await api(r.base, 'GET', `/api/h2h/${A.id}/${A.id}`, { token: B.token })).status).toBe(400);
    expect((await api(r.base, 'GET', `/api/h2h/${A.id}/NOPE`, { token: B.token })).status).toBe(404);
    expect((await api(r.base, 'GET', `/api/h2h/${A.id}/${'x'.repeat(65)}`, { token: B.token })).status).toBe(400);
    expect((await api(r.base, 'GET', `/api/h2h/${A.id}/${B.id}`)).status).toBe(401);
  });
});

describe('player stats and honours', () => {
  const kinds = ['twenty-nine', 'twenty-eight', 'nineteen', 'double-skunk', 'kiwi'] as const;
  const honourList = (games: Done[], pid: string) => {
    const f = handFacts(games, pid);
    const at = (code: string) => readGame(tmp.dbPath, code).row.finished_at!;
    return {
      'twenty-nine': [...f.hands, ...f.cribs].filter((h) => h.pts === 29).map((h) => h.code + '#' + h.handNo),
      'twenty-eight': [...f.hands, ...f.cribs].filter((h) => h.pts === 28).map((h) => h.code + '#' + h.handNo),
      nineteen: f.hands.filter((h) => h.pts === 0).map((h) => h.code + '#' + h.handNo),
      'double-skunk': outs(games, pid).filter((o) => o.given === 2).map((o) => o.g.code),
      kiwi: outs(games, pid).filter((o) => o.taken >= 1).map((o) => o.g.code),
      at,
    };
  };

  for (const who of ['Alice', 'Bob', 'Carol', 'Dave']) {
    it(`${who}: record by size, averages, best hands, streaks and honours`, async () => {
      const p = [A, B, Cc, D].find((x) => x.name === who)!;
      const res = await api(r.base, 'GET', `/api/players/${p.id}/stats`, { token: A.token });
      expect(res.status).toBe(200);
      const s = res.body as PlayerStats;
      const games = seasonGames('all');
      const os = outs(games, p.id);
      expect(s.overall).toEqual(line(os));
      for (const n of [2, 3, 4] as const) {
        expect(s.bySize[String(n) as '2']).toEqual(line(os.filter((o) => o.g.players === n)));
        expect(s.averagesBySize[String(n) as '2']).toEqual(avgs(games.filter((g) => g.players === n), p.id));
      }
      expect(s.averages).toEqual(avgs(games, p.id));
      const f = handFacts(games, p.id);
      const bh = bestOf(f.hands)!;
      expect(s.bestHand).toMatchObject({ code: bh.code, handNo: bh.handNo, points: bh.pts, cards: bh.cards, starter: bh.starter });
      const bc = bestOf(f.cribs);
      if (bc) expect(s.bestCrib).toMatchObject({ code: bc.code, handNo: bc.handNo, points: bc.pts, crib: true });
      else expect(s.bestCrib).toBeNull();
      const rs = os.map((o) => o.won);
      expect(s.currentStreak).toEqual(streakOf(rs));
      expect(s.longestWinningStreak).toBe(longestWins(rs));
      expect(s.recent.map((x) => x.code)).toEqual(os.slice(-10).reverse().map((o) => o.g.code));
      const want = honourList(games, p.id);
      expect(s.honours.map((h) => h.kind)).toEqual([...kinds]);
      for (const h of s.honours) {
        const list = want[h.kind];
        expect(h.count, h.kind).toBe(list.length);
        const key = (o: { code: string; handNo: number | null }) => (o.handNo === null ? o.code : o.code + '#' + o.handNo);
        expect(h.recent.map(key).sort()).toEqual([...list].slice(-20).sort());
        if (list.length) {
          expect(h.first).not.toBeNull();
          expect(h.latest!.at >= h.first!.at).toBe(true);
          if (h.kind === 'double-skunk' || h.kind === 'kiwi') expect(h.latest!.at).toBe(want.at(h.latest!.code));
          else expect(h.latest!.cards).toHaveLength(4);
        } else {
          expect(h.first).toBeNull();
          expect(h.latest).toBeNull();
        }
      }
    });
  }

  it('the scripted honours landed where expected', async () => {
    const a = (await api(r.base, 'GET', `/api/players/${A.id}/stats`, { token: B.token })).body as PlayerStats;
    const b = (await api(r.base, 'GET', `/api/players/${B.id}/stats`, { token: B.token })).body as PlayerStats;
    const count = (s: PlayerStats, k: string) => s.honours.find((h) => h.kind === k)!.count;
    expect(count(a, 'twenty-nine')).toBeGreaterThanOrEqual(3);
    expect(count(a, 'double-skunk')).toBeGreaterThanOrEqual(1);
    expect(count(a, 'nineteen')).toBeGreaterThanOrEqual(1);
    expect(count(b, 'twenty-eight')).toBeGreaterThanOrEqual(1);
    expect(count(b, 'kiwi')).toBeGreaterThanOrEqual(1);
    const t29 = a.honours.find((h) => h.kind === 'twenty-nine')!.first!;
    expect(t29.code).toBe(done[0].code);
    expect([...t29.cards!].sort((x, y) => x - y)).toEqual([...FIVES, C(10, 3)].sort((x, y) => x - y));
    expect(t29.starter).toBe(C(4, 3));
    expect(a.bestHand!.points).toBe(29);
  });

  it('the hall of fame lists every holder of every honour, best hands and streaks', async () => {
    const res = await api(r.base, 'GET', '/api/hall-of-fame', { token: D.token });
    expect(res.status).toBe(200);
    const games = seasonGames('all');
    for (const entry of res.body.honours as { kind: (typeof kinds)[number]; holders: { player: { id: string }; count: number }[] }[]) {
      const want = [A, B, Cc, D]
        .map((p) => ({ id: p.id, count: honourList(games, p.id)[entry.kind].length }))
        .filter((x) => x.count > 0);
      expect(entry.holders.map((h) => ({ id: h.player.id, count: h.count })).sort((x, y) => (x.id < y.id ? -1 : 1)))
        .toEqual(want.sort((x, y) => (x.id < y.id ? -1 : 1)));
      for (let i = 1; i < entry.holders.length; i++) expect(entry.holders[i - 1].count).toBeGreaterThanOrEqual(entry.holders[i].count);
    }
    const allHands = [A, B, Cc, D].flatMap((p) => handFacts(games, p.id).hands.map((h) => h.pts)).sort((x, y) => y - x);
    expect(res.body.bestHands.map((x: { hand: { points: number } }) => x.hand.points)).toEqual(allHands.slice(0, 10));
    const streakWant = [A, B, Cc, D]
      .map((p) => ({ id: p.id, length: longestWins(outs(games, p.id).map((o) => o.won)) }))
      .filter((x) => x.length > 0)
      .sort((x, y) => y.length - x.length);
    expect(res.body.longestStreaks.map((x: { length: number }) => x.length)).toEqual(streakWant.map((x) => x.length));
    // Season filter: season 2 has no 29.
    const s2 = await api(r.base, 'GET', '/api/hall-of-fame?season=2', { token: D.token });
    expect(s2.body.honours.find((h: { kind: string }) => h.kind === 'twenty-nine').holders).toEqual([]);
  });
});
