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

// Matchmaking for Jokoman 5v5: players queue for a mode (Bomb or Team Deathmatch), a match starts
// when 10 are waiting or after a short wait, and bots fill every empty slot. One live connection
// per account.
const FILL_WAIT_MS = Number(process.env.FPS_FILL_WAIT_MS) || 10_000;
const MAX_ROOMS = Number(process.env.FPS_MAX_ROOMS) || 6;
const MATCH_SIZE = RULES.teamSize * 2;
const REWARD = { difficulty: 0.85, mood: { win: 30, lose: 10 } };

const sockets = new Map();
const queue = [];
const rooms = new Map();
const roomOfUser = new Map();
const recentWins = new Map();

const send = (ws, message) => ws?.readyState === 1 && ws.send(JSON.stringify(message));

export const isInFps = (userId) => roomOfUser.has(userId);

function queueStatus() {
  for (const mode of MODES) {
    const waiting = queue.filter((e) => e.mode === mode);
    const oldest = waiting[0]?.joinedAt ?? Date.now();
    for (const entry of waiting) {
      send(sockets.get(entry.userId), {
        t: "queue",
        mode,
        waiting: waiting.length,
        fillInMs: Math.max(0, oldest + FILL_WAIT_MS - Date.now()),
        full: rooms.size >= MAX_ROOMS,
      });
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
  for (const p of room.players.values()) if (p.userId && roomOfUser.get(p.userId) === room.id) roomOfUser.delete(p.userId);
  rooms.delete(room.id);
  room.dispose();
}

function startMatch(entries, mode) {
  const humans = entries.map((e) => ({ userId: e.userId, name: e.name, skin: e.skin, socket: sockets.get(e.userId) ?? null }));
  const mapId = MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)];
  const room = new Room({
    mapId,
    humans,
    heroPick: true,
    mode,
    economy: mode === "bomb",
    onEnd: (r, result) => {
      const rewards = rewardsFor(r, result);
      setTimeout(() => closeRoom(r), 1000).unref?.();
      return rewards;
    },
  });
  rooms.set(room.id, room);
  for (const h of humans) {
    roomOfUser.set(h.userId, room.id);
    const p = room.playerOf(h.userId);
    send(h.socket, room.welcome(p));
  }
}

function matchmake() {
  for (const mode of MODES) {
    if (rooms.size >= MAX_ROOMS) break;
    const waiting = queue.filter((e) => e.mode === mode);
    if (!waiting.length) continue;
    const waitedLongEnough = Date.now() - waiting[0].joinedAt >= FILL_WAIT_MS;
    if (waiting.length < MATCH_SIZE && !waitedLongEnough) continue;
    const picked = waiting.slice(0, MATCH_SIZE);
    for (const e of picked) queue.splice(queue.indexOf(e), 1);
    startMatch(picked, mode);
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

function leaveQueue(userId) {
  const i = queue.findIndex((e) => e.userId === userId);
  if (i >= 0) queue.splice(i, 1);
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
  else send(ws, { t: "hello", maps: MAP_IDS });

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
        {
          const mode = MODES.includes(msg.mode) ? msg.mode : "bomb";
          // Switching modes while queued moves you to the other queue.
          leaveQueue(user.id);
          const fresh = User.find(user.id) ?? user;
          queue.push({ userId: user.id, name: fresh.name, skin: fresh.equipped_skin ?? "classic", mode, joinedAt: Date.now() });
        }
        return matchmake();
      case "cancel":
        leaveQueue(user.id);
        return send(ws, { t: "cancelled" });
      case "leave":
        if (room) {
          room.detach(user.id);
          roomOfUser.delete(user.id);
        }
        return send(ws, { t: "left" });
      case "ping":
        return send(ws, { t: "pong", c: msg.c, tm: Date.now() });
    }
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
    leaveQueue(user.id);
    roomFor(user.id)?.detach(user.id);
  });
}

export function shutdown() {
  clearInterval(ticker);
  for (const room of rooms.values()) room.dispose();
  for (const ws of sockets.values()) ws.close(1001, "server shutting down");
}
