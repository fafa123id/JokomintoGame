import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "jm-match-"));
process.env.DB_FILE = path.join(dir, "match.db");
process.env.NODE_ENV = "test";

let db;
let svc;
let Match;
let User;
let Pet;

before(async () => {
  const { migrate } = await import("../server/database/migrator.js");
  await migrate({ log: () => {} });
  db = await import("../server/database/connection.js");
  svc = await import("../server/services/match.service.js");
  ({ Match } = await import("../server/models/match.model.js"));
  ({ User } = await import("../server/models/user.model.js"));
  ({ Pet } = await import("../server/models/pet.model.js"));
});

after(() => {
  db?.closeDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("the player whose 5-minute turn runs out loses", () => {
  const players = ["Slow", "Fast"].map((name) => {
    const user = User.create({ name, isGuest: true });
    Pet.createFor(user.id, { hunger: 0, hygiene: 100, mood: 50, coin: 0 });
    return user;
  });
  const deadline = Date.now() + 300_000;
  const match = Match.create({
    id: "00000000-0000-4000-8000-000000000001",
    type: "tictactoe",
    playerA: players[0].id,
    playerB: players[1].id,
    state: { board: Array(9).fill(null), moves: 0 },
    deadline,
  });

  assert.equal(svc.expireTurn(match.id, deadline - 1000), undefined);
  assert.equal(Match.find(match.id).status, "active");

  const done = svc.expireTurn(match.id, deadline + 1);
  assert.equal(done.status, "finished");
  assert.equal(done.winner, "b");
  assert.equal(done.reason, "timeout");
  assert.ok(Pet.findByUser(players[1].id).coin >= 100);
  assert.equal(Pet.findByUser(players[0].id).coin, 0);
  assert.equal(svc.expireTurn(match.id, deadline + 2), null);
});
