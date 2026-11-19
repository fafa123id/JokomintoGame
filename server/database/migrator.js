import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDb, transaction } from "./connection.js";
import { paths } from "../config/index.js";

function migrationFiles() {
  return fs
    .readdirSync(paths.migrations)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

export async function migrate({ log = console.log } = {}) {
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at INTEGER NOT NULL)");
  const done = new Set(db.prepare("SELECT name FROM migrations").all().map((r) => r.name));

  let count = 0;
  for (const file of migrationFiles()) {
    const name = file.replace(/\.js$/, "");
    if (done.has(name)) continue;
    const { up } = await import(pathToFileURL(path.join(paths.migrations, file)).href);
    transaction(() => {
      up(db);
      db.prepare("INSERT INTO migrations (name, ran_at) VALUES (?, ?)").run(name, Date.now());
    });
    log(`migrated  ${name}`);
    count++;
  }
  if (count === 0) log("nothing to migrate");
}

export async function fresh(opts) {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
  db.exec("PRAGMA foreign_keys = OFF");
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.replaceAll('"', '""')}"`);
  db.exec("PRAGMA foreign_keys = ON");
  await migrate(opts);
}
