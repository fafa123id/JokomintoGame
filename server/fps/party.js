import crypto from "node:crypto";
import { MODES, RULES } from "../../src/fps/shared/rules.js";
import { MAP_IDS } from "../../src/fps/shared/maps.js";

// Parties (up to a full team that queues together), custom lobbies (private rooms joined by code,
// host sets teams and rules) and the invites for both. In memory only, like the rooms themselves.
// Every change is pushed to the people it concerns; the caller owns sockets and matchmaking.
export const PARTY_MAX = RULES.teamSize;
export const SPECTATOR_MAX = 4;
export const INVITE_SEC = 60;
const INVITES_PER_MINUTE = 6;
// A dropped connection keeps its place this long (page reloads, flaky phones).
const GRACE_MS = Number(process.env.FPS_PARTY_GRACE_MS) || 30_000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const CUSTOM_OPTIONS = {
  modes: MODES,
  maps: ["random", ...MAP_IDS],
  roundsToWin: [4, 7, 10, 13],
  killTarget: [20, 40, 60],
};
const DEFAULT_SETTINGS = { mode: "bomb", map: "random", roundsToWin: RULES.roundsToWin, killTarget: 40, bots: true };
const SLOTS = ["red", "blue", "spec"];

// Bomb halves: sides swap halfway to the win target (10 → every 5 rounds, as in matchmaking).
export const swapAfterFor = (roundsToWin) => Math.ceil(roundsToWin / 2);

// Splits queued groups (parties stay together) into two teams, oldest first. Groups that don't fit
// wait for the next match.
export function packTeams(groups, teamSize = RULES.teamSize) {
  const teams = { red: [], blue: [] };
  const used = [];
  for (const g of groups) {
    const order = teams.red.length <= teams.blue.length ? ["red", "blue"] : ["blue", "red"];
    const team = order.find((t) => teams[t].length + g.members.length <= teamSize);
    if (!team) continue;
    teams[team].push(...g.members);
    used.push(g);
  }
  return { teams, used };
}

export class Social {
  // send(userId, msg): to the player's game socket. notify(userId, event, data): app-wide (returns
  // false if they aren't online anywhere). profile(userId): { id, name, uid, skin } or null.
  // busy(userId): a reason they can't be invited right now, or null. online(userId): game socket up.
  constructor({ send, notify = () => true, profile, busy = () => null, online = () => true, onPartyChange = () => {}, clock = () => Date.now() }) {
    Object.assign(this, { send, notify, profile, busy, online, onPartyChange, clock });
    this.parties = new Map();
    this.partyOf = new Map();
    this.lobbies = new Map();
    this.lobbyOf = new Map();
    this.invites = new Map();
    this.sent = new Map();
    this.dropTimers = new Map();
  }

  // ---------- views ----------

  person(userId) {
    const p = this.profile(userId);
    return { id: userId, name: p?.name ?? "Player", uid: p?.uid ?? "", skin: p?.skin ?? "classic", online: this.online(userId) };
  }

  partyView(party) {
    return { id: party.id, leader: party.leader, mode: party.mode, members: party.members.map((id) => this.person(id)) };
  }

  lobbyView(lobby) {
    return {
      code: lobby.code,
      host: lobby.host,
      status: lobby.status,
      settings: { ...lobby.settings },
      options: CUSTOM_OPTIONS,
      players: [...lobby.slots].map(([id, slot]) => ({ ...this.person(id), slot })),
    };
  }

  pushParty(party) {
    const view = this.partyView(party);
    for (const id of party.members) this.send(id, { t: "party", party: view });
  }

  pushLobby(lobby) {
    const view = this.lobbyView(lobby);
    for (const id of lobby.slots.keys()) this.send(id, { t: "lobby", lobby: view });
  }

  // Current party and lobby for a (re)connecting player.
  stateFor(userId) {
    const party = this.parties.get(this.partyOf.get(userId));
    const lobby = this.lobbies.get(this.lobbyOf.get(userId));
    return { party: party ? this.partyView(party) : null, lobby: lobby ? this.lobbyView(lobby) : null };
  }

  partyFor(userId) {
    return this.parties.get(this.partyOf.get(userId)) ?? null;
  }

