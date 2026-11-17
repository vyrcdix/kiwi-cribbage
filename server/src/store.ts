// Data access for players, sessions, games, hands, seasons and fixtures. All
// calls are synchronous (better-sqlite3), so each request / socket message runs
// to completion without interleaving.
import { type Card, sortHand } from '../../shared/cards.js';
import {
  type GameEvent,
  type GameState,
  type HandLog,
  newGame,
  placings,
  type PlayerCount,
  type PlayerInfo,
  type Seat,
  type Shuffle,
  teamCount,
  teamOf,
} from '../../shared/game.js';
import type { Avatar, FixtureKind, FixtureStatus, PlayerCard } from '../../shared/league.js';
import { isAvatar, isSingleEmoji } from '../../shared/league.js';
import type { DB } from './db.js';
import { CODE_ALPHABET, hashToken, newId, newToken, randomCode, shuffle as cryptoShuffle } from './random.js';
import { randomInt } from 'node:crypto';

export type GameStatus = 'waiting' | 'active' | 'finished';

export interface PlayerRow {
  id: string;
  name: string;
  /** JSON Avatar or NULL. */
  avatar: string | null;
  /** Legacy: the hash of the player's first token. Authentication uses sessions. */
  token_hash: string;
  created_at: string;
  deck: string | null;
  four_colour: number;
  active: number;
  deactivated_at: string | null;
}

export interface GameRow {
  code: string;
  players: PlayerCount;
  creator: string;
  status: GameStatus;
  state: string | null;
  /** JSON array of scores by team. */
  scores: string;
  winner_team: number | null;
  next_code: string | null;
  created_at: string;
  finished_at: string | null;
  season_id: number;
  last_move_at: string;
  fixture_id: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface SeatRow {
  game_code: string;
  seat: Seat;
  player_id: string;
  place: number | null;
  skunk: number;
}

export interface SeasonRow {
  id: number;
  name: string;
  started_at: string;
  ended_at: string | null;
}

export interface FixtureRow {
  id: string;
  seq: number;
  season_id: number;
  kind: FixtureKind;
  players: PlayerCount;
  created_by: string;
  created_at: string;
  status: FixtureStatus;
  game_code: string | null;
  closed_by: string | null;
  closed_at: string | null;
}

export interface HandRow {
  game_code: string;
  hand_no: number;
  dealer: number;
  ended_game: number;
  log: string;
  scores_after: string;
  finished_at: string;
}

export interface HandSeatRow {
  game_code: string;
  hand_no: number;
  seat: number;
  player_id: string;
  is_dealer: number;
  hand_points: number | null;
  hand_cards: string;
  crib_points: number | null;
  crib_cards: string | null;
  starter: number | null;
  peg_points: number;
  pegged_out: number;
  heels: number;
}

export interface StoreOptions {
  /** Deals and cuts; defaults to the CSPRNG shuffle. Tests inject scripted decks. */
  shuffle?: Shuffle;
  /** Milliseconds since the epoch; defaults to Date.now. Tests move time on. */
  clock?: () => number;
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LINK_TTL_MS = 10 * 60 * 1000;
export const LINK_CODE_LENGTH = 8;
/** Only bump sessions.last_seen_at when it is older than this. */
const SEEN_GRANULARITY_MS = 60 * 1000;

/** A stored avatar, or null. One stored before the emoji check was tightened that fails it now (e.g. an emoji carrying hidden tag characters) reads as none. */
export const parseAvatar = (raw: string | null): Avatar | null => {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isAvatar(v) && isSingleEmoji(v.emoji) ? { emoji: v.emoji, colour: v.colour } : null;
  } catch {
    return null;
  }
};

/** Link codes: case-insensitive, dashes and spaces ignored. */
export const normalizeLinkCode = (raw: unknown): string =>
  typeof raw === 'string' && raw.length <= 40 ? raw.toUpperCase().replace(/[\s-]/g, '') : '';

export class Store {
  readonly shuffle: Shuffle;
  private readonly clock: () => number;

  constructor(
    readonly db: DB,
    opts: StoreOptions = {},
  ) {
    this.shuffle = opts.shuffle ?? cryptoShuffle;
    this.clock = opts.clock ?? Date.now;
  }

