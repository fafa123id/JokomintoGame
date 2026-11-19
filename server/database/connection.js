import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import config from "../config/index.js";

let db = null;
let txDepth = 0;

export function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
    db = new DatabaseSync(config.dbFile);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
  }
  return db;
}

// Nested calls join the outer transaction.
export function transaction(fn) {
  const conn = getDb();
  if (txDepth > 0) return fn();
  txDepth++;
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  } finally {
    txDepth--;
  }
}

export function closeDb() {
  db?.close();
  db = null;
}