  lobbyFor(userId) {
    return this.lobbies.get(this.lobbyOf.get(userId)) ?? null;
  }

  // ---------- party ----------

  createParty(leader) {
    const party = { id: crypto.randomUUID(), leader, members: [leader], mode: "bomb" };
    this.parties.set(party.id, party);
    this.partyOf.set(leader, party.id);
    return party;
  }

  joinParty(userId, party) {
    this.leaveAll(userId);
    party.members.push(userId);
    this.partyOf.set(userId, party.id);
    this.onPartyChange(party);
    this.pushParty(party);
  }

  leaveParty(userId, { kicked = false } = {}) {
    const party = this.partyFor(userId);
    if (!party) return;
    party.members = party.members.filter((id) => id !== userId);
    this.partyOf.delete(userId);
    this.send(userId, { t: "party", party: null, kicked });
    this.onPartyChange(party);
    // A party of one is no party.
    if (party.members.length <= 1) {
      for (const id of party.members) {
        this.partyOf.delete(id);
        this.send(id, { t: "party", party: null });
      }
      this.parties.delete(party.id);
      return;
    }
    if (party.leader === userId) party.leader = party.members[0];
    this.pushParty(party);
  }

  partyAction(userId, { action, target, mode }) {
    const party = this.partyFor(userId);
    if (!party) return "You're not in a party";
    const leader = party.leader === userId;
    if (action === "leave") return this.leaveParty(userId), null;
    if (!leader) return "Only the party leader can do that";
    if (action === "mode") {
      if (!MODES.includes(mode)) return "Unknown mode";
      party.mode = mode;
      this.onPartyChange(party);
    } else if (action === "kick" || action === "promote") {
      if (target === userId || !party.members.includes(target)) return "They're not in your party";
      if (action === "kick") return this.leaveParty(target, { kicked: true }), null;
      party.leader = target;
    } else return "Unknown action";
    this.pushParty(party);
    return null;
  }

  // ---------- custom lobby ----------

  newCode() {
    for (;;) {
      const code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
      if (!this.lobbies.has(code)) return code;
    }
  }

  createLobby(userId) {
    this.leaveAll(userId);
    const lobby = { code: this.newCode(), host: userId, status: "waiting", settings: { ...DEFAULT_SETTINGS }, slots: new Map([[userId, "red"]]), roomId: null };
    this.lobbies.set(lobby.code, lobby);
    this.lobbyOf.set(userId, lobby.code);
    this.pushLobby(lobby);
    return lobby;
  }

  slotCount(lobby, slot) {
    return [...lobby.slots.values()].filter((s) => s === slot).length;
  }

  slotFull(lobby, slot) {
    return this.slotCount(lobby, slot) >= (slot === "spec" ? SPECTATOR_MAX : RULES.teamSize);
  }

  // New arrivals go to the smaller team, or watch when both are full.
  openSlot(lobby) {
    const red = this.slotCount(lobby, "red");
    const blue = this.slotCount(lobby, "blue");
    const team = red <= blue ? "red" : "blue";
    if (!this.slotFull(lobby, team)) return team;
    return this.slotFull(lobby, "spec") ? null : "spec";
  }

  joinLobby(userId, code) {
    const lobby = this.lobbies.get(String(code ?? "").toUpperCase().trim());
    if (!lobby) return "No lobby with that code";
    if (lobby.slots.has(userId)) return this.pushLobby(lobby), null;
    if (lobby.status !== "waiting") return "That lobby is in a match right now";
    const slot = this.openSlot(lobby);
    if (!slot) return "That lobby is full";
    this.leaveAll(userId);
    lobby.slots.set(userId, slot);
    this.lobbyOf.set(userId, lobby.code);
    this.pushLobby(lobby);
    return null;
  }

  leaveLobby(userId, { kicked = false } = {}) {
    const lobby = this.lobbyFor(userId);
    if (!lobby) return;
    lobby.slots.delete(userId);
    this.lobbyOf.delete(userId);
    this.send(userId, { t: "lobby", lobby: null, kicked });
    if (!lobby.slots.size) {
      this.lobbies.delete(lobby.code);
      return;
    }
    if (lobby.host === userId) lobby.host = lobby.slots.keys().next().value;
    this.pushLobby(lobby);
  }

