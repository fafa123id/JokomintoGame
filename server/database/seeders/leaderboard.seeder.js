import crypto from "node:crypto";
import { getDb, transaction } from "../connection.js";
import { User } from "../../models/user.model.js";
import { Pet } from "../../models/pet.model.js";
import { PlayerStat } from "../../models/playerStat.model.js";

// Reserved TLD (RFC 2606); seeded accounts have no password and cannot log in.
const SEED_DOMAIN = "seed.invalid";
const COUNT = 30;

const NAMES = [
  "Budi", "Siti", "Andi", "Dewi", "Rizky", "Putri", "Agus", "Rina", "Fajar", "Nadia",
  "Yoga", "Intan", "Bayu", "Citra", "Dimas", "Eka", "Gilang", "Hana", "Joko", "Kirana",
  "Luthfi", "Maya", "Nanda", "Oki", "Rara", "Sari", "Tegar", "Umi", "Vino", "Wulan",
];
const SUFFIXES = ["", "_gg", "99", ".id", "_pro", "123", "_x", "07", "", "_san"];

export function seedLeaderboard() {
  const { count } = getDb()
    .prepare("SELECT COUNT(*) AS count FROM users WHERE email LIKE ?")
    .get(`%@${SEED_DOMAIN}`);

  if (count > 0) {
    console.log(`skipped   leaderboard seeder (${count} players exist)`);
    return;
  }

  transaction(() => {
    for (let i = 0; i < COUNT; i++) {
      const name = NAMES[i % NAMES.length] + SUFFIXES[crypto.randomInt(SUFFIXES.length)];
      const user = User.create({ name, email: `player${i + 1}@${SEED_DOMAIN}`, isGuest: false });
      Pet.createFor(user.id);

      const gamesPlayed = crypto.randomInt(5, 80);
      const gamesWon = crypto.randomInt(1, gamesPlayed + 1);
      const averageScore = crypto.randomInt(60, 190);
      PlayerStat.createFor(user.id, {
        gamesPlayed,
        gamesWon,
        totalScore: gamesWon * averageScore,
        bestScore: Math.min(200, averageScore + crypto.randomInt(0, 40)),
      });
    }
  });

  console.log(`seeded    leaderboard seeder (${COUNT} players)`);
}
