import { seedLeaderboard } from "./leaderboard.seeder.js";

const seeders = [seedLeaderboard];

export async function runSeeders() {
  for (const seeder of seeders) await seeder();
}
