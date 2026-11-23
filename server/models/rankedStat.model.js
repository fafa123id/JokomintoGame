import { getDb } from "../database/connection.js";

const db = () => getDb();
const EMPTY = { points: 0, peak: 0, games: 0, wins: 0, last_delta: 0 };

export const RankedStat = {
  find(userId) {
    return db().prepare("SELECT * FROM ranked_stats WHERE user_id = ?").get(userId) ?? { user_id: userId, ...EMPTY };
  },

  record(userId, { points, delta, won }) {
    db()
      .prepare(
        `INSERT INTO ranked_stats (user_id, points, peak, games, wins, last_delta, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           points = excluded.points, peak = MAX(peak, excluded.points), games = games + 1,
           wins = wins + excluded.wins, last_delta = excluded.last_delta, updated_at = excluded.updated_at`
      )
      .run(userId, points, points, won ? 1 : 0, delta, Date.now());
  },

  // Registered players by RP (guests play ranked but stay off the global ranking).
  top(limit, minPoints = 0) {
    return db()
      .prepare(
        `SELECT r.user_id, u.name, u.uid, r.points, r.games, r.wins
           FROM ranked_stats r JOIN users u ON u.id = r.user_id
          WHERE u.is_guest = 0 AND r.points >= ?
          ORDER BY r.points DESC, r.updated_at ASC
          LIMIT ?`
      )
      .all(minPoints, limit);
  },

  position(userId) {
    const row = db()
      .prepare(
        `SELECT COUNT(*) + 1 AS position FROM ranked_stats r JOIN users u ON u.id = r.user_id
          WHERE u.is_guest = 0 AND r.points > (SELECT points FROM ranked_stats WHERE user_id = ?)`
      )
      .get(userId);
    return row?.position ?? null;
  },
};
