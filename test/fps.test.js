import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { CELL, KEY, createBody, step, hitboxes, rayBox, rayWorld, aimDirection, collides, toCell, lineOfSight, traceShot, smokeBlocks } from "../src/fps/shared/physics.js";
import { WEAPONS } from "../src/fps/shared/weapons.js";
import { HEROES as heroList } from "../src/fps/shared/heroes.js";
import { RULES } from "../src/fps/shared/rules.js";
import { MAPS, MAP_IDS, isWalkable } from "../src/fps/shared/maps.js";
import { Room } from "../server/fps/room.js";
import { createBrain, think, planPath, wallAhead } from "../server/fps/bot.js";

test("all nine maps connect spawns and both bomb sites", () => {
  assert.equal(MAP_IDS.length, 9);
  for (const map of Object.values(MAPS)) {
    const start = map.grid.flatMap((r, z) => [...r].flatMap((c, x) => (c === "T" ? [[x, z]] : [])))[0];
    const seen = new Set([start.join()]);
    const queue = [start];
    while (queue.length) {
      const [x, z] = queue.shift();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = [x + dx, z + dz];
        if (!seen.has(n.join()) && isWalkable(map, n[0], n[1])) {
          seen.add(n.join());
          queue.push(n);
        }
      }
    }
    for (const ch of ["A", "B", "D"]) {
      assert.ok(map.grid.some((r, z) => [...r].some((c, x) => c === ch && seen.has(`${x},${z}`))), `${map.id}: ${ch} unreachable`);
    }
  }
});

test("players can't walk through walls and land after a jump", () => {
  const map = MAPS.pasar;
  // Cell (3, 21) is floor with a wall to its west at x < 3 * CELL.
  const body = createBody(3.5 * CELL, 21.5 * CELL);
  assert.ok(!collides(map, body.x, body.z));
  for (let i = 0; i < 60; i++) step(map, body, KEY.LEFT, 0, 0, 1 / 30);
  assert.ok(!collides(map, body.x, body.z));
  assert.ok(body.x >= 3 * CELL + 0.34, "stopped at the wall");
  step(map, body, KEY.JUMP, 0, 0, 1 / 30);
  assert.ok(body.y > 0 && !body.grounded);
  for (let i = 0; i < 60; i++) step(map, body, 0, 0, 0, 1 / 30);
  assert.equal(body.y, 0);
  assert.ok(body.grounded);
});

test("hitboxes: head above body, and walls stop bullets", () => {
  const target = createBody(10, 10);
  const [head, chest] = hitboxes(target);
  assert.equal(head.part, "head");
  assert.ok(head.min.y >= chest.max.y - 1e-9);
  const origin = { x: 10, y: 1.68, z: 20 };
  assert.ok(rayBox(origin, aimDirection(0, 0), head.min, head.max) > 0);
  assert.equal(rayBox({ x: 10, y: 1.68, z: 20 }, aimDirection(Math.PI / 2, 0), head.min, head.max), null);

  const map = MAPS.pasar;
  const eye = { x: 13 * CELL, y: 1.6, z: 15 * CELL };
  assert.ok(rayWorld(map, eye, aimDirection(Math.PI / 2, 0), 100) < 3 * CELL, "wall to the west");
});

test("team vision needs range, field of view and a clear line of sight", () => {
  let t = 1_000_000;
  const room = new Room({ mapId: "pantai", clock: () => t, autoTick: false });
  const [viewer, enemy] = [[...room.players.values()].find((p) => p.team === "red"), [...room.players.values()].find((p) => p.team === "blue")];
  for (const p of room.players.values()) if (p !== viewer && p !== enemy) p.alive = false;
  // Open beach plaza: viewer at (12.5, 18.5) cells looking north (-z), enemy 6 cells ahead.
  viewer.body = createBody(12.5 * CELL, 18.5 * CELL, 0);
  enemy.body = createBody(12.5 * CELL, 14.5 * CELL, 0);
  assert.deepEqual(room.computeVision().red, [enemy.id]);
  viewer.body.yaw = Math.PI;
  assert.deepEqual(room.computeVision().red, [], "behind the viewer");
  viewer.body.yaw = 0;
  enemy.body = createBody(12.5 * CELL, 12.5 * CELL, 0);
  assert.deepEqual(room.computeVision().red, [], "pillar at (12,13) blocks the view");
  enemy.body = createBody(12.5 * CELL, 8.5 * CELL, 0);
  viewer.body = createBody(12.5 * CELL, 19.5 * CELL, 0);
  assert.deepEqual(room.computeVision().red, [], "out of range");
});

test("a bots-only match runs to the end", () => {
  let t = 1_000_000;
  let seed = 3;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let result = null;
  const room = new Room({ mapId: "pabrik", clock: () => t, rng, autoTick: false, onEnd: (r, res) => (result = res) });
  for (let i = 0; i < 20 * 60 * 60 && !room.over; i++) {
    t += 50;
    room.tick();
  }
  assert.ok(room.over);
  assert.ok(Object.values(room.score).includes(RULES.roundsToWin));
  assert.deepEqual(result.results, []);
});

const fakeSocket = () => {
  const inbox = [];
  return { readyState: 1, inbox, send: (data) => inbox.push(JSON.parse(data)) };
};

function humanRoom(mapId = "pantai") {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const [red, blue] = [fakeSocket(), fakeSocket()];
  const room = new Room({
    mapId,
    clock: clock.now,
    // rng 0: the human attacker always draws the bomb.
    rng: () => 0,
    autoTick: false,
    humans: [
      { userId: 1, name: "Attacker", skin: "classic", socket: red },
      { userId: 2, name: "Defender", skin: "classic", socket: blue },
    ],
  });
  return { room, clock, red, blue, attacker: room.playerOf(1), defender: room.playerOf(2) };
}

test("knife: 50 from the front, lethal from behind", () => {
  const { room, attacker, defender } = humanRoom();
  room.round.phase = "live";
  room.switchWeapon(attacker, "knife", true);
  assert.equal(attacker.weapon, "knife");
  // Defender faces north (-z); attacker stands in front of them, facing south.
  defender.body = createBody(12.5 * CELL, 17.5 * CELL, 0);
  attacker.body = createBody(12.5 * CELL, 17.5 * CELL - 1.2, Math.PI);
  room.fire(attacker, Math.PI, -0.2);
  assert.equal(defender.hp, 50);
  attacker.nextShot = 0;
  attacker.body = createBody(12.5 * CELL, 17.5 * CELL + 1.2, 0);
  room.fire(attacker, 0, -0.2);
  assert.equal(defender.alive, false, "backstab");
});

