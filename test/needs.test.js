import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "jm-needs-"));
process.env.DB_FILE = path.join(dir, "needs.db");
process.env.NODE_ENV = "test";

let db;
let job;
let User;
let Pet;

before(async () => {
  const { migrate } = await import("../server/database/migrator.js");
  await migrate({ log: () => {} });
  db = await import("../server/database/connection.js");
  job = await import("../server/jobs/needsDecay.job.js");
  ({ User } = await import("../server/models/user.model.js"));
  ({ Pet } = await import("../server/models/pet.model.js"));
});

after(() => {
  db?.closeDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

function petFor(name, values) {
  const user = User.create({ name, isGuest: true });
  Pet.createFor(user.id, values);
  return user.id;
}

test("one decay step lowers every pet by 10 and clamps at the limits", () => {
  const a = petFor("Alpha", { hunger: 0, hygiene: 100, mood: 100, coin: 0 });
  const b = petFor("Beta", { hunger: 95, hygiene: 5, mood: 3, coin: 0 });
  job.runNeedsDecay();
  assert.deepEqual(
    (({ hunger, hygiene, mood }) => ({ hunger, hygiene, mood }))(Pet.findByUser(a)),
    { hunger: 10, hygiene: 90, mood: 90 }
  );
  assert.deepEqual(
    (({ hunger, hygiene, mood }) => ({ hunger, hygiene, mood }))(Pet.findByUser(b)),
    { hunger: 100, hygiene: 0, mood: 0 }
  );
});

test("alerts fire when a need turns bad, then remind while it stays bad", () => {
  const hour = 60 * 60 * 1000;
  const start = Date.now();
  const crossing = petFor("Gamma", { hunger: 65, hygiene: 35, mood: 35, coin: 0 });
  const alreadyBad = petFor("Delta", { hunger: 90, hygiene: 10, mood: 10, coin: 0 });
  const healthy = petFor("Echo", { hunger: 0, hygiene: 100, mood: 100, coin: 0 });

  const first = job.runNeedsDecay(start).alerts;
  assert.deepEqual(first.find((a) => a.userId === crossing)?.needs.sort(), ["dirty", "hungry", "sad"]);
  assert.ok(first.find((a) => a.userId === alreadyBad));
  assert.equal(first.find((a) => a.userId === healthy), undefined);

  const soon = job.runNeedsDecay(start + 2 * hour).alerts;
  assert.equal(soon.find((a) => a.userId === alreadyBad), undefined);

  const later = job.runNeedsDecay(start + 6 * hour).alerts;
  assert.ok(later.find((a) => a.userId === alreadyBad));
});
