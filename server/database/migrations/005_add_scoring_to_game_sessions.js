export function up(db) {
  db.exec(`ALTER TABLE game_sessions ADD COLUMN scoring TEXT NOT NULL DEFAULT '{}'`);
}
