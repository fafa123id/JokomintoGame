import { test } from "node:test";
import assert from "node:assert/strict";
import { Social, packTeams, swapAfterFor, PARTY_MAX } from "../server/fps/party.js";
import { Room } from "../server/fps/room.js";

function world() {
  const inbox = new Map();
  const notes = [];
  const online = new Set([1, 2, 3, 4, 5, 6, 7]);
  const busy = new Map();
  const social = new Social({
    send: (id, msg) => inbox.set(id, [...(inbox.get(id) ?? []), msg]),
    notify: (id, event, data) => (notes.push({ id, event, data }), online.has(id)),
    profile: (id) => (id > 0 && id < 20 ? { id, name: `P${id}`, uid: `UID0000${id}`, skin: "classic" } : null),
    online: (id) => online.has(id),
    busy: (id) => busy.get(id) ?? null,
  });
  const last = (id, t) => [...(inbox.get(id) ?? [])].reverse().find((m) => m.t === t);
  const inviteTo = (id) => [...notes].reverse().find((n) => n.id === id && n.event === "fps:invite")?.data.id;
  return { social, inbox, notes, online, busy, last, inviteTo };
}

test("party: invite, accept, leader powers, leaving", () => {
  const w = world();
  const { social } = w;
  assert.equal(social.invite(1, { kind: "party", toId: 1 }), "You can't invite yourself");
  assert.equal(social.invite(1, { kind: "party", toId: 99 }), "No player with that ID");
  assert.equal(social.invite(1, { kind: "party", toId: 2 }), null);
  assert.match(social.invite(1, { kind: "party", toId: 2 }), /already invited/);
  assert.equal(social.accept(3, w.inviteTo(2)), "This invite has expired", "only the invitee can accept");
  assert.equal(social.accept(2, w.inviteTo(2)), null);
  const party = social.partyFor(1);
  assert.deepEqual(party.members, [1, 2]);
  assert.equal(party.leader, 1);
  assert.equal(w.last(2, "party").party.members.length, 2);

  assert.equal(social.partyAction(2, { action: "mode", mode: "tdm" }), "Only the party leader can do that");
  assert.equal(social.partyAction(1, { action: "mode", mode: "tdm" }), null);
  assert.equal(party.mode, "tdm");
  assert.equal(social.partyAction(1, { action: "promote", target: 2 }), null);
  assert.equal(party.leader, 2);
  // Last but one leaves: the party dissolves.
  social.partyAction(1, { action: "leave" });
  assert.equal(social.partyFor(2), null);
  assert.equal(w.last(2, "party").party, null);
});

test("party: full, busy and offline players can't be invited", () => {
  const w = world();
  const { social } = w;
  for (let id = 2; id <= PARTY_MAX; id++) {
    social.invite(1, { kind: "party", toId: id });
    assert.equal(social.accept(id, w.inviteTo(id)), null);
  }
  assert.equal(social.partyFor(1).members.length, PARTY_MAX);
  assert.equal(social.invite(1, { kind: "party", toId: 6 }), "Your party is full");
  social.partyAction(1, { action: "kick", target: 5 });
  assert.equal(w.last(5, "party").kicked, true);
  w.busy.set(6, "is in a match");
  assert.equal(social.invite(1, { kind: "party", toId: 6 }), "P6 is in a match");
  w.online.delete(7);
  assert.equal(social.invite(1, { kind: "party", toId: 7 }), "P7 is offline");
  // Declines reach the inviter.
  w.online.add(7);
  social.invite(1, { kind: "party", toId: 7 });
  social.decline(7, w.inviteTo(7));
  assert.equal(w.last(1, "invite_closed").reason, "declined");
});

test("invites are rate limited", () => {
  const w = world();
  for (let id = 2; id <= 7; id++) assert.equal(w.social.invite(1, { kind: "party", toId: id }), null);
  w.online.add(8);
  assert.match(w.social.invite(1, { kind: "party", toId: 8 }), /too many invites/);
});

