// Data access for players and games. All calls are synchronous (better-sqlite3),
// so each request / socket message runs to completion without interleaving.
import { newGame, type GameState, type PlayerInfo, type Seat } from '../../shared/game.js';
import type { DB } from './db.js';
import { hashToken, newId, newToken, randomCode, shuffle } from './random.js';
import { nowIso } from './time.js';

export type GameStatus = 'waiting' | 'active' | 'finished';

export interface PlayerRow {
  id: string;
  name: string;
  avatar: string | null;
  token_hash: string;
  created_at: string;
}

export interface GameRow {
  code: string;
  p0: string;
  p1: string | null;
  status: GameStatus;
  state: string | null;
  score0: number;
  score1: number;
  winner: string | null;
  skunk: number;
  next_code: string | null;
  created_at: string;
  finished_at: string | null;
}

export class Store {
  constructor(readonly db: DB) {}

  // ---- players ----

  createPlayer(name: string): { id: string; name: string; token: string } {
    const id = newId();
    const token = newToken();
    this.db
      .prepare('INSERT INTO players (id, name, avatar, token_hash, created_at) VALUES (?, ?, NULL, ?, ?)')
      .run(id, name, hashToken(token), nowIso());
    return { id, name, token };
  }

  playerByToken(token: unknown): PlayerRow | undefined {
    if (typeof token !== 'string' || token.length === 0 || token.length > 200) return undefined;
    return this.db.prepare('SELECT * FROM players WHERE token_hash = ?').get(hashToken(token)) as
      | PlayerRow
      | undefined;
  }

  playerInfo(id: string | null): PlayerInfo | null {
    if (!id) return null;
    const row = this.db.prepare('SELECT id, name FROM players WHERE id = ?').get(id) as PlayerInfo | undefined;
    return row ? { id: row.id, name: row.name } : null;
  }

  // ---- games ----

  game(code: string): GameRow | undefined {
    if (!code) return undefined;
    return this.db.prepare('SELECT * FROM games WHERE code = ?').get(code) as GameRow | undefined;
  }

  private unusedCode(): string {
    for (let i = 0; i < 100; i++) {
      const code = randomCode();
      if (!this.game(code)) return code;
    }
    throw new Error('Could not allocate a game code');
  }

  createWaitingGame(p0: string): string {
    const code = this.unusedCode();
    this.db
      .prepare("INSERT INTO games (code, p0, status, created_at) VALUES (?, ?, 'waiting', ?)")
      .run(code, p0, nowIso());
    return code;
  }

  /** Seat 1 joins: deal the opening and go active. Returns the opening events. */
  startGame(code: string, p1: string) {
    const { state, events } = newGame(shuffle);
    this.db
      .prepare(
        "UPDATE games SET p1 = ?, status = 'active', state = ?, score0 = ?, score1 = ? WHERE code = ? AND p1 IS NULL",
      )
      .run(p1, JSON.stringify(state), state.scores[0], state.scores[1], code);
    return events;
  }

  /** A fresh, already-active game between two players. */
  createActiveGame(p0: string, p1: string): string {
    const code = this.unusedCode();
    const { state } = newGame(shuffle);
    this.db
      .prepare(
        "INSERT INTO games (code, p0, p1, status, state, score0, score1, created_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)",
      )
      .run(code, p0, p1, JSON.stringify(state), state.scores[0], state.scores[1], nowIso());
    return code;
  }

  setNextCode(code: string, next: string): void {
    this.db.prepare('UPDATE games SET next_code = ? WHERE code = ?').run(next, code);
  }

  /** Persist a new state; on game end also record the result. */
  saveState(game: GameRow, state: GameState): void {
    const over = state.winner !== null;
    const winnerId = over ? (state.winner === 0 ? game.p0 : game.p1) : null;
    this.db
      .prepare(
        `UPDATE games SET state = ?, score0 = ?, score1 = ?,
           status = ?, winner = ?, skunk = ?, finished_at = ?
         WHERE code = ?`,
      )
      .run(
        JSON.stringify(state),
        state.scores[0],
        state.scores[1],
        over ? 'finished' : 'active',
        winnerId,
        state.skunk,
        over ? nowIso() : null,
        game.code,
      );
  }

  gamesFor(playerId: string, limit = 30): GameRow[] {
    return this.db
      .prepare(
        `SELECT * FROM games WHERE p0 = ? OR p1 = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(playerId, playerId, limit) as GameRow[];
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export const seatOf = (game: GameRow, playerId: string): Seat | null =>
  game.p0 === playerId ? 0 : game.p1 === playerId ? 1 : null;

export const parseState = (game: GameRow): GameState | null =>
  game.state ? (JSON.parse(game.state) as GameState) : null;
