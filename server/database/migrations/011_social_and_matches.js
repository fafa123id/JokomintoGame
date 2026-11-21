import { newUid } from "../../utils/uid.js";

export function up(db) {
  db.exec("ALTER TABLE users ADD COLUMN uid TEXT;");
  const taken = new Set();
  const assign = db.prepare("UPDATE users SET uid = ? WHERE id = ?");
  for (const { id } of db.prepare("SELECT id FROM users").all()) {
    let uid;
    do uid = newUid();
    while (taken.has(uid));
    taken.add(uid);
    assign.run(uid, id);
  }

  db.exec(`
    CREATE UNIQUE INDEX users_uid ON users (uid);

    -- One row per direction: a request is (requester -> addressee, 'pending');
    -- accepting it marks that row and adds the reverse row, both 'accepted'.
    CREATE TABLE friendships (
      user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      friend_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      status     TEXT    NOT NULL CHECK (status IN ('pending', 'accepted')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_id)
    );
    CREATE INDEX friendships_friend ON friendships (friend_id);

    -- Online matches between two players; side 'a' is X / white and moves first.
    CREATE TABLE matches (
      id            TEXT    PRIMARY KEY,
      type          TEXT    NOT NULL,
      player_a      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      player_b      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      state         TEXT    NOT NULL,
      turn          TEXT    NOT NULL,
      turn_deadline INTEGER NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'active',
      winner        TEXT,
      reason        TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX matches_active ON matches (status);
    CREATE INDEX matches_player_a ON matches (player_a);
    CREATE INDEX matches_player_b ON matches (player_b);
  `);
}
