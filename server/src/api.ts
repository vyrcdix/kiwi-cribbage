import express, { type NextFunction, type Request, type Response } from 'express';
import {
  type GameSummary,
  isPlayerCount,
  type PlayerCount,
  type PlayerInfo,
  seatsToAct,
  type SkunkLevel,
  teamCount,
  teamOf,
} from '../../shared/game.js';
import {
  type CreatePlayerResponse,
  DECK_ID,
  type DeviceLinkCode,
  type InviteStatus,
  isAvatar,
  isSingleEmoji,
  type LeagueInvite,
  MAX_NAME,
  type Me,
  type OkResponse,
  type SeatingResponse,
  type SessionsResponse,
  type UpdateMeRequest,
} from '../../shared/league.js';
import { HttpError, isId, me, objectBody, onlyKeys, requireAuth, sessionId, text } from './http.js';
import type { Hub } from './hub.js';
import { leagueRoutes } from './league-api.js';
import { normalizeCode } from './random.js';
import { DEFAULT_RATE_LIMITS, type RateLimits, rateLimiter } from './ratelimit.js';
import { type GameRow, parseScores, parseState, type PlayerRow, type Store } from './store.js';

export { HttpError };

export function apiRouter(store: Store, hub: Hub, limits: RateLimits = DEFAULT_RATE_LIMITS): express.Router {
  const r = express.Router();
  const auth = requireAuth(store);
  const now = () => store.nowMs();
  const joinLimit = rateLimiter(limits.join, now);
  const redeemLimit = rateLimiter(limits.redeem, now);
  const inviteLimit = rateLimiter(limits.invite, now);

  const findGame = (raw: unknown): GameRow => {
    const game = store.game(normalizeCode(raw));
    if (!game) throw new HttpError(404, 'No such game');
    return game;
  };

  /** 409 if any of these players has been deactivated (a game with them in it could never move). */
  const refuseInactive = (ids: (string | null)[]): void => {
    for (const id of ids) {
      const p = id ? store.player(id) : undefined;
      if (p && !p.active) throw new HttpError(409, `${p.name} is no longer an active member`);
    }
  };

  const meOut = (p: PlayerRow): Me => ({ ...store.card(p), createdAt: p.created_at });

  const summary = (g: GameRow, pid: string): GameSummary => {
    const rows = store.seatRows(g.code);
    const n = g.players as PlayerCount;
    const seats: (PlayerInfo | null)[] = Array(n).fill(null);
    for (const row of rows) seats[row.seat] = store.playerInfo(row.player_id);
    const mine = rows.find((row) => row.player_id === pid)!;
    const you = mine.seat;
    const team = teamOf(n, you);
    const skunk: SkunkLevel[] = Array(teamCount(n)).fill(0);
    for (const row of rows) skunk[teamOf(n, row.seat)] = row.skunk as SkunkLevel;
    const state = g.status === 'active' && !g.voided_at ? parseState(g) : null;
    return {
      code: g.code,
      status: g.status,
      players: n,
      you,
      team,
      creator: g.creator === pid,
      seats,
      partner: n === 4 ? seats[(you + 2) % 4] : null,
      opponents: seats.filter((p, s): p is PlayerInfo => p !== null && teamOf(n, s) !== team),
      scores: parseScores(g),
      winner: g.winner_team,
      skunk,
      place: mine.place,
      createdAt: g.created_at,
      finishedAt: g.finished_at,
      waitingOnYou: state ? seatsToAct(state).includes(you) : false,
      lastMoveAt: g.last_move_at,
      seasonId: g.season_id,
      fixtureId: g.fixture_id,
      voided: g.voided_at !== null,
    };
  };

  const seating = (code: string, deleted: boolean): SeatingResponse => {
    const game = store.game(code);
    if (!game || deleted) return { code, deleted: true, seats: [], creator: null };
    return { code, deleted: false, seats: store.seats(game).map((id) => store.playerInfo(id)), creator: game.creator };
  };

  r.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ---- joining the league ----

  r.post('/players', joinLimit, (req, res) => {
    const name = text(req.body?.name, MAX_NAME, 'Name');
    const b = objectBody(req);
    const { invite, code } = b;
    const created: CreatePlayerResponse = store.transaction(() => {
      if (store.playerCount() > 0) {
        if (invite !== undefined) {
          if (typeof invite !== 'string') throw new HttpError(400, 'invite must be a string');
          const st = store.inviteState(invite);
          if (st === 'used') throw new HttpError(403, 'That invite link has already been used');
          if (st === 'expired') throw new HttpError(403, 'That invite link has expired');
          if (st === 'revoked') throw new HttpError(403, 'That invite link is no longer valid: ask a member for a new one');
          if (st !== 'ok') throw new HttpError(403, 'That invite link is not valid');
        } else if (code !== undefined) {
          if (typeof code !== 'string') throw new HttpError(400, 'code must be a string');
          const game = store.game(normalizeCode(code));
          if (!game || game.status !== 'waiting' || game.voided_at) throw new HttpError(403, 'That game is not waiting for players');
        } else {
          throw new HttpError(403, 'Cabbage is invite-only: ask a member for an invite link');
        }
      }
      const p = store.createPlayer(name);
      if (typeof invite === 'string') store.useInvite(invite, p.id);
      return p;
    });
    res.status(201).json(created);
  });

  r.post('/invites', auth, (_req, res) => {
    const out: LeagueInvite = store.createInvite(me(res).id);
    res.status(201).json(out);
  });

  r.get('/invites/:token', inviteLimit, (req, res) => {
    const inv = store.invite(req.params.token);
    const st = store.inviteState(req.params.token);
    const by = inv ? store.playerInfo(inv.created_by) : null;
    const out: InviteStatus = {
      valid: st === 'ok',
      // An invite whose issuer was deactivated reads as expired (no longer usable; ask for a new one).
      reason: st === 'ok' ? null : st === 'revoked' ? 'expired' : st,
      invitedBy: st === 'ok' ? by : null,
      expiresAt: st === 'ok' && inv ? inv.expires_at : null,
    };
    res.json(out);
  });

  // ---- devices ----

  r.post('/link', auth, (_req, res) => {
    const out: DeviceLinkCode = store.createLinkCode(me(res).id);
    res.status(201).json(out);
  });

  r.post('/link/redeem', redeemLimit, (req, res) => {
    const b = objectBody(req);
    if (typeof b.code !== 'string') throw new HttpError(400, 'code must be a string');
    const out: CreatePlayerResponse = store.transaction(() => {
      const got = store.redeemLinkCode(b.code);
      if ('error' in got) throw new HttpError(403, got.error);
      return { id: got.player.id, name: got.player.name, token: store.createSession(got.player.id) };
    });
    res.status(201).json(out);
  });

  r.get('/me/sessions', auth, (_req, res) => {
    const current = sessionId(res);
    const out: SessionsResponse = {
      sessions: store.sessions(me(res).id).map((s) => ({ id: s.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === current })),
    };
    res.json(out);
  });

  r.delete('/me/sessions/:id', auth, (req, res) => {
    if (!isId(req.params.id) || !store.deleteSession(me(res).id, req.params.id)) throw new HttpError(404, 'No such session');
    // That device's open game sockets end too (a lost phone signed out from another device).
    hub.kickSession(req.params.id, 'This device was signed out');
    const out: OkResponse = { ok: true };
    res.json(out);
  });

  r.post('/me/sign-out', auth, (_req, res) => {
    store.deleteSession(me(res).id, sessionId(res));
    hub.kickSession(sessionId(res), 'Signed out');
    const out: OkResponse = { ok: true };
    res.json(out);
  });

  // ---- profile ----

  r.get('/me', auth, (_req, res) => {
    res.json(meOut(me(res)));
  });

  r.patch('/me', auth, (req, res) => {
    const b = objectBody(req);
    onlyKeys(b, ['name', 'avatar', 'deck', 'fourColour']);
    if (Object.keys(b).length === 0) throw new HttpError(400, 'Nothing to change');
    const fields: UpdateMeRequest = {};
    if (b.name !== undefined) fields.name = text(b.name, MAX_NAME, 'Name');
    if (b.avatar !== undefined) {
      if (b.avatar !== null && !(isAvatar(b.avatar) && isSingleEmoji(b.avatar.emoji))) throw new HttpError(400, 'avatar must be { emoji: one emoji, colour: "#rrggbb" } or null');
      fields.avatar = b.avatar === null ? null : { emoji: b.avatar.emoji, colour: b.avatar.colour.toLowerCase() };
    }
    if (b.deck !== undefined) {
      if (b.deck !== null && (typeof b.deck !== 'string' || !DECK_ID.test(b.deck))) throw new HttpError(400, 'deck must be a deck id or null');
      fields.deck = b.deck;
    }
    if (b.fourColour !== undefined) {
      if (typeof b.fourColour !== 'boolean') throw new HttpError(400, 'fourColour must be true or false');
      fields.fourColour = b.fourColour;
    }
    store.updateProfile(me(res).id, fields);
    res.json(meOut(store.player(me(res).id)!));
  });

  // ---- games ----

  r.post('/games', auth, (req, res) => {
    const raw = req.body?.players ?? 2;
    if (!isPlayerCount(raw)) throw new HttpError(400, 'players must be 2, 3 or 4');
    const code = store.createWaitingGame(me(res).id, raw);
    res.status(201).json({ code, players: raw });
  });

  r.get('/games', auth, (_req, res) => {
    const pid = me(res).id;
    res.json({ games: store.gamesFor(pid, 30).map((g) => summary(g, pid)) });
  });

  r.post('/games/:code/join', auth, (req, res) => {
    const pid = me(res).id;
    const result = store.transaction(() => {
      const game = findGame(req.params.code);
      const seat = store.seatOf(game.code, pid);
      if (seat !== null) return { code: game.code, seat, events: null, seated: false };
      if (game.voided_at) throw new HttpError(409, 'This game was voided');
      // Filling the last seat deals the game: never with someone who can no longer move.
      const seats = store.seats(game);
      if (seats.filter((s) => s === null).length === 1) refuseInactive(seats);
      const taken = store.takeSeat(game, pid);
      if (!taken) throw new HttpError(409, 'Game is full');
      return { code: game.code, seat: taken.seat, events: taken.events, seated: true };
    });
    // Everyone already in the room sees the newcomer (and the opening, if that filled the table).
    if (result.seated) hub.broadcast(result.code, result.events ?? []);
    res.json({ code: result.code, seat: result.seat });
  });

  // Rearrange seats while waiting (creator only): this decides partners in a
  // four-player game and the order of play in a three-player one.
  r.post('/games/:code/seats', auth, (req, res) => {
    const pid = me(res).id;
    const code = store.transaction(() => {
      const game = findGame(req.params.code);
      if (game.creator !== pid) throw new HttpError(403, 'Only the player who made the game can arrange seats');
      if (game.status !== 'waiting') throw new HttpError(409, 'Seats are fixed once the game starts');
      const order: unknown = req.body?.order;
      const seated = store.seats(game).filter((s): s is string => s !== null);
      if (
        !Array.isArray(order) ||
        order.length !== game.players ||
        !order.every((x) => x === null || typeof x === 'string')
      ) {
        throw new HttpError(400, `order must list ${game.players} seats (a player id or null each)`);
      }
      const ids = order.filter((x): x is string => x !== null);
      if (ids.length !== seated.length || new Set(ids).size !== ids.length || !seated.every((id) => ids.includes(id))) {
        throw new HttpError(400, 'order must place every seated player exactly once');
      }
      store.setSeats(game.code, order as (string | null)[]);
      return game.code;
    });
    hub.broadcast(code, []);
    const game = store.game(code)!;
    res.json({ players: store.seats(game).map((id) => store.playerInfo(id)) });
  });

  // The creator takes someone out of a waiting game.
  r.post('/games/:code/remove', auth, (req, res) => {
    const pid = me(res).id;
    const b = objectBody(req);
    if (!isId(b.playerId)) throw new HttpError(400, 'playerId must be a player id');
    const target = b.playerId;
    const result = store.transaction(() => {
      const game = findGame(req.params.code);
      if (game.creator !== pid) throw new HttpError(403, 'Only the player who made the game can remove players');
      if (game.status !== 'waiting') throw new HttpError(409, 'Players can only be removed before the game starts');
      if (target === pid) throw new HttpError(400, 'To leave your own game, use leave');
      if (store.seatOf(game.code, target) === null) throw new HttpError(404, 'That player is not in this game');
      return { code: game.code, ...store.unseat(game, target) };
    });
    hub.kick(result.code, target, 'You were removed from this game');
    hub.broadcast(result.code, []);
    res.json(seating(result.code, result.deleted));
  });

  // A player leaves a waiting game.
  r.post('/games/:code/leave', auth, (req, res) => {
    const pid = me(res).id;
    const result = store.transaction(() => {
      const game = findGame(req.params.code);
      if (store.seatOf(game.code, pid) === null) throw new HttpError(403, 'You are not in this game');
      if (game.status !== 'waiting') throw new HttpError(409, 'You can only leave a game before it starts');
      return { code: game.code, ...store.unseat(game, pid) };
    });
    hub.kick(result.code, pid, 'You left this game');
    if (result.deleted) hub.closeRoom(result.code, 'This game was deleted');
    else hub.broadcast(result.code, []);
    res.json(seating(result.code, result.deleted));
  });

  r.post('/games/:code/rematch', auth, (req, res) => {
    const pid = me(res).id;
    const result = store.transaction(() => {
      const game = findGame(req.params.code);
      if (store.seatOf(game.code, pid) === null) throw new HttpError(403, 'You are not in this game');
      if (game.status !== 'finished') throw new HttpError(409, 'Game is not finished');
      if (game.next_code) return { old: game.code, code: game.next_code, created: false };
      // Same players in the same seats; the cut decides the first dealer afresh.
      const seats = store.seats(game) as string[];
      refuseInactive(seats);
      const code = store.createActiveGame(game.players, game.creator, seats);
      store.setNextCode(game.code, code);
      return { old: game.code, code, created: true };
    });
    if (result.created) hub.broadcast(result.old, []);
    res.json({ code: result.code });
  });

  leagueRoutes(r, store, hub);

  r.use(() => {
    throw new HttpError(404, 'Not found');
  });

  return r;
}

export const errorMiddleware = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // body-parser errors (malformed JSON, too large) carry an exposable 4xx status.
  const e = err as { status?: number; expose?: boolean; type?: string };
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
    const message = e.type === 'entity.parse.failed' ? 'Invalid JSON body' : e.expose ? String((err as Error).message) : 'Bad request';
    res.status(e.status).json({ error: message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
};
