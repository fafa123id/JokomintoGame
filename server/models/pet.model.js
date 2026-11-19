import { getDb } from "../database/connection.js";
import { INITIAL_PET } from "../config/game.js";

const db = () => getDb();

export const Pet = {
  findByUser(userId) {
    return db().prepare("SELECT * FROM pets WHERE user_id = ?").get(userId);
  },

  createFor(userId, values = INITIAL_PET) {
    db()
      .prepare("INSERT INTO pets (user_id, hunger, hygiene, mood, coin, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, values.hunger, values.hygiene, values.mood, values.coin, Date.now());
  },

  save(pet) {
    db()
      .prepare("UPDATE pets SET hunger = ?, hygiene = ?, mood = ?, coin = ?, updated_at = ? WHERE user_id = ?")
      .run(pet.hunger, pet.hygiene, pet.mood, pet.coin, pet.updated_at, pet.user_id);
  },

  toPublic({ hunger, hygiene, mood, coin }) {
    return { hunger, hygiene, mood, coin };
  },
};
