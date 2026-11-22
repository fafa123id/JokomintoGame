import { CELL, KEY, PLAYER, eyeHeight, forwardOf, lineOfSight, toCell, isSolid, collides, rayWorld, smokeBetween, smokeBlocks } from "../../src/fps/shared/physics.js";
import { heroById } from "../../src/fps/shared/heroes.js";
import { isWalkable, siteAt } from "../../src/fps/shared/maps.js";
import { RULES, SIDES } from "../../src/fps/shared/rules.js";
import { WEAPONS } from "../../src/fps/shared/weapons.js";

// Bot brain: walk a grid path toward a goal, react to visible enemies with human-like delay,
// aim with noise that shrinks while tracking, strafe in fights, plant and defuse.
// Attackers escort the bomb carrier (one may lurk the other site); after the plant they spread
// out to covered angles on the bomb. Defenders split across sites and rotate their hold spots.
const VIEW_RANGE = 48;
const FOV = (115 * Math.PI) / 180;
const HEARING_RANGE = 9;
const TURN_RATE = 7;
const REPATH_MS = 1500;
const PUSH_AFTER_MS = 40_000;
const ROTATE_AFTER_MS = 35_000;
const FOLLOW_DIST = 5;
const STUCK_MS = 1400;
// How long a bot remembers where it last saw an enemy who vanished into smoke.
const MEMORY_MS = 3500;

export function createBrain(rng) {
  return {
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
    hurtAt: -Infinity,
    heard: null,
    yawVel: 0,
    lookYaw: 0,
    lookUntil: 0,
    pauseUntil: 0,
    pauseCheckAt: 0,
    skill: 0.55 + rng() * 0.35,
    round: 0,
    role: "escort",
    holdSite: null,
    holdCell: null,
    holdUntil: 0,
    smokeCall: null,
    rotated: false,
    lastPos: null,
    lastMoveAt: 0,
    unstickUntil: 0,
    unstickKeys: 0,
    reset() {
      this.path = [];
      this.goal = null;
      this.target = null;
      this.hurtBy = null;
      this.hurtAt = -Infinity;
      this.heard = null;
      this.yawVel = 0;
      this.repathAt = 0;
      this.round = 0;
      this.lastPos = null;
    },
  };
}

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const turnToward = (current, desired, maxStep) => current + Math.max(-maxStep, Math.min(maxStep, angleDiff(desired, current)));
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const center = (cell) => ({ x: (cell.x + 0.5) * CELL, z: (cell.z + 0.5) * CELL });

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
  for (let k = goal; k !== start && k !== -1; k = prev.get(k)) path.push(center({ x: k % map.width, z: Math.floor(k / map.width) }));
  return path.reverse();
}

const cellOf = (pos) => ({ x: toCell(pos.x), z: toCell(pos.z) });
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

// Covered angles on a planted bomb: 2-6 cells away, with a clear view of it, next to a wall or crate.
function postPlantSpots(room) {
  const bomb = room.bomb.planted;
  if (room.bomb.spotsFor === bomb) return room.bomb.spots;
  const map = room.map;
  const origin = cellOf(bomb);
  const spots = [];
  for (let z = origin.z - 6; z <= origin.z + 6; z++) {
    for (let x = origin.x - 6; x <= origin.x + 6; x++) {
      if (!isWalkable(map, x, z)) continue;
      const d = Math.hypot(x - origin.x, z - origin.z);
      if (d < 2 || d > 6) continue;
      const c = center({ x, z });
      if (!lineOfSight(map, { x: c.x, y: PLAYER.eye, z: c.z }, { x: bomb.x, y: 0.3, z: bomb.z })) continue;
      const cover = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => isSolid(map, x + dx, z + dz)).length;
      if (!cover) continue;
      spots.push({ x, z, score: cover + room.rng() * 2 + (d > 3 ? 1 : 0) });
    }
  }
  spots.sort((a, b) => b.score - a.score);
  room.bomb.spotsFor = bomb;
  room.bomb.spots = spots;
  return spots;
}

// A cell inside or right next to a site, for defenders holding it.
function holdCell(room, brain, site) {
  const cells = room.map.sites[site];
  const base = pick(brain.rng, cells);
  for (let i = 0; i < 6; i++) {
    const c = { x: base.x + Math.round((brain.rng() - 0.5) * 4), z: base.z + Math.round((brain.rng() - 0.5) * 4) };
    if (isWalkable(room.map, c.x, c.z)) return c;
  }
  return base;
}

