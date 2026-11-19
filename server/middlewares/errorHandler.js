import config from "../config/index.js";

export function notFound(req, res) {
  res.status(404).json({ error: "Not found" });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Payload too large" });

  if (err.expose && err.status) {
    return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
  }

  if (!config.isTest) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: "Internal server error" });
}
