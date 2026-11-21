// The account's single active session; tokens carrying another session id are rejected.
export function up(db) {
  db.exec("ALTER TABLE users ADD COLUMN session_id TEXT;");
}
