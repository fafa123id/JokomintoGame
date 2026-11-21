import crypto from "node:crypto";
import config from "./config/index.js";
import { migrate } from "./database/migrator.js";
import { closeDb } from "./database/connection.js";

if (config.auth.jwtSecret.length < 32) {
  if (config.isProd) {
    console.error("JWT_SECRET must be set (min 32 characters) in production");
    process.exit(1);
  }
  console.warn("JWT_SECRET not set, using an ephemeral secret (sessions reset on restart)");
  config.auth.jwtSecret = crypto.randomBytes(48).toString("hex");
}

const { createApp } = await import("./app.js");
const { purgeInactiveGuests } = await import("./services/auth.service.js");

await migrate({ log: config.isTest ? () => {} : console.log });

const purgeGuests = () => {
  const removed = purgeInactiveGuests();
  if (removed && !config.isTest) console.log(`removed ${removed} inactive guest(s)`);
};
purgeGuests();
setInterval(purgeGuests, config.guest.cleanupIntervalMs).unref();

if (!config.isTest) {
  const { startNeedsDecay } = await import("./jobs/needsDecay.job.js");
  startNeedsDecay({ log: (message) => console.log(message) });
}

const { resumeMatches } = await import("./services/match.service.js");
const { closeAll: closeStreams } = await import("./realtime/hub.js");
resumeMatches();

const server = createApp().listen(config.port, () => {
  console.log(`JokomintoGame listening on http://localhost:${config.port} (${config.env})`);
});
const { attachFps } = await import("./fps/socket.js");
const closeFps = attachFps(server);

function shutdown() {
  closeStreams();
  closeFps();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