  lobbyAction(userId, { action, target, slot, settings }) {
    const lobby = this.lobbyFor(userId);
    if (!lobby) return "You're not in a lobby";
    const host = lobby.host === userId;
    if (action === "leave") return this.leaveLobby(userId), null;
    if (lobby.status !== "waiting") return "Wait for the match to finish";
    if (action === "slot") {
      const who = target ?? userId;
      if (who !== userId && !host) return "Only the host can move other players";
      if (!lobby.slots.has(who)) return "They're not in this lobby";
      if (!SLOTS.includes(slot)) return "Unknown slot";
      if (lobby.slots.get(who) === slot) return null;
      if (this.slotFull(lobby, slot)) return "That side is full";
      lobby.slots.set(who, slot);
    } else if (!host) return "Only the host can do that";
    else if (action === "kick" || action === "promote") {
      if (target === userId || !lobby.slots.has(target)) return "They're not in this lobby";
      if (action === "kick") return this.leaveLobby(target, { kicked: true }), null;
      lobby.host = target;
    } else if (action === "settings") {
      const error = this.applySettings(lobby, settings ?? {});
      if (error) return error;
    } else return "Unknown action";
    this.pushLobby(lobby);
    return null;
  }

  applySettings(lobby, next) {
    const s = { ...lobby.settings };
    if (next.mode !== undefined) {
      if (!CUSTOM_OPTIONS.modes.includes(next.mode)) return "Unknown mode";
      s.mode = next.mode;
    }
    if (next.map !== undefined) {
      if (!CUSTOM_OPTIONS.maps.includes(next.map)) return "Unknown map";
      s.map = next.map;
    }
    if (next.roundsToWin !== undefined) {
      if (!CUSTOM_OPTIONS.roundsToWin.includes(next.roundsToWin)) return "Pick one of the round options";
      s.roundsToWin = next.roundsToWin;
    }
    if (next.killTarget !== undefined) {
      if (!CUSTOM_OPTIONS.killTarget.includes(next.killTarget)) return "Pick one of the kill targets";
      s.killTarget = next.killTarget;
    }
    if (next.bots !== undefined) s.bots = !!next.bots;
    lobby.settings = s;
    return null;
  }

  // What the host's Start needs to build a room, or an error.
  startLobby(userId) {
    const lobby = this.lobbyFor(userId);
    if (!lobby) return { error: "You're not in a lobby" };
    if (lobby.host !== userId) return { error: "Only the host can start" };
    if (lobby.status !== "waiting") return { error: "Already in a match" };
    const offline = [...lobby.slots.keys()].filter((id) => !this.online(id));
    if (offline.length) return { error: `Waiting for ${this.person(offline[0]).name} to reconnect` };
    const players = [...lobby.slots].filter(([, slot]) => slot !== "spec");
    if (!players.length) return { error: "Someone has to play" };
    if (!lobby.settings.bots && (!this.slotCount(lobby, "red") || !this.slotCount(lobby, "blue"))) {
      return { error: "With bots off, both teams need at least one player" };
    }
    lobby.status = "playing";
    this.pushLobby(lobby);
    return {
      lobby,
      players: players.map(([id, team]) => ({ userId: id, team })),
      spectators: [...lobby.slots].filter(([, slot]) => slot === "spec").map(([id]) => id),
      settings: { ...lobby.settings },
    };
  }

