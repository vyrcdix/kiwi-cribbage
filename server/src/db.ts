import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from './time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

export type DB = Database.Database;

/** CABBAGE_DB, else server/cabbage.db (next to package.json). */
export const dbPath = (): string => {
  const env = process.env.CABBAGE_DB;
  if (env) return env;
  return resolve(__dirname, '..', 'cabbage.db');
};

export const openDb = (path: string = dbPath()): DB => {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
};

const ensureMigrationsTable = (db: DB) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
};

/** Apply every not-yet-applied migrations/*.sql in filename order, each in its own transaction. */
export const applyMigrations = (db: DB, log = true) => {
  ensureMigrationsTable(db);
  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const insertApplied = db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)');
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      insertApplied.run(file, nowIso());
    })();
    if (log) console.log(`[db] applied migration: ${file}`);
  }
};
