import config from "../config/index.js";
import { userFromToken, issueToken, startSession } from "../services/auth.service.js";
import { User } from "../models/user.model.js";
import { HttpError } from "../utils/httpError.js";

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const SESSION_REPLACED = "session_replaced";

function resolveUser(req, res) {
  const { user, replaced } = userFromToken(req.cookies?.[config.auth.cookieName]);
  // A token from a replaced session is useless from now on, so drop the cookie.
  if (replaced) clearAuthCookie(res);
  if (user && Date.now() - user.last_seen_at > TOUCH_INTERVAL_MS) User.touch(user.id);
  return { user, replaced };
}

export function requireAuth(req, res, next) {
  const { user, replaced } = resolveUser(req, res);
  if (replaced) return next(new HttpError(401, "Your account was signed in on another device", { code: SESSION_REPLACED }));
  if (!user) return next(HttpError.unauthorized());
  req.user = user;
  next();
}

export function optionalAuth(req, res, next) {
  req.user = resolveUser(req, res).user ?? null;
  next();
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: "lax",
  path: "/",
});

const CLIENT_ID = /^[a-z0-9-]{8,40}$/i;

// Starts a fresh session for the account (signing out its other devices) and sets the cookie.
export function setAuthCookie(req, res, userId) {
  const clientId = req.get("X-Client-Id");
  const sessionId = startSession(userId, CLIENT_ID.test(clientId ?? "") ? clientId : null);
  res.cookie(config.auth.cookieName, issueToken(userId, sessionId), {
    ...cookieOptions(),
    maxAge: config.auth.tokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(config.auth.cookieName, cookieOptions());
}
