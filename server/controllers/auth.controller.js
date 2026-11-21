import config from "../config/index.js";
import * as authService from "../services/auth.service.js";
import { User } from "../models/user.model.js";
import { HttpError } from "../utils/httpError.js";
import { setAuthCookie, clearAuthCookie } from "../middlewares/auth.js";

function sendUser(req, res, status, { user, ...extra }) {
  setAuthCookie(req, res, user.id);
  res.status(status).json({ user: User.toPublic(user), ...extra });
}

export function getConfig(req, res) {
  res.json({ googleClientId: config.auth.googleClientId || null });
}

export function me(req, res) {
  res.json({ user: User.toPublic(req.user) });
}

export function guest(req, res) {
  if (req.user) throw HttpError.badRequest("You already have a session");
  sendUser(req, res, 201, { user: authService.createGuest(req.validated.name) });
}

export async function register(req, res) {
  sendUser(req, res, 201, await authService.register(req.validated, req.user));
}

export async function login(req, res) {
  sendUser(req, res, 200, await authService.login(req.validated, req.user));
}

export async function google(req, res) {
  sendUser(req, res, 200, await authService.loginWithGoogle(req.validated.credential, req.user));
}

export function logout(req, res) {
  authService.logout(req.user);
  clearAuthCookie(res);
  res.json({ ok: true });
}
