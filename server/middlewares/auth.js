import config from "../config/index.js";
import { userFromToken, issueToken } from "../services/auth.service.js";
import { User } from "../models/user.model.js";
import { HttpError } from "../utils/httpError.js";

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function resolveUser(req) {
  const user = userFromToken(req.cookies?.[config.auth.cookieName]);
  if (user && Date.now() - user.last_seen_at > TOUCH_INTERVAL_MS) User.touch(user.id);
  return user;
}

export function requireAuth(req, res, next) {
  const user = resolveUser(req);
  if (!user) return next(HttpError.unauthorized());
  req.user = user;
  next();
}

export function optionalAuth(req, res, next) {
  req.user = resolveUser(req);
  next();
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: "lax",
  path: "/",
});

export function setAuthCookie(res, userId) {
  res.cookie(config.auth.cookieName, issueToken(userId), {
    ...cookieOptions(),
    maxAge: config.auth.tokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(config.auth.cookieName, cookieOptions());
}
