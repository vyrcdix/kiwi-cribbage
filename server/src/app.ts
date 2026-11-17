import express from 'express';
import { createServer, type Server } from 'node:http';
import { apiRouter, errorMiddleware } from './api.js';
import { applyMigrations, dbPath as defaultDbPath, openDb, type DB } from './db.js';
import { Hub, type HubOptions } from './hub.js';
import { DEFAULT_RATE_LIMITS, type RateLimits } from './ratelimit.js';
import { Store, type StoreOptions } from './store.js';

export interface AppOptions extends HubOptions, StoreOptions {
  /** SQLite file; defaults to CABBAGE_DB or server/cabbage.db. */
  dbPath?: string;
  /** Log applied migrations (default true). */
  logMigrations?: boolean;
  /** Per-IP limits on the public guessable endpoints (defaults: DEFAULT_RATE_LIMITS). Tests pass small ones. */
  rateLimits?: Partial<RateLimits>;
}

export type CabbageServer = Server & {
  db: DB;
  /** Hang up every socket, stop listening, close the database. */
  shutdown(): Promise<void>;
};

/** Build the HTTP + WebSocket server. Call `.listen()` on the result. */
export function createApp(opts: AppOptions = {}): CabbageServer {
  const db = openDb(opts.dbPath ?? defaultDbPath());
  applyMigrations(db, opts.logMigrations ?? true);
  const store = new Store(db, { shuffle: opts.shuffle, clock: opts.clock });
  store.heal();

  const app = express();
  // Behind Caddy in production.
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  const server = createServer(app);
  const hub = new Hub(store, opts);
  hub.attach(server);

  app.use('/api', apiRouter(store, hub, { ...DEFAULT_RATE_LIMITS, ...opts.rateLimits }));
  app.use(errorMiddleware);

  let closed: Promise<void> | null = null;
  const shutdown = () =>
    (closed ??= new Promise<void>((resolve) => {
      hub.close();
      const finish = () => {
        db.close();
        resolve();
      };
      if (!server.listening) return finish();
      server.close(() => finish());
      server.closeAllConnections();
    }));

  return Object.assign(server, { db, shutdown });
}
