// Independent audit of the league statistics.
//
// A league of eight members plays ~45 real games over real sockets (2, 3 and 4
// players, two seasons, scripted endings, skunks of every size, a voided game,
// a deactivated member). The moves come from pure-engine simulations replayed
// over the sockets, but every number the API is checked against here is worked
// out from NOTHING except the `state` messages (views + events) the simulated
// players received. This file deliberately does not import server/src/stats.ts,
// the hands table, or anything of the server's own bookkeeping.
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Card, sortHand } from '../../shared/cards.js';
import {
  type Action, applyAction, type GameState, newGame, type PlayerCount, type ServerMsg,
} from '../../shared/game.js';
import type {
  HallOfFame, HeadToHead, PlayerStats, ResultsResponse, StandingsResponse,
} from '../../shared/league.js';
import { connectAll, Decks, fixtureGame, lcg, movers, randomPolicy, seededDeck } from './league-helpers.js';
import { api, newPlayer, type Player, type Running, startApp, type StateMsg, tempDir } from './test-helpers.js';

// ------------------------------------------------------------------ scripts (pure engine)

interface Script { decks: Card[][]; init: GameState; actions: { seat: number; action: Action }[]; final: GameState }

const simulate = (seed: number, size: PlayerCount, initScores: number[] | null): Script | null => {
  const rand = lcg(seed);
  const decks: Card[][] = [];
  const shuffle = () => { const d = seededDeck(rand); decks.push([...d]); return d; };
  let s = newGame(shuffle, 121, size).state;
  if (initScores) { s.scores = [...initScores]; s.back = [...initScores]; }
  const init = structuredClone(s);
  const pr = lcg(seed * 7 + 1);
  const actions: Script['actions'] = [];
  for (let i = 0; s.phase !== 'over'; i++) {
    if (i > 3000) return null;
    const who = movers(s);
    const seat = who[Math.floor(pr() * who.length)];
    const action = randomPolicy(s, seat, pr);
    s = applyAction(s, seat, action, shuffle).state;
    actions.push({ seat, action });
  }
  return { decks, init, actions, final: s };
};

let seedCounter = 1000;
const find = (size: PlayerCount, init: number[] | null, pred: (f: GameState) => boolean = () => true): Script => {
  for (let tries = 0; tries < 40000; tries++) {
    const sc = simulate(seedCounter++, size, init);
    if (sc && pred(sc.final)) return sc;
  }
  throw new Error(`no scenario found for size ${size} init ${JSON.stringify(init)}`);
};
const plays = (f: GameState) => f.handLog!.peg.filter((p) => p.t === 'play').length;
const loser = (f: GameState) => f.scores[f.winner === 0 ? 1 : 0];

// ------------------------------------------------------------------ observation from sockets only

interface ObsHand {
  handNo: number;
  shows: { seat: number; crib: boolean; total: number; cards: Card[] }[];
  starter: Card | null;
  peg: number[];
  heels: number;
  plays: number;
}
interface Obs {
  code: string;
  size: PlayerCount;
  seats: string[];
  season: number;
  voided: boolean;
  scores: number[];
  winner: number;
  hands: ObsHand[];
  order: number;
}

const observe = (msgs: ServerMsg[], size: PlayerCount): { hands: ObsHand[]; scores: number[]; winner: number } => {
  const states = msgs.filter((m): m is StateMsg => m.t === 'state' && m.view !== null);
  const hands = new Map<number, ObsHand>();
  const hand = (n: number) => {
    let h = hands.get(n);
    if (!h) hands.set(n, (h = { handNo: n, shows: [], starter: null, peg: Array(size).fill(0), heels: 0, plays: 0 }));
    return h;
  };
  let cur = states[0].view!.handNo;
  for (const m of states) {
    for (const e of m.events) {
      if (e.t === 'deal') cur = e.handNo;
      else if (e.t === 'play') hand(cur).plays++;
      else if (e.t === 'score' && e.why === 'peg') hand(cur).peg[e.seat] += e.points;
      else if (e.t === 'score' && e.why === 'heels') hand(cur).heels += e.points;
    }
    const v = m.view!;
    const h = hand(v.handNo);
    if (v.starter !== null) h.starter = v.starter;
    if (v.showResult && !h.shows.some((x) => x.crib === v.showResult!.crib && x.seat === v.showResult!.seat)) {
      h.shows.push({ seat: v.showResult.seat, crib: v.showResult.crib, total: v.showResult.total, cards: [...v.showResult.cards] });
    }
  }
  const last = states[states.length - 1].view!;
  return { hands: [...hands.values()].sort((a, b) => a.handNo - b.handNo), scores: [...last.scores], winner: last.winner! };
};

// ------------------------------------------------------------------ the reference calculator

const skunkOf = (sc: number) => (sc < 61 ? 2 : sc < 91 ? 1 : 0);
const teamOf = (size: number, seat: number) => (size === 4 ? seat % 2 : seat);
const teamsOf = (size: number) => (size === 4 ? 2 : size);

