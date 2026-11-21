import { getDb } from "../database/connection.js";

const db = () => getDb();

function hydrate(row) {
  if (row) row.state = JSON.parse(row.state);
  return row;
}

export const Match = {
  create({ id, type, playerA, playerB, state, deadline }) {
    const now = Date.now();
    db()
      .prepare(
        `INSERT INTO matches (id, type, player_a, player_b, state, turn, turn_deadline, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'a', ?, ?, ?)`
      )
      .run(id, type, playerA, playerB, JSON.stringify(state), deadline, now, now);
    return this.find(id);
  },

  find(id) {
    return hydrate(db().prepare("SELECT * FROM matches WHERE id = ?").get(id));
  },

  activeFor(userId) {
    return hydrate(
      db()
        .prepare("SELECT * FROM matches WHERE status = 'active' AND (player_a = ? OR player_b = ?) ORDER BY created_at DESC LIMIT 1")
        .get(userId, userId)
    );
  },

  allActive() {
    return db().prepare("SELECT * FROM matches WHERE status = 'active'").all().map(hydrate);
  },

  update(id, { state, turn, deadline }) {
    db()
      .prepare("UPDATE matches SET state = ?, turn = ?, turn_deadline = ?, updated_at = ? WHERE id = ? AND status = 'active'")
      .run(JSON.stringify(state), turn, deadline, Date.now(), id);
  },

  countWinsSince(userId, since) {
    return db()
      .prepare(
        `SELECT COUNT(*) AS n FROM matches WHERE status = 'finished' AND updated_at >= ?
           AND ((player_a = ? AND winner = 'a') OR (player_b = ? AND winner = 'b'))`
      )
      .get(since, userId, userId).n;
  },

  // Returns false if the match was already over, so results are never applied twice.
  finish(id, { state, winner, reason }) {
    return (
      db()
        .prepare("UPDATE matches SET state = ?, status = 'finished', winner = ?, reason = ?, updated_at = ? WHERE id = ? AND status = 'active'")
        .run(JSON.stringify(state), winner, reason, Date.now(), id).changes === 1
    );
  },
};
