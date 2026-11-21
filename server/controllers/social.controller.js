import * as friends from "../services/friends.service.js";
import * as matches from "../services/match.service.js";
import { connect } from "../realtime/hub.js";
import { HttpError } from "../utils/httpError.js";

export function events(req, res) {
  connect(req, res, req.user.id);
}

export const listFriends = (req, res) => res.json(friends.listFriends(req.user));

export function requestFriend(req, res) {
  const { uid, userId } = req.validated;
  if (!uid && !userId) throw HttpError.unprocessable("Enter a player ID");
  res.json(friends.requestFriend(req.user, { uid, userId }));
}

export const respondFriend = (req, res) => res.json(friends.respondFriend(req.user, req.validated));
export const removeFriend = (req, res) => res.json(friends.removeFriend(req.user, req.validated));

export function invite(req, res) {
  const { type, friendId, uid } = req.validated;
  if (!friendId && !uid) throw HttpError.unprocessable("Pick a friend or enter a player ID");
  res.json(matches.invitePlayer(req.user, { type, friendId, uid }));
}

export const respondInvite = (req, res) => res.json(matches.respondInvite(req.user, req.validated));
export const cancelInvite = (req, res) => res.json(matches.cancelInvite(req.user, req.validated));
export const joinQueue = (req, res) => res.json(matches.joinQueue(req.user, req.validated));
export const leaveQueue = (req, res) => res.json(matches.leaveQueue(req.user));
export const current = (req, res) => res.json(matches.currentMatch(req.user));
export const show = (req, res) => res.json(matches.getMatch(req.user, req.params.id));
export const move = (req, res) => res.json(matches.playMatchMove(req.user, req.params.id, req.validated));
export const resign = (req, res) => res.json(matches.resignMatch(req.user, req.params.id));