interface Out { g: Obs; seat: number; won: boolean; mp: number; given: number; taken: number; pf: number; pa: number }
const outcome = (g: Obs, pid: string): Out | null => {
  const seat = g.seats.indexOf(pid);
  if (seat < 0) return null;
  const team = teamOf(g.size, seat);
  const ts = Array.from({ length: teamsOf(g.size) }, (_, t) => t);
  const won = team === g.winner;
  const worst = Math.max(...ts.filter((t) => t !== g.winner).map((t) => skunkOf(g.scores[t])));
  return {
    g, seat, won, mp: won ? 2 + worst : 0, given: won ? worst : 0, taken: won ? 0 : skunkOf(g.scores[team]),
    pf: g.scores[team], pa: Math.max(...ts.filter((t) => t !== team).map((t) => g.scores[t])),
  };
};
const outs = (gs: Obs[], pid: string) => gs.map((g) => outcome(g, pid)).filter((o): o is Out => o !== null);

const lineOf = (os: Out[]) => {
  const won = os.filter((o) => o.won).length;
  return {
    played: os.length, won, lost: os.length - won, matchPoints: os.reduce((t, o) => t + o.mp, 0),
    winRate: os.length ? won / os.length : 0,
    skunksGiven: os.filter((o) => o.given >= 1).length, skunksTaken: os.filter((o) => o.taken >= 1).length,
    doubleSkunksGiven: os.filter((o) => o.given === 2).length, doubleSkunksTaken: os.filter((o) => o.taken === 2).length,
    pointsFor: os.reduce((t, o) => t + o.pf, 0), pointsAgainst: os.reduce((t, o) => t + o.pa, 0),
  };
};
const streakNow = (os: Out[]) => {
  if (!os.length) return null;
  const last = os[os.length - 1].won;
  let n = 0;
  for (let i = os.length - 1; i >= 0 && os[i].won === last; i--) n++;
  return { result: last ? 'W' : 'L', length: n };
};
const longestWin = (os: Out[]) => {
  let best = 0, run = 0;
  for (const o of os) { run = o.won ? run + 1 : 0; best = Math.max(best, run); }
  return best;
};

interface Fact { code: string; handNo: number; pts: number; cards: Card[]; starter: Card; idx: number }
const factsOf = (gs: Obs[], pid: string) => {
  const hands: Fact[] = [], cribs: Fact[] = [];
  const pegs: number[] = [];
  let idx = 0;
  for (const g of gs) {
    const seat = g.seats.indexOf(pid);
    for (const h of g.hands) {
      if (seat < 0) continue;
      for (const s of h.shows) {
        if (s.seat !== seat) continue;
        (s.crib ? cribs : hands).push({ code: g.code, handNo: h.handNo, pts: s.total, cards: sortHand(s.cards), starter: h.starter!, idx: idx++ });
      }
      if (h.plays === 4 * g.size) pegs.push(h.peg[seat]);
    }
  }
  return { hands, cribs, pegs };
};
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
const averagesOf = (gs: Obs[], pid: string) => {
  const f = factsOf(gs, pid);
  const hs = f.hands.map((x) => x.pts), cs = f.cribs.map((x) => x.pts);
  return {
    hand: hs.length ? sum(hs) / hs.length : null, handTotal: sum(hs), hands: hs.length,
    crib: cs.length ? sum(cs) / cs.length : null, cribTotal: sum(cs), cribs: cs.length,
    pegging: f.pegs.length ? sum(f.pegs) / f.pegs.length : null, peggingTotal: sum(f.pegs), peggingHands: f.pegs.length,
  };
};
const topOf = (facts: Fact[]): Fact | null => {
  let top: Fact | null = null;
  for (const x of facts) if (!top || x.pts > top.pts) top = x; // strictly greater: the earliest keeps a tie
  return top;
};

type Kind = 'twenty-nine' | 'twenty-eight' | 'nineteen' | 'double-skunk' | 'kiwi';
const KINDS: Kind[] = ['twenty-nine', 'twenty-eight', 'nineteen', 'double-skunk', 'kiwi'];
interface Occ { code: string; handNo: number | null; cards: Card[] | null; starter: Card | null }
const honoursOf = (gs: Obs[], pid: string): Record<Kind, Occ[]> => {
  const out: Record<Kind, Occ[]> = { 'twenty-nine': [], 'twenty-eight': [], nineteen: [], 'double-skunk': [], kiwi: [] };
  for (const g of gs) {
    const seat = g.seats.indexOf(pid);
    if (seat < 0) continue;
    for (const h of g.hands) {
      for (const s of h.shows) {
        if (s.seat !== seat) continue;
        const occ: Occ = { code: g.code, handNo: h.handNo, cards: sortHand(s.cards), starter: h.starter };
        if (s.total === 29) out['twenty-nine'].push(occ);
        if (s.total === 28) out['twenty-eight'].push(occ);
        if (s.total === 0 && !s.crib) out.nineteen.push(occ);
      }
    }
  }
  // game honours land after hand honours in the same game, but are separate kinds, so order within a kind is by game
  const flat: { kind: Kind; order: number; occ: Occ }[] = [];
  for (const g of gs) {
    const o = outcome(g, pid);
    if (!o) continue;
    const occ: Occ = { code: g.code, handNo: null, cards: null, starter: null };
    if (o.given === 2) flat.push({ kind: 'double-skunk', order: g.order, occ });
    if (o.taken >= 1) flat.push({ kind: 'kiwi', order: g.order, occ });
  }
  for (const f of flat) out[f.kind].push(f.occ);
  return out;
};

