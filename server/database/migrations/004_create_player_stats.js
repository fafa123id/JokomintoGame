export function up(db) {
  db.exec(`
    CREATE TABLE player_stats (
      user_id      INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      total_score  INTEGER NOT NULL DEFAULT 0,
      games_played INTEGER NOT NULL DEFAULT 0,
      games_won    INTEGER NOT NULL DEFAULT 0,
      best_score   INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX player_stats_total_score ON player_stats (total_score DESC);
  `);
}
