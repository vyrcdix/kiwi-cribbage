-- Three- and four-player games. Seating moves out of games.p0/p1 into
-- game_players (one row per occupied seat); games gains a player count and the
-- creator (who may rearrange seats while waiting); scores become a JSON array by
-- team; the result is recorded as the winning team plus each player's place
-- and skunk level. Existing two-player rows are carried over unchanged in meaning.

ALTER TABLE games RENAME TO games_old;

CREATE TABLE games (
  code         TEXT PRIMARY KEY,
  players      INTEGER NOT NULL DEFAULT 2 CHECK (players IN (2, 3, 4)),
  creator      TEXT NOT NULL REFERENCES players(id),
  status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished')),
  -- Full GameState JSON (shared/game.ts): the source of truth, rewritten on every action.
  state        TEXT,
  -- JSON array of scores by team (2 teams, or 3 in a three-player game).
  scores       TEXT NOT NULL DEFAULT '[0,0]',
  winner_team  INTEGER,
  next_code    TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

INSERT INTO games (code, players, creator, status, state, scores, winner_team, next_code, created_at, finished_at)
SELECT code, 2, p0, status, state, json_array(score0, score1),
       CASE WHEN winner IS NULL THEN NULL WHEN winner = p0 THEN 0 ELSE 1 END,
       next_code, created_at, finished_at
FROM games_old;

CREATE TABLE game_players (
  game_code  TEXT NOT NULL REFERENCES games(code) ON DELETE CASCADE,
  seat       INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
  player_id  TEXT NOT NULL REFERENCES players(id),
  -- Once finished: 1 = won; losers ranked by score, ties sharing a place.
  place      INTEGER,
  -- Once finished: this player's (team's) skunk level, 0 none, 1 skunk, 2 double.
  skunk      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_code, seat),
  UNIQUE (game_code, player_id)
);

CREATE INDEX game_players_player ON game_players (player_id);

INSERT INTO game_players (game_code, seat, player_id, place, skunk)
SELECT code, 0, p0,
       CASE WHEN winner IS NULL THEN NULL WHEN winner = p0 THEN 1 ELSE 2 END,
       CASE WHEN winner IS NOT NULL AND winner <> p0 THEN skunk ELSE 0 END
FROM games_old;

INSERT INTO game_players (game_code, seat, player_id, place, skunk)
SELECT code, 1, p1,
       CASE WHEN winner IS NULL THEN NULL WHEN winner = p1 THEN 1 ELSE 2 END,
       CASE WHEN winner IS NOT NULL AND winner <> p1 THEN skunk ELSE 0 END
FROM games_old
WHERE p1 IS NOT NULL;

DROP TABLE games_old;

CREATE INDEX games_created ON games (created_at);
