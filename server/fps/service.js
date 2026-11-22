import { Room } from "./room.js";
import { MAP_IDS } from "../../src/fps/shared/maps.js";
import { RULES, MODES } from "../../src/fps/shared/rules.js";
import { transaction } from "../database/connection.js";
import { GameSession } from "../models/gameSession.model.js";
import { Match } from "../models/match.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { User } from "../models/user.model.js";
import { getCurrentPet, mutatePet } from "../services/pet.service.js";
import { baseFromDifficulty, coinReward } from "../services/scoring.service.js";
import { COIN } from "../config/game.js";
import { Social, packTeams, swapAfterFor } from "./party.js";
import { send as notifyApp, isAway } from "../realtime/hub.js";
import { sendToUser as pushToUser } from "../services/push.service.js";
import { activeMatchFor } from "../services/match.service.js";

// Matchmaking for Jokoman 5v5: players queue for a mode (Bomb or Team Deathmatch), alone or as a
// party that always lands on one team. A match starts when 10 are waiting or after a short wait,
// and bots fill every empty slot. Custom lobbies start their own rooms. One live connection per account.
const FILL_WAIT_MS = Number(process.env.FPS_FILL_WAIT_MS) || 10_000;
const MAX_ROOMS = Number(process.env.FPS_MAX_ROOMS) || 6;
const MATCH_SIZE = RULES.teamSize * 2;
const REWARD = { difficulty: 0.85, mood: { win: 30, lose: 10 } };

const sockets = new Map();
// Queue entries are groups: { members: [{ userId, name, skin }], party, mode, joinedAt }.
const queue = [];
const rooms = new Map();
const roomOfUser = new Map();
const recentWins = new Map();

const send = (ws, message) => ws?.readyState === 1 && ws.send(JSON.stringify(message));

export const isInFps = (userId) => roomOfUser.has(userId);

const sendUser = (userId, message) => send(sockets.get(userId), message);

function profile(userId) {
  const u = User.find(userId);
  return u ? { id: u.id, name: u.name, uid: u.uid, skin: u.equipped_skin ?? "classic" } : null;
}

export const social = new Social({
  send: sendUser,
  profile,
  online: (userId) => sockets.has(userId),
  busy: (userId) => (roomOfUser.has(userId) ? "is in a match" : activeMatchFor(userId) ? "is playing another game" : null),
  // Invites reach the whole app (any screen); a hidden tab also gets a browser notification.
  notify: (userId, event, data) => {
    const reached = notifyApp(userId, event, data);
    if (reached && event === "fps:invite" && isAway(userId)) {
      const what = data.kind === "lobby" ? "custom lobby" : "party";
      pushToUser(userId, { title: "Jokoman 5v5 🔫", body: `${data.from.name} invites you to their ${what}`, tag: "fps-invite", url: "/" }).catch(() => {});
    }
    return reached;
  },
  // A party that changes while queued drops out of the queue.
  onPartyChange: (party) => {
    const entry = queue.find((e) => e.party === party.id);
    if (!entry) return;
    queue.splice(queue.indexOf(entry), 1);
    for (const m of entry.members) sendUser(m.userId, { t: "cancelled", reason: "The party changed" });
  },
});

const playersIn = (entries) => entries.reduce((n, e) => n + e.members.length, 0);

function queueStatus() {
  for (const mode of MODES) {
    const waiting = queue.filter((e) => e.mode === mode);
    const oldest = waiting[0]?.joinedAt ?? Date.now();
    const count = playersIn(waiting);
    for (const entry of waiting) {
      for (const m of entry.members) {
        sendUser(m.userId, {
          t: "queue",
          mode,
          waiting: count,
          party: entry.members.length,
          fillInMs: Math.max(0, oldest + FILL_WAIT_MS - Date.now()),
          full: rooms.size >= MAX_ROOMS,
        });
      }
    }
  }
}