test("the carrier can drop the bomb for a teammate, but can't grab it straight back", () => {
  const { room, clock, attacker } = humanRoom();
  room.round.phase = "live";
  assert.equal(room.bomb.carrier, attacker.id);
  room.switchWeapon(attacker, "bomb", true);
  assert.equal(attacker.weapon, "bomb");
  room.dropBomb(attacker);
  assert.equal(room.bomb.carrier, null);
  assert.ok(room.bomb.dropped);
  assert.equal(attacker.weapon, "rifle", "bomb holstered");
  attacker.body = createBody(room.bomb.dropped.x, room.bomb.dropped.z);
  room.updateBomb(clock.now());
  assert.equal(room.bomb.carrier, null, "pickup lock");
  const mate = room.playersOn("attack").find((p) => p !== attacker);
  mate.body = createBody(room.bomb.dropped.x, room.bomb.dropped.z);
  room.updateBomb(clock.advance(100));
  assert.equal(room.bomb.carrier, mate.id);
  room.switchWeapon(attacker, "bomb", true);
  assert.equal(attacker.weapon, "rifle", "only the carrier can hold the bomb");
});

test("defenders get no site, carrier or timer once the bomb is planted", () => {
  const { room, clock, attacker, red, blue } = humanRoom();
  room.round.phase = "live";
  const site = room.map.sites.A[0];
  attacker.body = createBody((site.x + 0.5) * CELL, (site.z + 0.5) * CELL);
  // Park every defender somewhere without a view of the plant spot.
  const hidden = room.map.grid
    .flatMap((row, z) => [...row].map((_, x) => ({ x, z })))
    .find(({ x, z }) => {
      if (!isWalkable(room.map, x, z)) return false;
      for (const p of room.playersOn("defend")) p.body = createBody((x + 0.5) * CELL, (z + 0.5) * CELL);
      return !room.bombVisibleToDefenders(attacker.body);
    });
  assert.ok(hidden);
  attacker.using = true;
  room.sendSnapshots(clock.now());
  assert.equal(blue.inbox.at(-1).bomb.carrier, null);
  assert.equal(red.inbox.at(-1).bomb.carrier, attacker.id);
  for (let i = 0; i < 80 && !room.bomb.planted; i++) room.updateBomb(clock.advance(50));
  assert.ok(room.bomb.planted);
  assert.equal(red.inbox.find((m) => m.t === "planted").site, "A");
  assert.equal(blue.inbox.find((m) => m.t === "planted").site, undefined);
  room.sendSnapshots(clock.now());
  const seen = blue.inbox.at(-1);
  const ally = red.inbox.at(-1);
  assert.equal(seen.round.ends, null);
  assert.equal(ally.round.ends, null);
  assert.equal(seen.bomb.planted.site, undefined);
  assert.equal(seen.bomb.planted.x, undefined, "position hidden until spotted");
  assert.equal(seen.bomb.planted.explodeAt, undefined);
  assert.equal(ally.bomb.planted.explodeAt, undefined);
  assert.equal(ally.bomb.planted.site, "A");
  // Once a defender has eyes on it the position is shared with the whole team (still no site).
  const defender = room.playersOn("defend")[0];
  defender.body = createBody(attacker.body.x + 2, attacker.body.z);
  room.sendSnapshots(clock.advance(50));
  assert.ok(Number.isFinite(blue.inbox.at(-1).bomb.planted.x));
  assert.equal(blue.inbox.at(-1).bomb.planted.site, undefined);
});

test("any weapon but the knife can be dropped and picked up by an empty slot", () => {
  const { room, clock, attacker, defender } = humanRoom();
  room.round.phase = "live";
  room.switchWeapon(attacker, "knife", true);
  room.dropWeapon(attacker);
  assert.equal(attacker.weapon, "knife", "the knife stays");
  room.switchWeapon(attacker, "rifle", true);
  attacker.ammo.rifle.mag = 7;
  room.dropWeapon(attacker);
  assert.equal(attacker.ammo.rifle, undefined);
  assert.equal(attacker.weapon, "pistol");
  assert.equal(room.ground.length, 1);
  const gun = room.ground[0];
  room.updateGround(clock.now());
  assert.equal(room.ground.length, 1, "the dropper can't grab it straight back");
  // An enemy who already has a rifle walks over it: nothing happens. Without one, they take it.
  defender.body = createBody(gun.x, gun.z);
  room.updateGround(clock.advance(100));
  assert.equal(room.ground.length, 1);
  delete defender.ammo.rifle;
  defender.slots.primary = null;
  room.updateGround(clock.advance(100));
  assert.equal(room.ground.length, 0);
  assert.equal(defender.ammo.rifle.mag, 7, "ammo travels with the gun");
  // Dying drops your best gun.
  room.damage(attacker, defender, 200, "body");
  assert.equal(room.ground.at(-1).w, "rifle");
});

