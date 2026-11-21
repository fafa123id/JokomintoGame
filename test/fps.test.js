import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { CELL, KEY, createBody, step, hitboxes, rayBox, rayWorld, aimDirection, collides } from "../src/fps/shared/physics.js";
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
  for (let i = 0; i < 20 * 60 * 25 && !room.over; i++) {
    t += 50;
    room.tick();
  }
  assert.ok(room.over);
  assert.ok(Object.values(room.score).includes(5));
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

  const snap = await ws.next("snap");
  assert.equal(snap.ps.length, 9);
  assert.equal(snap.round.phase, "buy");
  for (let s = 1; s <= 5; s++) ws.send(JSON.stringify({ t: "in", s, k: KEY.FORWARD, y: 0, p: 0, d: 33 }));
  await new Promise((r) => setTimeout(r, 200));
  const later = await ws.next("snap");
  assert.ok(later.ack >= 1);
  ws.send(JSON.stringify({ t: "leave" }));
  await ws.next("left");
  ws.close();
});
