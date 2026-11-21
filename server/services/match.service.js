import crypto from "node:crypto";
import { Chess } from "chess.js";
import { transaction } from "../database/connection.js";
import { Match } from "../models/match.model.js";
import { User } from "../models/user.model.js";
import { GameSession } from "../models/gameSession.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { HttpError } from "../utils/httpError.js";
import { send, isOnline, isAway, onPresence } from "../realtime/hub.js";
import { getCurrentPet, mutatePet } from "./pet.service.js";
import { baseFromDifficulty, coinReward } from "./scoring.service.js";
import { winnerOf } from "./tictactoe.service.js";
import { legalMoves } from "./chess.service.js";
import { friendshipBetween, broadcastPresence } from "./friends.service.js";
import { MULTIPLAYER, COIN } from "../config/game.js";

const TYPES = ["tictactoe", "chess"];
const invites = new Map();
const queues = new Map(TYPES.map((t) => [t, []]));
const timers = new Map();

const other = (side) => (side === "a" ? "b" : "a");
const sideOf = (match, userId) => (match.player_a === userId ? "a" : match.player_b === userId ? "b" : null);
const playerOf = (match, side) => (side === "a" ? match.player_a : match.player_b);
const turnMs = () => MULTIPLAYER.turnSec * 1000;

export const activeMatchFor = (userId) => Match.activeFor(userId);

// Tells the opponent in a running match that this player's look changed (skin swaps mid-game).
export function announcePlayerChange(userId) {
  const match = Match.activeFor(userId);
  if (!match) return;
  const user = User.find(userId);
  const opponentId = match.player_a === userId ? match.player_b : match.player_a;
  send(opponentId, "match:player", { matchId: match.id, player: publicPlayer(user) });
}

// ---------- views ----------

const publicPlayer = (user) => ({ id: user.id, name: user.name, uid: user.uid, skin: user.equipped_skin ?? "classic", isGuest: !!user.is_guest });

function gameView(match, side) {
  if (match.type === "tictactoe") return { board: match.state.board, mark: side === "a" ? "X" : "O", winLine: match.state.winLine ?? null };
  const chess = new Chess(match.state.fen);
  const myTurn = match.status === "active" && match.turn === side;
  return {
    fen: match.state.fen,
    color: side === "a" ? "w" : "b",
    legal: myTurn ? legalMoves(chess) : {},
    check: chess.inCheck(),
  };
}

export function matchView(match, userId) {
  const side = sideOf(match, userId);
  const me = User.find(userId);
  const foe = User.find(playerOf(match, other(side)));
  const result = match.status === "finished" ? (match.winner === "draw" ? "draw" : match.winner === side ? "win" : "lose") : null;
  const relation = foe && !me.is_guest && !foe.is_guest ? friendshipBetween(me.id, foe.id) : "unavailable";
  return {
    id: match.id,
    type: match.type,
    status: match.status,
    yourTurn: match.status === "active" && match.turn === side,
    deadline: match.turn_deadline,
    serverNow: Date.now(),
    turnSec: MULTIPLAYER.turnSec,
    me: publicPlayer(me),
    foe: foe ? publicPlayer(foe) : null,
    lastMove: match.state.lastMove ?? null,
    result,
    reason: match.reason,
    reward: match.state.rewards?.[side] ?? null,
    canAddFriend: relation === null,
    ...gameView(match, side),
  };
}

function broadcast(match, event) {
  for (const userId of [match.player_a, match.player_b]) send(userId, event, matchView(match, userId));
}

// ---------- lifecycle ----------

function initialState(type) {
  return type === "tictactoe" ? { board: Array(9).fill(null), moves: 0 } : { fen: new Chess().fen(), moves: 0 };
}

function assertFree(userId, label) {
  if (Match.activeFor(userId)) throw HttpError.conflict(`${label} already in a match`);
}

function createMatch(type, firstId, secondId) {
  // Sides are drawn at random: 'a' plays X / white and moves first.
  const [a, b] = crypto.randomInt(2) ? [firstId, secondId] : [secondId, firstId];
  const match = transaction(() => {
    assertFree(firstId, "You're");
    assertFree(secondId, "That player is");
    return Match.create({ id: crypto.randomUUID(), type, playerA: a, playerB: b, state: initialState(type), deadline: Date.now() + turnMs() });
  });
  leaveQueues(firstId);
  leaveQueues(secondId);
  for (const userId of [firstId, secondId]) PlayerStat.recordGamePlayed(userId);
  schedule(match);
  broadcast(match, "match:start");
  broadcastPresence(firstId);
  broadcastPresence(secondId);
  return match;
}

function schedule(match) {
  clearTimeout(timers.get(match.id));
  const delay = Math.max(0, match.turn_deadline - Date.now()) + 50;
  const timer = setTimeout(() => expireTurn(match.id), delay);
  timer.unref?.();
  timers.set(match.id, timer);
}

