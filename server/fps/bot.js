import { CELL, KEY, PLAYER, eyeHeight, forwardOf, lineOfSight, toCell } from "../../src/fps/shared/physics.js";
import { isWalkable } from "../../src/fps/shared/maps.js";
import { RULES, SIDES } from "../../src/fps/shared/rules.js";
import { WEAPONS } from "../../src/fps/shared/weapons.js";

// Bot brain: walk a grid path toward the objective, react to visible enemies with human-like delay,
// aim with noise that shrinks while tracking, strafe in fights, plant and defuse.
const VIEW_RANGE = 48;
const FOV = (115 * Math.PI) / 180;
const HEARING_RANGE = 9;
const TURN_RATE = 7;
const REPATH_MS = 1500;
const PUSH_AFTER_MS = 40_000;

export function createBrain(rng) {
  const brain = {
    rng,
    path: [],
    goal: null,
    repathAt: 0,
    target: null,
    reactAt: 0,
    trackSince: 0,
    noise: { yaw: 0, pitch: 0 },
    strafe: 1,
    strafeAt: 0,
    crouchUntil: 0,
    hurtBy: null,
    skill: 0.55 + rng() * 0.35,
    reset() {
      this.path = [];
      this.goal = null;
      this.target = null;
      this.hurtBy = null;
      this.repathAt = 0;
    },
  };
  return brain;
}

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const turnToward = (current, desired, maxStep) => current + Math.max(-maxStep, Math.min(maxStep, angleDiff(desired, current)));

function bfsPath(map, from, to) {
  const key = (x, z) => z * map.width + x;
  const start = key(from.x, from.z);
  const goal = key(to.x, to.z);
  const prev = new Map([[start, -1]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    const x = cur % map.width;
    const z = Math.floor(cur / map.width);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      const k = key(nx, nz);
      if (!prev.has(k) && isWalkable(map, nx, nz)) {
        prev.set(k, cur);
        queue.push(k);
      }
    }
  }
  if (!prev.has(goal)) return [];
  const path = [];
  for (let k = goal; k !== start && k !== -1; k = prev.get(k)) path.push({ x: ((k % map.width) + 0.5) * CELL, z: (Math.floor(k / map.width) + 0.5) * CELL });
  return path.reverse();
}

const cellOf = (pos) => ({ x: toCell(pos.x), z: toCell(pos.z) });

function pickCell(brain, cells) {
  return cells[Math.floor(brain.rng() * cells.length)];
}

// Where this bot wants to be right now.
function chooseGoal(room, p) {
  const brain = p.brain;
  const side = room.sideOf(p.team);
  const bomb = room.bomb;
  if (side === SIDES.ATTACK) {
    if (bomb.planted) return { cell: cellOf(bomb.planted), key: "guard" };
    if (bomb.dropped) return { cell: cellOf(bomb.dropped), key: "pickup" };
    const siteCells = room.map.sites[bomb.botSite];
    if (brain.goal?.key === `site-${bomb.botSite}`) return brain.goal;
    return { cell: pickCell(brain, siteCells), key: `site-${bomb.botSite}` };
  }
  if (bomb.planted) return { cell: cellOf(bomb.planted), key: "defuse" };
  const defenders = room.playersOn(SIDES.DEFEND);
  // No plant after a while: half the defenders push out and hunt the nearest attacker.
  const elapsed = room.clock() - (room.round.ends - RULES.roundSec * 1000);
  if (elapsed > PUSH_AFTER_MS && defenders.indexOf(p) % 2 === 1) {
    const prey = room
      .playersOn(SIDES.ATTACK)
      .filter((e) => e.alive)
      .sort((a, b) => Math.hypot(a.body.x - p.body.x, a.body.z - p.body.z) - Math.hypot(b.body.x - p.body.x, b.body.z - p.body.z))[0];
    if (prey) return { cell: cellOf(prey.body), key: `hunt-${prey.id}` };
  }
  const site = defenders.indexOf(p) % 2 === 0 ? "A" : "B";
  if (brain.goal?.key === `hold-${site}`) return brain.goal;
  return { cell: pickCell(brain, room.map.sites[site]), key: `hold-${site}` };
}

function visibleEnemy(room, p, now) {
  const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
  const facing = forwardOf(p.body.yaw);
  let best = null;
  for (const enemy of room.players.values()) {
    if (!enemy.alive || enemy.team === p.team) continue;
    const dx = enemy.body.x - p.body.x;
    const dz = enemy.body.z - p.body.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VIEW_RANGE) continue;
    const inView = Math.acos(Math.max(-1, Math.min(1, (dx * facing.x + dz * facing.z) / (dist || 1)))) < FOV / 2;
    const noticed = inView || dist < HEARING_RANGE || p.brain.hurtBy === enemy.id;
    if (!noticed) continue;
    const chest = { x: enemy.body.x, y: enemy.body.y + (enemy.body.crouch ? 0.9 : 1.25), z: enemy.body.z };
    if (!lineOfSight(room.map, eye, chest)) continue;
    if (!best || dist < best.dist) best = { enemy, dist };
  }
  return best;
}