// ------------------------------------------------------------------ the league

let tmp: ReturnType<typeof tempDir>;
let r: Running;
const decks = new Decks(5);
const P: Record<string, Player> = {};
const NAMES = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'];
const active = new Set<string>();
const games: Obs[] = [];
let season = 1;
let finishCounter = 0;
const fixtureOf = new Map<string, string>();

const setState = (code: string, st: GameState) => {
  const db = new Database(tmp.dbPath);
  db.prepare('UPDATE games SET state = ?, scores = ? WHERE code = ?').run(JSON.stringify(st), JSON.stringify(st.scores), code);
  db.close();
};

/** Play a script over real sockets between these players (seat order). Everything recorded comes from the messages. */
const play = async (who: string[], sc: Script, opts: { midway?: { at: number; fn: () => Promise<void> }; keepOpen?: boolean } = {}): Promise<Obs> => {
  const bySeat = who.map((n) => P[n]);
  decks.clear();
  decks.push(...sc.decks);
  const seasonAtStart = season;
  const { code, fixtureId } = await fixtureGame(r, bySeat[0], bySeat.slice(1));
  const hasInit = sc.init.scores.some((x) => x > 0);
  if (hasInit) setState(code, sc.init);
  const seats = await connectAll(r, code, bySeat);
  for (let i = 0; i < sc.actions.length; i++) {
    if (opts.midway && opts.midway.at === i) await opts.midway.fn();
    const { seat, action } = sc.actions[i];
    const counts = seats.map((s) => s.client.msgs.length);
    seats[seat].client.send({ t: 'act', action });
    const reply = await seats[seat].client.waitCount(counts[seat] + 1);
    if (reply.t !== 'state') throw new Error(`step ${i} rejected: ${JSON.stringify(reply)}`);
    await Promise.all(seats.map((s, k) => s.client.waitCount(counts[k] + 1)));
  }
  const o = observe(seats[0].client.msgs, bySeat.length as PlayerCount);
  for (const s of seats) await s.client.close();
  decks.clear();
  expect(o.scores, 'observed final scores equal the simulation').toEqual(sc.final.scores);
  const obs: Obs = { code, size: bySeat.length as PlayerCount, seats: bySeat.map((p) => p.id), season: seasonAtStart, voided: false, ...o, order: ++finishCounter };
  games.push(obs);
  fixtureOf.set(code, fixtureId);
  return obs;
};

const counted = (s: number | 'all') => games.filter((g) => !g.voided && (s === 'all' || g.season === s)).sort((a, b) => a.order - b.order);
const members = () => NAMES.filter((n) => active.has(n)).map((n) => P[n]);
const byName = (id: string) => NAMES.find((n) => P[n].id === id)!;

const rankKey = (l: ReturnType<typeof lineOf>) => [l.played > 0 ? 1 : 0, l.matchPoints, l.winRate, l.pointsFor - l.pointsAgainst];

const expectStandings = (body: StandingsResponse, s: number | 'all') => {
  const gs = counted(s);
  expect(body.games).toBe(gs.length);
  const want = members().map((p) => {
    const os = outs(gs, p.id);
    return { p, os, l: lineOf(os) };
  });
  want.sort((a, b) => {
    const ka = rankKey(a.l), kb = rankKey(b.l);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return a.p.name.localeCompare(b.p.name);
  });
  expect(body.rows.map((x) => x.player.id)).toEqual(want.map((w) => w.p.id));
  let rank = 0;
  body.rows.forEach((row, i) => {
    const w = want[i];
    const eq = i > 0 && rankKey(want[i - 1].l).every((k, j) => k === rankKey(w.l)[j]);
    if (!eq) rank = i + 1;
    expect(row.rank, `rank of ${w.p.name}`).toBe(rank);
    expect(row, w.p.name).toMatchObject({
      ...w.l, pointDifference: w.l.pointsFor - w.l.pointsAgainst, streak: streakNow(w.os),
    });
    expect(row.lastFive.map((c) => c.code), `${w.p.name} last five`).toEqual(w.os.slice(-5).reverse().map((o) => o.g.code));
    row.lastFive.forEach((chip, k) => {
      const o = w.os.slice(-5).reverse()[k];
      expect(chip).toMatchObject({ result: o.won ? 'W' : 'L', players: o.g.size, score: o.pf, opponentScore: o.pa, skunk: o.won ? o.given : o.taken });
    });
  });
};

