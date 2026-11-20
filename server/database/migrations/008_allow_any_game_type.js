// Game types are validated in the app layer, so the column no longer needs a CHECK list.
export function up(db) {
  db.exec(`
    CREATE TABLE game_sessions_new (
      id          TEXT    PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      type        TEXT    NOT NULL,
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
    INSERT INTO game_sessions_new SELECT
      id, user_id, type, answer, image_file, revealed, hints_used, attempts,
      started_at, expires_at, finished, score, scoring, state
    FROM game_sessions;
    DROP TABLE game_sessions;
    ALTER TABLE game_sessions_new RENAME TO game_sessions;
    CREATE INDEX game_sessions_user_active ON game_sessions (user_id, finished);
  `);
}
