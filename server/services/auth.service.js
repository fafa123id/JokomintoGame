import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import config from "../config/index.js";
import { transaction } from "../database/connection.js";
import { User } from "../models/user.model.js";
import { Pet } from "../models/pet.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { HttpError } from "../utils/httpError.js";

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

export function issueToken(userId) {
  return jwt.sign({ sub: userId }, auth.jwtSecret, { expiresIn: `${auth.tokenTtlDays}d`, algorithm: "HS256" });
}

export function userFromToken(token) {
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, auth.jwtSecret, { algorithms: ["HS256"] });
    return User.find(sub) ?? null;
  } catch {
    return null;
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
}

export function purgeInactiveGuests() {
  const cutoff = Date.now() - config.guest.ttlDays * 24 * 60 * 60 * 1000;
  return User.deleteGuestsInactiveSince(cutoff);
}
