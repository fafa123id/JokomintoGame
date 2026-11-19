// Usage: node server/scripts/db.js <migrate | fresh | seed> [--force]
import config from "../config/index.js";
import { migrate, fresh } from "../database/migrator.js";
import { closeDb } from "../database/connection.js";
import { runSeeders } from "../database/seeders/index.js";

const [command, ...flags] = process.argv.slice(2);
const force = flags.includes("--force");

function assertNotProduction(name) {
  if (config.isProd && !force) {
    console.error(`"${name}" is disabled in production. Use --force to override.`);
    process.exit(1);
  }
}

const commands = {
  async migrate() {
    await migrate();
  },
  async fresh() {
    assertNotProduction("fresh");
    await fresh();
    await runSeeders();
  },
  async seed() {
    assertNotProduction("seed");
    await migrate({ log: () => {} });
    await runSeeders();
  },
};

if (!commands[command]) {
  console.log("Usage: node server/scripts/db.js <migrate | fresh | seed> [--force]");
  process.exit(command ? 1 : 0);
}

try {
  await commands[command]();
} finally {
  closeDb();
}