test("weight: the knife runs a bit faster than a rifle", () => {
  const map = { ...MAPS.pantai, grid: MAPS.pantai.grid.map((r) => r.replace(/[#=]/g, ".")) };
  const run = (weapon) => {
    const body = createBody(12.5 * CELL, 18.5 * CELL, 0);
    for (let i = 0; i < 15; i++) step(map, body, KEY.FORWARD, 0, 0, 1 / 30, { speed: WEAPONS[weapon].speed });
    return 18.5 * CELL - body.z;
  };
  const rifle = run("rifle");
  const knife = run("knife");
  assert.ok(knife > rifle * 1.18 && knife < rifle * 1.32, `${knife} vs ${rifle}`);
  assert.ok(run("pistol") > rifle);
});

test("bullets drop over distance", () => {
  const map = MAPS.pantai;
  const origin = { x: 12.5 * CELL, y: 1.6, z: 24 * CELL };
  const shot = traceShot(map, origin, aimDirection(0, 0), { speed: 320, range: 60 });
  assert.ok(shot.points.length > 3);
  assert.ok(shot.end.y < origin.y, "lower at the end than at the muzzle");
  const far = traceShot({ ...map, grid: map.grid.map((r) => r.replace(/[#=]/g, ".")) }, origin, aimDirection(0, 0), { speed: 320, range: 90 });
  const drop = origin.y - far.end.y;
  assert.ok(drop > 0.2 && drop < 0.6, `drop ${drop}`);
});

test("kill streaks, ace and clutch are reported", () => {
  const { room, clock, attacker, red } = humanRoom();
  room.round.phase = "live";
  const enemies = room.playersOn("defend");
  enemies.forEach((e, i) => {
    clock.advance(i === 3 ? 20_000 : 1000);
    room.damage(attacker, e, 200, "body");
  });
  const kills = red.inbox.filter((m) => m.t === "kill");
  assert.deepEqual(kills.map((k) => k.streak), [1, 2, 3, 4, 5], "counted per round, however far apart");
  assert.equal(kills.at(-1).ace, true);
  assert.equal(kills.filter((k) => k.ace).length, 1);

  // Clutch: last attacker alive against three, then wins the round.
  const next = humanRoom();
  next.room.round.phase = "live";
  const [, ...mates] = next.room.playersOn("attack");
  const foes = next.room.playersOn("defend");
  for (const m of mates) next.room.damage(foes[0], m, 200, "body");
  for (const f of foes.slice(0, 2)) next.room.damage(next.attacker, f, 200, "body");
  for (const f of foes.slice(2)) next.room.damage(next.attacker, f, 200, "body");
  next.room.updateBomb(next.clock.now());
  const end = next.red.inbox.find((m) => m.t === "round_end");
  assert.deepEqual(end.clutch, { id: next.attacker.id, vs: 5 });
});

test("assists go to the two teammates who did the most damage", () => {
  const { room, red } = humanRoom();
  room.round.phase = "live";
  const [killer, a, b, c] = room.playersOn("attack");
  const victim = room.playersOn("defend")[0];
  room.damage(c, victim, 10, "body");
  room.damage(a, victim, 40, "body");
  room.damage(b, victim, 25, "body");
  room.damage(killer, victim, 100, "body");
  const kill = red.inbox.find((m) => m.t === "kill");
  assert.deepEqual(kill.assists, [a.id, b.id]);
  assert.equal(a.assists, 1);
  assert.equal(c.assists, 0);
  assert.equal(room.roster().find((p) => p.id === b.id).assists, 1);
});

test("sides swap every few rounds and match point is announced", () => {
  const { room, red } = humanRoom();
  const sides = [1, 5, 6, 10, 11].map((n) => room.sideOf("red", n));
  assert.deepEqual(sides, ["attack", "attack", "defend", "defend", "attack"]);
  room.score = { red: 9, blue: 2 };
  for (let n = 1; n < 6; n++) room.startRound();
  const rounds = red.inbox.filter((m) => m.t === "round");
  assert.equal(rounds.at(-1).n, 6);
  assert.equal(rounds.at(-1).swap, true);
  assert.deepEqual(rounds.at(-1).matchPoint, ["red"]);
  assert.equal(rounds.find((m) => m.n === 3).swap, false);
});

test("hero select: unique per team, bots give way, hidden from the enemy, 20 s limit", () => {
  let t = 1_000_000;
  const sockets = [fakeSocket(), fakeSocket()];
  const room = new Room({
    mapId: "pantai",
    clock: () => t,
    rng: () => 0.3,
    autoTick: false,
    heroPick: true,
    humans: [
      { userId: 1, name: "Me", skin: "classic", socket: sockets[0] },
      { userId: 2, name: "Them", skin: "classic", socket: sockets[1] },
    ],
  });
  const me = room.playerOf(1);
  assert.equal(room.round.phase, "pick");
  // Bots hover and lock within a few seconds.
  for (let i = 0; i < 100; i++) {
    t += 50;
    room.tick();
  }
  const bots = room.teammates(me.team).filter((p) => p.bot);
  assert.ok(bots.every((b) => b.locked), "bots locked");
  // Taking a bot's hero makes that bot switch.
  const victim = bots[0];
  const wanted = victim.hero;
  room.heroAction(me, { action: "lock", id: wanted });
  assert.equal(me.hero, wanted);
  assert.notEqual(victim.hero, wanted);
  assert.notEqual(victim.hover, wanted);
  // Enemy picks never reach this team.
  const pick = sockets[0].inbox.filter((m) => m.t === "pick").at(-1);
  assert.ok(pick.team.every((q) => room.players.get(q.id).team === me.team));
  assert.ok(room.welcome(me).players.filter((q) => q.team !== me.team).every((q) => q.hero === null));
  // Unlock and relock work; time runs out at 20 s and everyone ends up with a distinct hero.
  room.heroAction(me, { action: "unlock" });
  assert.equal(me.locked, false);
  t += 21_000;
  room.tick();
  assert.equal(room.round.phase, "buy");
  for (const team of ["red", "blue"]) {
    const heroes = room.teammates(team).map((p) => p.hero);
    assert.equal(new Set(heroes).size, heroes.length, `${team} heroes are unique`);
    assert.ok(heroes.every(Boolean));
  }
  assert.ok(sockets[1].inbox.some((m) => m.t === "pick_done"));
});

// Open plaza on pantai: viewer at (12.5, 18.5) cells, enemy 6 cells north (see the vision test).
function abilityRoom() {
  const env = humanRoom();
  const { room, attacker, defender } = env;
  room.round.phase = "live";
  for (const p of room.players.values()) if (p !== attacker && p !== defender) p.alive = false;
  attacker.body = createBody(12.5 * CELL, 18.5 * CELL, 0);
  defender.body = createBody(12.5 * CELL, 14.5 * CELL, Math.PI);
  return env;
}
const run = (env, ms) => {
  for (let i = 0; i < ms / 50; i++) env.room.abilities.tick(env.clock.advance(50), 0.05);
};

test("every skill and ultimate goes off without errors", () => {
  const { HEROES } = { HEROES: heroList };
  for (const hero of HEROES) {
    for (const slot of ["skill", "ult"]) {
      const env = abilityRoom();
      const { room, attacker, defender } = env;
      attacker.hero = hero.id;
      attacker.abil.ult = 100;
      if (hero.ult.id === "revive") room.abilities.fallen.push({ id: room.playersOn("attack")[1].id, team: attacker.team, at: 0 });
      // Laptop abilities take map points; the spot between the two players is open beach.
      const points = [{ x: attacker.body.x, z: attacker.body.z - 6 }];
      const used = room.abilities.use(attacker, slot, { y: 0, p: -0.05, points });
      // Abilities that need someone under the crosshair simply don't fire without a target.
      const needsTarget = ["stun", "leap", "revive"].includes(slot === "skill" ? hero.skill.id : hero.ult.id);
      assert.ok(used || needsTarget, `${hero.id} ${slot}`);
      assert.doesNotThrow(() => run(env, 4000), `${hero.id} ${slot} ticks`);
      assert.ok(defender.hp <= 100);
    }
  }
});

test("abilities: smoke hides, walls block, shields soak, grenades hurt, pulls drag", () => {
  let env = abilityRoom();
  assert.deepEqual(env.room.computeVision().red, [env.defender.id]);
  env.attacker.hero = "kabut";
  const mid = { x: env.attacker.body.x, z: (env.attacker.body.z + env.defender.body.z) / 2 };
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: -0.1, points: [mid] });
  assert.deepEqual(env.room.computeVision().red, [], "smoke blocks sight");
  // One smoke only: half the cooldown.
  assert.equal(env.attacker.abil.cdUntil - env.room.clock(), 13_000);

  env = abilityRoom();
  env.attacker.hero = "pagar";
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: -0.1 });
  assert.equal(env.room.map.blocks.length, 1, "wall raised");
  assert.ok(!lineOfSightTest(env.room, env.attacker, env.defender), "wall blocks the line");
  const wall = env.room.abilities.effects.find((e) => e.type === "wall");
  run(env, 20_000);
  assert.ok(env.room.abilities.effects.includes(wall), "stands until broken");
  const wallMid = blockMid(wall.block);
  env.room.abilities.hitBlockAt(wallMid, 500, env.attacker.team);
  run(env, 100);
  assert.ok(env.room.abilities.effects.includes(wall), "teammates can't break it");
  env.attacker.abil.cdUntil = 0;
  env.room.abilities.use(env.attacker, "skill", { y: Math.PI / 2, p: -0.1 });
  assert.equal(env.room.abilities.effects.filter((e) => e.type === "wall").length, 1, "a new wall replaces the old");
  assert.ok(!env.room.abilities.effects.includes(wall));
  const second = env.room.abilities.effects.find((e) => e.type === "wall");
  env.room.abilities.hitBlockAt(blockMid(second.block), 500, env.defender.team);
  run(env, 100);
  assert.equal(env.room.map.blocks.length, 0, "enemies break it");

  env = abilityRoom();
  env.defender.abil.shield = 40;
  env.defender.abil.shieldUntil = Infinity;
  env.room.damage(env.attacker, env.defender, 50, "body");
  assert.equal(env.defender.hp, 90, "shield soaked 40");

  env = abilityRoom();
  env.attacker.hero = "petasan";
  env.defender.body = createBody(env.attacker.body.x, env.attacker.body.z - 11, 0);
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: -0.3 });
  run(env, 2500);
  assert.ok(env.defender.hp < 100, "grenade hurt");

  env = abilityRoom();
  env.attacker.hero = "magnet";
  // The baton has to actually be aimed: thrown wide, it misses.
  env.room.abilities.use(env.attacker, "skill", { y: 0.4, p: Math.atan2(1.2 - 1.6, 12) });
  run(env, 900);
  assert.ok(!env.room.abilities.stunned(env.defender), "a wide throw misses");
  env.attacker.abil.cdUntil = 0;
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: Math.atan2(1.2 - 1.6, 12) });
  assert.ok(!env.room.abilities.stunned(env.defender), "not instant: it has to fly there");
  run(env, 500);
  assert.ok(env.room.abilities.stunned(env.defender), "Magnet's baton stuns");
  assert.equal(env.room.abilities.speedFactor(env.defender), 0);

  env = abilityRoom();
  env.attacker.hero = "radar";
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: 0 });
  assert.ok(env.defender.abil.revealUntil > env.room.clock(), "scan reveals");

  env = abilityRoom();
  env.defender.hero = "dash";
  env.defender.abil.ult = 100;
  env.room.abilities.use(env.defender, "ult", { y: 0, p: 0 });
  assert.deepEqual(env.room.computeVision().red, [], "stealth hides at range");
});

