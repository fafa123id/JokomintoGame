import { getDb } from "../database/connection.js";

const db = () => getDb();

function hydrate(row) {
  if (row) {
    row.revealed = JSON.parse(row.revealed);
    row.scoring = JSON.parse(row.scoring || "{}");
    row.state = JSON.parse(row.state || "{}");
  }
  return row;
}

export const GameSession = {
  create({ id, userId, type, answer, imageFile = null, revealed = [], scoring = {}, state = {}, expiresAt }) {
    db()
      .prepare(
        `INSERT INTO game_sessions
           (id, user_id, type, answer, image_file, revealed, scoring, state, started_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        type,
        answer,
        imageFile,
        JSON.stringify(revealed),
        JSON.stringify(scoring),
        JSON.stringify(state),
        Date.now(),
        expiresAt
      );
    return this.find(id, userId);
  },

  find(id, userId) {
    return hydrate(db().prepare("SELECT * FROM game_sessions WHERE id = ? AND user_id = ?").get(id, userId));
  },

  closeActiveFor(userId) {
    db().prepare("UPDATE game_sessions SET finished = 1 WHERE user_id = ? AND finished = 0").run(userId);
  },

  revealMore(id, revealed) {
    db()
      .prepare("UPDATE game_sessions SET revealed = ?, hints_used = hints_used + 1 WHERE id = ?")
      .run(JSON.stringify(revealed), id);
  },

  setState(id, state) {
    db().prepare("UPDATE game_sessions SET state = ? WHERE id = ?").run(JSON.stringify(state), id);
  },

  addAttempt(id) {
    return db().prepare("UPDATE game_sessions SET attempts = attempts + 1 WHERE id = ? RETURNING attempts").get(id)
      .attempts;
  },

  countWinsSince(userId, since) {
    return db()
      .prepare(
        "SELECT COUNT(*) AS count FROM game_sessions WHERE user_id = ? AND finished = 1 AND score > 0 AND started_at >= ?"
      )
      .get(userId, since).count;
  },

  // Returns false if the session was already finished (prevents double rewards).
  finish(id, score = 0) {
    return (
      db().prepare("UPDATE game_sessions SET finished = 1, score = ? WHERE id = ? AND finished = 0").run(score, id)
        .changes === 1
    );
  },
};