  /**
   * Repair rows written by an older server still running against this database
   * (games without a season or last-move time). Idempotent; run at startup.
   */
  heal(): void {
    this.currentSeason();
    this.db.exec(`
      UPDATE games SET season_id = COALESCE(
        (SELECT s.id FROM seasons s WHERE s.started_at <= games.created_at ORDER BY s.started_at DESC, s.id DESC LIMIT 1),
        (SELECT MIN(id) FROM seasons))
      WHERE season_id IS NULL;
      UPDATE games SET last_move_at = COALESCE(finished_at, created_at) WHERE last_move_at IS NULL;
    `);
  }

  nowMs(): number {
    return this.clock();
  }

  now(): string {
    return new Date(this.clock()).toISOString();
  }

  // ---- players ----

  playerCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
  }

  /** A new player with their first session. The first player ever becomes commissioner. */
  createPlayer(name: string): { id: string; name: string; token: string } {
    const id = newId();
    const token = newToken();
    const now = this.now();
    const first = this.playerCount() === 0;
    this.db
      .prepare('INSERT INTO players (id, name, avatar, token_hash, created_at) VALUES (?, ?, NULL, ?, ?)')
      .run(id, name, hashToken(token), now);
    this.db
      .prepare('INSERT INTO sessions (id, player_id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId(), id, hashToken(token), now, now);
    if (first || this.commissionerId() === null) this.setCommissioner(id);
    return { id, name, token };
  }

  player(id: unknown): PlayerRow | undefined {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return undefined;
    return this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
  }

  /** Every player, active first, then by name. */
  allPlayers(): PlayerRow[] {
    return this.db.prepare('SELECT * FROM players ORDER BY active DESC, name COLLATE NOCASE, created_at').all() as PlayerRow[];
  }

  activePlayers(): PlayerRow[] {
    return this.db.prepare('SELECT * FROM players WHERE active = 1 ORDER BY created_at, rowid').all() as PlayerRow[];
  }

  /** Sign in with a token: the player and session, or undefined (unknown token). */
  authenticate(token: unknown): { player: PlayerRow; sessionId: string } | undefined {
    if (typeof token !== 'string' || token.length === 0 || token.length > 200) return undefined;
    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, s.last_seen_at AS seen, p.* FROM sessions s
         JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?`,
      )
      .get(hashToken(token)) as (PlayerRow & { session_id: string; seen: string }) | undefined;
    if (!row) return undefined;
    const { session_id, seen, ...player } = row;
    if (this.nowMs() - Date.parse(seen) > SEEN_GRANULARITY_MS) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(this.now(), session_id);
    }
    return { player, sessionId: session_id };
  }

  /** The active player behind a token (websocket hello and the like). */
  playerByToken(token: unknown): PlayerRow | undefined {
    const auth = this.authenticate(token);
    return auth && auth.player.active ? auth.player : undefined;
  }

  playerInfo(id: string | null): PlayerInfo | null {
    if (!id) return null;
    const row = this.db.prepare('SELECT id, name FROM players WHERE id = ?').get(id) as PlayerInfo | undefined;
    return row ? { id: row.id, name: row.name } : null;
  }

  card(row: PlayerRow, commissioner = this.commissionerId()): PlayerCard {
    return {
      id: row.id,
      name: row.name,
      avatar: parseAvatar(row.avatar),
      deck: row.deck,
      fourColour: row.four_colour === 1,
      active: row.active === 1,
      commissioner: row.id === commissioner,
    };
  }

  /** PlayerCards by id, for building lists (one query). */
  cards(): Map<string, PlayerCard> {
    const comm = this.commissionerId();
    const out = new Map<string, PlayerCard>();
    for (const p of this.db.prepare('SELECT * FROM players').all() as PlayerRow[]) out.set(p.id, this.card(p, comm));
    return out;
  }

  updateProfile(id: string, fields: { name?: string; avatar?: Avatar | null; deck?: string | null; fourColour?: boolean }): void {
    if (fields.name !== undefined) this.db.prepare('UPDATE players SET name = ? WHERE id = ?').run(fields.name, id);
    if (fields.avatar !== undefined)
      this.db.prepare('UPDATE players SET avatar = ? WHERE id = ?').run(fields.avatar ? JSON.stringify(fields.avatar) : null, id);
    if (fields.deck !== undefined) this.db.prepare('UPDATE players SET deck = ? WHERE id = ?').run(fields.deck, id);
    if (fields.fourColour !== undefined)
      this.db.prepare('UPDATE players SET four_colour = ? WHERE id = ?').run(fields.fourColour ? 1 : 0, id);
  }

  setActive(id: string, active: boolean): void {
    this.db
      .prepare('UPDATE players SET active = ?, deactivated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, active ? null : this.now(), id);
  }

  commissionerId(): string | null {
    const row = this.db.prepare('SELECT commissioner_id FROM league WHERE id = 1').get() as
      | { commissioner_id: string | null }
      | undefined;
    return row?.commissioner_id ?? null;
  }

  setCommissioner(id: string): void {
    this.db
      .prepare('INSERT INTO league (id, commissioner_id) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET commissioner_id = excluded.commissioner_id')
      .run(id);
  }

  // ---- sessions & device links ----

  sessions(playerId: string): { id: string; created_at: string; last_seen_at: string }[] {
    return this.db
      .prepare('SELECT id, created_at, last_seen_at FROM sessions WHERE player_id = ? ORDER BY created_at, id')
      .all(playerId) as { id: string; created_at: string; last_seen_at: string }[];
  }

  /** Why a session may no longer act (signed out / revoked, or the member deactivated), or null if it may. */
  sessionProblem(sessionId: string): string | null {
    const row = this.db
      .prepare('SELECT p.active FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.id = ?')
      .get(sessionId) as { active: number } | undefined;
    if (!row) return 'Not signed in';
    return row.active ? null : 'Your membership has been deactivated';
  }

  deleteSession(playerId: string, sessionId: string): boolean {
    return this.db.prepare('DELETE FROM sessions WHERE id = ? AND player_id = ?').run(sessionId, playerId).changes > 0;
  }

  createSession(playerId: string): string {
    const token = newToken();
    const now = this.now();
    this.db
      .prepare('INSERT INTO sessions (id, player_id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId(), playerId, hashToken(token), now, now);
    return token;
  }

  createLinkCode(playerId: string): { code: string; expiresAt: string } {
    for (let i = 0; i < 20; i++) {
      let code = '';
      for (let k = 0; k < LINK_CODE_LENGTH; k++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      const expiresAt = new Date(this.nowMs() + LINK_TTL_MS).toISOString();
      const res = this.db
        .prepare('INSERT OR IGNORE INTO link_codes (code_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(hashToken(code), playerId, this.now(), expiresAt);
      if (res.changes === 1) return { code, expiresAt };
    }
    throw new Error('Could not allocate a link code');
  }

  /** Use a link code: the player it belongs to, or why not. Call inside a transaction. */
  redeemLinkCode(raw: unknown): { player: PlayerRow } | { error: string } {
    const code = normalizeLinkCode(raw);
    if (code.length !== LINK_CODE_LENGTH) return { error: 'Unknown or expired code' };
    const row = this.db.prepare('SELECT * FROM link_codes WHERE code_hash = ?').get(hashToken(code)) as
      | { code_hash: string; player_id: string; expires_at: string; used_at: string | null }
      | undefined;
    if (!row || row.used_at !== null || Date.parse(row.expires_at) <= this.nowMs()) return { error: 'Unknown or expired code' };
    const player = this.player(row.player_id);
    if (!player || !player.active) return { error: 'Unknown or expired code' };
    this.db.prepare('UPDATE link_codes SET used_at = ? WHERE code_hash = ?').run(this.now(), row.code_hash);
    return { player };
  }

  // ---- invites ----

  createInvite(by: string): { token: string; expiresAt: string } {
    const token = newToken();
    const expiresAt = new Date(this.nowMs() + INVITE_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO invites (token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), by, this.now(), expiresAt);
    return { token, expiresAt };
  }

  invite(token: unknown):
    | { token_hash: string; created_by: string; created_at: string; expires_at: string; used_at: string | null; used_by: string | null }
    | undefined {
    if (typeof token !== 'string' || token.length === 0 || token.length > 200) return undefined;
    return this.db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hashToken(token)) as ReturnType<Store['invite']>;
  }

  /** 'revoked': whoever issued it has since been deactivated, so it no longer works. */
  inviteState(token: unknown): 'ok' | 'unknown' | 'used' | 'expired' | 'revoked' {
    const inv = this.invite(token);
    if (!inv) return 'unknown';
    if (inv.used_at !== null) return 'used';
    if (Date.parse(inv.expires_at) <= this.nowMs()) return 'expired';
    if (!this.player(inv.created_by)?.active) return 'revoked';
    return 'ok';
  }

  useInvite(token: string, by: string): void {
    this.db
      .prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE token_hash = ? AND used_at IS NULL')
      .run(this.now(), by, hashToken(token));
  }

  // ---- seasons ----

  currentSeason(): SeasonRow {
    const row = this.db.prepare('SELECT * FROM seasons WHERE ended_at IS NULL').get() as SeasonRow | undefined;
    if (row) return row;
    // Only reachable on a database whose seasons were tampered with: heal it.
    const id = this.db.prepare('INSERT INTO seasons (name, started_at) VALUES (?, ?)').run('Season 1', this.now()).lastInsertRowid;
    return this.db.prepare('SELECT * FROM seasons WHERE id = ?').get(id) as SeasonRow;
  }

  seasons(): SeasonRow[] {
    return this.db.prepare('SELECT * FROM seasons ORDER BY id').all() as SeasonRow[];
  }

  season(id: number): SeasonRow | undefined {
    return this.db.prepare('SELECT * FROM seasons WHERE id = ?').get(id) as SeasonRow | undefined;
  }

  /** End the current season and start a new one; queued fixtures carry over into it. Call inside a transaction. */
  startSeason(name: string): SeasonRow {
    const now = this.now();
    const old = this.currentSeason();
    this.db.prepare('UPDATE seasons SET ended_at = ? WHERE id = ?').run(now, old.id);
    const id = Number(this.db.prepare('INSERT INTO seasons (name, started_at) VALUES (?, ?)').run(name, now).lastInsertRowid);
    this.db.prepare("UPDATE fixtures SET season_id = ? WHERE status = 'queued'").run(id);
    return this.season(id)!;
  }

  // ---- games ----

  game(code: string): GameRow | undefined {
    if (!code) return undefined;
    return this.db.prepare('SELECT * FROM games WHERE code = ?').get(code) as GameRow | undefined;
  }

  seatRows(code: string): SeatRow[] {
    return this.db.prepare('SELECT * FROM game_players WHERE game_code = ? ORDER BY seat').all(code) as SeatRow[];
  }

  /** Player id by seat (length = player count); null for an open seat. */
  seats(game: GameRow): (string | null)[] {
    const out: (string | null)[] = Array(game.players).fill(null);
    for (const r of this.seatRows(game.code)) out[r.seat] = r.player_id;
    return out;
  }

  seatOf(code: string, playerId: string): Seat | null {
    const r = this.db
      .prepare('SELECT seat FROM game_players WHERE game_code = ? AND player_id = ?')
      .get(code, playerId) as { seat: Seat } | undefined;
    return r ? r.seat : null;
  }

  private unusedCode(): string {
    for (let i = 0; i < 100; i++) {
      const code = randomCode();
      if (!this.game(code)) return code;
    }
    throw new Error('Could not allocate a game code');
  }

  private insertGame(
    code: string, players: PlayerCount, creator: string, seats: string[], state: GameState | null, fixtureId: string | null = null,
  ) {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO games (code, players, creator, status, state, scores, created_at, season_id, last_move_at, fixture_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code,
        players,
        creator,
        state ? 'active' : 'waiting',
        state ? JSON.stringify(state) : null,
        JSON.stringify(state ? state.scores : Array(teamCount(players)).fill(0)),
        now,
        this.currentSeason().id,
        now,
        fixtureId,
      );
    const ins = this.db.prepare('INSERT INTO game_players (game_code, seat, player_id) VALUES (?, ?, ?)');
    seats.forEach((pid, seat) => ins.run(code, seat, pid));
  }

  /** A new game with the creator in seat 0, waiting for the other seats to fill. */
  createWaitingGame(creator: string, players: PlayerCount = 2): string {
    const code = this.unusedCode();
    this.insertGame(code, players, creator, [creator], null);
    return code;
  }

  touch(code: string): void {
    this.db.prepare('UPDATE games SET last_move_at = ? WHERE code = ?').run(this.now(), code);
  }

  /**
   * Seat a player in the lowest open seat; if that fills the table, deal the
   * opening and go active. Call inside a transaction. Returns the opening events
   * when the game started.
   */
  takeSeat(game: GameRow, playerId: string): { seat: Seat; events: GameEvent[] | null } | null {
    const seats = this.seats(game);
    const seat = seats.indexOf(null);
    if (seat < 0 || game.status !== 'waiting') return null;
    this.db.prepare('INSERT INTO game_players (game_code, seat, player_id) VALUES (?, ?, ?)').run(game.code, seat, playerId);
    this.touch(game.code);
    if (seats.filter((s) => s === null).length > 1) return { seat, events: null };
    const { state, events } = newGame(this.shuffle, 121, game.players);
    this.db
      .prepare("UPDATE games SET status = 'active', state = ?, scores = ? WHERE code = ? AND status = 'waiting'")
      .run(JSON.stringify(state), JSON.stringify(state.scores), game.code);
    return { seat, events };
  }

  /** Replace the seating of a waiting game (order: player id or null, by seat). */
  setSeats(code: string, order: (string | null)[]): void {
    this.db.prepare('DELETE FROM game_players WHERE game_code = ?').run(code);
    const ins = this.db.prepare('INSERT INTO game_players (game_code, seat, player_id) VALUES (?, ?, ?)');
    order.forEach((pid, seat) => {
      if (pid) ins.run(code, seat, pid);
    });
    this.touch(code);
  }

  /**
   * Take a player out of a waiting game. If they made it, the next seated player
   * becomes the creator; if nobody is left the game is deleted. Call inside a transaction.
   */
  unseat(game: GameRow, playerId: string): { deleted: boolean; creator: string | null } {
    this.db.prepare('DELETE FROM game_players WHERE game_code = ? AND player_id = ?').run(game.code, playerId);
    const left = this.seatRows(game.code);
    if (left.length === 0) {
      this.db.prepare('UPDATE games SET next_code = NULL WHERE next_code = ?').run(game.code);
      this.db.prepare('DELETE FROM games WHERE code = ?').run(game.code);
      return { deleted: true, creator: null };
    }
    let creator = game.creator;
    if (creator === playerId) {
      creator = left[0].player_id;
      this.db.prepare('UPDATE games SET creator = ? WHERE code = ?').run(creator, game.code);
    }
    this.touch(game.code);
    return { deleted: false, creator };
  }

  /** A fresh, already-active game with these players in these seats. */
  createActiveGame(players: PlayerCount, creator: string, seats: string[], fixtureId: string | null = null): string {
    const code = this.unusedCode();
    const { state } = newGame(this.shuffle, 121, players);
    this.insertGame(code, players, creator, seats, state, fixtureId);
    return code;
  }

  setNextCode(code: string, next: string): void {
    this.db.prepare('UPDATE games SET next_code = ? WHERE code = ?').run(next, code);
  }

  /**
   * Persist a new state (call inside a transaction). Stores the record of any
   * hand that just finished; on game end also records the result for every
   * seat and closes the fixture the game came from.
   */
  saveState(game: GameRow, state: GameState, prev?: GameState | null): void {
    const over = state.winner !== null;
    const now = this.now();
    this.db
      .prepare(
        `UPDATE games SET state = ?, scores = ?, status = ?, winner_team = ?, finished_at = ?, last_move_at = ?
         WHERE code = ?`,
      )
      .run(
        JSON.stringify(state),
        JSON.stringify(state.scores),
        over ? 'finished' : 'active',
        state.winner,
        over ? now : null,
        now,
        game.code,
      );
    if (prev?.handLog && prev.handNo !== state.handNo) this.recordHand(game.code, prev.handLog, prev.scores, false, now);
    if (over && state.handLog) this.recordHand(game.code, state.handLog, state.scores, true, now);
    if (!over) return;
    const places = placings(state.scores, state.winner);
    const upd = this.db.prepare('UPDATE game_players SET place = ?, skunk = ? WHERE game_code = ? AND seat = ?');
    for (let seat = 0; seat < state.players; seat++) {
      const team = teamOf(state.players, seat);
      upd.run(places[team], state.skunk[team], game.code, seat);
    }
    if (game.fixture_id) {
      this.db
        .prepare("UPDATE fixtures SET status = 'done', closed_at = ? WHERE id = ? AND game_code = ?")
        .run(now, game.fixture_id, game.code);
    }
  }

  /** Store one finished hand: the log as is, plus a flattened row per seat for statistics. */
  private recordHand(code: string, log: HandLog, scoresAfter: number[], endedGame: boolean, at: string): void {
    const n = log.dealt.length;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO hands (game_code, hand_no, dealer, ended_game, log, scores_after, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(code, log.handNo, log.dealer, endedGame ? 1 : 0, JSON.stringify(log), JSON.stringify(scoresAfter), at);
    const seats = this.seatRows(code);
    const peggedOut = log.peg.filter((p) => p.t === 'play').length === n * 4;
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO hand_seats (game_code, hand_no, seat, player_id, is_dealer, hand_points, hand_cards,
         crib_points, crib_cards, starter, peg_points, pegged_out, heels)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const sr of seats) {
      const seat = sr.seat;
      // Both stored sorted, as the contract promises for HandHighlight.cards.
      const kept: Card[] = sortHand(log.dealt[seat].filter((c) => !log.discards[seat].includes(c)));
      const handShow = log.shows.find((sh) => sh.seat === seat && !sh.crib);
      const cribShow = seat === log.dealer ? log.shows.find((sh) => sh.crib) : undefined;
      const crib = seat === log.dealer ? sortHand([...(log.deckToCrib === null ? [] : [log.deckToCrib]), ...log.discards.flat()]) : null;
      let peg = 0;
      for (const p of log.peg) if (p.t !== 'go' && p.seat === seat) peg += p.points;
      ins.run(
        code, log.handNo, seat, sr.player_id, seat === log.dealer ? 1 : 0,
        handShow ? handShow.total : null, JSON.stringify(kept),
        cribShow ? cribShow.total : null, crib ? JSON.stringify(crib) : null,
        log.starter, peg, peggedOut ? 1 : 0, seat === log.dealer ? log.heels : 0,
      );
    }
  }

  hands(code: string): HandRow[] {
    return this.db.prepare('SELECT * FROM hands WHERE game_code = ? ORDER BY hand_no').all(code) as HandRow[];
  }

  gamesFor(playerId: string, limit = 30): GameRow[] {
    return this.db
      .prepare(
        `SELECT g.* FROM games g JOIN game_players gp ON gp.game_code = g.code
         WHERE gp.player_id = ?
         ORDER BY g.created_at DESC, g.rowid DESC LIMIT ?`,
      )
      .all(playerId, limit) as GameRow[];
  }

  /** Every waiting or active game that is not voided, most recently moved first. */
  pendingGames(): GameRow[] {
    return this.db
      .prepare(
        `SELECT * FROM games WHERE status IN ('waiting', 'active') AND voided_at IS NULL
         ORDER BY last_move_at DESC, rowid DESC`,
      )
      .all() as GameRow[];
  }

  /** Finished games (voided included), oldest first; optionally one season. */
  finishedGames(seasonId: number | null): (GameRow & { seq: number })[] {
    const where = seasonId === null ? '' : 'AND season_id = ?';
    const args = seasonId === null ? [] : [seasonId];
    return this.db
      .prepare(`SELECT rowid AS seq, * FROM games WHERE status = 'finished' ${where} ORDER BY finished_at, rowid`)
      .all(...args) as (GameRow & { seq: number })[];
  }

  /** Seat rows for many games at once, grouped by game code. */
  seatRowsByGame(): Map<string, SeatRow[]> {
    const out = new Map<string, SeatRow[]>();
    for (const r of this.db.prepare('SELECT * FROM game_players ORDER BY game_code, seat').all() as SeatRow[]) {
      let list = out.get(r.game_code);
      if (!list) out.set(r.game_code, (list = []));
      list.push(r);
    }
    return out;
  }

  /** Flattened hand rows (with each hand's finish time) for finished, non-voided games. */
  countedHandSeats(seasonId: number | null): (HandSeatRow & { finished_at: string })[] {
    const where = seasonId === null ? '' : 'AND g.season_id = ?';
    const args = seasonId === null ? [] : [seasonId];
    return this.db
      .prepare(
        `SELECT hs.*, h.finished_at FROM hand_seats hs
         JOIN hands h ON h.game_code = hs.game_code AND h.hand_no = hs.hand_no
         JOIN games g ON g.code = hs.game_code
         WHERE g.status = 'finished' AND g.voided_at IS NULL ${where}
         ORDER BY h.finished_at, hs.game_code, hs.hand_no, hs.seat`,
      )
      .all(...args) as (HandSeatRow & { finished_at: string })[];
  }

  setVoid(code: string, by: string | null, reason: string | null): void {
    if (by === null) this.db.prepare('UPDATE games SET voided_at = NULL, voided_by = NULL, void_reason = NULL WHERE code = ?').run(code);
    else this.db.prepare('UPDATE games SET voided_at = ?, voided_by = ?, void_reason = ? WHERE code = ?').run(this.now(), by, reason, code);
  }

  // ---- fixtures ----

  fixture(id: unknown): FixtureRow | undefined {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return undefined;
    return this.db.prepare('SELECT * FROM fixtures WHERE id = ?').get(id) as FixtureRow | undefined;
  }

  fixtureSeats(id: string): string[] {
    return (this.db.prepare('SELECT player_id FROM fixture_players WHERE fixture_id = ? ORDER BY seat').all(id) as { player_id: string }[]).map(
      (r) => r.player_id,
    );
  }

  createFixture(kind: FixtureKind, createdBy: string, seats: string[]): FixtureRow {
    const id = newId();
    const seq = (this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM fixtures').get() as { n: number }).n;
    this.db
      .prepare(
        `INSERT INTO fixtures (id, seq, season_id, kind, players, created_by, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')`,
      )
      .run(id, seq, this.currentSeason().id, kind, seats.length, createdBy, this.now());
    const ins = this.db.prepare('INSERT INTO fixture_players (fixture_id, seat, player_id) VALUES (?, ?, ?)');
    seats.forEach((pid, seat) => ins.run(id, seat, pid));
    return this.fixture(id)!;
  }

  /** Fixtures in queue order, filtered. */
  fixtures(f: { seasonId?: number | null; open?: boolean; player?: string; status?: FixtureStatus }): FixtureRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.seasonId !== undefined && f.seasonId !== null) {
      where.push('f.season_id = ?');
      args.push(f.seasonId);
    }
    if (f.open) where.push("f.status IN ('queued', 'playing')");
    if (f.status) {
      where.push('f.status = ?');
      args.push(f.status);
    }
    if (f.player) {
      where.push('EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = f.id AND fp.player_id = ?)');
      args.push(f.player);
    }
    const sql = `SELECT f.* FROM fixtures f ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.seq`;
    return this.db.prepare(sql).all(...args) as FixtureRow[];
  }

  setFixture(id: string, fields: Partial<Pick<FixtureRow, 'status' | 'game_code' | 'closed_by' | 'closed_at' | 'season_id'>>): void {
    for (const [k, v] of Object.entries(fields)) {
      if (!['status', 'game_code', 'closed_by', 'closed_at', 'season_id'].includes(k)) continue;
      this.db.prepare(`UPDATE fixtures SET ${k} = ? WHERE id = ?`).run(v, id);
    }
  }

  /** Two-player fixtures still to be played this season between each pair, keyed "id1|id2" (sorted). */
  openPairFixtures(seasonId: number): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT f.id, group_concat(fp.player_id, '|') AS ids FROM fixtures f
         JOIN fixture_players fp ON fp.fixture_id = f.id
         WHERE f.season_id = ? AND f.players = 2 AND f.status IN ('queued', 'playing')
         GROUP BY f.id`,
      )
      .all(seasonId) as { id: string; ids: string }[];
    return new Set(rows.map((r) => r.ids.split('|').sort().join('|')));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export const parseScores = (game: GameRow): number[] => JSON.parse(game.scores) as number[];

export const parseState = (game: GameRow): GameState | null =>
  game.state ? upgradeState(JSON.parse(game.state)) : null;

/**
 * States saved before multi-player support (two players only) had no `players`,
 * a single `goSaid` flag (the player not on turn had said go) and a scalar
 * `skunk` for the loser. Everything else carries over as-is. States saved
 * before hand logging have no `handLog`; the engine starts one at the next deal.
 */
export function upgradeState(raw: any): GameState {
  if (raw.players) return raw as GameState;
  const goSaid = [false, false];
  if (raw.goSaid === true) goSaid[raw.turn === 0 ? 1 : 0] = true;
  const skunk = [0, 0];
  if (raw.winner === 0 || raw.winner === 1) skunk[raw.winner === 0 ? 1 : 0] = raw.skunk ?? 0;
  return { ...raw, players: 2, goSaid, skunk } as GameState;
}
