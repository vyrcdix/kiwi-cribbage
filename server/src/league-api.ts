// League routes: seasons, standings, head-to-head, player stats, the hall of
// fame, pending games, results, hand records, the fixture queue and the
// commissioner's tools. Every response type lives in shared/league.ts.
import type express from 'express';
import { type HandLog, type PlayerCount, seatsToAct, type SkunkLevel, teamCount, teamOf } from '../../shared/game.js';
import {
  type Fixture,
  type FixturesResponse,
  type GameResult,
  handRecordFrom,
  type HandRecord,
  type HandsResponse,
  type LeagueResponse,
  MAX_SEASON_NAME,
  MAX_VOID_REASON,
  type NextFixtureResponse,
  type PendingGame,
  type PendingResponse,
  type PlayerCard,
  type ResultsResponse,
  type RoundRobinResponse,
  type Season,
  type SeasonsResponse,
  type StandingsResponse,
  type StartFixtureResponse,
  type VoidResponse,
} from '../../shared/league.js';
import {
  HttpError,
  isId,
  me,
  memberParam,
  objectBody,
  onlyKeys,
  requireAuth,
  requireCommissioner,
  seasonParam,
  text,
} from './http.js';
import type { Hub } from './hub.js';
import { normalizeCode } from './random.js';
import { type GameRec, hallOfFame, type HandRec, headToHead, playerStats, standings } from './stats.js';
import {
  type FixtureRow,
  type GameRow,
  parseScores,
  parseState,
  type SeasonRow,
  type Store,
} from './store.js';

const MAX_ROUND_ROBIN_TIMES = 10;

