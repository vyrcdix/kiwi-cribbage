// Shared plumbing for the integration tests: boot a real app on port 0 with a
// temp DB, talk to it with real fetch + ws clients, and drive games with random
// legal moves derived purely from the views each player receives.
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { value } from '../../shared/cards.js';
import { type Action, discardCount, type GameState, leftOf, type PlayerCount, type PlayerView, type ServerMsg } from '../../shared/game.js';
import { type CabbageServer, createApp } from './app.js';
import type { HubOptions } from './hub.js';
import { type GameRow, type SeatRow, type StoreOptions, upgradeState } from './store.js';

export type StateMsg = Extract<ServerMsg, { t: 'state' }>;

export const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cabbage-test-'));
  return {
    dir,
    dbPath: join(dir, 'cabbage.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  };
};

export interface Running {
  server: CabbageServer;
  base: string;
  wsUrl: string;
}

export const startApp = async (dbPath: string, opts: HubOptions & StoreOptions = {}): Promise<Running> => {
  const server = createApp({ dbPath, logMigrations: false, ...opts });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/ws` };
};

export const api = async (
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; rawBody?: string } = {},
): Promise<{ status: number; body: any }> => {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  return { status: res.status, body: parsed };
};

export interface Player {
  id: string;
  name: string;
  token: string;
}

// Membership is invite-only: the first player of a fresh database needs no
// invite; everyone after is invited by a member. One member per server (keyed
// by base URL) issues the invites; creation is serialised per server.
const inviters = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();

export const newPlayer = (base: string, name: string): Promise<Player> => {
  const run = async (): Promise<Player> => {
    let invite: string | undefined;
    const inviter = inviters.get(base);
    if (inviter) {
      const inv = await api(base, 'POST', '/api/invites', { token: inviter });
      if (inv.status === 201) invite = inv.body.token as string;
    }
    const r = await api(base, 'POST', '/api/players', { body: invite ? { name, invite } : { name } });
    if (r.status !== 201) throw new Error(`createPlayer failed: ${r.status} ${JSON.stringify(r.body)}`);
    if (!invite) inviters.set(base, r.body.token as string);
    return r.body as Player;
  };
  const next = (queues.get(base) ?? Promise.resolve()).catch(() => {}).then(run);
  queues.set(base, next);
  return next;
};

/** An invite token from any member (for tests that call POST /api/players themselves). */
export const inviteFrom = async (base: string, token: string): Promise<string> => {
  const inv = await api(base, 'POST', '/api/invites', { token });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  return inv.body.token as string;
};

/** A ws client that records every message it receives. */
export class Client {
  readonly msgs: ServerMsg[] = [];
  readonly raw: string[] = [];
  closeCode: number | null = null;
  private waiters: Array<() => void> = [];
  readonly closed: Promise<void>;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const text = data.toString();
      this.raw.push(text);
      this.msgs.push(JSON.parse(text) as ServerMsg);
      this.wake();
    });
    this.closed = new Promise((resolve) =>
      ws.on('close', (code) => {
        this.closeCode = code;
        this.wake();
        resolve();
      }),
    );
    ws.on('error', () => {});
  }

  static async open(wsUrl: string): Promise<Client> {
    const ws = new WebSocket(wsUrl);
    const c = new Client(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return c;
  }

  /** Open, say hello, and wait for the first reply (state or error). */
  static async connect(wsUrl: string, token: string, code: string): Promise<Client> {
    const c = await Client.open(wsUrl);
    c.send({ t: 'hello', token, code });
    await c.waitCount(1);
    return c;
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Resolve once a message at index >= from matches; returns it. */
  async waitFor(pred: (m: ServerMsg) => boolean, from = 0, timeoutMs = 5000): Promise<ServerMsg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = from; i < this.msgs.length; i++) if (pred(this.msgs[i])) return this.msgs[i];
      if (this.closeCode !== null) throw new Error(`socket closed (${this.closeCode}) while waiting`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting; last msgs: ${JSON.stringify(this.msgs.slice(-3))}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  async waitCount(n: number, timeoutMs = 5000): Promise<ServerMsg> {
    return this.waitFor(() => this.msgs.length >= n, n - 1, timeoutMs);
  }

  get last(): ServerMsg | undefined {
    return this.msgs[this.msgs.length - 1];
  }

  get lastState(): StateMsg {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i];
      if (m.t === 'state') return m;
    }
    throw new Error('no state message yet');
  }

  async close(): Promise<void> {
    if (this.closeCode === null) this.ws.close();
    await this.closed;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pickRandom = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** A random legal move derived from nothing but the player's own view. */
export const legalMove = (view: PlayerView | null): Action | null => {
  if (!view) return null;
  const you = view.you;
  switch (view.phase) {
    case 'discard': {
      if (view.discarded[you]) return null;
      const hand = [...view.hand];
      const cards = [];
      for (let k = 0; k < discardCount(view.players); k++) cards.push(hand.splice(Math.floor(Math.random() * hand.length), 1)[0]);
      return { t: 'discard', cards };
    }
    case 'cut':
      return leftOf(view.players, view.dealer) === you ? { t: 'cut' } : null;
    case 'peg': {
      if (view.turn !== you) return null;
      const ok = view.hand.filter((c) => view.count + value(c) <= 31);
      return ok.length ? { t: 'play', card: pickRandom(ok) } : null;
    }
    case 'show':
      return view.acks[you] ? null : { t: 'ack' };
    default:
      return null;
  }
};

export interface Seated {
  player: Player;
  client: Client;
}

/**
 * One step: pick a random player with a legal move, send it, and wait for every
 * player to receive the resulting state. Returns false if the game is over.
 */
export const step = async (seats: Seated[]): Promise<boolean> => {
  const s0 = seats[0].client.lastState;
  if (s0.status === 'finished') return false;
  const options = seats
    .map((s) => ({ s, move: legalMove(s.client.lastState.view) }))
    .filter((o) => o.move !== null);
  if (options.length === 0) {
    throw new Error(`stuck: ${JSON.stringify(seats.map((s) => s.client.lastState.view))}`);
  }
  const { s: actor, move } = pickRandom(options);
  const others = seats.filter((s) => s !== actor);
  const na = actor.client.msgs.length;
  const no = others.map((o) => o.client.msgs.length);
  actor.client.send({ t: 'act', action: move });
  const reply = await actor.client.waitCount(na + 1);
  if (reply.t !== 'state') throw new Error(`move ${JSON.stringify(move)} rejected: ${JSON.stringify(reply)}`);
  await Promise.all(others.map((o, i) => o.client.waitCount(no[i] + 1)));
  return true;
};

/** Step until pred holds on seat 0's latest state (or the game ends). */
export const playUntil = async (
  seats: Seated[],
  pred: (m: StateMsg) => boolean,
  onStep?: () => void,
  maxSteps = 5000,
): Promise<void> => {
  for (let i = 0; i < maxSteps; i++) {
    if (pred(seats[0].client.lastState)) return;
    if (!(await step(seats))) return;
    onStep?.();
  }
  throw new Error('playUntil: too many steps');
};

export const playToEnd = (seats: Seated[], onStep?: () => void) =>
  playUntil(seats, (m) => m.status === 'finished', onStep);

/** Wait until every client has seen a state with every seat online. */
export const bothOnline = async (clients: Client[]) => {
  for (const c of clients) {
    await c.waitFor((m) => m.t === 'state' && m.online.every(Boolean), 0);
  }
  // Let any trailing presence broadcasts land before counting messages.
  await sleep(30);
};

/**
 * Create two players and a game: A creates and connects while waiting, B joins
 * over HTTP (A sees the opening), then B connects.
 */
export const setupGame = async (r: Running) => {
  const a = await newPlayer(r.base, 'Alice');
  const b = await newPlayer(r.base, 'Bob');
  const created = await api(r.base, 'POST', '/api/games', { token: a.token });
  const code = created.body.code as string;
  const ca = await Client.connect(r.wsUrl, a.token, code);
  const joined = await api(r.base, 'POST', `/api/games/${code}/join`, { token: b.token });
  if (joined.status !== 200) throw new Error(`join failed ${joined.status}`);
  await ca.waitFor((m) => m.t === 'state' && m.status === 'active');
  const cb = await Client.connect(r.wsUrl, b.token, code);
  await bothOnline([ca, cb]);
  const seats: [Seated, Seated] = [
    { player: a, client: ca },
    { player: b, client: cb },
  ];
  return { a, b, code, ca, cb, seats, created, joined };
};

export const allOnline = bothOnline;

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

/**
 * A game for `players`: the first player creates it and connects while
 * waiting, the rest join over HTTP in order (taking seats 1, 2, …), and once
 * the last seat fills and the opening is dealt everyone connects.
 */
export const setupTable = async (r: Running, players: PlayerCount) => {
  const people = await Promise.all(NAMES.slice(0, players).map((n) => newPlayer(r.base, n)));
  const created = await api(r.base, 'POST', '/api/games', { token: people[0].token, body: { players } });
  if (created.status !== 201) throw new Error(`create failed ${created.status}`);
  const code = created.body.code as string;
  const first = await Client.connect(r.wsUrl, people[0].token, code);
  for (const p of people.slice(1)) {
    const joined = await api(r.base, 'POST', `/api/games/${code}/join`, { token: p.token });
    if (joined.status !== 200) throw new Error(`join failed ${joined.status}`);
  }
  await first.waitFor((m) => m.t === 'state' && m.status === 'active');
  const clients = [first];
  for (const p of people.slice(1)) clients.push(await Client.connect(r.wsUrl, p.token, code));
  await bothOnline(clients);
  const seats: Seated[] = people.map((player, i) => ({ player, client: clients[i] }));
  return { code, people, clients, seats };
};

/** Read-only peek at the authoritative row, its state and its seating. */
export const readGame = (
  dbPath: string,
  code: string,
): { row: GameRow; state: GameState | null; seats: (string | null)[]; seatRows: SeatRow[] } => {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT * FROM games WHERE code = ?').get(code) as GameRow;
    const seatRows = db.prepare('SELECT * FROM game_players WHERE game_code = ? ORDER BY seat').all(code) as SeatRow[];
    const seats: (string | null)[] = row ? Array(row.players).fill(null) : [];
    for (const sr of seatRows) seats[sr.seat] = sr.player_id;
    return { row, state: row?.state ? upgradeState(JSON.parse(row.state)) : null, seats, seatRows };
  } finally {
    db.close();
  }
};

/** The scores column as numbers by team. */
export const rowScores = (row: GameRow): number[] => JSON.parse(row.scores) as number[];
