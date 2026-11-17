// HTTP client for the Cabbage server, plus the locally stored profile.
import type { PlayerInfo, Seat } from '../../shared/game';

export interface Profile {
  id: string;
  name: string;
  token: string;
}

export interface GameSummary {
  code: string;
  status: 'waiting' | 'active' | 'finished';
  you: Seat;
  opponent: PlayerInfo | null;
  scores: [number, number];
  winner: Seat | null;
  skunk: 0 | 1 | 2;
  createdAt: string | number;
  finishedAt: string | number | null;
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

async function request<T>(method: 'GET' | 'POST', path: string, token?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: string | undefined;
  if (method === 'POST') {
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

const gamePath = (code: string, action: string) => `/api/games/${encodeURIComponent(code)}/${action}`;

export const api = {
  createPlayer: (name: string) => request<Profile>('POST', '/api/players', undefined, { name }),
  me: (token: string) => request<PlayerInfo>('GET', '/api/me', token),
  createGame: (token: string) => request<{ code: string }>('POST', '/api/games', token),
  listGames: (token: string) => request<{ games: GameSummary[] }>('GET', '/api/games', token),
  join: (token: string, code: string) => request<{ code: string; seat: Seat }>('POST', gamePath(code, 'join'), token),
  rematch: (token: string, code: string) => request<{ code: string }>('POST', gamePath(code, 'rematch'), token),
};
