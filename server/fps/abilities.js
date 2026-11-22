import { eyeHeight, aimDirection, forwardOf, collides, lineOfSight, smokeBetween, toCell, PLAYER, KEY } from "../../src/fps/shared/physics.js";
import { deployPoint, deployWall, grenadeStart, grenadeStep, solidAt, validMapPoint } from "../../src/fps/shared/deploy.js";
import { heroById, ULT } from "../../src/fps/shared/heroes.js";

// Hero skills and ultimates, decided on the server. Effects live in this.effects (and walls in
// room.map.blocks so movement, bullets and sight all respect them); each snapshot carries what a
// player is allowed to see. Placement uses the same maths as the client's deploy preview.
// Cooldowns reset every round, ultimate charge carries over.
const SECOND = 1000;
const BATON = { speed: 34, gravity: 3, life: 0.85 };
const SCOUT = { speed: 8, chase: 7, altitude: 5, sight: 15, life: 7 };

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function abilityState() {
  return { cdUntil: 0, ult: 0, shield: 0, shieldUntil: 0, stealthUntil: 0, revealUntil: 0, slowUntil: 0, speedUntil: 0, focusUntil: 0, stunUntil: 0, dragUntil: 0 };
}

export class Abilities {
  constructor(room) {
    this.room = room;
    this.effects = [];
    this.pushes = [];
    this.nextId = 1;
    this.fallen = [];
  }

  get now() {
    return this.room.clock();
  }

  enemiesOf(p) {
    return [...this.room.players.values()].filter((q) => q.alive && q.team !== p.team);
  }

  teamOf(p) {
    return [...this.room.players.values()].filter((q) => q.alive && q.team === p.team);
  }

  add(effect) {
    effect.id = this.nextId++;
    this.effects.push(effect);
    return effect;
  }

  resetRound() {
    for (const e of this.effects) if (e.block) this.removeBlock(e.block);
    this.effects = [];
    this.pushes = [];
    this.fallen = [];
    for (const p of this.room.players.values()) {
      Object.assign(p.abil, { cdUntil: 0, shield: 0, shieldUntil: 0, stealthUntil: 0, revealUntil: 0, slowUntil: 0, speedUntil: 0, focusUntil: 0, stunUntil: 0, dragUntil: 0 });
    }
  }

  stunned(p, now = this.now) {
    return now < p.abil.stunUntil;
  }

  focused(p, now = this.now) {
    return now < p.abil.focusUntil;
  }

  // ---------- use ----------

  // slot: "skill" | "ult"; aim: { y, p } view angles, plus points [{x, z}] for map-picked abilities.
  // Returns true when it went off.
  use(p, slot, aim) {
    const room = this.room;
    const now = this.now;
    const hero = heroById(p.hero);
    if (!hero || !p.alive || room.round.phase !== "live" || this.stunned(p, now)) return false;
    if (!Number.isFinite(aim?.y) || !Number.isFinite(aim?.p)) return false;
    const a = p.abil;
    const ability = slot === "skill" ? hero.skill : hero.ult;
    // Steering an already-deployed moving shield doesn't need the skill to be off cooldown.
    const steering = slot === "skill" && ability.id === "shield" && this.ownShield(p);
    if (slot === "skill" && now < a.cdUntil && !steering) return false;
    if (slot === "ult" && a.ult < 100) return false;
    const result = this[ability.id]?.(p, aim, now);
    if (result === false || (result === undefined && !this[ability.id])) return false;
    if (result?.free) return true;
    if (slot === "skill") a.cdUntil = now + ability.cooldown * SECOND * (result?.cooldown ?? 1);
    else a.ult = 0;
    // Using anything (but stealth itself) breaks stealth.
    if (ability.id !== "stealth") a.stealthUntil = 0;
    room.broadcast({ t: "ability", id: p.id, kind: ability.id, hero: hero.id });
    return true;
  }

  point(p, aim, range) {
    return deployPoint(this.room.map, p.body, aim.y, aim.p, range);
  }

  // The enemy (or teammate) nearest the crosshair: within range, inside a narrow cone, in sight.
  aimedPlayer(p, aim, range, { team = "enemy", cone = 0.96 } = {}) {
    const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
    const dir = aimDirection(aim.y, aim.p);
    let best = null;
    for (const q of this.room.players.values()) {
      if (q === p || !q.alive || (team === "enemy" ? q.team === p.team : q.team !== p.team)) continue;
      const chest = { x: q.body.x, y: q.body.y + 1.2, z: q.body.z };
      const to = { x: chest.x - eye.x, y: chest.y - eye.y, z: chest.z - eye.z };
      const dist = Math.hypot(to.x, to.y, to.z);
      if (dist > range) continue;
      const cos = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / dist;
      if (cos < cone || !lineOfSight(this.room.map, eye, chest)) continue;
      if (!best || cos > best.cos) best = { q, cos, dist };
    }
    return best;
  }

