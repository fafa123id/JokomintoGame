export function up(db) {
  db.exec(`
    CREATE TABLE job_runs (
      name        TEXT    PRIMARY KEY,
      last_run_at INTEGER NOT NULL
    );

    CREATE TABLE push_subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      endpoint   TEXT    NOT NULL UNIQUE,
      p256dh     TEXT    NOT NULL,
      auth       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

    ALTER TABLE pets ADD COLUMN petting_window_start INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pets ADD COLUMN petting_window_gain  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pets ADD COLUMN last_petted_at       INTEGER NOT NULL DEFAULT 0;
  `);
}
