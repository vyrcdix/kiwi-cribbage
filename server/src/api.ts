import express, { type NextFunction, type Request, type Response } from 'express';
import type { Seat } from '../../shared/game.js';
import type { Hub } from './hub.js';
import { normalizeCode } from './random.js';
import { type GameRow, type PlayerRow, seatOf, type Store } from './store.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_NAME = 24;

const bearer = (req: Request): string | null => {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') ?? '');
  return m ? m[1] : null;
};

const me = (res: Response): PlayerRow => res.locals.player as PlayerRow;

export function apiRouter(store: Store, hub: Hub): express.Router {
  const r = express.Router();

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const player = store.playerByToken(bearer(req));
    if (!player) throw new HttpError(401, 'Not signed in');
    res.locals.player = player;
    next();
  };

  const findGame = (raw: unknown): GameRow => {
    const game = store.game(normalizeCode(raw));
    if (!game) throw new HttpError(404, 'No such game');
    return game;
  };

  r.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  r.post('/players', (req, res) => {
    const raw = req.body?.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name.length < 1 || name.length > MAX_NAME) {
      throw new HttpError(400, `Name must be 1–${MAX_NAME} characters`);
    }
    res.status(201).json(store.createPlayer(name));
  });

  r.get('/me', requireAuth, (_req, res) => {
    const p = me(res);
    res.json({ id: p.id, name: p.name });
  });

  r.post('/games', requireAuth, (_req, res) => {
    const code = store.createWaitingGame(me(res).id);
    res.status(201).json({ code });
  });

  r.get('/games', requireAuth, (_req, res) => {
    const pid = me(res).id;
    const games = store.gamesFor(pid, 30).map((g) => {
      const you = seatOf(g, pid) as Seat;
      const winner: Seat | null = g.winner === null ? null : g.winner === g.p0 ? 0 : 1;
      return {
        code: g.code,
        status: g.status,
        you,
        opponent: store.playerInfo(you === 0 ? g.p1 : g.p0),
        scores: [g.score0, g.score1],
        winner,
        skunk: g.skunk,
        createdAt: g.created_at,
        finishedAt: g.finished_at,
      };
    });
    res.json({ games });
  });

  r.post('/games/:code/join', requireAuth, (req, res) => {
    const pid = me(res).id;
    const result = store.transaction(() => {
      const game = findGame(req.params.code);
      const seat = seatOf(game, pid);
      if (seat !== null) return { code: game.code, seat, events: null };
      if (game.p1 !== null) throw new HttpError(409, 'Game is full');
      return { code: game.code, seat: 1 as Seat, events: store.startGame(game.code, pid) };
    });
    if (result.events) hub.broadcast(result.code, result.events);
    res.json({ code: result.code, seat: result.seat });
  });

  r.post('/games/:code/rematch', requireAuth, (req, res) => {
    const pid = me(res).id;
    const result = store.transaction(() => {
      const game = findGame(req.params.code);
      const seat = seatOf(game, pid);
      if (seat === null) throw new HttpError(403, 'You are not in this game');
      if (game.status !== 'finished') throw new HttpError(409, 'Game is not finished');
      if (game.next_code) return { old: game.code, code: game.next_code, created: false };
      const opponent = (seat === 0 ? game.p1 : game.p0)!;
      const code = store.createActiveGame(pid, opponent);
      store.setNextCode(game.code, code);
      return { old: game.code, code, created: true };
    });
    if (result.created) hub.broadcast(result.old, []);
    res.json({ code: result.code });
  });

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
