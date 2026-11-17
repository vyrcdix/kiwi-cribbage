// Simple in-memory rate limiting for the public endpoints that take a guessable
// secret: joining with a game code (5 characters, and anyone holding a waiting
// game's code may join the league), redeeming a device link code, and looking
// up an invite. Keyed by client IP (req.ip: the app trusts the proxy in front,
// Caddy, which replaces any X-Forwarded-For a client sends). Fixed windows,
// one counter per IP per endpoint; state is lost on restart, which is fine.
import type { NextFunction, Request, Response } from 'express';

export interface RateLimit {
  /** Requests allowed per window per client. */
  max: number;
  windowMs: number;
}

export interface RateLimits {
  /** POST /api/players (joining the league; with a game code that is a guess at the code). */
  join: RateLimit;
  /** POST /api/link/redeem. */
  redeem: RateLimit;
  /** GET /api/invites/:token. */
  invite: RateLimit;
}

const HOUR = 60 * 60 * 1000;

/**
 * Generous: far above anything a household behind one address does, yet a
 * guesser gets at most 600 tries an hour at 31^5 ≈ 28.6 million game codes.
 */
export const DEFAULT_RATE_LIMITS: RateLimits = {
  join: { max: 600, windowMs: HOUR },
  redeem: { max: 600, windowMs: HOUR },
  invite: { max: 600, windowMs: HOUR },
};

/**
 * The client key for an address: IPv4 as is (also when IPv4-mapped), IPv6 by
 * its /64 network, since one host can hold a whole /64.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const bare = ip.split('%')[0].toLowerCase();
  const [head, tail] = bare.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** Express middleware allowing `limit.max` requests per `limit.windowMs` per client; then 429. */
export function rateLimiter(limit: RateLimit, now: () => number = Date.now) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();
  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    if (t - lastSweep > limit.windowMs || windows.size > 50_000) {
      for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
      lastSweep = t;
    }
    const key = clientKey(req.ip);
    let w = windows.get(key);
    if (!w || w.resetAt <= t) windows.set(key, (w = { count: 0, resetAt: t + limit.windowMs }));
    w.count++;
    if (w.count > limit.max) {
      const wait = Math.max(1, Math.ceil((w.resetAt - t) / 1000));
      res.set('Retry-After', String(wait));
      const minutes = Math.ceil(wait / 60);
      res.status(429).json({ error: `Too many attempts from your network: try again in ${minutes} minute${minutes === 1 ? '' : 's'}` });
      return;
    }
    next();
  };
}
