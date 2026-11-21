import { getDb } from "../database/connection.js";

const db = () => getDb();

export const Friendship = {
  status(userId, friendId) {
    return db().prepare("SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?").get(userId, friendId)?.status ?? null;
  },

  areFriends(userId, friendId) {
    return this.status(userId, friendId) === "accepted";
  },

  request(userId, friendId) {
    db()
      .prepare("INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(userId, friendId, Date.now());
  },

  accept(requesterId, addresseeId) {
    const now = Date.now();
    db().prepare("UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(requesterId, addresseeId);
    db()
      .prepare(
        `INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, 'accepted', ?)
         ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'`
      )
      .run(addresseeId, requesterId, now);
  },

  // Removes the link in both directions (unfriend, decline or cancel).
  remove(userId, friendId) {
    db()
      .prepare("DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)")
      .run(userId, friendId, friendId, userId);
  },

  countFriends(userId) {
    return db().prepare("SELECT COUNT(*) AS n FROM friendships WHERE user_id = ? AND status = 'accepted'").get(userId).n;
  },

  friendIds(userId) {
    return db()
      .prepare("SELECT friend_id FROM friendships WHERE user_id = ? AND status = 'accepted'")
      .all(userId)
      .map((r) => r.friend_id);
  },

  list(userId) {
    const people = (sql) => db().prepare(sql).all(userId);
    const select = "SELECT u.id, u.name, u.uid, u.equipped_skin, u.last_seen_at FROM friendships f JOIN users u";
    return {
      friends: people(`${select} ON u.id = f.friend_id WHERE f.user_id = ? AND f.status = 'accepted' ORDER BY u.name COLLATE NOCASE`),
      incoming: people(`${select} ON u.id = f.user_id WHERE f.friend_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`),
      outgoing: people(`${select} ON u.id = f.friend_id WHERE f.user_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`),
    };
  },
};