test("electric dome stuns and burns enemies inside; laser warns before it fires", () => {
  let env = abilityRoom();
  env.attacker.hero = "pagar";
  env.attacker.abil.ult = 100;
  env.defender.body = createBody(env.attacker.body.x, env.attacker.body.z - 5, 0);
  env.room.abilities.use(env.attacker, "ult", { y: 0, p: -0.5 });
  const dome = env.room.abilities.effects.find((e) => e.type === "dome");
  env.defender.body = createBody(dome.x, dome.z, 0);
  run(env, 100);
  assert.ok(env.room.abilities.stunned(env.defender), "stunned on entry");
  run(env, 2000);
  assert.ok(env.defender.hp <= 62 && env.defender.hp >= 55, `burned ~40, hp ${env.defender.hp}`);

  env = abilityRoom();
  env.attacker.hero = "kabut";
  env.attacker.abil.ult = 100;
  const sockets = env.red;
  env.room.abilities.use(env.attacker, "ult", { y: 0, p: 0, points: [{ x: env.defender.body.x, z: env.defender.body.z }] });
  assert.ok(env.blue.inbox.some((m) => m.t === "laser_warn"), "enemies are warned");
  run(env, 4000);
  assert.equal(env.defender.hp, 100, "nothing before it arms");
  run(env, 1500);
  assert.ok(env.defender.hp < 100, "lasers hurt once armed");
  assert.ok(sockets);
});

test("Kafein steadies aim; scout drones reveal and can be shot down", () => {
  let env = abilityRoom();
  env.attacker.hero = "kopi";
  env.attacker.abil.ult = 100;
  env.room.abilities.use(env.attacker, "ult", { y: 0, p: 0 });
  assert.ok(env.room.abilities.focused(env.attacker));
  assert.ok(env.room.abilities.speedFactor(env.attacker) > 1.2);

  env = abilityRoom();
  env.attacker.hero = "lebah";
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: 0 });
  const scouts = env.room.abilities.effects.filter((e) => e.type === "scout");
  assert.equal(scouts.length, 1);
  run(env, 1000);
  assert.ok(env.defender.abil.revealUntil > env.room.clock(), "revealed by the scout");
  assert.ok(scouts[0].y > 4, "flies above the walls");
  assert.equal(scouts[0].track, env.defender.id, "locked on");
  // It shadows the enemy as they move.
  env.defender.body.x += 4;
  run(env, 1500);
  assert.ok(Math.hypot(scouts[0].x - env.defender.body.x, scouts[0].z - env.defender.body.z) < 3, "follows");
  assert.ok(env.defender.abil.revealUntil > env.room.clock());
  // The defender shoots it down.
  const target = scouts[0];
  const d = { x: target.x - env.defender.body.x, y: target.y - 1.6, z: target.z - env.defender.body.z };
  const len = Math.hypot(d.x, d.y, d.z);
  const hit = env.room.abilities.droneHit({ x: env.defender.body.x, y: 1.6, z: env.defender.body.z }, { x: d.x / len, y: d.y / len, z: d.z / len }, 50, env.defender.team);
  assert.equal(hit?.drone, target);
});

test("healing only ever adds whole hit points", () => {
  const env = abilityRoom();
  env.attacker.hero = "jamu";
  env.attacker.hp = 40;
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: -1.5 });
  for (let i = 0; i < 40; i++) {
    run(env, 50);
    assert.ok(Number.isInteger(env.attacker.hp), `hp ${env.attacker.hp}`);
  }
  assert.ok(env.attacker.hp > 60);
});