  // Map-picked points from the laptop, at most `count`, each on open floor.
  mapPoints(aim, count) {
    const points = (Array.isArray(aim.points) ? aim.points : []).slice(0, count).filter((q) => validMapPoint(this.room.map, q));
    return points.length ? points : null;
  }

  // ---------- controller ----------

  smoke(p, aim, now) {
    const points = this.mapPoints(aim, 2);
    if (!points) return false;
    for (const q of points) this.add({ type: "smoke", team: p.team, x: q.x, y: 1.6, z: q.z, r: 4.2, until: now + 12 * SECOND });
    // One cloud costs half the cooldown.
    return { cooldown: points.length === 1 ? 0.5 : 1 };
  }

  laser(p, aim, now) {
    const points = this.mapPoints(aim, 1);
    if (!points) return false;
    const q = points[0];
    const armAt = now + 4.5 * SECOND;
    this.add({ type: "laser", team: p.team, owner: p.id, x: q.x, z: q.z, r: 6, armAt, until: armAt + 4 * SECOND });
    // Everyone hears it coming.
    this.room.broadcast({ t: "laser_warn", x: q.x, z: q.z, r: 6, team: p.team, at: armAt });
  }

  // Stands until enemies break it; only one per Pagar.
  wall(p, aim) {
    for (const old of this.effects.filter((e) => e.type === "wall" && e.owner === p.id)) {
      this.removeBlock(old.block);
      this.effects.splice(this.effects.indexOf(old), 1);
    }
    const block = deployWall(this.room.map, p.body, aim.y, aim.p, heroById("pagar").skill.deploy);
    this.addBlock(block, { type: "wall", team: p.team, owner: p.id, hp: 350, until: Infinity });
  }

  // ---------- skirmisher ----------

  dash(p) {
    const keys = p.lastKeys ?? 0;
    const f = forwardOf(p.body.yaw);
    const r = { x: -f.z, z: f.x };
    let dx = 0;
    let dz = 0;
    if (keys & KEY.FORWARD) (dx += f.x), (dz += f.z);
    if (keys & KEY.BACK) (dx -= f.x), (dz -= f.z);
    if (keys & KEY.RIGHT) (dx += r.x), (dz += r.z);
    if (keys & KEY.LEFT) (dx -= r.x), (dz -= r.z);
    if (!dx && !dz) (dx = f.x), (dz = f.z);
    const len = Math.hypot(dx, dz);
    Object.assign(p.body, { dashT: 0.22, dvx: (dx / len) * 32, dvz: (dz / len) * 32 });
    // Dashing breaks a pull.
    this.pushes = this.pushes.filter((push) => push.id !== p.id);
  }

  stealth(p, aim, now) {
    p.abil.stealthUntil = now + 6 * SECOND;
  }

  boost(p, aim, now) {
    const at = this.point(p, aim, 12);
    this.add({ type: "boost", team: p.team, x: at.x, z: at.z, r: 2.5, until: now + 8 * SECOND });
  }

  // Kafein: the whole team runs faster and shoots steadier for a moment.
  rush(p, aim, now) {
    for (const q of this.teamOf(p)) {
      q.abil.speedUntil = Math.max(q.abil.speedUntil, now + 3 * SECOND);
      q.abil.focusUntil = now + 3 * SECOND;
    }
  }

  // ---------- assault ----------

  grenade(p, aim, now) {
    this.add({ type: "grenade", team: p.team, owner: p.id, ...grenadeStart(p.body, aim.y, aim.p), explodeAt: now + 1.0 * SECOND, dmg: 110, r: 5 });
  }

  barrage(p, aim, now) {
    const at = this.point(p, aim, 40);
    const shots = [];
    for (let i = 0; i < 10; i++) {
      const a = this.room.rng() * Math.PI * 2;
      const d = Math.sqrt(this.room.rng()) * 6;
      shots.push({ at: now + 150 + i * 200, x: at.x + Math.cos(a) * d, z: at.z + Math.sin(a) * d });
    }
    this.add({ type: "barrage", team: p.team, owner: p.id, x: at.x, z: at.z, r: 6, shots, until: now + 2.4 * SECOND });
  }

