import { getDb } from "../database/connection.js";

const db = () => getDb();

export const UserSkin = {
  ownedBy(userId) {
    return db()
      .prepare("SELECT skin_id FROM user_skins WHERE user_id = ?")
      .all(userId)
      .map((row) => row.skin_id);
  },

  owns(userId, skinId) {
    return !!db().prepare("SELECT 1 FROM user_skins WHERE user_id = ? AND skin_id = ?").get(userId, skinId);
  },

  add(userId, skinId) {
    db()
      .prepare("INSERT INTO user_skins (user_id, skin_id, purchased_at) VALUES (?, ?, ?)")
      .run(userId, skinId, Date.now());
  },

  equip(userId, skinId) {
    db().prepare("UPDATE users SET equipped_skin = ? WHERE id = ?").run(skinId, userId);
  },
};