test("bots walk into smoke after an enemy (no spraying), see up close inside it, and hunt a defuser", () => {
  const env = humanRoom();
  const { room } = env;
  room.round.phase = "live";
  room.round.ends = env.clock.now() + 60_000;
  const bot = room.playersOn("attack").find((p) => p.bot);
  const enemy = room.playersOn("defend").find((p) => p.bot);
  for (const p of room.players.values()) if (p !== bot && p !== enemy) p.alive = false;
  bot.brain ??= createBrain(Math.random);
  bot.body = createBody(12.5 * CELL, 18.5 * CELL, 0);
  enemy.body = createBody(12.5 * CELL, 14.5 * CELL, Math.PI);
  // Enemy vanished into a smoke between them a moment ago.
  room.abilities.add({ type: "smoke", team: enemy.team, x: enemy.body.x, y: 1.6, z: enemy.body.z + 4, r: 4.2, until: Infinity });
  bot.brain.lastSeen = { id: enemy.id, x: enemy.body.x, z: enemy.body.z, at: env.clock.now() };
  bot.body.yaw = 0;
  bot.lastShotAt = 0;
  bot.brain.smokeCall = { key: `${enemy.id}:${Math.round(enemy.body.x)}:${Math.round(enemy.body.z)}`, style: "enter", until: Infinity };
  const out = think(room, bot, env.clock.now());
  assert.ok(!out.fire, "no blind spraying");
  assert.ok(out.keys & KEY.FORWARD, "walks into the smoke after them");
  // At the spot with nobody found, it gives up the chase.
  const saved = { ...bot.body };
  const enemyAt = { ...enemy.body };
  enemy.body = createBody(3.5 * CELL, 3.5 * CELL, 0);
  bot.brain.lastSeen = { id: enemy.id, x: bot.body.x, z: bot.body.z - 0.5, at: env.clock.now() };
  think(room, bot, env.clock.advance(50));
  assert.equal(bot.brain.lastSeen, null, "leaves when the smoke is empty");
  bot.body = saved;
  enemy.body = enemyAt;

  // The edge style pushes toward the smoke briefly, then carries on with its plan.
  const cloud = room.abilities.effects[0];
  bot.body = createBody(cloud.x, cloud.z + cloud.r + 4, 0);
  const far = { x: cloud.x, z: cloud.z - 1 };
  enemy.body = createBody(3.5 * CELL, 3.5 * CELL, 0);
  bot.brain.lastSeen = { id: enemy.id, x: far.x, z: far.z, at: env.clock.now() };
  bot.brain.smokeCall = { key: `${enemy.id}:${Math.round(far.x)}:${Math.round(far.z)}`, style: "edge", until: env.clock.now() + 800 };
  bot.brain.target = null;
  const push = think(room, bot, env.clock.advance(50));
  assert.ok(push.keys & KEY.FORWARD, "pushes up toward the smoke");
  for (let i = 0; i < 20; i++) think(room, bot, env.clock.advance(50));
  assert.equal(bot.brain.smokeCall.style, "ignore", "then moves on without waiting");
  enemy.body = enemyAt;

  // Inside the enemy's smoke it's thick, but someone right next to you still shows.
  enemy.body = createBody(12.5 * CELL, 18.5 * CELL - 2, Math.PI);
  room.abilities.effects[0].z = enemy.body.z;
  room.abilities.effects[0].x = enemy.body.x;
  bot.brain.target = null;
  think(room, bot, env.clock.advance(50));
  assert.equal(bot.brain.target, enemy.id, "sees the enemy in the smoke up close");

  // A defuse pulls attackers toward the defuser.
  enemy.body = createBody(3.5 * CELL, 3.5 * CELL, 0);
  room.abilities.effects = [];
  room.bomb.planted = { x: enemy.body.x, z: enemy.body.z, site: "A", explodeAt: Infinity };
  room.bomb.defuseStart = { id: enemy.id, at: env.clock.now() };
  bot.brain.target = null;
  bot.brain.lastSeen = null;
  bot.brain.hurtBy = null;
  think(room, bot, env.clock.advance(50));
  assert.match(bot.brain.goal?.key ?? "", /^stop-defuse/);
});

test("smoke sight rules: thick outside, clear inside your own, hazy out of it, thick in the enemy's", () => {
  const smoke = [{ x: 0, y: 1.6, z: 0, r: 4, team: "red" }];
  const inside = { x: 0, y: 1.6, z: 0 };
  const alsoInside = { x: 3, y: 1.6, z: 1 };
  const nearOut = { x: 0, y: 1.6, z: 8 };
  const farOut = { x: 0, y: 1.6, z: 20 };
  // From outside, nobody sees in.
  assert.ok(smokeBlocks(smoke, "red", farOut, inside));
  assert.ok(smokeBlocks(smoke, "blue", farOut, inside));
  // Own smoke: clear inside, hazy out (close yes, far no).
  assert.ok(!smokeBlocks(smoke, "red", inside, alsoInside));
  assert.ok(!smokeBlocks(smoke, "red", inside, { x: 0, y: 1.6, z: 5.5 }));
  assert.ok(smokeBlocks(smoke, "red", inside, farOut));
  // Enemy smoke: only what's right beside you.
  assert.ok(!smokeBlocks(smoke, "blue", inside, { x: 1.5, y: 1.6, z: 0 }));
  assert.ok(smokeBlocks(smoke, "blue", inside, alsoInside));
  assert.ok(smokeBlocks(smoke, "blue", inside, nearOut));
});

function economyRoom(extra = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const room = new Room({ mapId: "pantai", clock: clock.now, rng: () => 0.99, autoTick: false, economy: true, humans: [{ userId: 1, name: "A", skin: "c", socket: fakeSocket() }, { userId: 2, name: "B", skin: "c", socket: fakeSocket() }], ...extra });
  return { room, clock, me: room.playerOf(1), foe: room.playerOf(2) };
}

