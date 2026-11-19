export function up(db) {
  db.exec(`
    CREATE TABLE pets (
      user_id    INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      hunger     INTEGER NOT NULL,
      hygiene    INTEGER NOT NULL,
      mood       INTEGER NOT NULL,
      coin       INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
