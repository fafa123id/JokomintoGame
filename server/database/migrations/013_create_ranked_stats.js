// Jokoman ranked ladder: one row per player who has played ranked.
export function up(db) {
  db.exec(`
    CREATE TABLE ranked_stats (
      user_id     INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      points      INTEGER NOT NULL DEFAULT 0,
      peak        INTEGER NOT NULL DEFAULT 0,
      games       INTEGER NOT NULL DEFAULT 0,
      wins        INTEGER NOT NULL DEFAULT 0,
      last_delta  INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX ranked_stats_points ON ranked_stats (points DESC);
  `);
}
