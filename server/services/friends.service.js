import { transaction } from "../database/connection.js";
import { Friendship } from "../models/friendship.model.js";
import { User } from "../models/user.model.js";
import { HttpError } from "../utils/httpError.js";
import { send, isOnline, isAway, onPresence } from "../realtime/hub.js";
import { activeMatchFor } from "./match.service.js";

const MAX_FRIENDS = 100;

function requireRegistered(user) {
  if (user.is_guest) throw HttpError.forbidden("Register an account to use the friend list");
}

export function presenceOf(userId) {
  if (!isOnline(userId)) return "offline";
  if (activeMatchFor(userId)) return "playing";
  return isAway(userId) ? "away" : "online";
}

const person = (row) => ({
  id: row.id,
  name: row.name,
  uid: row.uid,
  skin: row.equipped_skin ?? "classic",
  status: presenceOf(row.id),
  lastSeenAt: row.last_seen_at,
});

export function listFriends(user) {
  requireRegistered(user);
  const { friends, incoming, outgoing } = Friendship.list(user.id);
  return { friends: friends.map(person), incoming: incoming.map(person), outgoing: outgoing.map(person) };
}

export function friendshipBetween(userId, otherId) {
  return Friendship.status(userId, otherId) ?? (Friendship.status(otherId, userId) === "pending" ? "incoming" : null);
}

const notifyBoth = (a, b) => {
  send(a, "friends:changed");
  send(b, "friends:changed");
};

export function requestFriend(user, { uid, userId }) {
  requireRegistered(user);
  const target = uid ? User.findByUid(uid) : User.find(userId);
  if (!target) throw HttpError.notFound("No player with that ID");
  if (target.id === user.id) throw HttpError.badRequest("That's your own ID");
  if (target.is_guest) throw HttpError.badRequest("Guests can't be added as friends yet");

  const result = transaction(() => {
    if (Friendship.areFriends(user.id, target.id)) throw HttpError.conflict("You're already friends");
    if (Friendship.status(user.id, target.id) === "pending") throw HttpError.conflict("Request already sent");
    if (Friendship.countFriends(user.id) >= MAX_FRIENDS) throw HttpError.badRequest(`Friend list is full (${MAX_FRIENDS})`);
    // They already asked us: treat this as accepting.
    if (Friendship.status(target.id, user.id) === "pending") {
      Friendship.accept(target.id, user.id);
      return "accepted";
    }
    Friendship.request(user.id, target.id);
    return "pending";
  });

  if (result === "pending") send(target.id, "friends:request", { from: { id: user.id, name: user.name, uid: user.uid } });
  notifyBoth(user.id, target.id);
  return { status: result, friend: { id: target.id, name: target.name } };
}

export function respondFriend(user, { userId, accept }) {
  requireRegistered(user);
  transaction(() => {
    if (Friendship.status(userId, user.id) !== "pending") throw HttpError.notFound("No pending request from that player");
    if (accept) Friendship.accept(userId, user.id);
    else Friendship.remove(userId, user.id);
  });
  if (accept) send(userId, "friends:accepted", { by: { id: user.id, name: user.name } });
  notifyBoth(user.id, userId);
  return { ok: true };
}

export function removeFriend(user, { userId }) {
  requireRegistered(user);
  Friendship.remove(user.id, userId);
  notifyBoth(user.id, userId);
  return { ok: true };
}

// Friends see each other come online / go offline / start playing.
export function broadcastPresence(userId) {
  const status = presenceOf(userId);
  for (const friendId of Friendship.friendIds(userId)) send(friendId, "friends:presence", { id: userId, status });
}

onPresence((userId) => broadcastPresence(userId));