test("economy: pistol start, buy and sell in the buy phase, round pay and loss streak", () => {
  const { room, clock, me, foe } = economyRoom();
  assert.equal(me.credits, 800);
  assert.deepEqual(me.slots, { primary: null, secondary: "pistol" });
  room.buy(me, "sabit");
  assert.equal(me.slots.secondary, "sabit");
  assert.equal(me.credits, 0);
  room.sell(me, "sabit");
  assert.equal(me.credits, 800);
  assert.equal(me.slots.secondary, "pistol");
  room.buy(me, "rifle");
  assert.equal(me.slots.primary, null, "can't afford a rifle");
  room.buy(me, "light");
  assert.equal(me.armor, 25);
  // Shop closes once the round is live.
  room.round.phase = "live";
  room.buy(me, "rentet");
  assert.equal(me.slots.secondary, "pistol");
  // Kill pay, then round pay with a loss bonus for the other side.
  room.damage(me, foe, 200, "body");
  assert.equal(me.credits, 400 + 200);
  room.endRound(room.sideOf(me.team), "elimination");
  assert.equal(me.credits, 600 + 3000);
  assert.equal(foe.credits, 800 + 1900);
  // Armor soaks two thirds of a hit.
  const env = economyRoom();
  env.room.round.phase = "live";
  env.me.armor = 50;
  env.room.damage(env.foe, env.me, 30, "body");
  assert.equal(env.me.hp, 90);
  assert.equal(env.me.armor, 30);
  // Survivors keep their guns next round; the fallen restart with the pistol.
  const next = economyRoom();
  next.me.credits = 5000;
  next.room.buy(next.me, "rifle");
  next.room.round.phase = "live";
  next.room.damage(next.me, next.foe, 200, "body");
  next.room.endRound(next.room.sideOf(next.me.team), "elimination");
  next.room.startRound();
  assert.equal(next.me.slots.primary, "rifle");
  // The client's shop reads credits and this round's purchases from every snapshot.
  next.room.sendSnapshots(next.clock.now());
  const snap = next.me.socket.inbox.filter((m) => m.t === "snap").at(-1);
  assert.equal(snap.me.cr, next.me.credits);
  assert.ok(snap.me.cr > 4000, `round pay shows up (${snap.me.cr})`);
  assert.deepEqual(snap.me.pu, [], "last round's purchases can't be sold back");
  assert.equal(next.foe.slots.primary, null);
  assert.equal(next.foe.slots.secondary, "pistol");
  assert.ok(clock);
});

test("shotguns fire a spread of pellets and add the damage up", () => {
  const env = abilityRoom();
  env.attacker.slots.primary = "gledek";
  env.attacker.ammo.gledek = { mag: 5, reserve: 20 };
  env.attacker.weapon = "gledek";
  env.defender.body = createBody(env.attacker.body.x, env.attacker.body.z - 4, 0);
  env.room.fire(env.attacker, 0, Math.atan2(1.2 - 1.6, 4));
  const shot = env.red.inbox.filter((m) => m.t === "shot").at(-1);
  assert.equal(shot.paths.length, 12);
  assert.ok(env.defender.hp < 100 - 17 * 2, `several pellets hit (hp ${env.defender.hp})`);
});

test("team deathmatch: kills score, the fallen respawn, first to the target wins", () => {
  let t = 1_000_000;
  let result = null;
  const room = new Room({ mapId: "pantai", clock: () => t, rng: () => 0.5, autoTick: false, mode: "tdm", onEnd: (r, res) => (result = res), humans: [{ userId: 1, name: "A", skin: "c", socket: fakeSocket() }] });
  const me = room.playerOf(1);
  const foe = room.playersOn("defend")[0];
  assert.equal(me.slots.primary, "rifle");
  room.round.phase = "live";
  room.round.ends = t + 60_000;
  room.damage(me, foe, 200, "body");
  assert.equal(room.score[me.team], 1);
  assert.equal(foe.alive, false);
  t += 3100;
  room.tick();
  assert.equal(foe.alive, true, "respawned");
  assert.ok(room.clock() < foe.protectUntil, "spawn protection");
  room.damage(me, foe, 200, "body");
  assert.equal(foe.alive, true, "protected right after spawning");
  // Loadout choice is free and used from the next spawn.
  room.buy(me, "elang");
  assert.equal(me.loadout.primary, "elang");
  room.score[me.team] = 39;
  foe.protectUntil = 0;
  room.damage(me, foe, 200, "body");
  assert.ok(room.over);
  assert.ok(result);
});

test("sniper: two zoom levels, one round per shot and the scope comes back after the bolt", () => {
  const env = abilityRoom();
  const p = env.attacker;
  p.slots.primary = "elang";
  p.ammo.elang = { mag: 1, reserve: 15 };
  p.weapon = "elang";
  env.room.setScope(p, { level: 1 });
  assert.equal(p.scoped, 1);
  env.room.setScope(p, { level: 2 });
  assert.equal(p.scoped, 2);
  env.room.setScope(p, { level: 3 });
  assert.equal(p.scoped, 2, "only two zoom levels");
  env.room.fire(p, 0, 0);
  assert.equal(p.ammo.elang.mag, 0);
  assert.ok(p.reloadUntil > 0, "bolt starts right after the shot");
  assert.equal(p.scoped, 0);
  env.clock.advance(1600);
  env.room.completeReload(p);
  assert.deepEqual(p.ammo.elang, { mag: 1, reserve: 14 }, "1 / 14 after one shot");
  assert.equal(p.scoped, 2, "back on the same zoom");
});

test("Tombak fires a three-round burst per click", () => {
  const env = abilityRoom();
  const p = env.attacker;
  p.slots.primary = "tombak";
  p.ammo.tombak = { mag: 24, reserve: 72 };
  p.weapon = "tombak";
  p.nextShot = 0;
  env.room.fire(p, Math.PI, 0);
  assert.equal(p.ammo.tombak.mag, 23);
  // A second click mid-burst does nothing.
  env.room.fire(p, Math.PI, 0);
  assert.equal(p.ammo.tombak.mag, 23);
  for (let i = 0; i < 4; i++) {
    env.clock.advance(50);
    env.room.tick();
  }
  assert.equal(p.ammo.tombak.mag, 21, "the other two rounds followed");
  const shots = env.red.inbox.filter((m) => m.t === "shot" && m.id === p.id);
  assert.equal(shots.length, 3);
});

test("Jamu revives the body you aim at, where it fell", () => {
  const env = abilityRoom();
  const { room, attacker } = env;
  const mate = room.playersOn("attack").find((p) => p !== attacker);
  mate.alive = true;
  mate.body = createBody(attacker.body.x, attacker.body.z - 8, 0);
  room.damage(env.defender, mate, 200, "body");
  assert.equal(mate.alive, false);
  attacker.hero = "jamu";
  attacker.abil.ult = 100;
  // Aiming at an empty spot does nothing (and keeps the ultimate).
  assert.equal(room.abilities.use(attacker, "ult", { y: Math.PI / 2, p: 0 }), false);
  assert.equal(attacker.abil.ult, 100);
  const pitch = Math.atan2(0.3 - 1.6, 8);
  assert.ok(room.abilities.use(attacker, "ult", { y: 0, p: pitch }));
  assert.equal(mate.alive, true);
  assert.ok(Math.hypot(mate.body.x - attacker.body.x, mate.body.z - (attacker.body.z - 8)) < 1.3, "back up where they fell");
  assert.equal(mate.hp, 60);
});