// The player who let the turn clock run out loses.
export function expireTurn(matchId, now = Date.now()) {
  const match = Match.find(matchId);
  if (!match || match.status !== "active") return null;
  if (now < match.turn_deadline) return schedule(match);
  return conclude(match, other(match.turn), "timeout");
}

function rewardsFor(match, winner) {
  const rewards = {};
  const base = baseFromDifficulty(MULTIPLAYER.difficulty[match.type]);
  for (const side of ["a", "b"]) {
    const userId = playerOf(match, side);
    const outcome = winner === "draw" ? "draw" : winner === side ? "win" : "lose";
    const ratio = outcome === "win" ? 1 : outcome === "draw" ? MULTIPLAYER.drawRatio : 0;
    const recentWins =
      GameSession.countWinsSince(userId, Date.now() - COIN.fatigueWindowMs) + Match.countWinsSince(userId, Date.now() - COIN.fatigueWindowMs);
    const context = { difficulty: MULTIPLAYER.difficulty[match.type], recentWins, balance: getCurrentPet(userId).coin };
    const coin = ratio ? Math.round(coinReward(context, 1).coin * ratio) : 0;
    rewards[side] = { outcome, coin, score: Math.round(base * ratio), mood: MULTIPLAYER.mood[outcome] };
  }
  return rewards;
}

function conclude(match, winner, reason) {
  clearTimeout(timers.get(match.id));
  timers.delete(match.id);
  const done = transaction(() => {
    const rewards = rewardsFor(match, winner);
    const state = { ...match.state, rewards };
    if (!Match.finish(match.id, { state, winner, reason })) return null;
    for (const side of ["a", "b"]) {
      const userId = playerOf(match, side);
      const r = rewards[side];
      mutatePet(userId, (p) => {
        p.coin += r.coin;
        p.mood += r.mood;
      });
      if (r.outcome === "win") PlayerStat.recordWin(userId, r.score);
      else if (r.score > 0) PlayerStat.addScore(userId, r.score);
    }
    return Match.find(match.id);
  });
  if (!done) return null;
  broadcast(done, "match:end");
  broadcastPresence(done.player_a);
  broadcastPresence(done.player_b);
  return done;
}

// ---------- moves ----------

function activeMatchOf(userId, matchId) {
  const match = Match.find(matchId);
  const side = match && sideOf(match, userId);
  if (!side) throw HttpError.notFound("Match not found");
  if (match.status !== "active") throw HttpError.badRequest("This match is over");
  return { match, side };
}

function applyTicTacToe(match, side, { cell }) {
  const board = [...match.state.board];
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) throw HttpError.badRequest("Pick a cell");
  if (board[cell]) throw HttpError.badRequest("That cell is already taken");
  board[cell] = side === "a" ? "X" : "O";
  const win = winnerOf(board);
  const state = { ...match.state, board, moves: match.state.moves + 1, lastMove: { cell }, winLine: win?.line ?? null };
  if (win) return { state, winner: side };
  if (board.every(Boolean)) return { state, winner: "draw" };
  return { state };
}

function applyChess(match, side, { from, to, promotion = "q" }) {
  const chess = new Chess(match.state.fen);
  if (chess.turn() !== (side === "a" ? "w" : "b")) throw HttpError.badRequest("Not your turn");
  let move;
  try {
    move = chess.move({ from, to, promotion });
  } catch {
    throw HttpError.badRequest("Illegal move");
  }
  const lastMove = { from: move.from, to: move.to, san: move.san, captured: move.captured ?? null, promotion: move.promotion ?? null, flags: move.flags };
  const state = { ...match.state, fen: chess.fen(), moves: match.state.moves + 1, lastMove };
  if (chess.isCheckmate()) return { state, winner: side };
  if (chess.isDraw()) return { state, winner: "draw" };
  return { state };
}

export function playMatchMove(user, matchId, move) {
  const { match, side } = activeMatchOf(user.id, matchId);
  if (match.turn !== side) throw HttpError.badRequest("Wait for your turn");
  if (Date.now() > match.turn_deadline) {
    expireTurn(match.id);
    throw HttpError.badRequest("Your turn timed out");
  }
  const { state, winner } = match.type === "tictactoe" ? applyTicTacToe(match, side, move) : applyChess(match, side, move);
  if (winner) {
    conclude({ ...match, state }, winner, winner === "draw" ? "draw" : match.type === "chess" ? "checkmate" : "line");
    return matchView(Match.find(match.id), user.id);
  }
  Match.update(match.id, { state, turn: other(side), deadline: Date.now() + turnMs() });
  const next = Match.find(match.id);
  schedule(next);
  broadcast(next, "match:update");
  return matchView(next, user.id);
}