function setupRound(room, p) {
  const brain = p.brain;
  if (brain.round === room.round.n) return;
  brain.round = room.round.n;
  brain.rotated = false;
  brain.holdUntil = 0;
  brain.role = brain.rng() < 0.22 ? "lurk" : "escort";
  brain.holdSite = brain.rng() < 0.5 ? "A" : "B";
}

const goalAt = (pos, key, radius = 0.5) => ({ cell: cellOf(pos), key, exact: { x: pos.x, z: pos.z }, radius });
const goalCell = (cell, key) => ({ cell, key, exact: center(cell), radius: 0.8 });

// Team Deathmatch: chase whatever was last heard, hunt the nearest enemy, or roam the map.
function tdmGoal(room, p, now) {
  const brain = p.brain;
  if (brain.heard && now - brain.heard.at < 4000) return goalAt(brain.heard, "heard", 2);
  if (brain.goal?.key?.startsWith("roam") && now < brain.roamUntil) return brain.goal;
  const prey = room
    .playersOn(room.sideOf(p.team) === SIDES.ATTACK ? SIDES.DEFEND : SIDES.ATTACK)
    .filter((e) => e.alive)
    .sort((a, b) => dist2d(a.body, p.body) - dist2d(b.body, p.body))[0];
  brain.roamUntil = now + 8000 + brain.rng() * 7000;
  if (prey && brain.rng() < 0.55) return goalAt(prey.body, `roam-hunt-${prey.id}`, 3);
  // A random open cell somewhere on the map.
  for (let i = 0; i < 20; i++) {
    const cell = { x: Math.floor(brain.rng() * room.map.width), z: Math.floor(brain.rng() * room.map.height) };
    if (isWalkable(room.map, cell.x, cell.z)) return goalCell(cell, `roam-${cell.x}-${cell.z}`);
  }
  return goalAt(p.body, "roam-here", 1);
}

// Where this bot wants to be right now.
function chooseGoal(room, p, now) {
  const brain = p.brain;
  if (room.mode === "tdm") return tdmGoal(room, p, now);
  setupRound(room, p);
  const side = room.sideOf(p.team);
  const bomb = room.bomb;
  const elapsed = now - (room.round.ends - RULES.roundSec * 1000);
  const mates = room.playersOn(side).filter((q) => q.alive);

  if (side === SIDES.ATTACK) {
    if (bomb.planted) {
      // Someone is defusing: everyone goes for the defuser, through smoke or around walls.
      const defuser = bomb.defuseStart && room.players.get(bomb.defuseStart.id);
      if (defuser?.alive) return goalAt(defuser.body, `stop-defuse-${defuser.id}`, 1.5);
      const spots = postPlantSpots(room);
      const order = mates.sort((a, b) => a.id - b.id).indexOf(p);
      const spot = spots[order % Math.max(1, spots.length)];
      return spot ? goalCell(spot, `post-${spot.x}-${spot.z}`) : goalAt(bomb.planted, "guard", 3);
    }
    if (bomb.dropped) {
      // The two closest go and grab it; everyone else waits near them.
      const nearest = mates.sort((a, b) => dist2d(a.body, bomb.dropped) - dist2d(b.body, bomb.dropped));
      if (nearest.indexOf(p) < 2) return goalAt(bomb.dropped, "pickup", 0.4);
      return goalAt(bomb.dropped, "cover-pickup", FOLLOW_DIST);
    }
    const carrier = room.players.get(bomb.carrier);
    if (carrier === p) {
      // Bot carriers pick a site per round and sometimes rotate if it takes too long.
      if (!brain.rotated && elapsed > ROTATE_AFTER_MS) {
        brain.rotated = true;
        if (brain.rng() < 0.35) bomb.botSite = bomb.botSite === "A" ? "B" : "A";
      }
      const key = `site-${bomb.botSite}`;
      if (brain.goal?.key === key) return brain.goal;
      return goalCell(pick(brain.rng, room.map.sites[bomb.botSite]), key);
    }
    if (brain.role === "lurk" && carrier) {
      const other = bomb.botSite === "A" ? "B" : "A";
      const key = `lurk-${other}`;
      if (brain.goal?.key === key) return brain.goal;
      return goalCell(holdCell(room, brain, other), key);
    }
    if (carrier?.alive) {
      // Escort: once the carrier is on a site, spread across it; otherwise stay a few meters behind.
      const site = siteAt(room.map, carrier.body.x, carrier.body.z);
      if (site) {
        const key = `site-${site}`;
        if (brain.goal?.key === key) return brain.goal;
        return goalCell(pick(brain.rng, room.map.sites[site]), key);
      }
      return goalAt(carrier.body, `follow-${carrier.id}`, FOLLOW_DIST);
    }
    return goalCell(pick(brain.rng, room.map.sites[bomb.botSite]), `site-${bomb.botSite}`);
  }

  if (bomb.planted) return goalAt(bomb.planted, "defuse", RULES.defuseRange * 0.6);
  // No plant after a while: some defenders push out and hunt the nearest attacker.
  if (elapsed > PUSH_AFTER_MS && brain.role === "lurk") {
    const prey = room
      .playersOn(SIDES.ATTACK)
      .filter((e) => e.alive)
      .sort((a, b) => dist2d(a.body, p.body) - dist2d(b.body, p.body))[0];
    if (prey) return goalAt(prey.body, `hunt-${prey.id}`, 3);
  }
  // Both sites always get someone: the first two defenders cover one each.
  const index = mates.sort((a, b) => a.id - b.id).indexOf(p);
  const site = index === 0 ? "A" : index === 1 ? "B" : brain.holdSite;
  if (!brain.holdCell || brain.goal?.key !== `hold-${site}` || now > brain.holdUntil) {
    brain.holdCell = holdCell(room, brain, site);
    brain.holdUntil = now + 15_000 + brain.rng() * 12_000;
  }
  return goalCell(brain.holdCell, `hold-${site}`);
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
    // Stealthed enemies are only noticed up close.
    if (now < enemy.abil.stealthUntil && dist > 4) continue;
    const shotBy = p.brain.hurtBy === enemy.id && now - p.brain.hurtAt < 4000;
    const noticed = inView || dist < HEARING_RANGE || shotBy;
    if (!noticed) continue;
    const chest = { x: enemy.body.x, y: enemy.body.y + (enemy.body.crouch ? 0.9 : 1.25), z: enemy.body.z };
    if (!lineOfSight(room.map, eye, chest)) continue;
    // Same smoke rules as players: thick from outside, see-through only inside your own team's
    // cloud (and only within it), blind inside the enemy's.
    if (smokeBlocks(room.abilities.smokes(), p.team, eye, chest)) continue;
    if (!best || dist < best.dist) best = { enemy, dist };
  }
  return best;
}