test("Tameng: the shield moves where you aim; the leap raises a fence allies can walk through", () => {
  const env = abilityRoom();
  const { room, attacker } = env;
  attacker.hero = "tameng";
  room.abilities.use(attacker, "skill", { y: 0, p: -0.1 });
  const shield = room.abilities.ownShield(attacker);
  assert.ok(shield);
  const cd = attacker.abil.cdUntil;
  const before = (shield.block.x0 + shield.block.x1) / 2;
  // Sending it sideways is free while it's up.
  assert.ok(room.abilities.use(attacker, "skill", { y: Math.PI / 2, p: -0.1 }));
  assert.equal(attacker.abil.cdUntil, cd);
  run(env, 1000);
  assert.ok((shield.block.x0 + shield.block.x1) / 2 < before - 1, "slid toward the new aim");
  run(env, 3500);
  assert.equal(room.abilities.ownShield(attacker), undefined, "gone after 4 s");

  // Leap to a teammate, then a fence: enemies collide with it, allies don't.
  const mate = room.playersOn("attack").find((p) => p !== attacker);
  mate.alive = true;
  mate.body = createBody(attacker.body.x, attacker.body.z - 10, 0);
  attacker.abil.ult = 100;
  assert.ok(room.abilities.use(attacker, "ult", { y: 0, p: Math.atan2(1.2 - 1.6, 10) }));
  assert.ok(attacker.body.dashT > 0, "leaping");
  run(env, 1200);
  const fence = room.abilities.effects.find((e) => e.type === "fence");
  assert.ok(fence);
  const cx = (fence.block.x0 + fence.block.x1) / 2;
  const cz = (fence.block.z0 + fence.block.z1) / 2;
  assert.ok(collides(room.map, cx, cz, 0.35, env.defender.team), "blocks the enemy");
  assert.ok(!collides(room.map, cx, cz, 0.35, attacker.team), "lets allies through");
});

test("Kabut's laser bogs enemies down; Petasan's grenade is quicker and harder", () => {
  let env = abilityRoom();
  env.attacker.hero = "kabut";
  env.attacker.abil.ult = 100;
  env.room.abilities.use(env.attacker, "ult", { y: 0, p: 0, points: [{ x: env.defender.body.x, z: env.defender.body.z }] });
  run(env, 4600);
  assert.ok(env.room.abilities.speedFactor(env.defender) <= 0.4, "slowed in the zone");
  const hp = env.defender.hp;
  run(env, 1000);
  assert.ok(hp - env.defender.hp >= 35 && hp - env.defender.hp <= 45, `about 40 a second (${hp - env.defender.hp})`);

  env = abilityRoom();
  env.attacker.hero = "petasan";
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: -0.3 });
  run(env, 1050);
  assert.equal(env.room.abilities.effects.filter((e) => e.type === "grenade").length, 0, "went off within about a second");
});

test("Magnet's vortex drags, then only lightly slows", () => {
  const env = abilityRoom();
  env.attacker.hero = "magnet";
  env.attacker.abil.ult = 100;
  env.room.abilities.use(env.attacker, "ult", { y: 0, p: Math.atan2(-1.6, env.attacker.body.z - env.defender.body.z) });
  const vortex = env.room.abilities.effects.find((e) => e.type === "vortex");
  env.defender.body = createBody(vortex.x + 3, vortex.z, 0);
  run(env, 300);
  assert.equal(env.room.abilities.speedFactor(env.defender), 0.75);
  run(env, 4200);
  assert.equal(env.room.abilities.speedFactor(env.defender), 1, "worn off");
});

const blockMid = (b) => ({ x: (b.x0 + b.x1) / 2, y: 1, z: (b.z0 + b.z1) / 2 });

function lineOfSightTest(room, a, b) {
  return rayWorld(room.map, { x: a.body.x, y: 1.6, z: a.body.z }, { x: 0, y: 0, z: -1 }, a.body.z - b.body.z) >= a.body.z - b.body.z - 0.05;
}

test("chat goes to the team or to everyone", () => {
  const { room, clock, attacker, red, blue } = humanRoom();
  room.chat(attacker, { text: "  rush B  ", all: false });
  assert.equal(red.inbox.at(-1).text, "rush B");
  assert.ok(!blue.inbox.some((m) => m.t === "chat"));
  room.chat(attacker, { text: "gg", all: true });
  assert.ok(!red.inbox.some((m) => m.text === "gg"), "rate limited");
  clock.advance(600);
  room.chat(attacker, { text: "x".repeat(500), all: true });
  assert.equal(blue.inbox.at(-1).text.length, 120);
  assert.equal(blue.inbox.at(-1).all, true);
});

// ---------- over the network ----------

const PORT = 6000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), "jm-fps-"));
let proc;

before(async () => {
  proc = spawn(process.execPath, ["server/server.js"], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(dir, "fps.db"), JWT_SECRET: "z".repeat(48), NODE_ENV: "test", FPS_FILL_WAIT_MS: "300" },
    stdio: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});

after(async () => {
  if (proc && proc.exitCode === null) {
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await exited;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

function openSocket(headers) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/fps`, { headers });
  const inbox = [];
  const waiters = [];
  ws.on("message", (raw) => {
    inbox.push(JSON.parse(raw));
    waiters.splice(0).forEach((w) => w());
  });
  ws.next = (type, timeoutMs = 4000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${type}`)), timeoutMs);
      const check = () => {
        const i = inbox.findIndex((m) => m.t === type);
        if (i < 0) return waiters.push(check);
        clearTimeout(timer);
        resolve(inbox.splice(i, 1)[0]);
      };
      check();
    });
  return ws;
}