test("custom lobby: code join, slots, host powers, start rules", () => {
  const w = world();
  const { social } = w;
  const lobby = social.createLobby(1);
  assert.match(lobby.code, /^[A-Z2-9]{6}$/);
  assert.equal(social.joinLobby(2, "nope"), "No lobby with that code");
  assert.equal(social.joinLobby(2, lobby.code.toLowerCase()), null);
  assert.equal(lobby.slots.get(2), "blue", "joins the smaller team");
  assert.equal(social.lobbyAction(2, { action: "slot", slot: "spec" }), null);
  assert.equal(social.lobbyAction(2, { action: "slot", target: 1, slot: "blue" }), "Only the host can move other players");
  assert.equal(social.lobbyAction(1, { action: "settings", settings: { roundsToWin: 3 } }), "Pick one of the round options");
  assert.equal(social.lobbyAction(1, { action: "settings", settings: { mode: "tdm", killTarget: 20, bots: false, map: "random" } }), null);
  assert.equal(lobby.settings.killTarget, 20);
  // Bots off: both teams need a player.
  assert.match(social.startLobby(1).error, /both teams/);
  assert.equal(social.lobbyAction(1, { action: "slot", target: 2, slot: "blue" }), null);
  assert.equal(social.startLobby(2).error, "Only the host can start");
  social.joinLobby(3, lobby.code);
  social.lobbyAction(1, { action: "slot", target: 3, slot: "spec" });
  const plan = social.startLobby(1);
  assert.deepEqual(plan.players, [{ userId: 1, team: "red" }, { userId: 2, team: "blue" }]);
  assert.deepEqual(plan.spectators, [3]);
  assert.equal(social.joinLobby(4, lobby.code), "That lobby is in a match right now");
  social.lobbyMatchOver(lobby.code);
  assert.equal(lobby.status, "waiting");
  // Host leaves: the next player hosts.
  social.lobbyAction(1, { action: "leave" });
  assert.equal(lobby.host, 2);
  // Lobby invites.
  assert.equal(social.invite(2, { kind: "lobby", toId: 5 }), null);
  assert.equal(social.accept(5, w.inviteTo(5)), null);
  assert.ok(lobby.slots.has(5));
});

test("queued groups: parties stay on one team", () => {
  const g = (n, tag) => ({ members: Array.from({ length: n }, (_, i) => ({ userId: `${tag}${i}` })) });
  const { teams, used } = packTeams([g(3, "a"), g(1, "b"), g(5, "c"), g(2, "d"), g(1, "e")]);
  assert.equal(teams.red.filter((m) => m.userId.startsWith("a")).length + teams.blue.filter((m) => m.userId.startsWith("a")).length, 3);
  const sameTeam = (tag) => [teams.red, teams.blue].some((t) => t.filter((m) => m.userId.startsWith(tag)).length === used.find((u) => u.members[0].userId.startsWith(tag))?.members.length);
  for (const tag of ["a", "c", "d"]) if (used.some((u) => u.members[0].userId.startsWith(tag))) assert.ok(sameTeam(tag), tag);
  assert.ok(teams.red.length <= 5 && teams.blue.length <= 5);
  assert.equal(swapAfterFor(10), 5);
  assert.equal(swapAfterFor(7), 4);
});

test("custom room: fixed teams, no bots, custom win target, spectators see everyone", () => {
  const sent = [];
  const socket = (tag) => ({ readyState: 1, send: (d) => sent.push({ tag, msg: JSON.parse(d) }) });
  let now = 1_000_000;
  const room = new Room({
    mapId: "pantai",
    humans: [{ userId: 1, name: "A", skin: "classic", team: "blue", socket: socket("a") }, { userId: 2, name: "B", skin: "classic", team: "blue", socket: socket("b") }, { userId: 3, name: "C", skin: "classic", team: "red", socket: socket("c") }],
    spectators: [{ userId: 9, name: "S", skin: "classic", socket: socket("s") }],
    fillBots: false,
    rules: { roundsToWin: 4, swapAfter: 2, killTarget: 20 },
    custom: true,
    autoTick: false,
    clock: () => now,
  });
  assert.equal(room.players.size, 3);
  assert.equal(room.playerOf(1).team, "blue");
  assert.equal(room.playerOf(3).team, "red");
  assert.equal(room.sideOf("red", 3), room.sideOf("blue", 1), "sides swap after 2 rounds");
  const w = room.welcome(room.attach(9, socket("s")));
  assert.equal(w.spectator, true);
  assert.equal(w.rules.roundsToWin, 4);
  room.round.phase = "live";
  room.tick();
  const snap = sent.filter((s) => s.tag === "s" && s.msg.t === "snap").at(-1).msg;
  assert.equal(snap.ps.length, 3, "every player");
  assert.ok(snap.ps.every((row) => row[8] >= 0), "health of both teams");
  assert.equal(snap.me.alive, false);
  // Spectator chat stays with spectators.
  room.chat(room.spectators.get(9), { text: "hi" });
  assert.ok(sent.some((s) => s.tag === "s" && s.msg.t === "chat"));
  assert.ok(!sent.some((s) => s.tag !== "s" && s.msg.t === "chat"));
  room.score.red = 3;
  room.round.phase = "end";
  room.round.ends = now;
  room.score.red = 4;
  room.tick();
  assert.equal(room.over, true, "first to 4");
  assert.ok(sent.some((s) => s.tag === "s" && s.msg.t === "match_end" && s.msg.spectator));
  room.dispose();
});