// Turning with momentum: the view speeds up and settles instead of snapping at a fixed rate.
function steerYaw(brain, current, desired, dt, boost = 1) {
  const diff = angleDiff(desired, current);
  const maxRate = (4 + brain.skill * 3.5) * boost;
  const target = Math.max(-maxRate, Math.min(maxRate, diff * 8));
  brain.yawVel += (target - brain.yawVel) * Math.min(1, dt * 12);
  return current + brain.yawVel * dt;
}

function steerPitch(brain, current, desired, dt) {
  return current + (desired - current) * Math.min(1, dt * 7);
}

// Movement keys for a world direction while looking somewhere else (strafing, backpedaling).
function moveKeys(yaw, dir) {
  const f = forwardOf(yaw);
  const r = { x: -f.z, z: f.x };
  const along = dir.x * f.x + dir.z * f.z;
  const side = dir.x * r.x + dir.z * r.z;
  let keys = 0;
  if (along > 0.38) keys |= KEY.FORWARD;
  if (along < -0.38) keys |= KEY.BACK;
  if (side > 0.38) keys |= KEY.RIGHT;
  if (side < -0.38) keys |= KEY.LEFT;
  return keys;
}

// Straight walkable line between two points (body width included)?
function clearWalk(map, a, b) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(len / 0.5);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    if (collides(map, a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, PLAYER.radius + 0.12)) return false;
  }
  return true;
}

// Cut corners: head for the furthest upcoming path point that can be reached in a straight line.
function smoothNext(room, body, path) {
  for (let i = Math.min(path.length - 1, 5); i > 0; i--) if (clearWalk(room.map, body, path[i])) return path[i];
  return path[0];
}