function rewardsFor(room, { results }) {
  const rewards = {};
  const base = baseFromDifficulty(REWARD.difficulty);
  const since = Date.now() - COIN.fatigueWindowMs;
  for (const r of results) {
    if (!User.find(r.userId)) continue;
    try {
      const wins = (recentWins.get(r.userId) ?? []).filter((t) => t > since);
      const context = {
        difficulty: REWARD.difficulty,
        recentWins: GameSession.countWinsSince(r.userId, since) + Match.countWinsSince(r.userId, since) + wins.length,
        balance: getCurrentPet(r.userId).coin,
      };
      const performance = Math.max(0.5, Math.min(1, 0.6 + (r.kills - r.deaths) * 0.04));
      const coin = r.won ? coinReward(context, performance).coin : 0;
      const score = r.won ? Math.round(base * performance) : Math.round(base * 0.2);
      const mood = REWARD.mood[r.won ? "win" : "lose"];
      transaction(() => {
        mutatePet(r.userId, (p) => {
          p.coin += coin;
          p.mood += mood;
        });
        if (r.won) PlayerStat.recordWin(r.userId, score);
        else PlayerStat.addScore(r.userId, score);
      });
      if (r.won) recentWins.set(r.userId, [...wins, Date.now()]);
      rewards[r.userId] = { coin, mood, score, won: r.won };
    } catch (err) {
      console.error("fps reward failed", err);
    }
  }
  return rewards;
}

function closeRoom(room) {
  for (const id of [...[...room.players.values()].map((p) => p.userId), ...room.spectators.keys()]) {
    if (id && roomOfUser.get(id) === room.id) roomOfUser.delete(id);
  }
  rooms.delete(room.id);
  room.dispose();
}

const randomMap = () => MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)];

function openRoom({ humans, spectators = [], mode, mapId = randomMap(), onEnd, ...options }) {
  const withSockets = (list) => list.map((h) => ({ ...h, ...profileBits(h.userId), socket: sockets.get(h.userId) ?? null }));
  const room = new Room({ mapId, humans: withSockets(humans), spectators: withSockets(spectators), heroPick: true, mode, economy: mode === "bomb", onEnd, ...options });
  rooms.set(room.id, room);
  for (const h of [...humans, ...spectators]) {
    roomOfUser.set(h.userId, room.id);
    const p = room.attach(h.userId, sockets.get(h.userId) ?? null);
    send(sockets.get(h.userId), room.welcome(p));
  }
  return room;
}

function profileBits(userId) {
  const p = profile(userId);
  return { name: p?.name ?? "Player", skin: p?.skin ?? "classic" };
}

function startMatch(teams, mode) {
  const humans = [...teams.red.map((m) => ({ userId: m.userId, team: "red" })), ...teams.blue.map((m) => ({ userId: m.userId, team: "blue" }))];
  openRoom({
    humans,
    mode,
    onEnd: (r, result) => {
      const rewards = rewardsFor(r, result);
      setTimeout(() => closeRoom(r), 1000).unref?.();
      return rewards;
    },
  });
}

// Custom lobby: the host's teams and rules; no rewards (it isn't matchmaking), then back to the lobby.
function startCustom(userId) {
  const plan = social.startLobby(userId);
  if (plan.error) return sendUser(userId, { t: "notice", text: plan.error, tone: "error" });
  const { lobby, players, spectators, settings } = plan;
  const room = openRoom({
    humans: players,
    spectators: spectators.map((id) => ({ userId: id })),
    mode: settings.mode,
    mapId: settings.map === "random" ? randomMap() : settings.map,
    fillBots: settings.bots,
    custom: true,
    rules: { roundsToWin: settings.roundsToWin, swapAfter: swapAfterFor(settings.roundsToWin), killTarget: settings.killTarget },
    onEnd: (r) => {
      setTimeout(() => {
        closeRoom(r);
        social.lobbyMatchOver(lobby.code);
      }, 1000).unref?.();
      return {};
    },
  });
  lobby.roomId = room.id;
}

