export function up(db) {
  db.exec(`
    CREATE TABLE game_sessions (
      id          TEXT    PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      type        TEXT    NOT NULL CHECK (type IN ('word', 'image')),
      answer      TEXT    NOT NULL,
      image_file  TEXT,
      revealed    TEXT    NOT NULL,
      hints_used  INTEGER NOT NULL DEFAULT 0,
      attempts    INTEGER NOT NULL DEFAULT 0,
      started_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      finished    INTEGER NOT NULL DEFAULT 0,
      score       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX game_sessions_user_active ON game_sessions (user_id, finished);
  `);
}
