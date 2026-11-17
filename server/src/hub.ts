// WebSocket rooms: one room per game code, any number of sockets per seat.
// Every message from a client is untrusted; nothing in here may throw out of a
// socket event handler.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  type Action,
  applyAction,
  type GameEvent,
  GameError,
  type PlayerView,
  type Seat,
  type ServerMsg,
  viewFor,
} from '../../shared/game.js';
import { normalizeCode } from './random.js';
import { parseState, type Store } from './store.js';

export interface HubOptions {
  /** How often to ping sockets; a socket that misses a whole interval is terminated. */
  pingIntervalMs?: number;
  /** How long a socket may stay open without a successful hello. */
  helloTimeoutMs?: number;
}

interface Conn {
  ws: WebSocket;
  alive: boolean;
  code: string | null;
  /** Who this socket is; their seat is looked up afresh (seats can be rearranged while waiting). */
  playerId: string | null;
  helloTimer: NodeJS.Timeout | null;
}

const MAX_PAYLOAD = 64 * 1024;

const isCard = (c: unknown): c is number =>
  typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < 52;

/** Rebuild a clean Action from untrusted JSON, or null if it is malformed. */
export function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  switch (a.t) {
    case 'discard': {
      // One card (three or four players) or two (two players); the engine checks which.
      const cards = a.cards;
      if (!Array.isArray(cards) || cards.length < 1 || cards.length > 2) return null;
      const out: number[] = [];
      for (let i = 0; i < cards.length; i++) {
        if (!isCard(cards[i])) return null;
        out.push(cards[i]);
      }
      return { t: 'discard', cards: out };
    }
    case 'play':
      return isCard(a.card) ? { t: 'play', card: a.card } : null;
    case 'cut':
      return { t: 'cut' };
    case 'ack':
      return { t: 'ack' };
    default:
      return null;
  }
}

export class Hub {
  private readonly wss: WebSocketServer;
  private readonly conns = new Set<Conn>();
  private readonly rooms = new Map<string, Set<Conn>>();
  private readonly pingTimer: NodeJS.Timeout;
  private readonly helloTimeoutMs: number;
  private closing = false;

  constructor(
    private readonly store: Store,
    opts: HubOptions = {},
  ) {
    this.helloTimeoutMs = opts.helloTimeoutMs ?? 15_000;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.pingTimer = setInterval(() => this.pingAll(), opts.pingIntervalMs ?? 30_000);
    this.pingTimer.unref();
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      socket.on('error', () => socket.destroy());
      let path = '';
      try {
        path = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        /* fall through to reject */
      }
      if (path !== '/ws' || this.closing) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
  }

  /** Send every socket in the room its own state message. */
  broadcast(code: string, events: GameEvent[]): void {
    if (this.closing) return;
    const room = this.rooms.get(code);
    if (!room || room.size === 0) return;
    const game = this.store.game(code);
    if (!game) return;
    const seats = this.store.seats(game);
    const players = seats.map((id) => this.store.playerInfo(id));
    const online = this.online(code, seats);
    const state = parseState(game);
    const views = new Map<Seat, PlayerView>();
    for (const conn of room) {
      if (conn.playerId === null || conn.ws.readyState !== WebSocket.OPEN) continue;
      const seat = seats.indexOf(conn.playerId);
      if (seat < 0) continue;
      let view: PlayerView | null = null;
      if (state) {
        view = views.get(seat) ?? viewFor(state, seat);
        views.set(seat, view);
      }
      const msg: ServerMsg = {
        t: 'state',
        code: game.code,
        status: game.status,
        players,
        online,
        creator: game.creator,
        you: seat,
        view,
        events,
        next: game.next_code,
      };
      this.send(conn, msg);
    }
  }

  /** Which seats have at least one open socket. */
  online(code: string, seats: (string | null)[]): boolean[] {
    const out = seats.map(() => false);
    for (const conn of this.rooms.get(code) ?? []) {
      if (conn.playerId === null || conn.ws.readyState !== WebSocket.OPEN) continue;
      const seat = seats.indexOf(conn.playerId);
      if (seat >= 0) out[seat] = true;
    }
    return out;
  }

  /** Hang up one player's sockets in one room (removed from, or left, a waiting game). */
  kick(code: string, playerId: string, message: string): void {
    for (const conn of [...(this.rooms.get(code) ?? [])]) if (conn.playerId === playerId) this.reject(conn, message);
  }

  /** Hang up one player's sockets everywhere (deactivated). */
  kickPlayer(playerId: string, message: string): void {
    for (const conn of [...this.conns]) if (conn.playerId === playerId) this.reject(conn, message);
  }

  /** Hang up everyone in a room (the game is gone). */
  closeRoom(code: string, message: string): void {
    for (const conn of [...(this.rooms.get(code) ?? [])]) this.reject(conn, message);
  }

  /** Tell everyone in a room something (an error message they can show); nobody is hung up. */
  notifyRoom(code: string, message: string): void {
    for (const conn of this.rooms.get(code) ?? []) this.sendError(conn, message);
  }

