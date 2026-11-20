export function up(db) {
  db.exec("ALTER TABLE pets ADD COLUMN last_notified_at INTEGER NOT NULL DEFAULT 0;");
}