// Where to look while not fighting: toward recent danger, around the next corner, or down the
// longest open sightline near the way we're heading. Changes every second or so, like a person
// checking angles.
function chooseLook(room, p, now, baseYaw, path) {
  const brain = p.brain;
  if (brain.heard && now - brain.heard.at < 3500) return yawTo(brain.heard.x - p.body.x, brain.heard.z - p.body.z);
  if (now < brain.lookUntil) return brain.lookYaw;
  brain.lookUntil = now + 700 + brain.rng() * 1400;
  const ahead = path?.[Math.min(path.length - 1, 3)];
  if (ahead && brain.rng() < 0.45) {
    brain.lookYaw = yawTo(ahead.x - p.body.x, ahead.z - p.body.z);
    return brain.lookYaw;
  }
  const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
  let best = baseYaw;
  let bestScore = -1;
  for (let i = -3; i <= 3; i++) {
    const yaw = baseYaw + i * 0.45 + (brain.rng() - 0.5) * 0.2;
    const f = forwardOf(yaw);
    const open = rayWorld(room.map, eye, { x: f.x, y: 0, z: f.z }, 30);
    const score = open * (1 - Math.abs(i) * 0.08) * (0.7 + brain.rng() * 0.6);
    if (score > bestScore) {
      bestScore = score;
      best = yaw;
    }
  }
  brain.lookYaw = best;
  return best;
}

