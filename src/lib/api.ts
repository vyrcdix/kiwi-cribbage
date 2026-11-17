// HTTP client for the Cabbage server, plus the locally stored profile.
// Every league body type comes from shared/league.ts.
import type { GameSummary, PlayerCount, PlayerInfo, Seat } from '../../shared/game';
import type {
  ChallengeRequest, CreatePlayerResponse, DeviceLinkCode, Fixture, FixturesResponse, HallOfFame, HandsResponse,
  HeadToHead, InviteStatus, LeagueInvite, LeagueResponse, Me, NextFixtureResponse, OkResponse, PendingResponse,
  PlayerCard, PlayerStats, ResultsResponse, RoundRobinResponse, Season, SeasonFilter, SeasonsResponse,
  SeatingResponse, SessionsResponse, StandingsResponse, StartFixtureResponse, UpdateMeRequest, VoidResponse,
} from '../../shared/league';

export type { GameSummary };

export interface Profile {
  id: string;
  name: string;
  token: string;
}

const PROFILE_KEY = 'cabbage:profile';

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p: unknown = JSON.parse(raw);
    if (
      p && typeof p === 'object' &&
      typeof (p as Profile).id === 'string' &&
      typeof (p as Profile).name === 'string' &&
      typeof (p as Profile).token === 'string'
    ) {
      const { id, name, token } = p as Profile;
      return { id, name, token };
    }
  } catch {
    /* storage blocked or corrupt: behave as a new visitor */
  }
  return null;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. — the session still works until reload */
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : 'Something went wrong';

