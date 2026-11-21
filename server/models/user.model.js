import { getDb } from "../database/connection.js";
import { newUid } from "../utils/uid.js";

const db = () => getDb();

const FILLABLE = {
  name: "name",
  email: "email",
  passwordHash: "password_hash",
  googleId: "google_id",
  isGuest: "is_guest",
};

export const User = {
  find(id) {
    return db().prepare("SELECT * FROM users WHERE id = ?").get(id);
  },

  findByEmail(email) {
    return db().prepare("SELECT * FROM users WHERE email = ?").get(email);
  },

  findByGoogleId(googleId) {
    return db().prepare("SELECT * FROM users WHERE google_id = ?").get(googleId);
  },

  findByUid(uid) {
    return db().prepare("SELECT * FROM users WHERE uid = ?").get(uid);
  },

  create({ name, email = null, passwordHash = null, googleId = null, isGuest = true }) {
    const now = Date.now();
    const insert = db().prepare(
      `INSERT INTO users (name, email, password_hash, google_id, is_guest, created_at, last_seen_at, uid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // A UID collision is astronomically rare; retry on the unique index instead of checking first.
    for (let attempt = 0; ; attempt++) {
      try {
        const { lastInsertRowid } = insert.run(name, email, passwordHash, googleId, isGuest ? 1 : 0, now, now, newUid());
        return this.find(Number(lastInsertRowid));
      } catch (err) {
        if (attempt >= 3 || !String(err.message).includes("users.uid")) throw err;
      }
    }
  },

  update(id, fields) {
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(FILLABLE)) {
      if (!(key in fields)) continue;
      sets.push(`${column} = ?`);
      values.push(key === "isGuest" ? (fields[key] ? 1 : 0) : fields[key]);
    }
    if (sets.length) db().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    return this.find(id);
  },

  touch(id) {
    db().prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(Date.now(), id);
  },

  delete(id) {
    db().prepare("DELETE FROM users WHERE id = ?").run(id);
  },

  deleteGuestsInactiveSince(timestamp) {
    return db().prepare("DELETE FROM users WHERE is_guest = 1 AND last_seen_at < ?").run(timestamp).changes;
  },

  toPublic(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isGuest: !!user.is_guest,
      uid: user.uid,
      skin: user.equipped_skin ?? "classic",
    };
  },
};
