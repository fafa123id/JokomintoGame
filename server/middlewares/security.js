import helmet from "helmet";
import rateLimit from "express-rate-limit";
import config from "../config/index.js";

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://accounts.google.com/gsi/client"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com/gsi/style"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://accounts.google.com/gsi/"],
      frameSrc: ["https://accounts.google.com/gsi/"],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  crossOriginEmbedderPolicy: false,
  hsts: config.isProd,
});

// State-changing requests must be JSON from our own origin.
export function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.is("application/json")) return res.status(415).json({ error: "JSON only" });

  const origin = req.get("origin");
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      // invalid origin header
    }
    if (host !== req.get("host")) return res.status(403).json({ error: "Bad origin" });
  }
  next();
}

const limiter = (windowMs, limit, message = "Too many requests, try again later") =>
  rateLimit({
    windowMs,
    limit: config.isTest ? 10_000 : limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: message },
  });

export const apiLimiter = limiter(60_000, 120);
export const authLimiter = limiter(15 * 60_000, 20, "Too many attempts, try again later");
export const guestLimiter = limiter(60 * 60_000, 10, "Too many guest accounts, try again later");
