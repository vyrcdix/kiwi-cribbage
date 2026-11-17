// Small HTTP plumbing shared by the routers: errors, auth middleware and strict
// validators for untrusted input.
import type { NextFunction, Request, Response } from 'express';
import type { PlayerRow, SeasonRow, Store } from './store.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const bearer = (req: Request): string | null => {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') ?? '');
  return m ? m[1] : null;
};

export const me = (res: Response): PlayerRow => res.locals.player as PlayerRow;
export const sessionId = (res: Response): string => res.locals.sessionId as string;

export const DEACTIVATED = 'Your membership has been deactivated';

/** 401 unless the bearer token belongs to an active member. */
export const requireAuth = (store: Store) => (req: Request, res: Response, next: NextFunction) => {
  const auth = store.authenticate(bearer(req));
  if (!auth) throw new HttpError(401, 'Not signed in');
  if (!auth.player.active) throw new HttpError(401, DEACTIVATED);
  res.locals.player = auth.player;
  res.locals.sessionId = auth.sessionId;
  next();
};

/** 403 unless the signed-in member is the commissioner (use after requireAuth). */
export const requireCommissioner = (store: Store) => (_req: Request, res: Response, next: NextFunction) => {
  if (store.commissionerId() !== me(res).id) throw new HttpError(403, 'Only the commissioner can do that');
  next();
};

/** The JSON body as a plain object ({} when absent); 400 for arrays and primitives. */
export const objectBody = (req: Request): Record<string, unknown> => {
  const b: unknown = req.body;
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Expected a JSON object');
  // Express gives `{}` for a missing body; anything else must be a plain object.
  return b as Record<string, unknown>;
};

/** Reject keys we don't know (typos should not silently do nothing). */
export const onlyKeys = (b: Record<string, unknown>, allowed: string[]) => {
  for (const k of Object.keys(b)) if (!allowed.includes(k)) throw new HttpError(400, `Unknown field: ${k.slice(0, 40)}`);
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isId = (x: unknown): x is string => typeof x === 'string' && ID.test(x);

/** A member id from untrusted input: 400 if malformed, 404 if nobody has it. */
export const memberParam = (store: Store, raw: unknown): PlayerRow => {
  if (!isId(raw)) throw new HttpError(400, 'Not a player id');
  const p = store.player(raw);
  if (!p) throw new HttpError(404, 'No such player');
  return p;
};

/**
 * The `season` query parameter: undefined → `fallback`; 'all' → null (all
 * time); 'current' → the current season; a season id → that season (404 if none).
 */
export const seasonParam = (store: Store, raw: unknown, fallback: 'current' | 'all'): SeasonRow | null => {
  const v = raw === undefined ? fallback : raw;
  if (v === 'all') return null;
  if (v === 'current') return store.currentSeason();
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,8}$/.test(v)) throw new HttpError(400, "season must be a season id, 'current' or 'all'");
  const s = store.season(Number(v));
  if (!s) throw new HttpError(404, 'No such season');
  return s;
};

/** A UTF-16 surrogate without its partner (SQLite would store it as U+FFFD). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Bidirectional embedding / override (U+202A–202E) and isolate (U+2066–2069) controls: they reorder the text around a name. */
const BIDI_CONTROL = /[‪-‮⁦-⁩]/;
/**
 * Characters that draw nothing on their own: white space, format characters
 * (zero-width space / joiner, word joiner, tags, …), anything default-ignorable
 * (Hangul fillers, variation selectors, …), combining marks with no base, and
 * the Braille blank.
 */
const INVISIBLE = /[\p{White_Space}\p{Cc}\p{Cf}\p{Z}\p{M}\p{Default_Ignorable_Code_Point}⠀]/u;

/**
 * A trimmed string of length 1..max that shows at least one visible character,
 * or 400 with `what` in the message.
 */
export const text = (raw: unknown, max: number, what: string): string => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s.length < 1 || s.length > max) throw new HttpError(400, `${what} must be 1–${max} characters`);
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s) || BIDI_CONTROL.test(s)) throw new HttpError(400, `${what} may not contain control characters`);
  if (LONE_SURROGATE.test(s)) throw new HttpError(400, `${what} is not valid text (a broken character)`);
  if (![...s].some((ch) => !INVISIBLE.test(ch))) throw new HttpError(400, `${what} must contain at least one visible character`);
  return s;
};