function matchmake() {
  for (const mode of MODES) {
    if (rooms.size >= MAX_ROOMS) break;
    const waiting = queue.filter((e) => e.mode === mode);
    if (!waiting.length) continue;
    const waitedLongEnough = Date.now() - waiting[0].joinedAt >= FILL_WAIT_MS;
    if (playersIn(waiting) < MATCH_SIZE && !waitedLongEnough) continue;
    const { teams, used } = packTeams(waiting);
    if (!used.length) continue;
    for (const e of used) queue.splice(queue.indexOf(e), 1);
    startMatch(teams, mode);
  }
  queueStatus();
}

// A match nobody is watching (everyone left) is closed after a minute instead of running on with bots.
const ABANDON_MS = Number(process.env.FPS_ABANDON_MS) || 60_000;
function sweepAbandoned() {
  for (const room of rooms.values()) if (!room.over && Date.now() - room.lastHumanAt > ABANDON_MS) closeRoom(room);
}

const ticker = setInterval(() => {
  sweepAbandoned();
  matchmake();
}, 500);
ticker.unref?.();

// Leaving the queue takes your whole group (party) out with you.
function leaveQueue(userId, reason = null) {
  const i = queue.findIndex((e) => e.members.some((m) => m.userId === userId));
  if (i < 0) return;
  const [entry] = queue.splice(i, 1);
  for (const m of entry.members) if (m.userId !== userId) sendUser(m.userId, { t: "cancelled", reason });
}

function joinQueue(user, ws, requested) {
  const party = social.partyFor(user.id);
  if (social.lobbyFor(user.id)) return send(ws, { t: "notice", text: "Leave the custom lobby to queue", tone: "error" });
  if (party && party.leader !== user.id) return send(ws, { t: "notice", text: "The party leader starts the queue", tone: "error" });
  const ids = party ? party.members : [user.id];
  const missing = ids.find((id) => !sockets.has(id) || roomOfUser.has(id));
  if (missing) return send(ws, { t: "notice", text: `${profileBits(missing).name} isn't ready`, tone: "error" });
  const mode = MODES.includes(requested) ? requested : party?.mode ?? "bomb";
  if (party && party.mode !== mode) social.partyAction(user.id, { action: "mode", mode });
  // Switching modes while queued moves you to the other queue.
  for (const id of ids) leaveQueue(id);
  queue.push({ members: ids.map((id) => ({ userId: id, ...profileBits(id) })), party: party?.id ?? null, mode, joinedAt: Date.now() });
  matchmake();
}

const asUserId = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

function inviteTarget(msg) {
  if (typeof msg.uid === "string") {
    const clean = msg.uid.toUpperCase().replace(/[\s-]/g, "");
    return User.findByUid(clean)?.id ?? null;
  }
  return asUserId(msg.friendId);
}

// Party, lobby and invite messages; true when handled.
function socialMessage(user, ws, msg) {
  const report = (error) => error && send(ws, { t: "notice", text: error, tone: "error" });
  switch (msg.t) {
    case "invite": {
      const toId = inviteTarget(msg);
      const error = social.invite(user.id, { kind: msg.kind, toId });
      if (error) report(error);
      else send(ws, { t: "notice", text: `Invite sent to ${profileBits(toId).name}` });
      return true;
    }
    case "invite_accept":
      if (typeof msg.id === "string") report(social.accept(user.id, msg.id));
      return true;
    case "invite_decline":
      if (typeof msg.id === "string") social.decline(user.id, msg.id);
      return true;
    case "party":
      if (["leave", "kick", "promote", "mode"].includes(msg.action)) report(social.partyAction(user.id, { action: msg.action, target: asUserId(msg.target), mode: msg.mode }));
      return true;
    case "lobby_create":
      leaveQueue(user.id);
      social.createLobby(user.id);
      return true;
    case "lobby_join":
      leaveQueue(user.id);
      report(social.joinLobby(user.id, typeof msg.code === "string" ? msg.code.slice(0, 12) : ""));
      return true;
    case "lobby":
      if (["leave", "kick", "promote", "slot", "settings"].includes(msg.action)) {
        report(social.lobbyAction(user.id, { action: msg.action, target: asUserId(msg.target), slot: msg.slot, settings: msg.settings && typeof msg.settings === "object" ? msg.settings : null }));
      }
      return true;
    case "lobby_start":
      startCustom(user.id);
      return true;
  }
  return false;
}

