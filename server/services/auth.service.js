import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import config from "../config/index.js";
import { transaction } from "../database/connection.js";
import { User } from "../models/user.model.js";
import { Pet } from "../models/pet.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { HttpError } from "../utils/httpError.js";
import { kickUser } from "../realtime/hub.js";

const { auth } = config;
const googleClient = auth.googleClientId ? new OAuth2Client(auth.googleClientId) : null;

// Compared against when the email doesn't exist, so response time doesn't reveal registered emails.
const DUMMY_HASH = bcrypt.hashSync("timing-safe-dummy", auth.bcryptRounds);

function createPlayer(fields) {
  return transaction(() => {
    const user = User.create(fields);
    Pet.createFor(user.id);
    PlayerStat.createFor(user.id);
    return user;
  });
}

function discardGuest(currentUser, nextUserId) {
  if (currentUser?.is_guest && currentUser.id !== nextUserId) {
    User.delete(currentUser.id);
    return true;
  }
  return false;
}

export function issueToken(userId, sessionId) {
  return jwt.sign({ sub: userId, sid: sessionId }, auth.jwtSecret, { expiresIn: `${auth.tokenTtlDays}d`, algorithm: "HS256" });
}

// One active session per account: logging in again (password, Google, register) replaces it,
// and other devices are told right away. The device that logged in keeps its live connection.
export function startSession(userId, clientId) {
  const sessionId = crypto.randomBytes(16).toString("hex");
  User.setSession(userId, sessionId);
  kickUser(userId, clientId, "session:replaced", { at: Date.now() });
  return sessionId;
}

export function endSession(user) {
  if (user && !user.is_guest) User.setSession(user.id, crypto.randomBytes(16).toString("hex"));
}

// Returns { user } for a valid token, { replaced: true } when the account has a newer session.
export function userFromToken(token) {
  if (!token) return {};
  try {
    const { sub, sid } = jwt.verify(token, auth.jwtSecret, { algorithms: ["HS256"] });
    const user = User.find(sub);
    if (!user) return {};
    // Tokens issued before single sessions existed stay valid until the account logs in again.
    if (user.session_id && user.session_id !== sid) return { replaced: true };
    return { user };
  } catch {
    return {};
  }
}

export function createGuest(name) {
  return createPlayer({ name, isGuest: true });
}

export async function register({ name, email, password }, currentUser) {
  if (currentUser && !currentUser.is_guest) throw HttpError.badRequest("Already logged in, please logout first");
  if (User.findByEmail(email)) throw HttpError.conflict("Email already registered");

  const passwordHash = await bcrypt.hash(password, auth.bcryptRounds);

  if (currentUser?.is_guest) {
    const user = User.update(currentUser.id, { name: name || currentUser.name, email, passwordHash, isGuest: false });
    return { user, progressKept: true };
  }

  const user = createPlayer({ name: name || email.split("@")[0].slice(0, 20), email, passwordHash, isGuest: false });
  return { user, progressKept: false };
}

export async function login({ email, password }, currentUser) {
  const user = User.findByEmail(email);
  const valid = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !user.password_hash || !valid) throw HttpError.unauthorized("Wrong email or password");
  return { user, guestDiscarded: discardGuest(currentUser, user.id) };
}

export async function loginWithGoogle(credential, currentUser) {
  if (!googleClient) throw HttpError.unavailable("Google login is not configured");

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: auth.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw HttpError.unauthorized("Invalid Google token");
  }
  if (!payload?.email || !payload.email_verified) throw HttpError.unauthorized("Google email not verified");

  const email = payload.email.toLowerCase();
  let user = User.findByGoogleId(payload.sub) ?? User.findByEmail(email);

  if (user) {
    if (!user.google_id) user = User.update(user.id, { googleId: payload.sub });
    return { user, guestDiscarded: discardGuest(currentUser, user.id) };
  }

  if (currentUser?.is_guest) {
    user = User.update(currentUser.id, { email, googleId: payload.sub, isGuest: false });
    return { user, progressKept: true };
  }

  const name = (payload.name || email.split("@")[0]).slice(0, 20);
  return { user: createPlayer({ name, email, googleId: payload.sub, isGuest: false }) };
}

export function logout(currentUser) {
  if (currentUser?.is_guest) User.delete(currentUser.id);
  else endSession(currentUser);
}

export function purgeInactiveGuests() {
  const cutoff = Date.now() - config.guest.ttlDays * 24 * 60 * 60 * 1000;
  return User.deleteGuestsInactiveSince(cutoff);
}
