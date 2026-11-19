import { getDb } from "../database/connection.js";

const db = () => getDb();

export const PlayerStat = {
  createFor(userId, { totalScore = 0, gamesPlayed = 0, gamesWon = 0, bestScore = 0 } = {}) {
    db()
      .prepare(
        `INSERT INTO player_stats (user_id, total_score, games_played, games_won, best_score, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(userId, totalScore, gamesPlayed, gamesWon, bestScore, Date.now());
  },

  findByUser(userId) {
    return db().prepare("SELECT * FROM player_stats WHERE user_id = ?").get(userId);
  },

  recordGamePlayed(userId) {
    db()
      .prepare("UPDATE player_stats SET games_played = games_played + 1, updated_at = ? WHERE user_id = ?")
      .run(Date.now(), userId);
  },

  recordWin(userId, score) {
    db()
      .prepare(
        `UPDATE player_stats
            SET total_score = total_score + ?, games_won = games_won + 1,
                best_score = MAX(best_score, ?), updated_at = ?
          WHERE user_id = ?`
      )
      .run(score, score, Date.now(), userId);
  },

  addScore(userId, score) {
    db()
      .prepare(
        `UPDATE player_stats
            SET total_score = total_score + ?, best_score = MAX(best_score, ?), updated_at = ?
          WHERE user_id = ?`
      )
      .run(score, score, Date.now(), userId);
  },

  topRegistered(limit) {
    return db()
      .prepare(
        `SELECT u.id AS user_id, u.name, s.total_score, s.games_won, s.best_score
           FROM player_stats s
           JOIN users u ON u.id = s.user_id
          WHERE u.is_guest = 0
          ORDER BY s.total_score DESC, s.games_won DESC, s.updated_at ASC
          LIMIT ?`
      )
      .all(limit);
  },

  rankForScore(score) {
    const { count } = db()
      .prepare(
        `SELECT COUNT(*) AS count
           FROM player_stats s
           JOIN users u ON u.id = s.user_id
          WHERE u.is_guest = 0 AND s.total_score > ?`
      )
      .get(score);
    return count + 1;
  },

  countRegistered() {
    return db()
      .prepare("SELECT COUNT(*) AS count FROM player_stats s JOIN users u ON u.id = s.user_id WHERE u.is_guest = 0")
      .get().count;
  },
};
