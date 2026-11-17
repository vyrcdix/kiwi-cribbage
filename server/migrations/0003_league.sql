-- The league: profiles, invite-only membership with a commissioner, sessions
-- (several devices per player), seasons, hand records, the fixture queue and
-- void games. Everything already stored keeps its meaning:
-- - every existing player stays a member; the earliest-created one becomes commissioner;
-- - every existing token keeps working (it becomes that player's first session);
-- - every existing game falls into Season 1.

-- ---- players: profile and membership ----
-- `avatar` (already present, always NULL so far) now holds JSON {"emoji","colour"}.
-- `token_hash` is kept for compatibility: the hash of the player's first token.
-- Authentication now uses `sessions` only.
ALTER TABLE players ADD COLUMN deck TEXT;
ALTER TABLE players ADD COLUMN four_colour INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE players ADD COLUMN deactivated_at TEXT;

-- A single row: who runs the league.
CREATE TABLE league (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  commissioner_id  TEXT REFERENCES players(id)
);
INSERT INTO league (id, commissioner_id)
SELECT 1, (SELECT id FROM players ORDER BY created_at, rowid LIMIT 1);

-- ---- sessions: one per signed-in device; tokens stored only as sha256 hashes ----
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES players(id),
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX sessions_player ON sessions (player_id);
INSERT INTO sessions (id, player_id, token_hash, created_at, last_seen_at)
SELECT 'legacy-' || id, id, token_hash, created_at, created_at FROM players;

-- League invite links: single use, 7 days.
CREATE TABLE invites (
  token_hash  TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL REFERENCES players(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  used_by     TEXT REFERENCES players(id)
);

-- Device link codes: single use, 10 minutes.
CREATE TABLE link_codes (
  code_hash   TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

-- ---- seasons: exactly one has no end (the current one) ----
CREATE TABLE seasons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT
);
CREATE UNIQUE INDEX seasons_one_current ON seasons ((ended_at IS NULL)) WHERE ended_at IS NULL;
INSERT INTO seasons (id, name, started_at)
VALUES (1, 'Season 1', COALESCE(
  (SELECT MIN(created_at) FROM games),
  (SELECT MIN(created_at) FROM players),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));

-- ---- fixtures: the queue of matchups to be played ----
CREATE TABLE fixtures (
  id          TEXT PRIMARY KEY,
  -- Queue order (league-wide; each player's queue is this order filtered to them).
  seq         INTEGER NOT NULL UNIQUE,
  season_id   INTEGER NOT NULL REFERENCES seasons(id),
  kind        TEXT NOT NULL CHECK (kind IN ('challenge', 'round-robin')),
  players     INTEGER NOT NULL CHECK (players IN (2, 3, 4)),
  created_by  TEXT NOT NULL REFERENCES players(id),
  created_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'playing', 'done', 'declined', 'cancelled')),
  game_code   TEXT REFERENCES games(code),
  -- Who declined / cancelled it, and when it was closed (done, declined or cancelled).
  closed_by   TEXT REFERENCES players(id),
  closed_at   TEXT
);
CREATE INDEX fixtures_season ON fixtures (season_id, status);

-- Seats in table order: in four-player fixtures seats 0 & 2 partner against 1 & 3.
CREATE TABLE fixture_players (
  fixture_id  TEXT NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  seat        INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
  player_id   TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY (fixture_id, seat),
  UNIQUE (fixture_id, player_id)
);
CREATE INDEX fixture_players_player ON fixture_players (player_id);

-- ---- games: season, last move, fixture link, void ----
ALTER TABLE games ADD COLUMN season_id INTEGER REFERENCES seasons(id);
UPDATE games SET season_id = 1;
-- Unknown for games already in progress: their creation time stands in.
ALTER TABLE games ADD COLUMN last_move_at TEXT;
UPDATE games SET last_move_at = COALESCE(finished_at, created_at);
ALTER TABLE games ADD COLUMN fixture_id TEXT REFERENCES fixtures(id);
ALTER TABLE games ADD COLUMN voided_at TEXT;
ALTER TABLE games ADD COLUMN voided_by TEXT REFERENCES players(id);
ALTER TABLE games ADD COLUMN void_reason TEXT;
CREATE INDEX games_season ON games (season_id, status);
CREATE INDEX games_status ON games (status);

-- ---- hand records ----
-- One row per finished hand (fully counted, or cut short by the end of the game).
-- `log` is the engine's HandLog JSON (shared/game.ts): dealer, dealt cards,
-- discards, starter, heels, every pegging step with its points, each show.
-- The hand in progress lives in games.state until it finishes.
CREATE TABLE hands (
  game_code     TEXT NOT NULL REFERENCES games(code) ON DELETE CASCADE,
  hand_no       INTEGER NOT NULL,
  dealer        INTEGER NOT NULL,
  ended_game    INTEGER NOT NULL DEFAULT 0,
  log           TEXT NOT NULL,
  -- JSON array by team.
  scores_after  TEXT NOT NULL,
  finished_at   TEXT NOT NULL,
  PRIMARY KEY (game_code, hand_no)
);

-- The same hands, one row per seat, flattened for statistics.
CREATE TABLE hand_seats (
  game_code    TEXT NOT NULL,
  hand_no      INTEGER NOT NULL,
  seat         INTEGER NOT NULL,
  player_id    TEXT NOT NULL REFERENCES players(id),
  is_dealer    INTEGER NOT NULL,
  -- The kept hand's count; NULL = never counted (the game ended first).
  hand_points  INTEGER,
  -- JSON array: the four cards kept.
  hand_cards   TEXT NOT NULL,
  -- Dealer only: the crib's count; NULL = not the dealer, or never counted.
  crib_points  INTEGER,
  crib_cards   TEXT,
  starter      INTEGER,
  -- Pegging points (plays plus go / last card), full rule values.
  peg_points   INTEGER NOT NULL,
  -- 1 when every card of the hand was played (pegging not cut short).
  pegged_out   INTEGER NOT NULL,
  heels        INTEGER NOT NULL,
  PRIMARY KEY (game_code, hand_no, seat),
  FOREIGN KEY (game_code, hand_no) REFERENCES hands (game_code, hand_no) ON DELETE CASCADE
);
CREATE INDEX hand_seats_player ON hand_seats (player_id);
