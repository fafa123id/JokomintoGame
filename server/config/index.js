import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env.NODE_ENV || "development";

export const paths = {
  publicRoot: path.resolve(serverDir, ".."),
  storage: path.join(serverDir, "storage"),
  gameImages: path.join(serverDir, "storage", "images"),
  imageCache: process.env.IMAGE_CACHE_DIR || path.join(serverDir, "storage", "cache", "images"),
  migrations: path.join(serverDir, "database", "migrations"),
};

// A hop count ("2") or Express subnet keywords ("loopback, linklocal, uniquelocal").
function parseTrustProxy(value) {
  if (!value) return false;
  return /^\d+$/.test(value.trim()) ? Number(value) : value;
}

const config = {
  env,
  isProd: env === "production",
  isTest: env === "test",
  port: Number(process.env.PORT) || 3000,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  dbFile: process.env.DB_FILE || path.join(paths.storage, "database", "game.db"),

  auth: {
    jwtSecret: process.env.JWT_SECRET || "",
    cookieName: "jm_token",
    tokenTtlDays: 7,
    bcryptRounds: 12,
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  },

  guest: {
    ttlDays: Number(process.env.GUEST_TTL_DAYS) || 30,
    cleanupIntervalMs: 6 * 60 * 60 * 1000,
  },

  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  },

  pixabay: {
    apiKey: process.env.PIXABAY_API_KEY || "",
    searchCacheMs: 24 * 60 * 60 * 1000,
    maxImageBytes: 3 * 1024 * 1024,
    maxCachedImages: 500,
  },
};

export default config;