function roomFor(userId) {
  const room = rooms.get(roomOfUser.get(userId));
  return room && !room.over ? room : null;
}

const MESSAGE_LIMIT_PER_SEC = 120;

export function connect(ws, user) {
  sockets.get(user.id)?.close(4000, "replaced");
  sockets.set(user.id, ws);
  let alive = true;
  let budget = MESSAGE_LIMIT_PER_SEC;
  const refill = setInterval(() => (budget = MESSAGE_LIMIT_PER_SEC), 1000);
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);
  ws.on("pong", () => (alive = true));

  // Coming back to a running match.
  const existing = roomFor(user.id);
  if (existing) send(ws, existing.welcome(existing.attach(user.id, ws)));
  else send(ws, { t: "hello", maps: MAP_IDS, ...social.stateFor(user.id) });
  social.connected(user.id);

  ws.on("message", (raw) => {
    if (--budget < 0) return ws.close(4008, "too many messages");
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== "string") return;
    const room = roomFor(user.id);
    const player = room?.playerOf(user.id);
    switch (msg.t) {
      case "queue":
        if (room) return send(ws, room.welcome(room.attach(user.id, ws)));
        return joinQueue(user, ws, msg.mode);
      case "cancel":
        leaveQueue(user.id, "Matchmaking was cancelled");
        return send(ws, { t: "cancelled" });
      case "leave":
        if (room) {
          room.detach(user.id);
          roomOfUser.delete(user.id);
          // A custom match everyone has walked out of ends, freeing the lobby.
          if (room.custom && ![...room.players.values()].some((p) => p.userId && roomOfUser.get(p.userId) === room.id)) room.finish(null);
        }
        return send(ws, { t: "left", ...social.stateFor(user.id) });
      case "ping":
        return send(ws, { t: "pong", c: msg.c, tm: Date.now() });
    }
    if (!room && socialMessage(user, ws, msg)) return;
    const spectator = room?.spectators.get(user.id);
    if (spectator && msg.t === "chat") return room.chat(spectator, msg);
    if (!room || !player) return;
    if (msg.t === "in") room.input(player, msg);
    else if (msg.t === "fire") room.fire(player, msg.y, msg.p, Number.isFinite(msg.vt) ? msg.vt : null);
    else if (msg.t === "reload") room.startReload(player);
    else if (msg.t === "switch") room.switchWeapon(player, msg.w);
    else if (msg.t === "use") player.using = !!msg.on;
    else if (msg.t === "drop") room.dropWeapon(player);
    else if (msg.t === "chat") room.chat(player, msg);
    else if (msg.t === "hero") room.heroAction(player, msg);
    else if (msg.t === "ability") room.useAbility(player, msg);
    else if (msg.t === "buy" && typeof msg.item === "string") room.buy(player, msg.item);
    else if (msg.t === "sell" && typeof msg.item === "string") room.sell(player, msg.item);
    else if (msg.t === "scope") room.setScope(player, msg);
  });

  ws.on("close", () => {
    clearInterval(refill);
    clearInterval(heartbeat);
    if (sockets.get(user.id) !== ws) return;
    sockets.delete(user.id);
    leaveQueue(user.id, "Someone in your party disconnected");
    roomFor(user.id)?.detach(user.id);
    social.disconnected(user.id);
  });
}

export function shutdown() {
  clearInterval(ticker);
  for (const room of rooms.values()) room.dispose();
  for (const ws of sockets.values()) ws.close(1001, "server shutting down");
}