  // Magnet's skill: a thrown electric baton. It flies where you aim (no homing); the first enemy
  // it touches is stunned for 1.5 s.
  stun(p, aim, now) {
    const dir = aimDirection(aim.y, aim.p);
    const eye = eyeHeight(p.body);
    this.add({ type: "baton", team: p.team, owner: p.id, x: p.body.x + dir.x * 0.5, y: eye + dir.y * 0.5, z: p.body.z + dir.z * 0.5, vx: dir.x * BATON.speed, vy: dir.y * BATON.speed, vz: dir.z * BATON.speed, until: now + BATON.life * SECOND });
  }

  vortex(p, aim, now) {
    const at = this.point(p, aim, 30);
    this.add({ type: "vortex", team: p.team, x: at.x, z: at.z, r: 7, until: now + 2 * SECOND });
  }

  // ---------- support ----------

  heal(p, aim, now) {
    const at = this.point(p, aim, 10);
    this.add({ type: "heal", team: p.team, x: at.x, z: at.z, r: 4, until: now + 6 * SECOND });
  }

  // A fallen teammate's body under the crosshair (closest to the aim within range), or null.
  aimedCorpse(p, aim, range) {
    const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
    const dir = aimDirection(aim.y, aim.p);
    let best = null;
    for (const f of this.fallen) {
      if (f.team !== p.team || this.room.players.get(f.id)?.alive) continue;
      const to = { x: f.x - eye.x, y: 0.3 - eye.y, z: f.z - eye.z };
      const dist = Math.hypot(to.x, to.y, to.z);
      if (dist > range) continue;
      const cos = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / dist;
      if (cos < 0.94) continue;
      if (!best || cos > best.cos) best = { f, cos };
    }
    return best?.f ?? null;
  }

  revive(p, aim, now) {
    // Pick the body: the teammate stands back up right where they fell.
    const fallen = this.aimedCorpse(p, aim, 40);
    if (!fallen) return false;
    const q = this.room.players.get(fallen.id);
    const spot = this.freeSpotNear({ x: fallen.x, z: fallen.z });
    Object.assign(q.body, { x: spot.x, z: spot.z, y: 0, vx: 0, vy: 0, vz: 0, dashT: 0 });
    q.alive = true;
    q.hp = 60;
    q.respawnAt = 0;
    // Their guns stayed on the floor: back up with the sidearm.
    if (!q.slots?.primary && !q.slots?.secondary) this.room.equip(q, { primary: null, secondary: "pistol" });
    q.weapon = this.room.bestWeapon(q);
    this.room.broadcast({ t: "revived", id: q.id, by: p.id });
    for (const q of this.teamOf(p)) {
      q.abil.shield = 40;
      q.abil.shieldUntil = now + 10 * SECOND;
    }
  }