export function resignMatch(user, matchId) {
  const { match, side } = activeMatchOf(user.id, matchId);
  const done = conclude(match, other(side), "resign");
  return matchView(done ?? Match.find(match.id), user.id);
}

export function getMatch(user, matchId) {
  const match = Match.find(matchId);
  if (!match || !sideOf(match, user.id)) throw HttpError.notFound("Match not found");
  return matchView(match, user.id);
}

export function currentMatch(user) {
  const match = Match.activeFor(user.id);
  return { match: match ? matchView(match, user.id) : null };
}

// ---------- invites ----------

function expireInvite(id) {
  const invite = invites.get(id);
  if (!invite) return;
  invites.delete(id);
  send(invite.from, "invite:closed", { id, reason: "expired" });
  send(invite.to, "invite:closed", { id, reason: "expired" });
}

export function invitePlayer(user, { type, friendId, uid }) {
  const target = uid ? User.findByUid(uid) : User.find(friendId);
  if (!target) throw HttpError.notFound("No player with that ID");
  if (target.id === user.id) throw HttpError.badRequest("You can't invite yourself");
  if (friendId && (user.is_guest || friendshipBetween(user.id, target.id) !== "accepted")) {
    throw HttpError.forbidden("You can only invite friends from your list");
  }
  if (!isOnline(target.id)) throw HttpError.badRequest(`${target.name} is offline`);
  if (isAway(target.id)) throw HttpError.badRequest(`${target.name} is away right now`);
  assertFree(user.id, "You're");
  assertFree(target.id, `${target.name} is`);
  for (const invite of invites.values()) {
    if (invite.from === user.id) throw HttpError.conflict("You already have an invite waiting");
    if (invite.to === target.id) throw HttpError.conflict(`${target.name} is answering another invite`);
  }

  const id = crypto.randomUUID();
  const timer = setTimeout(() => expireInvite(id), (MULTIPLAYER.inviteSec + MULTIPLAYER.inviteGraceSec) * 1000);
  timer.unref?.();
  invites.set(id, { id, type, from: user.id, to: target.id, timer });
  send(target.id, "invite", {
    id,
    type,
    expiresInSec: MULTIPLAYER.inviteSec,
    from: { id: user.id, name: user.name, uid: user.uid, skin: user.equipped_skin ?? "classic" },
  });
  return { inviteId: id, expiresInSec: MULTIPLAYER.inviteSec, to: { name: target.name } };
}

export function respondInvite(user, { inviteId, accept }) {
  const invite = invites.get(inviteId);
  if (!invite || invite.to !== user.id) throw HttpError.notFound("This invite has expired");
  clearTimeout(invite.timer);
  invites.delete(inviteId);
  if (!accept) {
    send(invite.from, "invite:closed", { id: inviteId, reason: "declined", by: user.name });
    return { ok: true };
  }
  if (!isOnline(invite.from)) throw HttpError.badRequest("The other player left");
  const match = createMatch(invite.type, invite.from, user.id);
  return { match: matchView(match, user.id) };
}

export function cancelInvite(user, { inviteId }) {
  const invite = invites.get(inviteId);
  if (!invite || invite.from !== user.id) return { ok: true };
  clearTimeout(invite.timer);
  invites.delete(inviteId);
  send(invite.to, "invite:closed", { id: inviteId, reason: "cancelled" });
  return { ok: true };
}

// ---------- matchmaking ----------

function leaveQueues(userId) {
  for (const queue of queues.values()) {
    const i = queue.indexOf(userId);
    if (i >= 0) queue.splice(i, 1);
  }
}

export function joinQueue(user, { type }) {
  assertFree(user.id, "You're");
  leaveQueues(user.id);
  const queue = queues.get(type);
  while (queue.length) {
    const opponent = queue.shift();
    if (opponent === user.id || !isOnline(opponent) || Match.activeFor(opponent)) continue;
    const match = createMatch(type, opponent, user.id);
    return { status: "matched", match: matchView(match, user.id) };
  }
  queue.push(user.id);
  return { status: "waiting" };
}

export function leaveQueue(user) {
  leaveQueues(user.id);
  return { ok: true };
}

// Players who disconnect leave the queue and drop pending invites; running matches keep their turn clock.
onPresence((userId, online) => {
  if (online) return;
  leaveQueues(userId);
  for (const invite of [...invites.values()]) {
    if (invite.from === userId || invite.to === userId) {
      clearTimeout(invite.timer);
      invites.delete(invite.id);
      send(invite.from === userId ? invite.to : invite.from, "invite:closed", { id: invite.id, reason: "left" });
    }
  }
});

// Restores turn clocks after a restart; matches that ran out meanwhile are settled now.
export function resumeMatches() {
  for (const match of Match.allActive()) {
    if (Date.now() >= match.turn_deadline) expireTurn(match.id);
    else schedule(match);
  }
}

export { TYPES as MATCH_TYPES };