const expectH2H = (h: HeadToHead, a: Player, b: Player, s: number | 'all') => {
  const gs = counted(s).filter((g) => g.seats.includes(a.id) && g.seats.includes(b.id));
  const singles = gs.filter((g) => g.size === 2);
  const oa = outs(singles, a.id), ob = outs(singles, b.id);
  expect(h.played).toBe(singles.length);
  let aw = 0, bw = 0;
  expect(h.timeline.map((t) => ({ code: t.code, seasonId: t.seasonId, scores: t.scores, winner: t.winner, skunk: t.skunk }))).toEqual(
    singles.map((g, i) => ({ code: g.code, seasonId: g.season, scores: [oa[i].pf, ob[i].pf], winner: oa[i].won ? a.id : b.id, skunk: oa[i].won ? ob[i].taken : oa[i].taken })),
  );
  h.timeline.forEach((t, i) => {
    if (oa[i].won) aw++; else bw++;
    expect(t.record).toEqual([aw, bw]);
    if (i > 0) expect(t.finishedAt >= h.timeline[i - 1].finishedAt).toBe(true);
  });
  for (const [side, mine, theirs, who] of [[h.a, oa, ob, a], [h.b, ob, oa, b]] as const) {
    const l = lineOf(mine);
    const st = streakNow(mine);
    expect(side.player.id).toBe(who.id);
    expect(side).toMatchObject({
      won: l.won, matchPoints: l.matchPoints, skunksGiven: l.skunksGiven, doubleSkunksGiven: l.doubleSkunksGiven,
      skunksTaken: lineOf(theirs).skunksGiven, doubleSkunksTaken: lineOf(theirs).doubleSkunksGiven,
      pointsFor: l.pointsFor, currentStreak: st && st.result === 'W' ? st.length : 0, longestStreak: longestWin(mine),
    });
    expect(side.averages).toEqual(averagesOf(singles, who.id));
    const top = topOf(factsOf(singles, who.id).hands);
    if (!top) expect(side.bestHand).toBeNull();
    else {
      expect(side.bestHand).toMatchObject({ code: top.code, handNo: top.handNo, points: top.pts, starter: top.starter, crib: false });
      expect(sortHand(side.bestHand!.cards)).toEqual(top.cards);
    }
  }
  const partner = gs.filter((g) => g.size === 4 && teamOf(4, g.seats.indexOf(a.id)) === teamOf(4, g.seats.indexOf(b.id)));
  const pw = partner.filter((g) => outcome(g, a.id)!.won).length;
  expect(h.partners).toEqual({ played: partner.length, won: pw, lost: partner.length - pw, games: partner.map((g) => g.code) });
  const opp = gs.filter((g) => g.size > 2 && !partner.includes(g));
  const place = (g: Obs, id: string) => {
    const t = teamOf(g.size, g.seats.indexOf(id));
    if (t === g.winner) return 1;
    return 1 + Array.from({ length: teamsOf(g.size) }, (_, u) => u).filter((u) => u !== t && (u === g.winner || g.scores[u] > g.scores[t])).length;
  };
  const cnt = (f: (g: Obs) => boolean) => opp.filter(f).length;
  expect(h.opponents).toEqual({
    played: opp.length, threePlayer: cnt((g) => g.size === 3), fourPlayer: cnt((g) => g.size === 4),
    aWon: cnt((g) => outcome(g, a.id)!.won), bWon: cnt((g) => outcome(g, b.id)!.won),
    neitherWon: cnt((g) => !outcome(g, a.id)!.won && !outcome(g, b.id)!.won),
    aAhead: cnt((g) => place(g, a.id) < place(g, b.id)), bAhead: cnt((g) => place(g, b.id) < place(g, a.id)),
    games: opp.map((g) => g.code),
  });
};

const expectPlayerStats = (st: PlayerStats, p: Player, s: number | 'all') => {
  const gs = counted(s);
  const os = outs(gs, p.id);
  expect(st.overall).toEqual(lineOf(os));
  for (const n of [2, 3, 4] as const) {
    expect(st.bySize[String(n) as '2'], `bySize ${n}`).toEqual(lineOf(os.filter((o) => o.g.size === n)));
    expect(st.averagesBySize[String(n) as '2'], `averagesBySize ${n}`).toEqual(averagesOf(gs.filter((g) => g.size === n), p.id));
  }
  expect(st.averages).toEqual(averagesOf(gs, p.id));
  const f = factsOf(gs, p.id);
  for (const [got, top, crib] of [[st.bestHand, topOf(f.hands), false], [st.bestCrib, topOf(f.cribs), true]] as const) {
    if (!top) expect(got).toBeNull();
    else {
      expect(got).toMatchObject({ code: top.code, handNo: top.handNo, points: top.pts, starter: top.starter, crib });
      expect(sortHand(got!.cards)).toEqual(top.cards);
    }
  }
  expect(st.currentStreak).toEqual(streakNow(os));
  expect(st.longestWinningStreak).toBe(longestWin(os));
  expect(st.recent.map((c) => c.code)).toEqual(os.slice(-10).reverse().map((o) => o.g.code));
  const hon = honoursOf(gs, p.id);
  expect(st.honours.map((h) => h.kind)).toEqual(KINDS);
  for (const h of st.honours) {
    const want = hon[h.kind];
    expect(h.count, `${p.name} ${h.kind}`).toBe(want.length);
    const key = (o: { code: string; handNo: number | null; cards: Card[] | null }) => `${o.code}#${o.handNo}#${o.cards ? sortHand(o.cards).join(',') : ''}`;
    expect(h.recent.map(key)).toEqual(want.slice(-20).reverse().map(key));
    expect(h.first && key(h.first)).toEqual(want.length ? key(want[0]) : null);
    expect(h.latest && key(h.latest)).toEqual(want.length ? key(want[want.length - 1]) : null);
  }
};

