import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { CELL, KEY, createBody, step, hitboxes, rayBox, rayWorld, aimDirection, collides, traceShot } from "../src/fps/shared/physics.js";
import { WEAPONS } from "../src/fps/shared/weapons.js";
import { HEROES as heroList } from "../src/fps/shared/heroes.js";
import { RULES } from "../src/fps/shared/rules.js";
import { MAPS, MAP_IDS, isWalkable } from "../src/fps/shared/maps.js";
import { Room } from "../server/fps/room.js";

test("all five maps connect spawns and both bomb sites", () => {
  assert.equal(MAP_IDS.length, 5);
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
      const used = room.abilities.use(attacker, slot, { y: 0, p: -0.05 });
      assert.ok(used || hero.skill.id === "pull", `${hero.id} ${slot}`);
      assert.doesNotThrow(() => run(env, 4000), `${hero.id} ${slot} ticks`);
      assert.ok(defender.hp <= 100);
    }
  }
});

test("abilities: smoke hides, walls block, shields soak, grenades hurt, pulls drag", () => {
  let env = abilityRoom();
  assert.deepEqual(env.room.computeVision().red, [env.defender.id]);
  env.attacker.hero = "kabut";
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: -0.1 });
  assert.deepEqual(env.room.computeVision().red, [], "smoke blocks sight");

  env = abilityRoom();
  env.attacker.hero = "pagar";
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: -0.1 });
  assert.equal(env.room.map.blocks.length, 1, "wall raised");
  assert.ok(!lineOfSightTest(env.room, env.attacker, env.defender), "wall blocks the line");

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
  const before = env.defender.body.z;
  env.room.abilities.use(env.attacker, "skill", { y: 0, p: Math.atan2(1.2 - 1.6, 12) });
  run(env, 600);
  assert.ok(env.defender.body.z > before + 2, "pulled toward the caster");

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
