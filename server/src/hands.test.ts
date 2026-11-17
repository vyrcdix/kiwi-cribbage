// Hand records: every hand of every game is stored with enough to replay it,
// matches what actually happened (checked against the authoritative states
// and events), and a hand in progress never reveals hidden cards.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sortHand } from '../../shared/cards.js';
import type { GameState, PlayerCount } from '../../shared/game.js';
import type { HandRecord, HandsResponse } from '../../shared/league.js';
import { connectAll, Decks, drive, fixtureGame, type HandObs, observe } from './league-helpers.js';
import { api, newPlayer, type Player, readGame, type Running, startApp, tempDir } from './test-helpers.js';

let tmp: ReturnType<typeof tempDir>;
let r: Running;
let people: Player[];

beforeEach(async () => {
  tmp = tempDir();
  r = await startApp(tmp.dbPath, { shuffle: new Decks(99).shuffle });
  people = [];
  for (const n of ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']) people.push(await newPlayer(r.base, n));
});
afterEach(async () => {
  await r.server.shutdown();
  tmp.cleanup();
});

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** A finished record agrees with what was observed for that hand. */
const expectMatches = (rec: HandRecord, h: HandObs, players: PlayerCount, last: boolean) => {
  expect(rec.handNo).toBe(h.handNo);
  expect(rec.dealer).toBe(h.dealer);
  expect(rec.complete).toBe(true);
  expect(rec.endedGame).toBe(last);
  expect(rec.dealt).toEqual(h.dealt.map(sortHand));
  expect(rec.kept.map((k) => sorted(k!))).toEqual(h.kept.map(sorted));
  rec.discards.forEach((d, s) => expect(sorted([...d!, ...rec.kept[s]!])).toEqual(sorted(h.dealt[s])));
  expect(sorted(rec.crib!)).toEqual(sorted(h.crib));
  if (players === 3) expect(h.crib).toContain(rec.deckToCrib);
  else expect(rec.deckToCrib).toBeNull();
  expect(rec.starter).toBe(h.starter);
  expect(rec.heels).toBe(h.heels);
  const plays = rec.peg.filter((p) => p.t === 'play');
  expect(plays.map((p) => ({ card: p.card, seat: p.seat }))).toEqual(h.played);
  const peg = Array(players).fill(0);
  for (const p of rec.peg) if (p.t !== 'go') peg[p.seat] += p.points;
  expect(peg).toEqual(h.peg);
  expect(rec.scoresAfter).toEqual(h.scoresAfter);
  const counted = rec.shows.filter((s) => s.counted);
  expect(counted.map((s) => ({ seat: s.seat, crib: s.crib, total: s.total, cards: s.cards }))).toEqual(h.shows);
  if (!last || h.peggedOut) expect(rec.shows).toHaveLength(players + 1);
  if (last) {
    // Whatever was never counted is listed as such, cards shown (the game is over).
    for (const s of rec.shows.filter((x) => !x.counted)) {
      expect(s.total).toBeNull();
      expect(s.items).toEqual([]);
      expect(s.cards).toHaveLength(4);
    }
    expect(rec.shows).toHaveLength(players + 1);
  } else expect(counted).toHaveLength(players + 1);
};

/** Every card mentioned anywhere in a record. */
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

for (const players of [2, 3, 4] as const) {
  it(`${players} players: every hand is recorded and matches play; in-progress hands hide what they should`, async () => {
    const bySeat = people.slice(0, players);
    const outsider = people[4];
    const { code } = await fixtureGame(r, bySeat[0], bySeat.slice(1));
    const seats = await connectAll(r, code, bySeat);

    // Mid-game: the outsider is refused, each player sees only what they may.
    let audited = 0;
    const audit = async (S: GameState) => {
      expect((await api(r.base, 'GET', `/api/games/${code}/hands`, { token: outsider.token })).status).toBe(403);
      for (let seat = 0; seat < players; seat++) {
        const res = await api(r.base, 'GET', `/api/games/${code}/hands`, { token: bySeat[seat].token });
        expect(res.status).toBe(200);
        const body = res.body as HandsResponse;
        expect(body.you).toBe(seat);
        const cur = body.hands[body.hands.length - 1];
        expect(cur.handNo).toBe(S.handNo);
        expect(cur.complete).toBe(false);
        expect(cur.finishedAt).toBeNull();
        expect(cur.crib).toBeNull();
        expect(cur.deckToCrib).toBeNull();
        cur.dealt.forEach((d, s) => expect(d === null).toBe(s !== seat));
        // Nothing hidden: every card is mine, played, the starter or already counted.
        const legit = new Set([
          ...cur.dealt[seat]!,
          ...S.played.map((p) => p.card),
          ...(S.starter === null ? [] : [S.starter]),
          ...(cur.shows.filter((x) => x.counted).flatMap((x) => x.cards!)),
        ]);
        for (const c of cardsIn(cur)) expect(legit.has(c), `card ${c} leaked to seat ${seat} in ${S.phase}`).toBe(true);
        for (const prev of body.hands.slice(0, -1)) expect(prev.complete).toBe(true);
      }
      audited++;
    };
    // Stop at a few interesting points: mid-discard, pegging, the show, hand 2.
    const stops: ((s: GameState) => boolean)[] = [
      (s) => s.phase === 'discard' && s.hands.some((h) => h.length === 4),
      (s) => s.phase === 'peg' && s.played.length >= 2,
      (s) => s.phase === 'show' && s.showStep >= 1,
      (s) => s.handNo === 2 && s.phase === 'peg',
    ];
    const parts = [];
    for (const until of stops) {
      parts.push(await drive(tmp.dbPath, code, seats, { seed: players, until }));
      await audit(readGame(tmp.dbPath, code).state!);
    }
    parts.push(await drive(tmp.dbPath, code, seats, { seed: players + 10 }));
    expect(audited).toBe(4);
    const d = { states: parts.flatMap((p, i) => (i ? p.states.slice(1) : p.states)), events: parts.flatMap((p) => p.events) };
    const obs = observe(d, players);
    expect(readGame(tmp.dbPath, code).row.status).toBe('finished');

    // Finished: everyone in the league may look, and it is all there.
    for (const who of [bySeat[0], outsider]) {
      const res = await api(r.base, 'GET', `/api/games/${code.toLowerCase()}/hands`, { token: who.token });
      expect(res.status).toBe(200);
      const body = res.body as HandsResponse;
      expect(body).toMatchObject({ code, players, status: 'finished', firstRecordedHand: 1, you: who === outsider ? null : 0 });
      expect(body.seats.map((s) => s!.id)).toEqual(bySeat.map((p) => p.id));
      expect(body.hands.map((h) => h.handNo)).toEqual(obs.map((h) => h.handNo));
      body.hands.forEach((rec, i) => expectMatches(rec, obs[i], players, i === obs.length - 1));
      // Scores chain from hand to hand and finish on the final board.
      body.hands.forEach((rec, i) => expect(rec.scoresBefore).toEqual(i ? body.hands[i - 1].scoresAfter : Array(rec.scoresAfter.length).fill(0)));
      expect(body.hands[body.hands.length - 1].scoresAfter).toEqual(readGame(tmp.dbPath, code).state!.scores);
    }
  }, 90_000);
}

describe('access', () => {
  it('needs sign-in; unknown games 404; a waiting game has no hands', async () => {
    const [a] = people;
    const w = await api(r.base, 'POST', '/api/games', { token: a.token });
    expect((await api(r.base, 'GET', `/api/games/${w.body.code}/hands`)).status).toBe(401);
    expect((await api(r.base, 'GET', '/api/games/ZZZZZ/hands', { token: a.token })).status).toBe(404);
    const res = await api(r.base, 'GET', `/api/games/${w.body.code}/hands`, { token: a.token });
    expect(res.body).toMatchObject({ status: 'waiting', hands: [], firstRecordedHand: null, you: 0 });
    expect((await api(r.base, 'GET', `/api/games/${w.body.code}/hands`, { token: people[1].token })).status).toBe(403);
  });
});
