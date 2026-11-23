import { test } from "node:test";
import assert from "node:assert/strict";
import { rankOf, rpChange, MASTER_FLOOR, TIERS } from "../src/fps/shared/ranked.js";
import { Room } from "../server/fps/room.js";
import { createBody } from "../src/fps/shared/physics.js";
import { HOSTAGE } from "../src/fps/shared/rules.js";

test("tiers: Unranked 300, Bronze to Gold 3 x 500, Diamond 1000 and Master 1500 per level", () => {
  assert.equal(rankOf(0).label, "Unranked");
  assert.equal(rankOf(299).id, "unranked");
  assert.equal(rankOf(300).label, "Bronze III");
  assert.equal(rankOf(800).label, "Bronze II");
  assert.equal(rankOf(1300).label, "Bronze I");
  assert.equal(rankOf(1800).label, "Silver III");
  assert.equal(rankOf(3300).label, "Gold III");
  assert.equal(rankOf(4800).label, "Platinum III");
  assert.equal(rankOf(7050).label, "Diamond III");
  assert.equal(rankOf(8050).label, "Diamond II");
  assert.equal(rankOf(MASTER_FLOOR).label, "Joko Master III");
  assert.equal(rankOf(MASTER_FLOOR + 1500).label, "Joko Master II");
  // Past the last Master level the points keep counting.
  assert.equal(rankOf(MASTER_FLOOR + 9000).label, "Joko Master I");
  // Emperor comes from the global ranking, and only for Masters.
  assert.equal(rankOf(MASTER_FLOOR + 10, { emperor: true }).name, "Joko Emperor");
  assert.equal(rankOf(5000, { emperor: true }).id, "platinum");
  assert.equal(rankOf(1050).progress, 0.5);
  assert.equal(TIERS.length, 8);
});

test("RP: wins 200-500, losses from -50 (worse at high tiers) to +50, leaving costs", () => {
  const avg = { kills: 8, deaths: 9, assists: 3 };
  const win = rpChange({ points: 400, won: true, ...avg, margin: 3 });
  assert.ok(win.delta >= 200 && win.delta <= 500, `win ${win.delta}`);
  const carry = rpChange({ points: 400, won: true, kills: 25, deaths: 5, assists: 6, objectives: 3, margin: 8 });
  assert.ok(carry.delta > win.delta, "playing well pays");
  assert.ok(carry.delta <= 500);
  const lose = rpChange({ points: 2000, won: false, kills: 2, deaths: 14 });
  assert.equal(lose.delta, -50 - 15, "a bad loss in Silver: -50 minus the entry cost");
  const goodLoss = rpChange({ points: 400, won: false, kills: 20, deaths: 8, assists: 5, objectives: 2 });
  assert.ok(goodLoss.delta > 0 && goodLoss.delta <= 50, `great game in a loss ${goodLoss.delta}`);
  const master = rpChange({ points: MASTER_FLOOR + 3000, won: true, kills: 2, deaths: 14 });
  assert.equal(master.delta, 200, "a win is never below 200");
  const left = rpChange({ points: 2500, won: true, ...avg, left: true });
  assert.equal(left.delta, -(150 + 15));
  // Demotion protection: a loss can't drop you out of your tier.
  assert.equal(rpChange({ points: 1810, won: false, kills: 0, deaths: 10 }).after, 1800);
  assert.equal(rpChange({ points: 20, won: false, kills: 0, deaths: 10 }).after, 0);
});

test("Hostage mode: both hostages together, both must come out, hidden from attackers, costly to hurt", () => {
  let t = 1_000_000;
  const sent = [];
  const socket = { readyState: 1, send: (d) => sent.push(JSON.parse(d)) };
  const room = new Room({ mapId: "pasar", mode: "hostage", economy: true, clock: () => t, rng: () => 0.3, autoTick: false, humans: [{ userId: 1, name: "A", skin: "classic", socket, team: "red" }, { userId: 2, name: "D", skin: "classic", socket: null, team: "blue" }] });
  assert.equal(room.economy, true, "buy phase and credits like Bomb");
  assert.equal(room.round.phase, "buy");
  const [h1, h2] = room.hostages;
  assert.equal(h1.site, h2.site, "kept together on one site");
  assert.ok(Math.hypot(h1.body.x - h2.body.x, h1.body.z - h2.body.z) <= 7, "a cell or two apart");
  room.round.phase = "live";
  room.round.ends = t + 200_000;
  const me = room.playerOf(1);
  const enemy = room.playerOf(2);
  for (const p of room.players.values()) if (p !== me) p.socket = { readyState: 0 };
  // Attackers far away don't know where they are; defenders do.
  me.body = createBody(room.map.spawns.attack[0].x, room.map.spawns.attack[0].z, 0);
  room.updateHostageSight([me]);
  assert.equal(room.hostageView(true, t).length, 0, "hidden from attackers");
  assert.equal(room.hostageView(false, t).length, 2, "defenders know");

  // Lead both out, one behind the other.
  me.body = createBody(h1.body.x + 1, h1.body.z, 0);
  me.using = true;
  for (let i = 0; i < 50; i++) room.updateHostages((t += 50));
  me.body = createBody(h2.body.x + 1, h2.body.z, 0);
  for (let i = 0; i < 50; i++) room.updateHostages((t += 50));
  me.using = false;
  assert.equal(h1.state, "carried");
  assert.equal(h2.state, "carried");
  assert.ok(room.hostageView(true, t).length === 2, "attackers see the ones they lead");
  const home = room.map.spawns.attack[0];
  me.body = createBody(home.x, home.z, 0);
  room.updateHostages((t += 50));
  assert.equal(h1.state, "rescued");
  assert.equal(h2.state, "rescued");
  assert.equal(room.round.reason, "rescue");
  assert.equal(room.hostageView(false, t).length, 0, "rescued hostages leave the defenders' map");

  // One out isn't enough.
  room.startRound();
  room.round.phase = "live";
  room.round.ends = t + 200_000;
  const [a, b] = room.hostages;
  me.body = createBody(a.body.x + 1, a.body.z, 0);
  me.using = true;
  for (let i = 0; i < 50; i++) room.updateHostages((t += 50));
  me.using = false;
  me.body = createBody(home.x, home.z, 0);
  room.updateHostages((t += 50));
  assert.equal(a.state, "rescued");
  assert.equal(room.round.phase, "live", "the round goes on until both are out");

  // Either side pays for hurting one: per point of damage, and a lot more for a kill.
  enemy.credits = 3000;
  room.hurtHostage(enemy, b, 30);
  assert.equal(enemy.credits, 3000 - 30 * HOSTAGE.hurtPenaltyPerHp);
  assert.equal(b.hp, 70);
  me.credits = 5000;
  room.hurtHostage(me, b, 200);
  assert.equal(b.state, "dead");
  assert.equal(me.credits, 5000 - 70 * HOSTAGE.hurtPenaltyPerHp - HOSTAGE.killPenalty);
  // Every hostage still alive is out: that's a win.
  assert.equal(room.round.phase, "live");
  room.updateHostages((t += 50));
  assert.equal(room.round.reason, "rescue");
});
