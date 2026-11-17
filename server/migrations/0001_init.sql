-- Players are anonymous: a name plus a bearer token (stored only as a sha256 hash).
CREATE TABLE players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  avatar      TEXT,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- One row per game. `state` is the full GameState JSON from shared/game.ts and is
-- the source of truth: it is rewritten on every action so a restart resumes exactly.
CREATE TABLE games (
  code         TEXT PRIMARY KEY,
  p0           TEXT NOT NULL REFERENCES players(id),
  p1           TEXT REFERENCES players(id),
  status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished')),
  state        TEXT,
  score0       INTEGER NOT NULL DEFAULT 0,
  score1       INTEGER NOT NULL DEFAULT 0,
  winner       TEXT REFERENCES players(id),
  skunk        INTEGER NOT NULL DEFAULT 0,
  next_code    TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE INDEX games_p0 ON games (p0, created_at);
CREATE INDEX games_p1 ON games (p1, created_at);