export function think(room, p, now) {
  const brain = p.brain;
  const body = p.body;
  const out = { keys: 0, yaw: body.yaw, pitch: body.pitch, fire: false, use: false, reload: false };
  if (room.round.phase !== "live") return out;
  const dt = 1 / RULES.tickRate;
  const side = room.sideOf(p.team);
  const ammo = p.ammo[p.weapon];
  if (ammo.mag === 0 && !p.reloadUntil) out.reload = true;

  const seen = visibleEnemy(room, p, now);
  if (seen) {
    const enemy = seen.enemy;
    if (brain.target !== enemy.id) {
      brain.target = enemy.id;
      brain.reactAt = now + (380 - brain.skill * 180) + brain.rng() * 220;
      brain.trackSince = now;
      brain.noise = { yaw: (brain.rng() - 0.5) * 0.25, pitch: (brain.rng() - 0.5) * 0.12 };
    }
    // Aim error shrinks the longer the bot tracks the same target.
    const settle = Math.min(1, (now - brain.trackSince) / (900 - brain.skill * 400));
    const aimHead = brain.skill > 0.75 && brain.rng() < 0.35;
    const targetY = enemy.body.y + (aimHead ? (enemy.body.crouch ? 1.15 : 1.6) : enemy.body.crouch ? 0.85 : 1.2);
    const dx = enemy.body.x - body.x;
    const dz = enemy.body.z - body.z;
    const flat = Math.hypot(dx, dz);
    const wobble = (1 - settle) + 0.15;
    const desiredYaw = yawTo(dx, dz) + brain.noise.yaw * wobble;
    const desiredPitch = Math.atan2(targetY - eyeHeight(body), flat) + brain.noise.pitch * wobble;
    out.yaw = turnToward(body.yaw, desiredYaw, TURN_RATE * dt);
    out.pitch = body.pitch + Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, desiredPitch - body.pitch));
    const onTarget = Math.abs(angleDiff(out.yaw, yawTo(dx, dz))) < 0.06 + 0.6 / Math.max(flat, 1) * 0.3;
    if (now >= brain.reactAt && onTarget && ammo.mag > 0) {
      // Burst at range, spray up close.
      const burst = flat > 18 ? now - p.lastShotAt > WEAPONS[p.weapon].interval * 1000 * 2.5 : true;
      out.fire = burst;
    }
    if (now > brain.strafeAt) {
      brain.strafe = brain.rng() < 0.5 ? -1 : 1;
      brain.strafeAt = now + 450 + brain.rng() * 700;
      if (brain.rng() < 0.2) brain.crouchUntil = now + 900;
    }
    out.keys |= brain.strafe > 0 ? KEY.RIGHT : KEY.LEFT;
    if (flat > 22) out.keys |= KEY.FORWARD;
    if (now < brain.crouchUntil) out.keys |= KEY.CROUCH;
    return out;
  }
  brain.target = null;

  const goal = chooseGoal(room, p);
  const here = cellOf(body);
  if (goal.key !== brain.goal?.key || goal.cell.x !== brain.goal.cell.x || goal.cell.z !== brain.goal.cell.z || now > brain.repathAt) {
    brain.goal = goal;
    brain.path = bfsPath(room.map, here, goal.cell);
    brain.repathAt = now + REPATH_MS;
  }

  const atGoal = here.x === goal.cell.x && here.z === goal.cell.z;
  const bomb = room.bomb;
  if (atGoal) {
    const isCarrier = bomb.carrier === p.id && !bomb.planted;
    if (side === SIDES.ATTACK && isCarrier && room.map.grid[here.z][here.x] === bomb.botSite) {
      out.use = true;
      return out;
    }
    if (side === SIDES.DEFEND && bomb.planted && Math.hypot(bomb.planted.x - body.x, bomb.planted.z - body.z) <= RULES.defuseRange * 0.8) {
      out.use = true;
      return out;
    }
    // Holding an angle: slowly look around.
    out.yaw = body.yaw + Math.sin(now / 900 + p.id) * 0.6 * dt;
    if (side === SIDES.DEFEND && bomb.planted) {
      out.yaw = turnToward(body.yaw, yawTo(bomb.planted.x - body.x, bomb.planted.z - body.z), TURN_RATE * dt);
      out.keys |= KEY.FORWARD;
    }
    return out;
  }

  let next = brain.path[0];
  while (next && Math.hypot(next.x - body.x, next.z - body.z) < 0.7) {
    brain.path.shift();
    next = brain.path[0];
  }
  if (!next) {
    const target = { x: (goal.cell.x + 0.5) * CELL, z: (goal.cell.z + 0.5) * CELL };
    next = target;
  }
  const desired = yawTo(next.x - body.x, next.z - body.z);
  out.yaw = turnToward(body.yaw, desired, TURN_RATE * dt);
  out.pitch = body.pitch * 0.8;
  if (Math.abs(angleDiff(out.yaw, desired)) < 0.9) out.keys |= KEY.FORWARD;
  // Walk quietly-looking near the objective, run elsewhere.
  if (brain.path.length < 3 && side === SIDES.DEFEND && !bomb.planted) out.keys |= KEY.WALK;
  return out;
}

export { PLAYER };