test("socket needs a login and the site's origin", async () => {
  const refused = new WebSocket(`ws://127.0.0.1:${PORT}/ws/fps`);
  await new Promise((resolve) => refused.on("error", resolve));
  const res = await fetch(`${BASE}/api/auth/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Spy" }) });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const foreign = new WebSocket(`ws://127.0.0.1:${PORT}/ws/fps`, { headers: { Cookie: cookie, Origin: "https://evil.example" } });
  await new Promise((resolve) => foreign.on("error", resolve));
});

test("solo queue fills with bots and the match streams snapshots", async () => {
  const res = await fetch(`${BASE}/api/auth/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Jokoman" }) });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const ws = openSocket({ Cookie: cookie, Origin: BASE });
  await ws.next("hello");
  ws.send(JSON.stringify({ t: "queue" }));
  const welcome = await ws.next("welcome");
  assert.equal(welcome.players.length, 10);
  assert.equal(welcome.players.filter((p) => !p.bot).length, 1);
  assert.ok(MAP_IDS.includes(welcome.map));

  // Matches open with hero select; only our own team is listed.
  assert.equal(welcome.phase, "pick");
  const pick = await ws.next("pick");
  assert.equal(pick.team.length, 5);
  const snap = await ws.next("snap");
  assert.equal(snap.ps.length, 9);
  assert.equal(snap.round.phase, "pick");
  for (let s = 1; s <= 5; s++) ws.send(JSON.stringify({ t: "in", s, k: KEY.FORWARD, y: 0, p: 0, d: 33 }));
  await new Promise((r) => setTimeout(r, 200));
  const later = await ws.next("snap");
  assert.ok(later.ack >= 1);
  ws.send(JSON.stringify({ t: "leave" }));
  await ws.next("left");
  ws.close();
});

test("bots go around ability walls, and shoot down an enemy wall that seals the way", () => {
  // A small room with a pillar: a wall in the lower lane leaves the upper lane open.
  const open = { width: 7, height: 5, grid: ["#######", "#.....#", "#.#.#.#", "#.....#", "#######"].map((r) => r.split("")) };
  const wallIn = (map, cx, cz, team, pass = null) => ({ block: { x0: cx * CELL, x1: (cx + 1) * CELL, z0: cz * CELL + 1.3, z1: cz * CELL + 1.7, h: 3, pass }, team });
  const bot = { team: "red", body: createBody(1.5 * CELL, 3.5 * CELL, 0) };
  let room = { map: open, abilities: { effects: [wallIn(open, 3, 3, "blue")] } };
  let plan = planPath(room, bot, { x: 1, z: 3 }, { x: 5, z: 3 });
  assert.equal(plan.breach, false);
  assert.ok(!plan.path.some((c) => toCell(c.x) === 3 && toCell(c.z) === 3), "detours through the other lane");
  // A team's own fence doesn't count as a wall for it.
  room = { map: open, abilities: { effects: [wallIn(open, 3, 3, "red", "red")] } };
  assert.ok(planPath(room, bot, { x: 1, z: 3 }, { x: 5, z: 3 }).path.some((c) => toCell(c.x) === 3 && toCell(c.z) === 3));

  // A single corridor sealed by an enemy wall: break it.
  const corridor = { width: 7, height: 3, grid: ["#######", "#.....#", "#######"].map((r) => r.split("")) };
  const seal = { block: { x0: 3 * CELL + 1.3, x1: 3 * CELL + 1.7, z0: CELL, z1: 2 * CELL, h: 3 }, team: "blue" };
  room = { map: corridor, abilities: { effects: [seal] } };
  const runner = { team: "red", body: createBody(2.5 * CELL, 1.5 * CELL, 0) };
  plan = planPath(room, runner, { x: 1, z: 1 }, { x: 5, z: 1 });
  assert.equal(plan.breach, true);
  assert.ok(plan.path.length > 0);
  const ahead = wallAhead(room, runner, { x: 4.5 * CELL, z: 1.5 * CELL });
  assert.equal(ahead?.effect, seal, "sees the wall on the way");
  assert.equal(ahead.enemy, true);
  assert.equal(wallAhead(room, runner, { x: 1.5 * CELL, z: 1.5 * CELL }), null, "not when walking away from it");
  assert.equal(wallAhead({ map: corridor, abilities: { effects: [{ ...seal, team: "red" }] } }, runner, { x: 4.5 * CELL, z: 1.5 * CELL }).enemy, false, "our own wall is never a target");
});

test("Team Deathmatch: change hero (instant when dead or just spawned, otherwise next spawn)", () => {
  let t = 1_000_000;
  const sent = [];
  const socket = { readyState: 1, send: (d) => sent.push(JSON.parse(d)) };
  const room = new Room({ mapId: "pantai", mode: "tdm", clock: () => t, autoTick: false, humans: [{ userId: 1, name: "Me", skin: "classic", socket, team: "red" }, { userId: 2, name: "Mate", skin: "classic", socket: null, team: "red" }] });
  const me = room.playerOf(1);
  const mate = room.playerOf(2);
  mate.bot = false;
  room.round.phase = "live";
  mate.hero = "jamu";
  me.hero = "kabut";
  me.abil.ult = 80;
  // Taken by a human teammate.
  room.swapHero(me, "jamu");
  assert.equal(sent.at(-1).error, "A teammate is playing that hero");
  // A bot teammate gives the hero up.
  const bot = [...room.players.values()].find((p) => p.bot && p.team === "red");
  bot.hero = "petasan";
  // Alive, out of spawn protection: queued for the next spawn.
  me.protectUntil = 0;
  room.swapHero(me, "petasan");
  assert.equal(me.hero, "kabut");
  assert.equal(me.nextHero, "petasan");
  assert.notEqual(bot.hero, "petasan", "the bot moved off it");
  assert.deepEqual(sent.at(-1), { t: "hero_swap", hero: "petasan", now: false });
  room.damage(room.playerOf(1) === me ? [...room.players.values()].find((p) => p.team === "blue") : me, me, 200, "body");
  assert.equal(me.alive, false);
  t = me.respawnAt;
  room.respawnDue(t);
  assert.equal(me.hero, "petasan", "swapped on respawn");
  assert.equal(me.abil.ult, 0, "ultimate starts over");
  // Within spawn protection: instant.
  room.swapHero(me, "magnet");
  assert.equal(me.hero, "magnet");
  assert.ok(sent.some((m) => m.t === "hero" && m.id === me.id && m.hero === "magnet"));
  // Bomb mode: no swapping.
  const bombRoom = new Room({ mapId: "pantai", autoTick: false, humans: [{ userId: 1, name: "Me", skin: "classic", socket: null }] });
  const p = bombRoom.playerOf(1);
  p.hero = "kabut";
  bombRoom.swapHero(p, "dash");
  assert.equal(p.hero, "kabut");
});

test("spawn spots stay out of the enemy's sight lines", () => {
  // Sawah and Stasiun have a straight lane between the spawns; no spawn spot looks down it.
  const eye = (p) => ({ x: p.x, y: 1.6, z: p.z });
  for (const id of MAP_IDS) {
    const map = MAPS[id];
    for (const [side, other] of [["attack", "defend"], ["defend", "attack"]]) {
      assert.ok(map.spawns[side].length >= 6, `${id} ${side}`);
      const enemyZone = map.zones[other].map((c) => ({ x: (c.x + 0.5) * CELL, z: (c.z + 0.5) * CELL }));
      for (const s of map.spawns[side]) assert.ok(!enemyZone.some((e) => lineOfSight(map, eye(s), eye(e))), `${id} ${side} spawn sees the enemy spawn`);
    }
  }
});
