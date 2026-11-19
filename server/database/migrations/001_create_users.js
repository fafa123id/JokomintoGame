export function up(db) {
  db.exec(`
    CREATE TABLE users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    UNIQUE,
      password_hash TEXT,
      google_id     TEXT    UNIQUE,
      is_guest      INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL
    );
    CREATE INDEX users_guest_last_seen ON users (is_guest, last_seen_at);
  `);
}