const expectHallOfFame = (hof: HallOfFame, s: number | 'all') => {
  const gs = counted(s);
  const everyone = NAMES.map((n) => P[n]); // deactivated members stay in the hall
  for (const kind of KINDS) {
    const entry = hof.honours.find((h) => h.kind === kind)!;
    const want = everyone.map((p) => ({ id: p.id, occ: honoursOf(gs, p.id)[kind] })).filter((x) => x.occ.length > 0);
    expect(entry.holders.map((h) => [h.player.id, h.count]).sort()).toEqual(want.map((x) => [x.id, x.occ.length]).sort());
    for (let i = 1; i < entry.holders.length; i++) expect(entry.holders[i - 1].count).toBeGreaterThanOrEqual(entry.holders[i].count);
    for (const h of entry.holders) {
      const w = want.find((x) => x.id === h.player.id)!;
      expect(h.latest.code).toBe(w.occ[w.occ.length - 1].code);
    }
  }
  const all = everyone.flatMap((p) => factsOf(gs, p.id).hands.map((x) => ({ p, ...x })));
  all.sort((x, y) => y.pts - x.pts);
  expect(hof.bestHands.map((b) => b.hand.points)).toEqual(all.slice(0, 10).map((x) => x.pts));
  for (const b of hof.bestHands) expect(all.some((x) => x.p.id === b.player.id && x.code === b.hand.code && x.handNo === b.hand.handNo && x.pts === b.hand.points)).toBe(true);
  const streaks = everyone.map((p) => ({ id: p.id, n: longestWin(outs(gs, p.id)) })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
  expect(hof.longestStreaks.map((x) => x.length)).toEqual(streaks.slice(0, 10).map((x) => x.n));
  for (const x of hof.longestStreaks) expect(streaks.find((y) => y.id === x.player.id)!.n).toBe(x.length);
};

const tok = () => P.Ann.token;
const get = async (path: string, token = tok()) => {
  const res = await api(r.base, 'GET', path, { token });
  expect(res.status, path).toBe(200);
  return res.body;
};

/** Check every statistics endpoint against the reference. */
const verifyAll = async (label: string) => {
  const seasons = [...new Set(games.map((g) => g.season))].concat(season).filter((x, i, a) => a.indexOf(x) === i);
  for (const s of [...seasons, 'all'] as (number | 'all')[]) {
    try {
      expectStandings(await get(`/api/standings?season=${s}`), s);
      for (let i = 0; i < NAMES.length; i++)
        for (let j = i + 1; j < NAMES.length; j++)
          expectH2H(await get(`/api/h2h/${P[NAMES[i]].id}/${P[NAMES[j]].id}?season=${s}`, P.Ben.token), P[NAMES[i]], P[NAMES[j]], s);
      for (const n of NAMES) expectPlayerStats(await get(`/api/players/${P[n].id}/stats?season=${s}`, P.Cat.token), P[n], s);
      expectHallOfFame(await get(`/api/hall-of-fame?season=${s}`, P.Dan.token), s);
    } catch (e) {
      (e as Error).message = `[${label}, season ${s}] ${(e as Error).message}`;
      throw e;
    }
  }
};

const rollover = async (name: string) => {
  expect((await api(r.base, 'POST', '/api/commissioner/seasons', { token: P.Ann.token, body: { name } })).status).toBe(201);
  season++;
};

beforeAll(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath, { shuffle: decks.shuffle });
  for (const n of NAMES) { P[n] = await newPlayer(r.base, n); active.add(n); }
}, 60_000);