/** Pairings for a round robin by the circle method: rounds of disjoint pairs. */
export function roundRobinRounds(ids: string[]): [string, string][][] {
  const list: (string | null)[] = ids.length % 2 ? [...ids, null] : [...ids];
  const n = list.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a !== null && b !== null) pairs.push(r % 2 === 1 && i === 0 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

export function leagueRoutes(r: express.Router, store: Store, hub: Hub): void {
  const auth = requireAuth(store);
  const commissioner = [auth, requireCommissioner(store)];

  const seasonOut = (s: SeasonRow, currentId = store.currentSeason().id): Season => ({
    id: s.id, name: s.name, startedAt: s.started_at, endedAt: s.ended_at, current: s.id === currentId,
  });

  const findGame = (raw: unknown): GameRow => {
    const game = store.game(normalizeCode(raw));
    if (!game) throw new HttpError(404, 'No such game');
    return game;
  };

  /** Finished, non-voided games as statistics records. */
  const countedGames = (season: SeasonRow | null): GameRec[] => {
    const seats = store.seatRowsByGame();
    return store
      .finishedGames(season ? season.id : null)
      .filter((g) => g.voided_at === null && g.winner_team !== null)
      .map((g) => {
        const rows = seats.get(g.code) ?? [];
        const n = g.players as PlayerCount;
        const skunk: SkunkLevel[] = Array(teamCount(n)).fill(0);
        const ids: string[] = Array(n).fill('');
        const places: number[] = Array(n).fill(0);
        for (const sr of rows) {
          ids[sr.seat] = sr.player_id;
          places[sr.seat] = sr.place ?? 0;
          skunk[teamOf(n, sr.seat)] = sr.skunk as SkunkLevel;
        }
        return {
          code: g.code, players: n, seasonId: g.season_id, createdAt: g.created_at, finishedAt: g.finished_at!,
          seq: g.seq, scores: parseScores(g), winnerTeam: g.winner_team!, skunk, seats: ids, places,
        };
      });
  };
  const countedHands = (season: SeasonRow | null): HandRec[] => store.countedHandSeats(season ? season.id : null);

  const fixtureOut = (f: FixtureRow, cards: Map<string, PlayerCard>): Fixture => ({
    id: f.id,
    seasonId: f.season_id,
    kind: f.kind,
    players: f.players,
    seats: store.fixtureSeats(f.id).map((id) => cards.get(id)!),
    createdBy: cards.get(f.created_by)!,
    createdAt: f.created_at,
    status: f.status,
    gameCode: f.game_code,
    closedBy: f.closed_by ? cards.get(f.closed_by) ?? null : null,
    closedAt: f.closed_at,
  });

  const findFixture = (raw: unknown): FixtureRow => {
    if (!isId(raw)) throw new HttpError(404, 'No such fixture');
    const f = store.fixture(raw);
    if (!f) throw new HttpError(404, 'No such fixture');
    return f;
  };

  // ---- the league ----

  r.get('/league', auth, (_req, res) => {
    const cards = store.cards();
    const current = store.currentSeason();
    const comm = store.commissionerId();
    const out: LeagueResponse = {
      commissioner: comm ? cards.get(comm) ?? null : null,
      season: seasonOut(current, current.id),
      seasons: store.seasons().map((s) => seasonOut(s, current.id)),
      members: store.allPlayers().map((p) => cards.get(p.id)!),
    };
    res.json(out);
  });

  r.get('/seasons', auth, (_req, res) => {
    const current = store.currentSeason();
    const out: SeasonsResponse = { current: seasonOut(current, current.id), seasons: store.seasons().map((s) => seasonOut(s, current.id)) };
    res.json(out);
  });

  r.get('/standings', auth, (req, res) => {
    const season = seasonParam(store, req.query.season, 'current');
    const games = countedGames(season);
    const cards = store.cards();
    const members = store.activePlayers().map((p) => cards.get(p.id)!);
    const out: StandingsResponse = { season: season ? seasonOut(season) : null, rows: standings(games, members), games: games.length };
    res.json(out);
  });

  r.get('/h2h/:a/:b', auth, (req, res) => {
    const a = memberParam(store, req.params.a);
    const b = memberParam(store, req.params.b);
    if (a.id === b.id) throw new HttpError(400, 'Pick two different players');
    const season = seasonParam(store, req.query.season, 'all');
    const cards = store.cards();
    res.json(headToHead(countedGames(season), countedHands(season), cards.get(a.id)!, cards.get(b.id)!, season ? seasonOut(season) : null));
  });

  r.get('/players/:id/stats', auth, (req, res) => {
    const p = memberParam(store, req.params.id);
    const season = seasonParam(store, req.query.season, 'all');
    res.json(playerStats(countedGames(season), countedHands(season), store.cards().get(p.id)!, season ? seasonOut(season) : null));
  });

  r.get('/hall-of-fame', auth, (req, res) => {
    const season = seasonParam(store, req.query.season, 'all');
    const people = [...store.cards().values()];
    res.json(hallOfFame(countedGames(season), countedHands(season), people, season ? seasonOut(season) : null));
  });

  // ---- games across the league ----

  r.get('/pending', auth, (_req, res) => {
    const cards = store.cards();
    const now = store.nowMs();
    const games: PendingGame[] = store.pendingGames().map((g) => {
      const seats = store.seats(g);
      const state = g.status === 'active' ? parseState(g) : null;
      const acting = state ? seatsToAct(state) : [];
      return {
        code: g.code,
        status: g.status as 'waiting' | 'active',
        players: g.players,
        seasonId: g.season_id,
        fixtureId: g.fixture_id,
        seats: seats.map((id) => (id ? cards.get(id) ?? null : null)),
        scores: parseScores(g),
        phase: state ? state.phase : null,
        handNo: state ? state.handNo : 0,
        createdAt: g.created_at,
        lastMoveAt: g.last_move_at,
        idleSeconds: Math.max(0, Math.floor((now - Date.parse(g.last_move_at)) / 1000)),
        waitingOn: acting.map((s) => cards.get(seats[s]!)!).filter(Boolean),
        waitingOnSeats: acting,
        openSeats: seats.filter((s) => s === null).length,
      };
    });
    const out: PendingResponse = { games };
    res.json(out);
  });

  r.get('/results', auth, (req, res) => {
    const season = seasonParam(store, req.query.season, 'current');
    let player: string | null = null;
    if (req.query.player !== undefined) player = memberParam(store, req.query.player).id;
    const cards = store.cards();
    const seatMap = store.seatRowsByGame();
    const games: GameResult[] = [];
    for (const g of store.finishedGames(season ? season.id : null).reverse()) {
      const rows = seatMap.get(g.code) ?? [];
      if (player && !rows.some((sr) => sr.player_id === player)) continue;
      const n = g.players as PlayerCount;
      const skunk: SkunkLevel[] = Array(teamCount(n)).fill(0);
      for (const sr of rows) skunk[teamOf(n, sr.seat)] = sr.skunk as SkunkLevel;
      games.push({
        code: g.code, players: n, seasonId: g.season_id, fixtureId: g.fixture_id,
        seats: rows.map((sr) => cards.get(sr.player_id)!),
        scores: parseScores(g), winnerTeam: g.winner_team ?? 0, skunk,
        createdAt: g.created_at, finishedAt: g.finished_at!,
        voided: g.voided_at !== null, voidReason: g.void_reason, voidedAt: g.voided_at,
      });
    }
    const out: ResultsResponse = { games };
    res.json(out);
  });

  r.get('/games/:code/hands', auth, (req, res) => {
    const game = findGame(req.params.code);
    const you = store.seatOf(game.code, me(res).id);
    if (you === null && game.status !== 'finished') throw new HttpError(403, 'Only the players can see the hands of a game in progress');
    const cards = store.cards();
    const hands: HandRecord[] = store.hands(game.code).map((h) =>
      handRecordFrom(JSON.parse(h.log) as HandLog, game.players, {
        scoresAfter: JSON.parse(h.scores_after) as number[],
        complete: true,
        endedGame: h.ended_game === 1,
        finishedAt: h.finished_at,
        visibleTo: you,
      }),
    );
    const state = game.status === 'active' ? parseState(game) : null;
    if (state?.handLog && !hands.some((h) => h.handNo === state.handLog!.handNo)) {
      hands.push(handRecordFrom(state.handLog, game.players, { scoresAfter: state.scores, complete: false, endedGame: false, finishedAt: null, visibleTo: you }));
    }
    const out: HandsResponse = {
      code: game.code,
      players: game.players,
      status: game.status,
      seats: store.seats(game).map((id) => (id ? cards.get(id) ?? null : null)),
      you,
      firstRecordedHand: hands.length ? hands[0].handNo : null,
      hands,
    };
    res.json(out);
  });

  // ---- fixtures ----

  r.post('/fixtures', auth, (req, res) => {
    const pid = me(res).id;
    const b = objectBody(req);
    onlyKeys(b, ['opponents', 'partner']);
    const { opponents, partner } = b;
    if (!Array.isArray(opponents) || opponents.length < 1 || opponents.length > 2 || !opponents.every(isId))
      throw new HttpError(400, 'opponents must list one or two player ids');
    if (partner !== undefined && (!isId(partner) || opponents.length !== 2))
      throw new HttpError(400, 'A partner is only for a four-player game: name a partner and two opponents');
    const seats: string[] =
      partner === undefined ? [pid, ...(opponents as string[])] : [pid, opponents[0] as string, partner as string, opponents[1] as string];
    if (new Set(seats).size !== seats.length) throw new HttpError(400, 'Everyone in a fixture must be a different player (and not you twice)');
    const created = store.transaction(() => {
      for (const id of seats.slice(1)) {
        const p = store.player(id);
        if (!p) throw new HttpError(404, 'No such player');
        if (!p.active) throw new HttpError(409, `${p.name} is not an active member`);
      }
      return store.createFixture('challenge', pid, seats);
    });
    res.status(201).json(fixtureOut(created, store.cards()));
  });

  r.get('/fixtures', auth, (req, res) => {
    const status = req.query.status ?? 'open';
    if (status !== 'open' && status !== 'all') throw new HttpError(400, "status must be 'open' or 'all'");
    // Open fixtures are listed whatever their season (a game in progress at a rollover stays visible).
    const season = seasonParam(store, req.query.season, status === 'open' ? 'all' : 'current');
    const player = req.query.player === undefined ? undefined : memberParam(store, req.query.player).id;
    const cards = store.cards();
    const out: FixturesResponse = {
      fixtures: store.fixtures({ seasonId: season ? season.id : null, open: status === 'open', player }).map((f) => fixtureOut(f, cards)),
    };
    res.json(out);
  });

  r.get('/fixtures/mine', auth, (_req, res) => {
    const cards = store.cards();
    const out: FixturesResponse = { fixtures: store.fixtures({ open: true, player: me(res).id }).map((f) => fixtureOut(f, cards)) };
    res.json(out);
  });

  r.get('/fixtures/next', auth, (_req, res) => {
    const next = store.fixtures({ status: 'queued', player: me(res).id })[0];
    const out: NextFixtureResponse = { fixture: next ? fixtureOut(next, store.cards()) : null };
    res.json(out);
  });

  r.post('/fixtures/:id/start', auth, (req, res) => {
    const pid = me(res).id;
    const result = store.transaction(() => {
      const f = findFixture(req.params.id);
      const seats = store.fixtureSeats(f.id);
      if (!seats.includes(pid)) throw new HttpError(403, 'Only the players in a fixture can start it');
      if (f.status === 'playing' && f.game_code) return { id: f.id, code: f.game_code };
      if (f.status !== 'queued') throw new HttpError(409, `This fixture is ${f.status}`);
      for (const id of seats) {
        const p = store.player(id)!;
        if (!p.active) throw new HttpError(409, `${p.name} is not an active member`);
      }
      const code = store.createActiveGame(f.players, pid, seats, f.id);
      store.setFixture(f.id, { status: 'playing', game_code: code });
      return { id: f.id, code };
    });
    const out: StartFixtureResponse = { code: result.code, fixture: fixtureOut(store.fixture(result.id)!, store.cards()) };
    res.json(out);
  });

  r.post('/fixtures/:id/decline', auth, (req, res) => {
    const pid = me(res).id;
    const id = store.transaction(() => {
      const f = findFixture(req.params.id);
      const seats = store.fixtureSeats(f.id);
      if (!seats.includes(pid) || f.created_by === pid) throw new HttpError(403, 'Only a challenged player can decline');
      if (f.kind !== 'challenge') throw new HttpError(409, 'Round-robin fixtures can only be cancelled by the commissioner');
      if (f.status !== 'queued') throw new HttpError(409, `This fixture is ${f.status}`);
      store.setFixture(f.id, { status: 'declined', closed_by: pid, closed_at: store.now() });
      return f.id;
    });
    res.json(fixtureOut(store.fixture(id)!, store.cards()));
  });

  r.post('/fixtures/:id/cancel', auth, (req, res) => {
    const pid = me(res).id;
    const id = store.transaction(() => {
      const f = findFixture(req.params.id);
      if (f.created_by !== pid && store.commissionerId() !== pid)
        throw new HttpError(403, 'Only whoever made the fixture, or the commissioner, can cancel it');
      if (f.status !== 'queued') throw new HttpError(409, `This fixture is ${f.status}`);
      store.setFixture(f.id, { status: 'cancelled', closed_by: pid, closed_at: store.now() });
      return f.id;
    });
    res.json(fixtureOut(store.fixture(id)!, store.cards()));
  });

  // ---- commissioner ----

  r.post('/commissioner/seasons', ...commissioner, (req, res) => {
    const b = objectBody(req);
    onlyKeys(b, ['name']);
    const name = text(b.name, MAX_SEASON_NAME, 'Season name');
    const s = store.transaction(() => store.startSeason(name));
    res.status(201).json(seasonOut(s, s.id));
  });

  r.post('/commissioner/round-robin', ...commissioner, (req, res) => {
    const b = objectBody(req);
    onlyKeys(b, ['times']);
    const times = b.times === undefined ? 1 : b.times;
    if (typeof times !== 'number' || !Number.isInteger(times) || times < 1 || times > MAX_ROUND_ROBIN_TIMES)
      throw new HttpError(400, `times must be a whole number from 1 to ${MAX_ROUND_ROBIN_TIMES}`);
    const pid = me(res).id;
    const result = store.transaction(() => {
      const season = store.currentSeason();
      const open = store.openPairFixtures(season.id);
      const rounds = roundRobinRounds(store.activePlayers().map((p) => p.id));
      const skipped = new Set<string>();
      const created: FixtureRow[] = [];
      for (let t = 0; t < times; t++) {
        for (const round of rounds) {
          for (const [x, y] of round) {
            const key = [x, y].sort().join('|');
            if (open.has(key)) {
              skipped.add(key);
              continue;
            }
            created.push(store.createFixture('round-robin', pid, t % 2 ? [y, x] : [x, y]));
          }
        }
      }
      return { created, skippedPairs: skipped.size };
    });
    const cards = store.cards();
    const out: RoundRobinResponse = { created: result.created.map((f) => fixtureOut(f, cards)), skippedPairs: result.skippedPairs };
    res.status(201).json(out);
  });

  const voidOut = (code: string): VoidResponse => {
    const g = store.game(code)!;
    return { code: g.code, voided: g.voided_at !== null, voidReason: g.void_reason, voidedAt: g.voided_at };
  };

  r.post('/commissioner/games/:code/void', ...commissioner, (req, res) => {
    const b = objectBody(req);
    onlyKeys(b, ['reason']);
    let reason: string | null = null;
    if (b.reason !== undefined && b.reason !== null && b.reason !== '') reason = text(b.reason, MAX_VOID_REASON, 'reason');
    const code = store.transaction(() => {
      const g = findGame(req.params.code);
      if (g.voided_at) throw new HttpError(409, 'That game is already void');
      store.setVoid(g.code, me(res).id, reason);
      // A fixture's game voided: the fixture goes back in the queue to be played again, in the
      // current season (as fixtures queued at a rollover move into the new season).
      if (g.fixture_id) {
        const f = store.fixture(g.fixture_id);
        if (f && f.game_code === g.code)
          store.setFixture(f.id, { status: 'queued', game_code: null, closed_at: null, closed_by: null, season_id: store.currentSeason().id });
      }
      return g.code;
    });
    hub.notifyRoom(code, 'This game was voided by the commissioner');
    res.json(voidOut(code));
  });

  r.post('/commissioner/games/:code/unvoid', ...commissioner, (req, res) => {
    const code = store.transaction(() => {
      const g = findGame(req.params.code);
      if (!g.voided_at) throw new HttpError(409, 'That game is not void');
      store.setVoid(g.code, null, null);
      if (g.fixture_id) {
        const f = store.fixture(g.fixture_id);
        if (f && f.status === 'queued' && f.game_code === null) {
          const done = g.status === 'finished';
          // Back with its game, in its game's season.
          store.setFixture(f.id, { status: done ? 'done' : 'playing', game_code: g.code, closed_at: done ? g.finished_at : null, season_id: g.season_id });
        }
      }
      return g.code;
    });
    res.json(voidOut(code));
  });

  r.post('/commissioner/players/:id/deactivate', ...commissioner, (req, res) => {
    const target = memberParam(store, req.params.id);
    const pid = me(res).id;
    if (target.id === pid) throw new HttpError(409, 'Hand the commissioner role to someone else before deactivating yourself');
    store.transaction(() => {
      store.setActive(target.id, false);
      for (const f of store.fixtures({ status: 'queued', player: target.id }))
        store.setFixture(f.id, { status: 'cancelled', closed_by: pid, closed_at: store.now() });
    });
    hub.kickPlayer(target.id, 'Your membership has been deactivated');
    res.json(store.cards().get(target.id));
  });

  r.post('/commissioner/players/:id/reactivate', ...commissioner, (req, res) => {
    const target = memberParam(store, req.params.id);
    store.setActive(target.id, true);
    res.json(store.cards().get(target.id));
  });

  r.post('/commissioner/handover', ...commissioner, (req, res) => {
    const b = objectBody(req);
    onlyKeys(b, ['playerId']);
    const target = memberParam(store, b.playerId);
    if (!target.active) throw new HttpError(409, 'The commissioner must be an active member');
    store.setCommissioner(target.id);
    res.json(store.cards().get(target.id));
  });
}
