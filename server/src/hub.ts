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
  type PlayerInfo,
  type PlayerView,
  type Seat,
  type ServerMsg,
  viewFor,
} from '../../shared/game.js';
import { normalizeCode, shuffle } from './random.js';
import { parseState, seatOf, type Store } from './store.js';

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
  seat: Seat | null;
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
      const cards = a.cards;
      if (!Array.isArray(cards) || cards.length !== 2 || !isCard(cards[0]) || !isCard(cards[1])) return null;
      return { t: 'discard', cards: [cards[0], cards[1]] };
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
    const players: [PlayerInfo | null, PlayerInfo | null] = [
      this.store.playerInfo(game.p0),
      this.store.playerInfo(game.p1),
    ];
    const online = this.online(code);
    const state = parseState(game);
    const views: Partial<Record<Seat, PlayerView>> = {};
    for (const conn of room) {
      if (conn.seat === null || conn.ws.readyState !== WebSocket.OPEN) continue;
      const seat = conn.seat;
      const view = state ? (views[seat] ??= viewFor(state, seat)) : null;
      const msg: ServerMsg = {
        t: 'state',
        code: game.code,
        status: game.status,
        players,
        online,
        you: seat,
        view,
        events,
        next: game.next_code,
      };
      this.send(conn, msg);
    }
  }

  online(code: string): [boolean, boolean] {
    const out: [boolean, boolean] = [false, false];
    for (const conn of this.rooms.get(code) ?? []) {
      if (conn.seat !== null && conn.ws.readyState === WebSocket.OPEN) out[conn.seat] = true;
    }
    return out;
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
    const conn: Conn = { ws, alive: true, code: null, seat: null, helloTimer: null };
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
    const player = this.store.playerByToken(token);
    if (!player) return this.reject(conn, 'Not signed in');
    const code = normalizeCode(rawCode);
    const game = this.store.game(code);
    if (!game) return this.reject(conn, 'No such game');
    const seat = seatOf(game, player.id);
    if (seat === null) return this.reject(conn, 'You are not in this game');

    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    conn.helloTimer = null;
    conn.code = game.code;
    conn.seat = seat;
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
    if (game.status === 'waiting') return this.sendError(conn, 'Waiting for an opponent');
    if (game.status === 'finished') return this.sendError(conn, 'This game is over');
    const state = parseState(game);
    if (!state) return this.sendError(conn, 'Game has not started');

    let result: ReturnType<typeof applyAction>;
    try {
      result = applyAction(state, conn.seat!, action, shuffle);
    } catch (err) {
      if (err instanceof GameError) return this.sendError(conn, err.message);
      throw err;
    }
    this.store.saveState(game, result.state);
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