export const errorStatus = (e: unknown): number => (e instanceof ApiError ? e.status : 0);

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, token?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: string | undefined;
  if (method === 'POST' || method === 'PATCH') {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  let data: unknown = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const enc = encodeURIComponent;
const gamePath = (code: string, action: string) => `/api/games/${enc(code)}/${action}`;
const seasonQ = (s: SeasonFilter | undefined) => (s === undefined ? '' : `season=${s}`);
const qs = (...parts: string[]) => {
  const p = parts.filter(Boolean).join('&');
  return p ? `?${p}` : '';
};

export const api = {
  // ---- joining and devices (public) ----
  /** Sign up with a game invite code, a league invite token, or neither (the very first player only). */
  createPlayer: (name: string, via: { code?: string; invite?: string } = {}) =>
    request<CreatePlayerResponse>('POST', '/api/players', undefined, { name, ...via }),
  invite: (token: string) => request<InviteStatus>('GET', `/api/invites/${enc(token)}`),
  redeemLink: (code: string) => request<CreatePlayerResponse>('POST', '/api/link/redeem', undefined, { code }),

  // ---- you ----
  me: (token: string) => request<Me>('GET', '/api/me', token),
  updateMe: (token: string, patch: UpdateMeRequest) => request<Me>('PATCH', '/api/me', token, patch),
  createInvite: (token: string) => request<LeagueInvite>('POST', '/api/invites', token),
  createLink: (token: string) => request<DeviceLinkCode>('POST', '/api/link', token),
  sessions: (token: string) => request<SessionsResponse>('GET', '/api/me/sessions', token),
  endSession: (token: string, id: string) => request<OkResponse>('DELETE', `/api/me/sessions/${enc(id)}`, token),
  signOut: (token: string) => request<OkResponse>('POST', '/api/me/sign-out', token),

  // ---- the league ----
  league: (token: string) => request<LeagueResponse>('GET', '/api/league', token),
  seasons: (token: string) => request<SeasonsResponse>('GET', '/api/seasons', token),
  standings: (token: string, season?: SeasonFilter) => request<StandingsResponse>('GET', `/api/standings${qs(seasonQ(season))}`, token),
  h2h: (token: string, a: string, b: string, season?: SeasonFilter) =>
    request<HeadToHead>('GET', `/api/h2h/${enc(a)}/${enc(b)}${qs(seasonQ(season))}`, token),
  playerStats: (token: string, id: string, season?: SeasonFilter) =>
    request<PlayerStats>('GET', `/api/players/${enc(id)}/stats${qs(seasonQ(season))}`, token),
  hallOfFame: (token: string, season?: SeasonFilter) => request<HallOfFame>('GET', `/api/hall-of-fame${qs(seasonQ(season))}`, token),
  pending: (token: string) => request<PendingResponse>('GET', '/api/pending', token),
  results: (token: string, opts: { season?: SeasonFilter; player?: string } = {}) =>
    request<ResultsResponse>('GET', `/api/results${qs(seasonQ(opts.season), opts.player ? `player=${enc(opts.player)}` : '')}`, token),
  hands: (token: string, code: string) => request<HandsResponse>('GET', gamePath(code, 'hands'), token),

  // ---- the queue ----
  fixtures: (token: string, opts: { status?: 'open' | 'all'; season?: SeasonFilter | 'current'; player?: string } = {}) =>
    request<FixturesResponse>(
      'GET',
      `/api/fixtures${qs(opts.status ? `status=${opts.status}` : '', opts.season !== undefined ? `season=${opts.season}` : '', opts.player ? `player=${enc(opts.player)}` : '')}`,
      token,
    ),
  myFixtures: (token: string) => request<FixturesResponse>('GET', '/api/fixtures/mine', token),
  nextFixture: (token: string) => request<NextFixtureResponse>('GET', '/api/fixtures/next', token),
  challenge: (token: string, body: ChallengeRequest) => request<Fixture>('POST', '/api/fixtures', token, body),
  startFixture: (token: string, id: string) => request<StartFixtureResponse>('POST', `/api/fixtures/${enc(id)}/start`, token),
  declineFixture: (token: string, id: string) => request<Fixture>('POST', `/api/fixtures/${enc(id)}/decline`, token),
  cancelFixture: (token: string, id: string) => request<Fixture>('POST', `/api/fixtures/${enc(id)}/cancel`, token),

  // ---- commissioner ----
  newSeason: (token: string, name: string) => request<Season>('POST', '/api/commissioner/seasons', token, { name }),
  roundRobin: (token: string, times: number) => request<RoundRobinResponse>('POST', '/api/commissioner/round-robin', token, { times }),
  voidGame: (token: string, code: string, reason: string) =>
    request<VoidResponse>('POST', `/api/commissioner/games/${enc(code)}/void`, token, reason ? { reason } : {}),
  unvoidGame: (token: string, code: string) => request<VoidResponse>('POST', `/api/commissioner/games/${enc(code)}/unvoid`, token),
  deactivate: (token: string, id: string) => request<PlayerCard>('POST', `/api/commissioner/players/${enc(id)}/deactivate`, token),
  reactivate: (token: string, id: string) => request<PlayerCard>('POST', `/api/commissioner/players/${enc(id)}/reactivate`, token),
  handover: (token: string, playerId: string) => request<PlayerCard>('POST', '/api/commissioner/handover', token, { playerId }),

  // ---- games ----
  createGame: (token: string, players: PlayerCount) =>
    request<{ code: string; players: PlayerCount }>('POST', '/api/games', token, { players }),
  listGames: (token: string) => request<{ games: GameSummary[] }>('GET', '/api/games', token),
  join: (token: string, code: string) => request<{ code: string; seat: Seat }>('POST', gamePath(code, 'join'), token),
  rematch: (token: string, code: string) => request<{ code: string }>('POST', gamePath(code, 'rematch'), token),
  /** Creator only, while waiting: player id (or null for an open seat) by seat. */
  arrangeSeats: (token: string, code: string, order: (string | null)[]) =>
    request<{ players: (PlayerInfo | null)[] }>('POST', gamePath(code, 'seats'), token, { order }),
  removePlayer: (token: string, code: string, playerId: string) =>
    request<SeatingResponse>('POST', gamePath(code, 'remove'), token, { playerId }),
  leaveGame: (token: string, code: string) => request<SeatingResponse>('POST', gamePath(code, 'leave'), token),
};
