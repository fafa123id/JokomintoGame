export function up(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN equipped_skin TEXT NOT NULL DEFAULT 'classic';
    CREATE TABLE user_skins (
      user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      skin_id      TEXT    NOT NULL,
      purchased_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, skin_id)
    );
  `);
}