  freeSpotNear(body) {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) {
      const x = body.x + dx * 1.2;
      const z = body.z + dz * 1.2;
      if (!collides(this.room.map, x, z)) return { x, z };
    }
    return { x: body.x, z: body.z };
  }

  ownShield(p) {
    return this.effects.find((e) => e.type === "barrier" && e.owner === p.id);
  }

  // Tameng's skill: a 4 s shield. Pressing again while it's up sends it to where you aim (it slides
  // there and turns to face the new direction) without using the cooldown.
  shield(p, aim, now) {
    const box = deployWall(this.room.map, p.body, aim.y, aim.p, heroById("tameng").skill.deploy, 0.15, 2);
    const active = this.ownShield(p);
    if (active) {
      active.goal = box;
      return { free: true };
    }
    this.addBlock(box, { type: "barrier", team: p.team, owner: p.id, hp: 400, until: now + 4 * SECOND });
  }

  // Tameng's ultimate: leap to the aimed teammate, then raise an electric fence ahead of them.
  // Allies walk through it; enemies can't, and touching it shocks and slows them.
  leap(p, aim, now) {
    const hit = this.aimedPlayer(p, aim, heroById("tameng").ult.deploy.range, { team: "ally", cone: 0.95 });
    if (!hit) return false;
    const ally = hit.q;
    const dx = ally.body.x - p.body.x;
    const dz = ally.body.z - p.body.z;
    const d = Math.hypot(dx, dz) || 1;
    const travel = Math.max(0, d - 1.2);
    const time = Math.max(0.3, Math.min(1.1, travel / 20));
    Object.assign(p.body, { dashT: time, dvx: (dx / d) * (travel / time), dvz: (dz / d) * (travel / time), vy: 6, grounded: false });
    this.pushes = this.pushes.filter((push) => push.id !== p.id);
    this.add({ type: "leapFence", team: p.team, owner: p.id, x: ally.body.x, z: ally.body.z, yaw: Math.atan2(-dx, -dz), at: now + time * SECOND, until: now + time * SECOND + 200 });
    this.room.broadcast({ t: "leap", id: p.id, to: ally.id, ms: Math.round(time * 1000) });
  }

  raiseFence(e, now) {
    const f = forwardOf(e.yaw);
    const center = { x: e.x + f.x * 3, z: e.z + f.z * 3 };
    const alongX = Math.abs(f.z) > Math.abs(f.x);
    const half = 4;
    const thick = 0.2;
    const block = alongX
      ? { x0: center.x - half, x1: center.x + half, z0: center.z - thick, z1: center.z + thick, h: 2.6, pass: e.team }
      : { x0: center.x - thick, x1: center.x + thick, z0: center.z - half, z1: center.z + half, h: 2.6, pass: e.team };
    this.addBlock(block, { type: "fence", team: e.team, owner: e.owner, hp: 900, until: now + 12 * SECOND, burn: new Map() }, e.team);
  }

  // Grenades and firecrackers can't get into an enemy dome.
  insideEnemyDome(pos, team) {
    return this.effects.some((d) => d.type === "dome" && d.team !== team && Math.hypot(pos.x - d.x, pos.z - d.z) < d.r);
  }

  // Electric dome: teammates walk through freely; enemies inside are stunned on entry, staggered
  // (slowed) while inside and burn for 20 damage a second. Bullets from outside stop at the shell.
  dome(p, aim, now) {
    const at = this.point(p, aim, 10);
    this.add({ type: "dome", team: p.team, owner: p.id, x: at.x, z: at.z, r: 4.5, hp: 1200, until: now + 8 * SECOND, inside: new Set(), burn: new Map() });
  }

  // ---------- recon ----------

  scan(p, aim, now) {
    // A 60° cone, 40 m; passes walls but not smoke, and stealthed enemies slip through.
    const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
    const f = forwardOf(aim.y);
    const smokes = this.smokes();
    for (const e of this.enemiesOf(p)) {
      const dx = e.body.x - p.body.x;
      const dz = e.body.z - p.body.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 40 || (dist > 1 && (dx * f.x + dz * f.z) / dist < Math.cos(Math.PI / 6))) continue;
      if (now < e.abil.stealthUntil) continue;
      if (smokeBetween(smokes, eye, { x: e.body.x, y: e.body.y + 1.2, z: e.body.z })) continue;
      this.revealPlayer(e, now + 3 * SECOND);
    }
    this.room.broadcast({ t: "scan", id: p.id, yaw: aim.y, team: p.team });
  }

  reveal(p, aim, now) {
    for (const e of this.enemiesOf(p)) if (now >= e.abil.stealthUntil) this.revealPlayer(e, now + 3 * SECOND);
  }

  // Defusing makes noise: attackers anywhere close enough hear it and come running.
  hearDefuse(defuser) {
    for (const q of this.room.players.values()) {
      if (q.team === defuser.team || !q.brain || !q.alive) continue;
      if (Math.hypot(q.body.x - defuser.body.x, q.body.z - defuser.body.z) < 45) q.brain.heard = { x: defuser.body.x, z: defuser.body.z, at: this.now };
    }
  }

  revealPlayer(e, until) {
    e.abil.revealUntil = Math.max(e.abil.revealUntil, until);
    // Bots on the other side learn where they are.
    for (const q of this.room.players.values()) {
      if (q.team !== e.team && q.brain) q.brain.heard = { x: e.body.x, z: e.body.z, at: this.now };
    }
  }

  // A scout drone: climbs above the walls, flies ahead, and once it spots an enemy it shadows them.
  scouts(p, aim, now) {
    const f = forwardOf(aim.y);
    this.add({ type: "scout", team: p.team, owner: p.id, x: p.body.x + f.x * 0.8, y: 2, z: p.body.z + f.z * 0.8, vx: f.x * SCOUT.speed, vz: f.z * SCOUT.speed, hp: 80, maxHp: 80, until: now + SCOUT.life * SECOND, track: null });
  }

  // Can the scout see this enemy from up there?
  scoutSees(e, q, now) {
    if (!q.alive || (now < q.abil.stealthUntil && flat(q.body, e) > 3)) return false;
    if (flat(q.body, e) > SCOUT.sight) return false;
    const chest = { x: q.body.x, y: q.body.y + 1.2, z: q.body.z };
    return lineOfSight(this.room.map, e, chest) && !smokeBetween(this.smokes(), e, chest);
  }

  // The hunter drone: tougher (150 hp), seeks the nearest enemy and explodes.
  drone(p, aim, now) {
    this.add({ type: "drone", team: p.team, owner: p.id, x: p.body.x, y: 2.2, z: p.body.z, hp: 150, maxHp: 150, until: now + 10 * SECOND });
  }

  // ---------- walls ----------

  addBlock(block, effect, passTeam = null) {
    // Don't trap anyone inside a new wall: nudge them out along the thin side.
    for (const q of this.room.players.values()) {
      if (!q.alive || q.team === passTeam) continue;
      const r = PLAYER.radius;
      if (q.body.x + r > block.x0 && q.body.x - r < block.x1 && q.body.z + r > block.z0 && q.body.z - r < block.z1) {
        const thinX = block.x1 - block.x0 < block.z1 - block.z0;
        if (thinX) q.body.x = q.body.x < (block.x0 + block.x1) / 2 ? block.x0 - r - 0.05 : block.x1 + r + 0.05;
        else q.body.z = q.body.z < (block.z0 + block.z1) / 2 ? block.z0 - r - 0.05 : block.z1 + r + 0.05;
      }
    }
    this.room.map.blocks.push(block);
    effect.block = block;
    this.add(effect);
  }

  removeBlock(block) {
    const list = this.room.map.blocks;
    const i = list.indexOf(block);
    if (i >= 0) list.splice(i, 1);
  }

  // Bullets chip walls and barriers (never your own team's); returns true if a wall took the hit.
  hitBlockAt(point, damage, team = null) {
    for (const e of this.effects) {
      const b = e.block;
      if (!b) continue;
      if (point.x >= b.x0 - 0.05 && point.x <= b.x1 + 0.05 && point.z >= b.z0 - 0.05 && point.z <= b.z1 + 0.05 && point.y <= b.h + 0.05) {
        if (e.team !== team) e.hp -= damage;
        return true;
      }
    }
    return false;
  }

  // Dome entry along a ray from outside: { t, dome } for the nearest dome the shot enters, or null.
  domeHit(origin, dir, maxDist) {
    let best = null;
    for (const d of this.effects) {
      if (d.type !== "dome") continue;
      const ox = origin.x - d.x;
      const oy = origin.y;
      const oz = origin.z - d.z;
      if (ox * ox + oy * oy + oz * oz < d.r * d.r) continue;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - d.r * d.r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < maxDist && (!best || t < best.t)) best = { t, dome: d };
    }
    return best;
  }

  // Enemy drones a shot can hit: { t, drone } for the nearest along the ray, or null.
  droneHit(origin, dir, maxDist, shooterTeam) {
    let best = null;
    for (const d of this.effects) {
      if ((d.type !== "scout" && d.type !== "drone") || d.team === shooterTeam) continue;
      const ox = origin.x - d.x;
      const oy = origin.y - d.y;
      const oz = origin.z - d.z;
      const r = 0.4;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < maxDist && (!best || t < best.t)) best = { t, drone: d };
    }
    return best;
  }

  // ---------- explosions ----------

  explode(owner, at, dmg, r) {
    const room = this.room;
    const center = { x: at.x, y: Math.max(0.3, at.y ?? 0.3), z: at.z };
    room.broadcast({ t: "boom", x: center.x, y: center.y, z: center.z, r });
    const attacker = room.players.get(owner);
    for (const e of room.players.values()) {
      if (!e.alive || e.team === attacker?.team) continue;
      const d = Math.hypot(e.body.x - center.x, e.body.y + 1 - center.y, e.body.z - center.z);
      if (d > r) continue;
      // Walls, barriers and domes between the blast and the target soak it.
      if (!lineOfSight(room.map, center, { x: e.body.x, y: e.body.y + 1, z: e.body.z })) continue;
      if (this.domeHit(center, normalize(e.body.x - center.x, e.body.y + 1 - center.y, e.body.z - center.z), d)) continue;
      const amount = Math.round(dmg * (1 - (d / r) * 0.65));
      if (attacker) room.damage(attacker, e, amount, "body");
    }
    // Explosions shred walls, barriers, domes and drones.
    for (const fx of this.effects) {
      if (fx.team === attacker?.team) continue;
      if (fx.block && flat(blockCenter(fx.block), center) < r + 2) fx.hp -= dmg * 2.5;
      if (fx.type === "dome" && flat(fx, center) < r + fx.r) fx.hp -= dmg * 3;
      if ((fx.type === "scout" || fx.type === "drone") && fx.team !== attacker?.team && flat(fx, center) < r) fx.hp -= dmg;
    }
  }

  // ---------- per tick ----------

  smokes() {
    return this.effects.filter((e) => e.type === "smoke");
  }

  speedFactor(p, now = this.now) {
    if (this.stunned(p, now)) return 0;
    let k = 1;
    if (now < p.abil.stealthUntil) k *= 1.3;
    if (now < p.abil.speedUntil) k *= 1.3;
    if (this.effects.some((e) => e.type === "laser" && now >= e.armAt && e.team !== p.team && flat(e, p.body) < e.r)) k *= 0.4;
    else if (now < p.abil.slowUntil) k *= 0.55;
    else if (now < p.abil.dragUntil) k *= 0.75;
    else if (this.effects.some((e) => e.type === "slow" && e.team !== p.team && flat(e, p.body) < e.r)) k *= 0.5;
    return k;
  }

  // Damage over time from one source, in whole points.
  burn(owner, victim, store, dps, dt) {
    const acc = (store.get(victim.id) ?? 0) + dps * dt;
    const whole = Math.floor(acc);
    store.set(victim.id, acc - whole);
    const attacker = this.room.players.get(owner);
    if (whole > 0 && attacker) this.room.damage(attacker, victim, whole, "body");
  }

  tick(now, dt) {
    const room = this.room;
    if (room.round.phase !== "live") return;
    for (const p of room.players.values()) {
      if (p.alive) p.abil.ult = Math.min(100, p.abil.ult + ULT.perSecond * dt);
      if (p.abil.shieldUntil && now >= p.abil.shieldUntil) p.abil.shield = 0;
    }
    // Pulls.
    this.pushes = this.pushes.filter((push) => {
      const p = room.players.get(push.id);
      if (!p?.alive || now >= push.until) return false;
      const nx = p.body.x + push.vx * dt;
      const nz = p.body.z + push.vz * dt;
      if (!collides(room.map, nx, p.body.z)) p.body.x = nx;
      if (!collides(room.map, p.body.x, nz)) p.body.z = nz;
      return true;
    });
    const keep = [];
    for (const e of this.effects) {
      const broken = e.hp !== undefined && e.hp <= 0;
      if (broken || this.update(e, now, dt) === false || now >= e.until) {
        if (e.block) this.removeBlock(e.block);
        if (broken) {
          const at = e.block ? blockCenter(e.block) : e;
          room.broadcast({ t: "broken", fx: e.id, kind: e.type, x: at.x, y: e.y ?? 1, z: at.z });
        }
        continue;
      }
      keep.push(e);
    }
    this.effects = keep;
  }

  // Returns false to remove the effect.
  update(e, now, dt) {
    const room = this.room;
    if (e.type === "grenade") {
      const before = { x: e.x, z: e.z };
      grenadeStep(room.map, e, dt);
      // Bounces off the shell of an enemy dome.
      if (this.insideEnemyDome(e, e.team) && !this.insideEnemyDome(before, e.team)) {
        Object.assign(e, before);
        e.vx *= -0.5;
        e.vz *= -0.5;
      }
      if (now >= e.explodeAt) {
        this.explode(e.owner, e, e.dmg, e.r);
        return false;
      }
    } else if (e.type === "barrage") {
      while (e.shots.length && now >= e.shots[0].at) {
        const s = e.shots.shift();
        // Firecrackers landing inside an enemy dome fizzle on its shell.
        if (this.insideEnemyDome(s, e.team)) continue;
        this.explode(e.owner, { x: s.x, y: 0.3, z: s.z }, 65, 3.5);
      }
    } else if (e.type === "vortex") {
      for (const q of this.enemiesOf({ team: e.team })) {
        const d = flat(q.body, e);
        if (d > e.r) continue;
        q.abil.dragUntil = Math.max(q.abil.dragUntil, now + 2 * SECOND);
        if (d < 0.6) continue;
        const pull = 8 * dt;
        const nx = q.body.x + ((e.x - q.body.x) / d) * pull;
        const nz = q.body.z + ((e.z - q.body.z) / d) * pull;
        if (!collides(room.map, nx, q.body.z)) q.body.x = nx;
        if (!collides(room.map, q.body.x, nz)) q.body.z = nz;
      }
    } else if (e.type === "heal") {
      // Health only ever goes up in whole points; the fractions carry over to the next tick.
      e.store ??= new Map();
      for (const q of this.teamOf({ team: e.team })) {
        if (flat(q.body, e) >= e.r || q.hp >= PLAYER.maxHealth) continue;
        const acc = (e.store.get(q.id) ?? 0) + 14 * dt;
        const whole = Math.floor(acc);
        e.store.set(q.id, acc - whole);
        q.hp = Math.min(PLAYER.maxHealth, q.hp + whole);
      }
    } else if (e.type === "leapFence") {
      if (now >= e.at) {
        this.raiseFence(e, now);
        return false;
      }
    } else if (e.type === "fence") {
      // Enemies pressed against the fence get shocked and slowed.
      for (const q of this.enemiesOf({ team: e.team })) {
        const b = e.block;
        const dx = Math.max(b.x0 - q.body.x, 0, q.body.x - b.x1);
        const dz = Math.max(b.z0 - q.body.z, 0, q.body.z - b.z1);
        if (Math.hypot(dx, dz) > 1) continue;
        q.abil.slowUntil = Math.max(q.abil.slowUntil, now + 0.6 * SECOND);
        this.burn(e.owner, q, e.burn, 25, dt);
      }
    } else if (e.type === "barrier" && e.goal) {
      // The moving shield slides toward where it was sent and turns to face it.
      const b = e.block;
      const g = e.goal;
      const step = 9 * dt;
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const gx = (g.x0 + g.x1) / 2;
      const gz = (g.z0 + g.z1) / 2;
      const d = Math.hypot(gx - cx, gz - cz);
      const k = d <= step ? 1 : step / d;
      const nx = cx + (gx - cx) * k;
      const nz = cz + (gz - cz) * k;
      const hw = (g.x1 - g.x0) / 2;
      const hd = (g.z1 - g.z0) / 2;
      const next = { x0: nx - hw, x1: nx + hw, z0: nz - hd, z1: nz + hd };
      const blocked = [...room.players.values()].some((q) => q.alive && q.body.x + PLAYER.radius > next.x0 && q.body.x - PLAYER.radius < next.x1 && q.body.z + PLAYER.radius > next.z0 && q.body.z - PLAYER.radius < next.z1);
      if (!blocked) Object.assign(b, next);
      if (d <= step || blocked) e.goal = null;
    } else if (e.type === "boost") {
      for (const q of this.teamOf({ team: e.team })) if (flat(q.body, e) < e.r) q.abil.speedUntil = Math.max(q.abil.speedUntil, now + 2 * SECOND);
    } else if (e.type === "dome") {
      for (const q of this.enemiesOf({ team: e.team })) {
        if (flat(q.body, e) >= e.r) {
          e.inside.delete(q.id);
          continue;
        }
        // Stunned on the way in, staggered while inside.
        if (!e.inside.has(q.id)) {
          e.inside.add(q.id);
          q.abil.stunUntil = Math.max(q.abil.stunUntil, now + 0.7 * SECOND);
          room.sendTo(q, { t: "stunned", ms: 700 });
        }
        q.abil.slowUntil = Math.max(q.abil.slowUntil, now + 0.4 * SECOND);
        this.burn(e.owner, q, e.burn, 20, dt);
      }
    } else if (e.type === "laser") {
      if (now >= e.armAt) {
        // Less raw damage than before, but everyone caught is bogged down and keeps taking it.
        e.burnStore ??= new Map();
        for (const q of this.enemiesOf({ team: e.team })) if (flat(q.body, e) < e.r) this.burn(e.owner, q, e.burnStore, 40, dt);
      }
    } else if (e.type === "scout") {
      // Climb above the walls first.
      e.y += (SCOUT.altitude - e.y) * Math.min(1, dt * 2.5);
      const enemies = this.enemiesOf({ team: e.team });
      let target = e.track && room.players.get(e.track);
      if (target && !this.scoutSees(e, target, now)) target = null;
      if (!target) target = enemies.filter((q) => this.scoutSees(e, q, now)).sort((a, b) => flat(a.body, e) - flat(b.body, e))[0] ?? null;
      e.track = target?.id ?? null;
      if (target) {
        // Shadow them from above, a couple of meters back.
        const d = flat(target.body, e);
        const gap = Math.max(0, d - 2);
        const s = Math.min(gap, SCOUT.chase * dt);
        e.vx = d ? ((target.body.x - e.x) / d) * SCOUT.chase : 0;
        e.vz = d ? ((target.body.z - e.z) / d) * SCOUT.chase : 0;
        if (d) Object.assign(e, { x: e.x + ((target.body.x - e.x) / d) * s, z: e.z + ((target.body.z - e.z) / d) * s });
      } else {
        const nx = e.x + e.vx * dt;
        const nz = e.z + e.vz * dt;
        // Stops at the edge of the map (or anything taller than it flies).
        const cx = toCell(nx);
        const cz = toCell(nz);
        if (cx <= 0 || cz <= 0 || cx >= room.map.width - 1 || cz >= room.map.height - 1 || solidAt(room.map, nx, e.y, nz)) e.vx = e.vz = 0;
        else Object.assign(e, { x: nx, z: nz });
      }
      for (const q of enemies) if (q === target || (q.alive && this.scoutSees(e, q, now) && flat(q.body, e) < 8)) this.revealPlayer(q, now + 1.5 * SECOND);
    } else if (e.type === "baton") {
      // Small steps so it can't skip through a body or a thin wall.
      const steps = Math.ceil((BATON.speed * dt) / 0.25);
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const before = { x: e.x, z: e.z };
        e.vy -= BATON.gravity * h;
        e.x += e.vx * h;
        e.y += e.vy * h;
        e.z += e.vz * h;
        if (e.y <= 0 || solidAt(room.map, e.x, e.y, e.z) || (this.insideEnemyDome(e, e.team) && !this.insideEnemyDome(before, e.team))) {
          room.broadcast({ t: "zapped", x: e.x, y: Math.max(0.1, e.y), z: e.z, team: e.team });
          return false;
        }
        for (const q of this.enemiesOf({ team: e.team })) {
          const top = q.body.y + (q.body.crouch ? 1.3 : 1.85);
          if (flat(q.body, e) > PLAYER.radius + 0.25 || e.y < q.body.y || e.y > top) continue;
          q.abil.stunUntil = Math.max(q.abil.stunUntil, now + 1.5 * SECOND);
          room.sendTo(q, { t: "stunned", ms: 1500 });
          room.broadcast({ t: "zapped", x: e.x, y: e.y, z: e.z, team: e.team, hit: q.id });
          return false;
        }
      }
    } else if (e.type === "drone") {
      const target = this.enemiesOf({ team: e.team }).sort((a, b) => flat(a.body, e) - flat(b.body, e))[0];
      if (target) {
        const d = flat(target.body, e);
        const speed = 7;
        // Fly high over walls, dive when close.
        const altitude = d < 3 ? target.body.y + 1.2 : 5;
        e.x += ((target.body.x - e.x) / (d || 1)) * Math.min(d, speed * dt);
        e.z += ((target.body.z - e.z) / (d || 1)) * Math.min(d, speed * dt);
        e.y += (altitude - e.y) * Math.min(1, dt * 3);
        if (d < 1.2 && Math.abs(e.y - (target.body.y + 1.2)) < 0.8) {
          this.explode(e.owner, e, 75, 3);
          return false;
        }
      }
    }
    return true;
  }

  // ---------- events ----------

  onKill(attacker, victim, assists) {
    attacker.abil.ult = Math.min(100, attacker.abil.ult + ULT.kill);
    for (const id of assists) {
      const q = this.room.players.get(id);
      if (q) q.abil.ult = Math.min(100, q.abil.ult + ULT.assist);
    }
    // Bodies stay where they fell (Jamu can revive them there).
    this.fallen = this.fallen.filter((f) => f.id !== victim.id);
    this.fallen.push({ id: victim.id, team: victim.team, at: this.now, x: victim.body.x, z: victim.body.z });
  }

  onDamage(attacker, amount) {
    attacker.abil.ult = Math.min(100, attacker.abil.ult + amount * ULT.damage);
  }

  // Shields soak damage first. Returns what's left for health.
  absorb(victim, amount) {
    const a = victim.abil;
    if (a.shield > 0 && this.now < a.shieldUntil) {
      const soaked = Math.min(a.shield, amount);
      a.shield -= soaked;
      return amount - soaked;
    }
    return amount;
  }

  // What one player gets told: their own state, and the effects they may see.
  snapshotFor(me, now) {
    const effects = [];
    for (const e of this.effects) {
      const out = { id: e.id, type: e.type, team: e.team };
      if (e.block) Object.assign(out, { x0: round(e.block.x0), z0: round(e.block.z0), x1: round(e.block.x1), z1: round(e.block.z1), h: e.block.h, pass: e.block.pass });
      if (e.owner === me.id) out.mine = 1;
      Object.assign(out, { x: round(e.x), y: round(e.y ?? 0), z: round(e.z), r: e.r });
      if (e.maxHp) out.hp = Math.max(0, e.hp / e.maxHp);
      if (e.type === "laser") out.armIn = Math.max(0, e.armAt - now);
      effects.push(out);
    }
    const a = me.abil;
    const left = (until) => Math.max(0, until - now);
    return {
      effects,
      ab: {
        cd: left(a.cdUntil),
        ult: Math.floor(a.ult),
        sh: a.shield > 0 && now < a.shieldUntil ? Math.round(a.shield) : 0,
        sf: this.speedFactor(me, now),
        st: left(a.stealthUntil),
        sp: left(a.speedUntil),
        fo: left(a.focusUntil),
        stun: left(a.stunUntil),
        slow: Math.max(left(a.slowUntil), left(a.dragUntil)),
      },
    };
  }
}

const round = (v) => Math.round(v * 100) / 100;
const blockCenter = (b) => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });
function normalize(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
