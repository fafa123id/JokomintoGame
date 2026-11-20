import { getDb, transaction } from "../database/connection.js";
import { NEEDS } from "../config/game.js";
import { notifyNeeds } from "../services/push.service.js";

const JOB = "needs-decay";
const clamp = (value) => Math.max(0, Math.min(100, value));
const intervalMs = () => NEEDS.decayEveryHours * 60 * 60 * 1000;

function lastRun() {
  return getDb().prepare("SELECT last_run_at FROM job_runs WHERE name = ?").get(JOB)?.last_run_at ?? 0;
}

function recordRun(at) {
  getDb()
    .prepare("INSERT INTO job_runs (name, last_run_at) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET last_run_at = excluded.last_run_at")
    .run(JOB, at);
}

// Applies one decay step to every pet (guests and accounts) and reports pets that need care:
// right away when a need turns bad, then as a reminder every NEEDS.remindEveryHours while it stays bad.
export function runNeedsDecay(now = Date.now()) {
  const { step, alert } = NEEDS;
  const remindMs = NEEDS.remindEveryHours * 60 * 60 * 1000;
  return transaction(() => {
    const db = getDb();
    const pets = db.prepare("SELECT user_id, hunger, hygiene, mood, last_notified_at FROM pets").all();
    const update = db.prepare("UPDATE pets SET hunger = ?, hygiene = ?, mood = ? WHERE user_id = ?");
    const notified = db.prepare("UPDATE pets SET last_notified_at = ? WHERE user_id = ?");
    const alerts = [];

    for (const pet of pets) {
      const next = {
        hunger: clamp(pet.hunger + step.hunger),
        hygiene: clamp(pet.hygiene + step.hygiene),
        mood: clamp(pet.mood + step.mood),
      };
      update.run(next.hunger, next.hygiene, next.mood, pet.user_id);

      const needs = [];
      if (next.hunger >= alert.hunger) needs.push("hungry");
      if (next.hygiene <= alert.hygiene) needs.push("dirty");
      if (next.mood <= alert.mood) needs.push("sad");
      if (!needs.length) continue;

      const justTurnedBad =
        (pet.hunger < alert.hunger && next.hunger >= alert.hunger) ||
        (pet.hygiene > alert.hygiene && next.hygiene <= alert.hygiene) ||
        (pet.mood > alert.mood && next.mood <= alert.mood);
      if (justTurnedBad || now - pet.last_notified_at >= remindMs) {
        notified.run(now, pet.user_id);
        alerts.push({ userId: pet.user_id, needs });
      }
    }

    recordRun(now);
    return { updated: pets.length, alerts };
  });
}

// Runs every NEEDS.decayEveryHours while the server is up. A run missed during downtime happens once at startup.
export function startNeedsDecay({ log = () => {} } = {}) {
  let timer = null;

  const tick = async () => {
    const { updated, alerts } = runNeedsDecay();
    log(`needs decay: ${updated} pet(s), ${alerts.length} alert(s)`);
    await Promise.all(alerts.map((a) => notifyNeeds(a.userId, a.needs).catch(() => 0)));
    schedule();
  };

  const schedule = () => {
    const last = lastRun();
    if (!last) recordRun(Date.now());
    const wait = Math.max(0, (last || Date.now()) + intervalMs() - Date.now());
    timer = setTimeout(() => tick().catch((err) => log(`needs decay failed: ${err.message}`)), wait);
    timer.unref?.();
  };

  schedule();
  return () => clearTimeout(timer);
}