  lobbyMatchOver(code) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return;
    lobby.status = "waiting";
    lobby.roomId = null;
    this.pushLobby(lobby);
  }

  // ---------- invites ----------

  invite(fromId, { kind, toId }) {
    if (kind !== "party" && kind !== "lobby") return "Unknown invite";
    const target = toId && this.profile(toId);
    if (!target) return "No player with that ID";
    if (toId === fromId) return "You can't invite yourself";
    const now = this.clock();
    const recent = (this.sent.get(fromId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= INVITES_PER_MINUTE) return "Slow down: too many invites in a minute";
    const reason = this.busy(toId);
    if (reason) return `${target.name} ${reason}`;
    let ref;
    if (kind === "party") {
      const party = this.partyFor(fromId);
      if (party?.members.includes(toId)) return `${target.name} is already in your party`;
      if (party && party.members.length >= PARTY_MAX) return "Your party is full";
      if (this.lobbyFor(fromId)) return "Leave the custom lobby first";
      ref = party?.id ?? null;
    } else {
      const lobby = this.lobbyFor(fromId);
      if (!lobby) return "You're not in a lobby";
      if (lobby.slots.has(toId)) return `${target.name} is already in the lobby`;
      if (!this.openSlot(lobby)) return "The lobby is full";
      ref = lobby.code;
    }
    for (const inv of this.invites.values()) if (inv.from === fromId && inv.to === toId && inv.kind === kind) return `You already invited ${target.name}`;

    const from = this.person(fromId);
    const id = crypto.randomUUID();
    const invite = { id, kind, from: fromId, to: toId, ref, at: now };
    const lobby = kind === "lobby" ? this.lobbies.get(ref) : null;
    const mode = kind === "party" ? (this.partyFor(fromId)?.mode ?? "bomb") : lobby.settings.mode;
    if (!this.notify(toId, "fps:invite", { id, kind, mode, from: { name: from.name, uid: from.uid }, expiresInSec: INVITE_SEC })) return `${target.name} is offline`;
    invite.timer = setTimeout(() => this.closeInvite(id, "expired"), INVITE_SEC * 1000);
    invite.timer.unref?.();
    this.invites.set(id, invite);
    this.sent.set(fromId, [...recent, now]);
    return null;
  }

  closeInvite(id, reason) {
    const inv = this.invites.get(id);
    if (!inv) return;
    clearTimeout(inv.timer);
    this.invites.delete(id);
    this.notify(inv.to, "fps:invite:closed", { id, reason });
    if (reason !== "accepted") this.send(inv.from, { t: "invite_closed", reason, name: this.person(inv.to).name });
  }

  decline(userId, id) {
    const inv = this.invites.get(id);
    if (inv?.to === userId) this.closeInvite(id, "declined");
  }

  accept(userId, id) {
    const inv = this.invites.get(id);
    if (!inv || inv.to !== userId) return "This invite has expired";
    const reason = this.busy(userId);
    if (reason) return `You ${reason.replace(/^is /, "are ")}`;
    if (inv.kind === "lobby") {
      const error = this.joinLobby(userId, inv.ref);
      if (error) return this.closeInvite(id, "failed"), error;
    } else {
      // The inviter's party may have been created (or changed) since the invite went out.
      let party = this.partyFor(inv.from);
      if (!party) {
        if (this.lobbyFor(inv.from)) return this.closeInvite(id, "failed"), "They moved to a custom lobby";
        party = this.createParty(inv.from);
      }
      if (party.members.length >= PARTY_MAX) return this.closeInvite(id, "failed"), "That party is full";
      this.joinParty(userId, party);
    }
    this.closeInvite(id, "accepted");
    this.send(inv.from, { t: "notice", text: `${this.person(userId).name} joined` });
    return null;
  }

  // ---------- connections ----------

  leaveAll(userId) {
    this.leaveParty(userId);
    this.leaveLobby(userId);
  }

  connected(userId) {
    clearTimeout(this.dropTimers.get(userId));
    this.dropTimers.delete(userId);
    this.partyFor(userId) && this.pushParty(this.partyFor(userId));
    this.lobbyFor(userId) && this.pushLobby(this.lobbyFor(userId));
  }

  disconnected(userId) {
    const party = this.partyFor(userId);
    if (party) {
      this.onPartyChange(party);
      this.pushParty(party);
    }
    const lobby = this.lobbyFor(userId);
    if (lobby) this.pushLobby(lobby);
    if (!party && !lobby) return;
    clearTimeout(this.dropTimers.get(userId));
    const timer = setTimeout(() => {
      this.dropTimers.delete(userId);
      if (!this.online(userId)) this.leaveAll(userId);
    }, GRACE_MS);
    timer.unref?.();
    this.dropTimers.set(userId, timer);
  }
}