function fight(room, p, seen, now, out) {
  const brain = p.brain;
  const body = p.body;
  const dt = 1 / RULES.tickRate;
  const enemy = seen.enemy;
  const weapon = WEAPONS[p.weapon];
  const ammo = p.ammo[p.weapon];
  const shotAt = now - brain.hurtAt < 1500;
  if (brain.target !== enemy.id) {
    brain.target = enemy.id;
    // Already under fire: snap reactions are faster.
    brain.reactAt = now + (shotAt ? 110 + brain.rng() * 120 : 330 - brain.skill * 150 + brain.rng() * 220);
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
  const wobble = 1 - settle + 0.15;
  const desiredYaw = yawTo(dx, dz) + brain.noise.yaw * wobble;
  const desiredPitch = Math.atan2(targetY - eyeHeight(body), flat) + brain.noise.pitch * wobble;
  out.yaw = steerYaw(brain, body.yaw, desiredYaw, dt, shotAt ? 2.2 : 1.6);
  out.pitch = steerPitch(brain, body.pitch, desiredPitch, dt * 1.6);
  const onTarget = Math.abs(angleDiff(out.yaw, yawTo(dx, dz))) < 0.06 + (0.6 / Math.max(flat, 1)) * 0.3;

  // Snipers scope in at range; shotguns close the distance first.
  out.scope = weapon.scope && flat > 10 ? (flat > 30 ? 2 : 1) : 0;
  if (weapon.pellets && flat > 14) out.keys |= KEY.FORWARD;
  if (weapon.melee) {
    // Out of bullets: run in and slash.
    out.keys |= KEY.FORWARD;
    out.fire = now >= brain.reactAt && onTarget && flat < weapon.range;
    return out;
  }
  if (now >= brain.reactAt && onTarget && ammo?.mag > 0) {
    // Burst at range, spray up close.
    out.fire = weapon.pellets && flat > 18 ? false : flat > 18 && weapon.auto ? now - p.lastShotAt > weapon.interval * 1000 * 2.5 : true;
  }
  // Duck and weave: strafe changes direction irregularly, sometimes crouch-spraying.
  if (now > brain.strafeAt) {
    brain.strafe = brain.rng() < 0.5 ? -1 : 1;
    brain.strafeAt = now + 300 + brain.rng() * 700;
    if (brain.rng() < (shotAt ? 0.35 : 0.2)) brain.crouchUntil = now + 500 + brain.rng() * 700;
  }
  const back = retreatDir(room, p);
  if (back) {
    out.keys |= moveKeys(out.yaw, back);
    return out;
  }
  out.keys |= brain.strafe > 0 ? KEY.RIGHT : KEY.LEFT;
  if (flat > 22) out.keys |= KEY.FORWARD;
  if (now < brain.crouchUntil) out.keys |= KEY.CROUCH;
  return out;
}

export function think(room, p, now) {
  if (room.abilities.stunned(p, now)) return { keys: 0, yaw: p.body.yaw, pitch: p.body.pitch, fire: false, use: false, reload: false };
  const out = move(room, p, now);
  if (room.round.phase === "live" && p.hero) out.ability = chooseAbility(room, p, now, out);
  return out;
}

// When a bot uses its skill or ultimate, and where it aims it. Simple per-hero habits; at most
// one decision every ~1.2 s so bots don't burn everything at once.
function chooseAbility(room, p, now, out) {
  const brain = p.brain;
  if (now < (brain.abilityAt ?? 0)) return null;
  brain.abilityAt = now + 1200;
  const hero = heroById(p.hero);
  const a = p.abil;
  const skill = now >= a.cdUntil;
  const ult = a.ult >= 100;
  const r = brain.rng();
  const seen = brain.target !== null ? room.players.get(brain.target) : null;
  const dist = seen ? Math.hypot(seen.body.x - p.body.x, seen.body.z - p.body.z) : Infinity;
  const at = (target, lift = 0) => {
    const dx = target.x - p.body.x;
    const dz = target.z - p.body.z;
    const d = Math.hypot(dx, dz) || 1;
    return { y: yawTo(dx, dz), p: Math.atan2((target.y ?? 0) - eyeHeight(p.body), d) + lift };
  };
  const hurt = now - brain.hurtAt < 1000;
  const bomb = room.bomb;
  const attacking = room.sideOf(p.team) === "attack";
  const busy = (bomb.carrier === p.id && bomb.plantStart) || bomb.defuseStart?.id === p.id;
  const teammateDown = room.abilities.fallen.some((f) => f.team === p.team && !room.players.get(f.id)?.alive);
  const use = (slot, aim, points) => ({ slot, y: aim?.y ?? out.yaw, p: aim?.p ?? out.pitch, points });
  const spot = (pos) => [{ x: pos.x, z: pos.z }];
  const siteCenter = (site) => {
    const cells = room.map.sites[site];
    return { x: (cells.reduce((s, c) => s + c.x, 0) / cells.length + 0.5) * CELL, z: (cells.reduce((s, c) => s + c.z, 0) / cells.length + 0.5) * CELL };
  };

  if (ult) {
    switch (hero.ult.id) {
      case "laser":
        // Lasers on the planted bomb (defending) or on a fight in progress.
        if (!attacking && bomb.planted) return use("ult", null, spot(bomb.planted));
        if (seen && dist > 8) return use("ult", null, spot(seen.body));
        break;
      case "rush":
        if (seen || (attacking && r < 0.15)) return use("ult");
        break;
      case "vortex":
      case "barrage":
        if (seen && dist > 5) return use("ult", at(seen.body));
        break;
      case "stealth":
        if (attacking && !seen && r < 0.3) return use("ult");
        break;
      case "revive": {
        // Aim at the closest fallen teammate's body.
        if (seen) break;
        const body = room.abilities.fallen
          .filter((f) => f.team === p.team && !room.players.get(f.id)?.alive && Math.hypot(f.x - p.body.x, f.z - p.body.z) < 35)
          .sort((a, b) => Math.hypot(a.x - p.body.x, a.z - p.body.z) - Math.hypot(b.x - p.body.x, b.z - p.body.z))[0];
        if (body) return use("ult", at({ x: body.x, y: 0.3, z: body.z }));
        break;
      }
      case "leap": {
        // Jump in to a teammate who's fighting.
        const mate = [...room.players.values()].find((q) => q !== p && q.alive && q.team === p.team && q.brain?.target != null && Math.hypot(q.body.x - p.body.x, q.body.z - p.body.z) < 32);
        if (mate) return use("ult", at({ x: mate.body.x, y: mate.body.y + 1.2, z: mate.body.z }));
        break;
      }
      case "dome":
        if (busy || (seen && p.hp < 50)) return use("ult", { y: out.yaw, p: -1.2 });
        break;
      case "reveal":
      case "drone":
        if (!seen && r < 0.25) return use("ult");
        break;
    }
  }
  // Steering a shield that's already up: keep it between us and the enemy (no cooldown needed).
  if (hero.skill.id === "shield" && seen && room.abilities.ownShield(p) && r < 0.5) return use("skill", at(seen.body));
  if (!skill) return null;
  switch (hero.skill.id) {
    case "smoke":
      if (seen && (p.hp < 60 || dist > 14) && r < 0.4) return use("skill", null, spot(seen.body));
      if (!seen && attacking && bomb.carrier && siteNear(room, room.players.get(bomb.carrier), 16) && r < 0.4) return use("skill", null, spot(siteCenter(bomb.botSite)));
      break;
    case "boost":
      if (!seen && brain.goal && r < 0.08) return use("skill", { y: out.yaw, p: -1.2 });
      break;
    case "scouts":
      if (!seen && r < 0.15 && !room.abilities.effects.some((e) => e.type === "scout" && e.owner === p.id)) return use("skill", { y: out.yaw, p: 0 });
      break;
    case "wall":
      // The wall lasts until broken, so don't throw away a standing one for nothing.
      if (seen && (hurt || p.hp < 70) && r < 0.3) return use("skill", at(seen.body));
      break;
    case "dash":
      if (hurt && r < 0.6) return use("skill");
      break;
    case "grenade":
      if (seen && dist > 5 && dist < 24) return use("skill", at(seen.body, 0.12 + dist * 0.012));
      break;
    case "stun":
      if (seen && dist < 20 && r < 0.7) return use("skill", at({ x: seen.body.x, y: seen.body.y + 1.2, z: seen.body.z }));
      break;
    case "heal":
      if (p.hp < 60 && !seen) return use("skill", { y: out.yaw, p: -1 });
      break;
    case "shield":
      if (seen && dist > 6 && r < 0.5) return use("skill", at(seen.body));
      break;
    case "scan":
      if (!seen && r < 0.12) return use("skill", { y: out.yaw, p: 0 });
      break;
  }
  return null;
}

function smokeTactics(room, p, now, out) {
  const brain = p.brain;
  const last = brain.lastSeen;
  if (!last || now - last.at > MEMORY_MS) return null;
  const enemy = room.players.get(last.id);
  if (!enemy?.alive) return null;
  const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
  const spot = { x: last.x, y: 1.2, z: last.z };
  const dist = Math.hypot(last.x - p.body.x, last.z - p.body.z);
  // Reached the spot and nobody's there: give up and get back to the plan.
  if (dist < 1.5) {
    brain.lastSeen = null;
    return null;
  }
  const smokes = room.abilities.smokes();
  if (dist > 28 || !smokeBetween(smokes, eye, spot) || !lineOfSight(room.map, eye, spot)) return null;
  // Each time someone vanishes into smoke the bot makes a fresh call, so it doesn't play the same
  // way every time: chase them in, push up to the edge briefly, or just carry on with the plan.
  // Lurkers and higher-skill bots chase more often; nobody stands around waiting.
  const key = `${last.id}:${Math.round(last.x)}:${Math.round(last.z)}`;
  if (brain.smokeCall?.key !== key) {
    const chase = 0.35 + (brain.role === "lurk" ? 0.2 : 0) + (brain.skill - 0.7) * 0.4 + (room.bomb.defuseStart ? 0.3 : 0);
    const r = brain.rng();
    const style = r < chase ? "enter" : r < chase + 0.35 ? "edge" : "ignore";
    brain.smokeCall = { key, style, until: now + 600 + brain.rng() * 1400 };
  }
  const call = brain.smokeCall;
  if (call.style === "ignore") return null;
  const dt = 1 / RULES.tickRate;
  const yaw = yawTo(last.x - p.body.x, last.z - p.body.z);
  out.yaw = steerYaw(brain, p.body.yaw, yaw, dt, 1.4);
  out.pitch = steerPitch(brain, p.body.pitch, Math.atan2(1.2 - eyeHeight(p.body), dist), dt);
  const toward = { x: (last.x - p.body.x) / dist, z: (last.z - p.body.z) / dist };
  // No blind spraying either way.
  //  enter: walk into the smoke after them, crosshair ready; up close they become visible and the
  //         normal fight takes over.
  //  edge:  push up toward the smoke for a moment with the angle covered, then carry on.
  if (call.style === "edge") {
    const cloud = smokes.find((s) => smokeBetween([s], eye, spot));
    const toEdge = cloud ? Math.hypot(cloud.x - p.body.x, cloud.z - p.body.z) - cloud.r : 0;
    if (now > call.until) {
      call.style = "ignore";
      return null;
    }
    if (toEdge > 1.5) out.keys |= moveKeys(out.yaw, toward);
    return out;
  }
  out.keys |= moveKeys(out.yaw, toward);
  return out;
}

// Own smoke as cover. Inside it the bot can't see out (same as a player), so it waits briefly and
// then the smoke-chase logic walks it back out toward the last enemy it saw: shoot, retreat, repeat.
function smokeCover(room, p, now, out) {
  const brain = p.brain;
  const mine = room.abilities.smokes().filter((s) => s.team === p.team);
  if (!mine.length) return null;
  const dt = 1 / RULES.tickRate;
  const inside = mine.find((s) => Math.hypot(s.x - p.body.x, s.z - p.body.z) < s.r * 0.7);
  if (inside) {
    if (brain.retreating) {
      brain.retreating = false;
      brain.coverUntil = now + 700 + brain.rng() * 1100;
    }
    if (now >= (brain.coverUntil ?? 0)) return null;
    const last = brain.lastSeen;
    if (last) out.yaw = steerYaw(brain, p.body.yaw, yawTo(last.x - p.body.x, last.z - p.body.z), dt);
    // Reload while hidden.
    const ammo = p.ammo[p.weapon];
    if (ammo && ammo.mag < WEAPONS[p.weapon].magazine && ammo.reserve > 0 && !p.reloadUntil) out.reload = true;
    return out;
  }
  const pressured = now - brain.hurtAt < 1500 || (p.hp < 50 && brain.lastSeen && now - brain.lastSeen.at < 2000);
  if (!pressured) return null;
  const near = mine.map((s) => ({ s, d: Math.hypot(s.x - p.body.x, s.z - p.body.z) })).filter((c) => c.d < 10).sort((a, b) => a.d - b.d)[0];
  if (!near) return null;
  brain.retreating = true;
  const dir = { x: (near.s.x - p.body.x) / near.d, z: (near.s.z - p.body.z) / near.d };
  out.keys |= moveKeys(p.body.yaw, dir);
  return out;
}

// In a losing fight next to our own smoke: back into it while still shooting.
function retreatDir(room, p) {
  if (p.hp >= 45) return null;
  const mine = room.abilities.smokes().filter((s) => s.team === p.team);
  const near = mine.map((s) => ({ s, d: Math.hypot(s.x - p.body.x, s.z - p.body.z) })).filter((c) => c.d < 8 && c.d > c.s.r * 0.6).sort((a, b) => a.d - b.d)[0];
  if (!near) return null;
  p.brain.retreating = true;
  return { x: (near.s.x - p.body.x) / near.d, z: (near.s.z - p.body.z) / near.d };
}

function siteNear(room, player, range) {
  if (!player) return false;
  return ["A", "B"].some((s) => room.map.sites[s].some((c) => Math.hypot((c.x + 0.5) * CELL - player.body.x, (c.z + 0.5) * CELL - player.body.z) < range));
}

function move(room, p, now) {
  const brain = p.brain;
  const body = p.body;
  const out = { keys: 0, yaw: body.yaw, pitch: body.pitch, fire: false, use: false, reload: false };
  if (room.round.phase !== "live") return out;
  const dt = 1 / RULES.tickRate;
  const side = room.sideOf(p.team);
  const ammo = p.ammo[p.weapon];
  if (ammo && ammo.mag === 0 && !p.reloadUntil) out.reload = true;

  const seen = visibleEnemy(room, p, now);
  if (seen) {
    brain.lastSeen = { id: seen.enemy.id, x: seen.enemy.body.x, z: seen.enemy.body.z, at: now };
    return fight(room, p, seen, now, out);
  }
  // Under pressure with our own smoke nearby: duck into it, wait a moment, then peek back out.
  const cover = smokeCover(room, p, now, out);
  if (cover) return cover;
  // An enemy just slipped into smoke: go in after them (no blind spraying).
  const smoke = smokeTactics(room, p, now, out);
  if (smoke) return smoke;
  brain.target = null;
  if (ammo && ammo.mag < WEAPONS[p.weapon].magazine * 0.4 && ammo.reserve > 0 && !p.reloadUntil) out.reload = true;

  // Shot from somewhere we can't see (often behind): spin around fast toward the shooter,
  // crouch-strafe out of the line of fire.
  const attacker = brain.hurtBy !== null && now - brain.hurtAt < 2500 ? room.players.get(brain.hurtBy) : null;
  if (attacker?.alive) {
    out.yaw = steerYaw(brain, body.yaw, yawTo(attacker.body.x - body.x, attacker.body.z - body.z), dt, 2.6);
    out.pitch = steerPitch(brain, body.pitch, 0, dt);
    if (now > brain.strafeAt) {
      brain.strafe = brain.rng() < 0.5 ? -1 : 1;
      brain.strafeAt = now + 350 + brain.rng() * 400;
    }
    out.keys |= brain.strafe > 0 ? KEY.RIGHT : KEY.LEFT;
    if (brain.rng() < 0.03) out.keys |= KEY.CROUCH;
    return out;
  }

  const goal = chooseGoal(room, p, now);
  const here = cellOf(body);
  if (goal.key !== brain.goal?.key || goal.cell.x !== brain.goal.cell.x || goal.cell.z !== brain.goal.cell.z || now > brain.repathAt) {
    brain.goal = goal;
    brain.path = bfsPath(room.map, here, goal.cell);
    brain.repathAt = now + REPATH_MS;
  }

  const bomb = room.bomb;
  const toExact = dist2d(body, goal.exact);
  if (toExact <= goal.radius) {
    brain.lastMoveAt = now;
    if (side === SIDES.ATTACK && bomb.carrier === p.id && !bomb.planted && siteAt(room.map, body.x, body.z)) {
      out.use = true;
      return out;
    }
    if (goal.key === "defuse") {
      out.use = true;
      out.yaw = steerYaw(brain, body.yaw, yawTo(bomb.planted.x - body.x, bomb.planted.z - body.z), dt);
      out.pitch = steerPitch(brain, body.pitch, -0.6, dt);
      return out;
    }
    // Holding: watch the bomb (post-plant) or the angles enemies come from.
    const watch = goal.key.startsWith("post-") ? yawTo(bomb.planted.x - body.x, bomb.planted.z - body.z) : yawTo(room.map.width * 1.5 - body.x, room.map.height * 1.5 - body.z);
    out.yaw = steerYaw(brain, body.yaw, chooseLook(room, p, now, watch, null), dt, 0.6);
    out.pitch = steerPitch(brain, body.pitch, -0.05, dt);
    if (goal.key.startsWith("post-") && (p.id + Math.floor(now / 6000)) % 3 === 0) out.keys |= KEY.CROUCH;
    return out;
  }

  // Walk the path with cut corners; look around independently of where the legs go.
  let next = brain.path[0];
  while (next && dist2d(next, body) < 0.8) {
    brain.path.shift();
    next = brain.path[0];
  }
  next = !next || (here.x === goal.cell.x && here.z === goal.cell.z) ? goal.exact : smoothNext(room, body, brain.path);
  const dx = next.x - body.x;
  const dz = next.z - body.z;
  const len = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / len, z: dz / len };
  const heading = yawTo(dir.x, dir.z);
  const look = chooseLook(room, p, now, heading, brain.path);
  // Never look so far off the heading that it turns into a backpedal march.
  const off = Math.max(-1.3, Math.min(1.3, angleDiff(look, heading)));
  out.yaw = steerYaw(brain, body.yaw, heading + off, dt, 0.7);
  out.pitch = steerPitch(brain, body.pitch, Math.sin(now / 1700 + p.id) * 0.06, dt);
  if (now >= brain.pauseUntil) out.keys |= moveKeys(out.yaw, dir);
  // A short pause now and then at a corner, like checking it.
  if (now > brain.pauseCheckAt) {
    brain.pauseCheckAt = now + 2500 + brain.rng() * 4000;
    if (brain.rng() < 0.25 && brain.path.length > 2) brain.pauseUntil = now + 250 + brain.rng() * 450;
  }
  // Walk quietly near the objective as a defender, and sometimes when sneaking up as an attacker.
  if ((brain.path.length < 3 && side === SIDES.DEFEND && !bomb.planted) || (brain.role === "lurk" && brain.path.length < 5)) out.keys |= KEY.WALK;

  // Unstick: if a bot that wants to move hasn't moved for a while, sidestep and jump, then repath.
  if (!brain.lastPos || dist2d(brain.lastPos, body) > 0.5) {
    brain.lastPos = { x: body.x, z: body.z };
    brain.lastMoveAt = now;
  } else if (now - brain.lastMoveAt > STUCK_MS && now > brain.unstickUntil && now >= brain.pauseUntil) {
    brain.unstickUntil = now + 500;
    brain.unstickKeys = (brain.rng() < 0.5 ? KEY.LEFT : KEY.RIGHT) | KEY.JUMP;
    brain.repathAt = 0;
    brain.lastMoveAt = now;
  }
  if (now < brain.unstickUntil) out.keys |= brain.unstickKeys;
  return out;
}

// Gunfire is heard: bots on the other team within range look toward it for a while.
export function hearShot(room, shooter, now, range = 35) {
  for (const p of room.players.values()) {
    if (!p.alive || !p.brain || p.team === shooter.team) continue;
    if (Math.hypot(p.body.x - shooter.body.x, p.body.z - shooter.body.z) > range) continue;
    p.brain.heard = { x: shooter.body.x, z: shooter.body.z, at: now };
  }
}
