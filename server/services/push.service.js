import * as webpush from "web-push";
import config from "../config/index.js";
import { getDb } from "../database/connection.js";
import { HttpError } from "../utils/httpError.js";

const MAX_SUBSCRIPTIONS_PER_USER = 5;
const TTL_SECONDS = 6 * 60 * 60;

// Only real browser push services are allowed, so a client can't make the server call arbitrary URLs (SSRF).
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

const NEED_MESSAGES = {
  hungry: "Joko lapar nih... kasih makan yuk 🍽️",
  dirty: "Joko kotor, mandiin dong 🛁",
  sad: "Joko kesepian, ajak main yuk 🎮",
};

const db = () => getDb();
let configured = false;

export const pushEnabled = () => !!(config.push.publicKey && config.push.privateKey);

function setup() {
  if (configured || !pushEnabled()) return pushEnabled();
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
  configured = true;
  return true;
}

export function publicKey() {
  return pushEnabled() ? config.push.publicKey : null;
}

export function isAllowedEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function saveSubscription(userId, { endpoint, keys }) {
  if (!isAllowedEndpoint(endpoint)) throw HttpError.badRequest("Unsupported push service");
  if (!pushEnabled()) throw HttpError.unavailable("Notifications are not configured");
  db()
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
    )
    .run(userId, endpoint, keys.p256dh, keys.auth, Date.now());
  db()
    .prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
         SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`
    )
    .run(userId, userId, MAX_SUBSCRIPTIONS_PER_USER);
}

export function removeSubscription(userId, endpoint) {
  db().prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(userId, endpoint);
}

export async function sendToUser(userId, payload) {
  if (!setup()) return 0;
  const subscriptions = db().prepare("SELECT * FROM push_subscriptions WHERE user_id = ?").all(userId);
  let sent = 0;
  await Promise.all(
    subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: TTL_SECONDS }
        );
        sent++;
      } catch (err) {
        // Gone or invalid subscriptions are cleaned up; other errors are transient.
        if (err.statusCode === 404 || err.statusCode === 410) {
          db().prepare("DELETE FROM push_subscriptions WHERE id = ?").run(s.id);
        }
      }
    })
  );
  return sent;
}

export function notifyNeeds(userId, needs) {
  const body = needs.map((need) => NEED_MESSAGES[need]).filter(Boolean).join("\n");
  if (!body) return Promise.resolve(0);
  return sendToUser(userId, { title: "Joko butuh kamu! 🐰", body, tag: "joko-needs", url: "/" });
}