  close(): void {
    this.closing = true;
    clearInterval(this.pingTimer);
    for (const conn of this.conns) {
      if (conn.helloTimer) clearTimeout(conn.helloTimer);
      conn.ws.terminate();
    }
    this.conns.clear();
    this.rooms.clear();
    this.wss.close();
  }

  // ---- internals ----

  private onConnection(ws: WebSocket): void {
    const conn: Conn = { ws, alive: true, code: null, playerId: null, helloTimer: null };
    this.conns.add(conn);
    conn.helloTimer = setTimeout(() => {
      if (conn.code === null) this.reject(conn, 'Expected hello');
    }, this.helloTimeoutMs);
    conn.helloTimer.unref();

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('error', () => {
      // e.g. oversized or invalid frames; ws closes the socket itself.
    });
    ws.on('message', (data, isBinary) => {
      conn.alive = true;
      try {
        this.onMessage(conn, data, isBinary);
      } catch (err) {
        console.error('[ws] message handler failed', err);
        this.sendError(conn, 'Server error');
      }
    });
    ws.on('close', () => {
      try {
        this.onClose(conn);
      } catch (err) {
        console.error('[ws] close handler failed', err);
      }
    });
  }

  private onMessage(conn: Conn, data: RawData, isBinary: boolean): void {
    let msg: unknown;
    try {
      if (isBinary) throw new Error('binary');
      msg = JSON.parse(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString());
    } catch {
      msg = undefined;
    }
    const m = msg && typeof msg === 'object' && !Array.isArray(msg) ? (msg as Record<string, unknown>) : null;

    if (conn.code === null) {
      if (!m || m.t !== 'hello') return this.reject(conn, 'Expected hello');
      return this.onHello(conn, m.token, m.code);
    }
    if (!m) return this.sendError(conn, 'Malformed message');
    switch (m.t) {
      case 'act':
        return this.onAct(conn, m.action);
      case 'hello':
        return this.sendError(conn, 'Already connected to a game');
      default:
        return this.sendError(conn, 'Unknown message type');
    }
  }

  private onHello(conn: Conn, token: unknown, rawCode: unknown): void {
    const auth = this.store.authenticate(token);
    if (!auth) return this.reject(conn, 'Not signed in');
    if (!auth.player.active) return this.reject(conn, 'Your membership has been deactivated');
    const player = auth.player;
    const code = normalizeCode(rawCode);
    const game = this.store.game(code);
    if (!game) return this.reject(conn, 'No such game');
    if (this.store.seatOf(game.code, player.id) === null) return this.reject(conn, 'You are not in this game');

    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    conn.helloTimer = null;
    conn.code = game.code;
    conn.playerId = player.id;
    let room = this.rooms.get(game.code);
    if (!room) this.rooms.set(game.code, (room = new Set()));
    room.add(conn);
    // Everyone (including the newcomer) gets a fresh state with updated presence.
    this.broadcast(game.code, []);
  }

  private onAct(conn: Conn, rawAction: unknown): void {
    const action = parseAction(rawAction);
    if (!action) return this.sendError(conn, 'Malformed action');
    const game = this.store.game(conn.code!);
    if (!game) return this.sendError(conn, 'No such game');
    if (game.status === 'waiting')
      return this.sendError(conn, game.players === 2 ? 'Waiting for an opponent' : 'Waiting for players');
    if (game.status === 'finished') return this.sendError(conn, 'This game is over');
    if (game.voided_at) return this.sendError(conn, 'This game was voided by the commissioner');
    const state = parseState(game);
    if (!state) return this.sendError(conn, 'Game has not started');
    const seat = this.store.seatOf(game.code, conn.playerId!);
    if (seat === null) return this.sendError(conn, 'You are not in this game');

    let result: ReturnType<typeof applyAction>;
    try {
      result = applyAction(state, seat, action, this.store.shuffle);
    } catch (err) {
      if (err instanceof GameError) return this.sendError(conn, err.message);
      throw err;
    }
    this.store.transaction(() => this.store.saveState(game, result.state, state));
    this.broadcast(game.code, result.events);
  }

  private onClose(conn: Conn): void {
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    this.conns.delete(conn);
    if (conn.code === null) return;
    const room = this.rooms.get(conn.code);
    room?.delete(conn);
    if (room && room.size === 0) this.rooms.delete(conn.code);
    else this.broadcast(conn.code, []);
  }

  private pingAll(): void {
    for (const conn of this.conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        conn.ws.terminate();
      }
    }
  }

  private send(conn: Conn, msg: ServerMsg): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    conn.ws.send(JSON.stringify(msg), () => {
      /* errors surface as 'close' */
    });
  }

  private sendError(conn: Conn, message: string): void {
    this.send(conn, { t: 'error', message });
  }

  /** Send an error and hang up (failed or missing hello). */
  private reject(conn: Conn, message: string): void {
    this.sendError(conn, message);
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.close(1008, message.slice(0, 120));
  }
}