afterAll(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

const winnerSeat = (w: number) => (f: GameState) => f.winner === w;
const full = (size: PlayerCount, w?: number) => find(size, null, w === undefined ? undefined : winnerSeat(w));

describe('a two-season league of eight, checked against an independent count', () => {
  it('season 1, part one: Ann streaks over Ben across a voided game', async () => {
    await play(['Ann', 'Ben'], full(2, 0));
    await play(['Ben', 'Ann'], full(2, 1)); // Ann wins again (seat 1)
    const toVoid = await play(['Ben', 'Ann'], full(2, 0)); // Ben wins: voided below
    await play(['Ann', 'Ben'], full(2, 0));
    await verifyAll('before void');
    // Streak with the game in: Ann W W L W (current 1, longest 2); the voided game then vanishes.
    const h1 = (await get(`/api/h2h/${P.Ann.id}/${P.Ben.id}`)) as HeadToHead;
    expect(h1.a.currentStreak).toBe(1);
    expect(h1.a.longestStreak).toBe(2);
    const v = await api(r.base, 'POST', `/api/commissioner/games/${toVoid.code}/void`, { token: P.Ann.token, body: { reason: 'dog ate the board' } });
    expect(v.status).toBe(200);
    toVoid.voided = true;
    await verifyAll('after void');
    const h2 = (await get(`/api/h2h/${P.Ann.id}/${P.Ben.id}`)) as HeadToHead;
    expect(h2.a.currentStreak).toBe(3);
    expect(h2.a.longestStreak).toBe(3);
    expect(h2.timeline.map((t) => t.record)).toEqual([[1, 0], [2, 0], [3, 0]]);
  }, 120_000);

  it('season 1, part two: scripted endings (mid-peg, heels, every count position, last card) with Hal still active', async () => {
    const nd = (f: GameState) => f.handLog!.shows.length;
    await play(['Cat', 'Hal'], find(2, [117, 117], (f) => nd(f) === 0 && plays(f) < 8 && f.handLog!.peg.length > 0)); // ends mid-pegging
    await play(['Hal', 'Dan'], find(2, [119, 119], (f) => f.handLog!.heels === 2 && f.handLog!.peg.length === 0 && f.winner === f.dealer)); // heels
    await play(['Eve', 'Hal'], find(2, [118, 118], (f) => nd(f) === 0 && plays(f) === 8)); // ends on the very last card
    await play(['Hal', 'Cat', 'Dan'], find(3, [100, 70, 70], (f) => f.winner === 0 && f.scores[1] === f.scores[2])); // tied losers
    await play(['Dan', 'Hal'], full(2));
    await play(['Hal', 'Eve', 'Fay', 'Gus'], find(4, [105, 40], (f) => f.skunk.some((k) => k === 2)));
    await verifyAll('scripted endings');
  }, 120_000);

  it('a member deactivated mid-season leaves the standings; their games still count for the others', async () => {
    const q = await api(r.base, 'POST', '/api/fixtures', { token: P.Dan.token, body: { opponents: [P.Hal.id] } });
    expect(q.status).toBe(201);
    expect((await api(r.base, 'POST', `/api/commissioner/players/${P.Hal.id}/deactivate`, { token: P.Ann.token })).status).toBe(200);
    active.delete('Hal');
    const fx = ((await get('/api/fixtures?status=all')) as { fixtures: { id: string; status: string }[] }).fixtures.find((f) => f.id === q.body.id);
    expect(fx!.status).toBe('cancelled');
    const st = (await get('/api/standings?season=1')) as StandingsResponse;
    expect(st.rows.some((x) => x.player.id === P.Hal.id)).toBe(false);
    await verifyAll('after deactivation');
  }, 120_000);

  it('season 1, part three: every count position, skunk boundaries 60 / 61 / 90 / 91, 3- and 4-player', async () => {
    const nd = (f: GameState) => f.handLog!.shows.length;
    await play(['Cat', 'Dan'], find(2, [105, 105], (f) => nd(f) === 1));
    await play(['Dan', 'Eve'], find(2, [105, 105], (f) => nd(f) === 2));
    await play(['Eve', 'Fay'], find(2, [105, 105], (f) => nd(f) === 3));
    const bounds = { 60: [100, 50], 61: [100, 50], 90: [100, 80], 91: [100, 80] } as const;
    const pairs: [string, string][] = [['Fay', 'Gus'], ['Gus', 'Ann'], ['Ben', 'Cat'], ['Cat', 'Eve']];
    const seen: number[] = [];
    for (const [i, want] of ([60, 61, 90, 91] as const).entries()) {
      const sc = find(2, [...bounds[want]], (f) => loser(f) === want);
      seen.push(loser(sc.final));
      const g = await play(pairs[i], sc);
      const lo = g.scores[g.winner === 0 ? 1 : 0];
      expect(skunkOf(lo)).toBe(want === 60 ? 2 : want === 61 ? 1 : want === 90 ? 1 : 0);
    }
    expect(seen).toEqual([60, 61, 90, 91]);
    await play(['Ann', 'Dan', 'Gus'], find(3, [100, 40, 50], (f) => f.skunk.some((k) => k === 2)));
    await play(['Ben', 'Eve', 'Fay'], full(3));
    await play(['Ann', 'Cat', 'Ben', 'Dan'], find(4, [100, 80], (f) => f.skunk.some((k) => k === 1)));
    await play(['Eve', 'Ann', 'Fay', 'Gus'], full(4));
    await play(['Dan', 'Ben', 'Gus', 'Cat'], find(4, [100, 60], (f) => f.winner === 1));
    await verifyAll('part three');
  }, 240_000);

  it('a game in progress when the season rolls over stays in the season it began in', async () => {
    const sc = full(2, 0);
    const g = await play(['Ben', 'Dan'], sc, { midway: { at: 20, fn: () => rollover('Spring') } });
    expect(g.season).toBe(1); // created in season 1
    expect(season).toBe(2);
    const res = (await get('/api/results?season=1')) as ResultsResponse;
    expect(res.games[0].code).toBe(g.code);
    await verifyAll('rollover game');
  }, 120_000);

  it('season 2: streak across the season boundary, three sizes, a loss ends it', async () => {
    // Ann beat Ben last in season 1 (game 4); her all-time run goes on.
    await play(['Ann', 'Ben'], full(2, 0));
    let h = (await get(`/api/h2h/${P.Ann.id}/${P.Ben.id}`)) as HeadToHead;
    expect(h.a.currentStreak).toBe(4); // season-1 W W (void) W, then season-2 W
    const h2 = (await get(`/api/h2h/${P.Ann.id}/${P.Ben.id}?season=2`)) as HeadToHead;
    expect(h2.a.currentStreak).toBe(1);
    await play(['Ben', 'Ann'], full(2, 0)); // Ben wins
    h = (await get(`/api/h2h/${P.Ann.id}/${P.Ben.id}`)) as HeadToHead;
    expect(h.a.currentStreak).toBe(0);
    expect(h.a.longestStreak).toBe(4);
    for (const [who, size] of [[['Cat', 'Dan'], 2], [['Eve', 'Fay'], 2], [['Gus', 'Ann'], 2], [['Dan', 'Gus', 'Ben'], 3], [['Ann', 'Eve', 'Cat'], 3], [['Fay', 'Gus', 'Ann', 'Eve'], 4], [['Ben', 'Cat', 'Dan', 'Fay'], 4]] as const)
      await play([...who], full(size));
    for (const [a, b] of [['Ann', 'Cat'], ['Cat', 'Ben'], ['Dan', 'Eve'], ['Fay', 'Ann'], ['Gus', 'Ben'], ['Eve', 'Cat']] as const)
      await play([a, b], find(2, [100, 70], () => true));
    await play(['Ben', 'Gus'], find(2, [119, 119], (f) => f.handLog!.heels === 2 && f.handLog!.peg.length === 0 && f.winner === f.dealer));
    await play(['Cat', 'Fay'], find(2, [117, 117], (f) => f.handLog!.shows.length === 0 && plays(f) < 8 && f.handLog!.peg.length > 0));
    await play(['Dan', 'Eve', 'Gus'], find(3, [100, 60, 60], (f) => f.scores[1] === f.scores[2] && f.winner === 0));
    await play(['Gus', 'Eve', 'Dan'], find(3, [60, 100, 60], (f) => f.scores[0] === f.scores[2] && f.winner === 1));
    await verifyAll('season 2');
  }, 300_000);

  it('void then unvoid: the game returns to its place in the order, streaks and all', async () => {
    const voidedBefore = games.find((g) => g.voided)!;
    const u = await api(r.base, 'POST', `/api/commissioner/games/${voidedBefore.code}/unvoid`, { token: P.Ann.token });
    expect(u.status).toBe(200);
    voidedBefore.voided = false;
    await verifyAll('after unvoid');
    const h = (await get(`/api/h2h/${P.Ann.id}/${P.Ben.id}?season=1`)) as HeadToHead;
    expect(h.a.longestStreak).toBe(2);
    expect(h.timeline.map((t) => t.record)).toEqual([[1, 0], [2, 0], [2, 1], [3, 1]]);
    // …and void again so later phases have a voided game to exclude.
    expect((await api(r.base, 'POST', `/api/commissioner/games/${voidedBefore.code}/void`, { token: P.Ann.token })).status).toBe(200);
    voidedBefore.voided = true;
  }, 300_000);

  it('a fixture game voided, replayed, then the original unvoided: both count, and the numbers stay self-consistent', async () => {
    const orig = games.filter((g) => g.season === 2 && g.size === 2 && !g.voided).slice(-1)[0];
    const [a, b] = orig.seats.map(byName);
    const fid = fixtureOf.get(orig.code)!;
    const v = await api(r.base, 'POST', `/api/commissioner/games/${orig.code}/void`, { token: P.Ann.token });
    expect(v.status).toBe(200);
    orig.voided = true;
    await verifyAll('fixture game voided');
    const q = (await get('/api/fixtures')) as { fixtures: { id: string; status: string; gameCode: string | null }[] };
    expect(q.fixtures.find((f) => f.id === fid)).toMatchObject({ status: 'queued', gameCode: null });
    // Replay through the same fixture.
    const replaySc = full(2);
    decks.clear();
    decks.push(...replaySc.decks);
    const started = await api(r.base, 'POST', `/api/fixtures/${fid}/start`, { token: P[a].token });
    expect(started.status).toBe(200);
    const code = started.body.code as string;
    const seats = await connectAll(r, code, [P[a], P[b]]);
    for (const { seat, action } of replaySc.actions) {
      const counts = seats.map((s) => s.client.msgs.length);
      seats[seat].client.send({ t: 'act', action });
      await Promise.all(seats.map((s, k) => s.client.waitCount(counts[k] + 1)));
    }
    const o = observe(seats[0].client.msgs, 2);
    for (const s of seats) await s.client.close();
    decks.clear();
    games.push({ code, size: 2, seats: [P[a].id, P[b].id], season, voided: false, ...o, order: ++finishCounter });
    expect(((await get('/api/fixtures?status=all')) as { fixtures: { id: string; status: string; gameCode: string }[] }).fixtures.find((f) => f.id === fid)).toMatchObject({ status: 'done', gameCode: code });
    await verifyAll('replayed');
    // Now the original comes back: two finished games from one fixture.
    expect((await api(r.base, 'POST', `/api/commissioner/games/${orig.code}/unvoid`, { token: P.Ann.token })).status).toBe(200);
    orig.voided = false;
    await verifyAll('original unvoided as well');
    const fx = ((await get('/api/fixtures?status=all')) as { fixtures: { id: string; status: string; gameCode: string }[] }).fixtures.find((f) => f.id === fid)!;
    expect(fx).toMatchObject({ status: 'done', gameCode: code }); // the fixture points at the replay
    const res = (await get('/api/results?season=2')) as ResultsResponse;
    expect(res.games.filter((g) => g.fixtureId === fid).map((g) => g.voided)).toEqual([false, false]);
    const st = (await get('/api/standings?season=2')) as StandingsResponse;
    expect(st.games).toBe(counted(2).length);
    // Both games count; the fixture still reads "done" once.
    expect(counted(2).filter((g) => fixtureOf.get(g.code) === fid || g.code === code)).toHaveLength(2);
    // Void the replay again: no one is left unplayed (the fixture stays attached to the replay).
    const rv = await api(r.base, 'POST', `/api/commissioner/games/${code}/void`, { token: P.Ann.token });
    expect(rv.status).toBe(200);
    games.find((g) => g.code === code)!.voided = true;
    await verifyAll('replay voided again');
    // Void the original while the replay is voided too: fixture queued again, with nothing counted.
    expect((await api(r.base, 'POST', `/api/commissioner/games/${orig.code}/void`, { token: P.Ann.token })).status).toBe(200);
    orig.voided = true;
    await verifyAll('both voided');
    for (const g of [orig, games.find((x) => x.code === code)!]) {
      expect((await api(r.base, 'POST', `/api/commissioner/games/${g.code}/unvoid`, { token: P.Ann.token })).status).toBe(200);
      g.voided = false;
    }
    await verifyAll('everything unvoided');
  }, 400_000);

  it('the results list and API ordering agree with the order games finished', async () => {
    const res = (await get('/api/results?season=all')) as ResultsResponse;
    const all = [...games].sort((x, y) => y.order - x.order);
    expect(res.games.map((g) => g.code)).toEqual(all.map((g) => g.code));
    for (const g of res.games) {
      const o = games.find((x) => x.code === g.code)!;
      expect(g.voided).toBe(o.voided);
      expect(g.scores).toEqual(o.scores);
      expect(g.winnerTeam).toBe(o.winner);
      expect(g.seats.map((p) => p.id)).toEqual(o.seats);
      expect(g.skunk).toEqual(o.scores.map((sc, t) => (t === o.winner ? 0 : skunkOf(sc))));
    }
    const mine = (await get(`/api/results?season=all&player=${P.Gus.id}`)) as ResultsResponse;
    expect(mine.games.map((g) => g.code)).toEqual(all.filter((g) => g.seats.includes(P.Gus.id)).map((g) => g.code));
    expect(games.length).toBeGreaterThanOrEqual(40);
  });

  it('best hands and hand honours come back sorted, as the contract says', async () => {
    // HandHighlight.cards: "The four cards kept (or the crib), sorted."
    let checked = 0;
    for (const n of NAMES) {
      const st = (await get(`/api/players/${P[n].id}/stats`)) as PlayerStats;
      if (st.bestHand) { checked++; expect(st.bestHand.cards, `${n} best hand`).toEqual(sortHand(st.bestHand.cards)); }
      for (const h of st.honours) for (const o of h.recent) if (o.cards && h.kind === 'nineteen') expect(o.cards).toEqual(sortHand(o.cards));
    }
    expect(checked).toBeGreaterThan(5);
  });

  // BUG (reported, now fixed): the crib in a HandHighlight was stored in seat order with the deck-to-crib
  // card first, not sorted, although shared/league.ts says "(or the crib), sorted". The show record of the
  // very same crib (/api/games/:code/hands -> shows[].cards) is sorted. Server: store.ts recordHand
  // built `crib` as [deckToCrib, ...discards.flat()] and stats.ts `highlight` returned it as stored.
  // Expected: bestCrib.cards (and crib honour occurrences) sorted ascending.
  it('BUG (fixed): bestCrib.cards is sorted', async () => {
    let checked = 0;
    for (const n of NAMES) {
      const st = (await get(`/api/players/${P[n].id}/stats`)) as PlayerStats;
      if (st.bestCrib) { checked++; expect(st.bestCrib.cards, `${n} best crib`).toEqual(sortHand(st.bestCrib.cards)); }
      for (const h of st.honours) for (const o of [...h.recent, h.first, h.latest]) if (o?.cards) expect(o.cards, `${n} ${h.kind}`).toEqual(sortHand(o.cards));
    }
    expect(checked).toBeGreaterThan(0);
  });
});
