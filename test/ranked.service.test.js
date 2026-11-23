import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "jm-ranked-"));
process.env.DB_FILE = path.join(dir, "ranked.db");
process.env.NODE_ENV = "test";

let db;
let svc;
let User;
let RankedStat;

before(async () => {
  const { migrate } = await import("../server/database/migrator.js");
  await migrate({ log: () => {} });
  db = await import("../server/database/connection.js");
  svc = await import("../server/fps/service.js");
  ({ User } = await import("../server/models/user.model.js"));
  ({ RankedStat } = await import("../server/models/rankedStat.model.js"));
});

after(() => {
  svc?.shutdown();
  db?.closeDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("ranked results are saved, leavers pay and get a queue ban, and the ladder ranks registered players", () => {
  const winner = User.create({ name: "Winner", isGuest: false });
  const loser = User.create({ name: "Loser", isGuest: false });
  const quitter = User.create({ name: "Quitter", isGuest: false });
  const room = { id: "room-1", score: { red: 10, blue: 6 } };
  const results = [
    { userId: winner.id, team: "red", won: true, kills: 18, deaths: 9, assists: 4, objectives: 2 },
    { userId: loser.id, team: "blue", won: false, kills: 6, deaths: 15, assists: 2, objectives: 0 },
    { userId: quitter.id, team: "blue", won: false, kills: 1, deaths: 3, assists: 0, objectives: 0 },
  ];
  const out = svc.rankedResults(room, { winner: "red", results }, (id) => id === quitter.id);
  assert.ok(out[winner.id].delta >= 200 && out[winner.id].delta <= 500);
  assert.equal(out[winner.id].rankAfter.id, "bronze", "one good win lifts you out of Unranked");
  assert.equal(RankedStat.find(winner.id).points, out[winner.id].after);
  assert.equal(RankedStat.find(winner.id).wins, 1);
  assert.equal(out[loser.id].delta, 0, "Unranked can't go below 0");
  assert.equal(out[quitter.id].left, true);
  assert.ok(svc.rankedProfile(quitter.id).bannedMs > 0, "left early: ranked is locked for a while");
  const profile = svc.rankedProfile(winner.id);
  assert.equal(profile.position, 1);
  assert.equal(profile.games, 1);
});
