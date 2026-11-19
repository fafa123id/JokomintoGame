export function up(db) {
  db.exec(`
    CREATE TABLE game_sessions_new (
      id          TEXT    PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      type        TEXT    NOT NULL CHECK (type IN ('word', 'image', 'tictactoe')),
      answer      TEXT    NOT NULL,
      image_file  TEXT,
      revealed    TEXT    NOT NULL,
      hints_used  INTEGER NOT NULL DEFAULT 0,
      attempts    INTEGER NOT NULL DEFAULT 0,
      started_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      finished    INTEGER NOT NULL DEFAULT 0,
      score       INTEGER NOT NULL DEFAULT 0,
      scoring     TEXT    NOT NULL DEFAULT '{}',
      state       TEXT    NOT NULL DEFAULT '{}'
    );
    INSERT INTO game_sessions_new
      (id, user_id, type, answer, image_file, revealed, hints_used, attempts, started_at, expires_at, finished, score, scoring)
    SELECT id, user_id, type, answer, image_file, revealed, hints_used, attempts, started_at, expires_at, finished, score, scoring
      FROM game_sessions;
    DROP TABLE game_sessions;
    ALTER TABLE game_sessions_new RENAME TO game_sessions;
    CREATE INDEX game_sessions_user_active ON game_sessions (user_id, finished);
  `);
}
