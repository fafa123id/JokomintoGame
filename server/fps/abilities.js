import { eyeHeight, aimDirection, rayWorld, forwardOf, collides, lineOfSight, smokeBetween, toCell, cellAt, PLAYER, KEY, WALL_HEIGHT, COVER_HEIGHT } from "../../src/fps/shared/physics.js";

import { heroById, ULT } from "../../src/fps/shared/heroes.js";

// Hero skills and ultimates, decided on the server. Effects live in this.effects (and walls in
// room.map.blocks so movement, bullets and sight all respect them); each snapshot carries what a
// player is allowed to see. Cooldowns reset every round, ultimate charge carries over.
const SECOND = 1000;
const GRAVITY = 14;

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function abilityState() {
  return { cdUntil: 0, ult: 0, shield: 0, shieldUntil: 0, stealthUntil: 0, revealUntil: 0, slowUntil: 0, jumpUntil: 0 };
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

  // Where the player is aiming: the first wall/floor hit within range, or the point at range.
  aimPoint(p, aim, range) {
    const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
    const dir = aimDirection(aim.y, aim.p);
    const t = Math.max(0, rayWorld(this.room.map, eye, dir, range) - 0.4);
    return { x: eye.x + dir.x * t, y: Math.max(0, eye.y + dir.y * t), z: eye.z + dir.z * t };
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
      Object.assign(p.abil, { cdUntil: 0, shield: 0, shieldUntil: 0, stealthUntil: 0, revealUntil: 0, slowUntil: 0, jumpUntil: 0 });
    }
  }

  // ---------- use ----------

  // slot: "skill" | "ult"; aim: { y, p } (view angles). Returns true when it went off.
  use(p, slot, aim) {
    const room = this.room;
    const now = this.now;
    const hero = heroById(p.hero);
    if (!hero || !p.alive || room.round.phase !== "live" || !Number.isFinite(aim?.y) || !Number.isFinite(aim?.p)) return false;
    const a = p.abil;
    if (slot === "skill" && now < a.cdUntil) return false;
    if (slot === "ult" && a.ult < 100) return false;
    const kind = slot === "skill" ? hero.skill.id : hero.ult.id;
    const done = this[kind]?.(p, aim, now);
    if (done === false) return false;
    if (slot === "skill") a.cdUntil = now + hero.skill.cooldown * SECOND;
    else a.ult = 0;
    // Using anything (but stealth itself) breaks stealth.
    if (kind !== "stealth") a.stealthUntil = 0;
    room.broadcast({ t: "ability", id: p.id, kind, hero: hero.id });
    return true;
  }

  // ---------- controller ----------

  smoke(p, aim, now, r = 4.2, life = 12) {
    const at = this.aimPoint(p, aim, 32);
    this.add({ type: "smoke", team: p.team, x: at.x, y: 1.6, z: at.z, r, until: now + life * SECOND });
  }

  smokeDome(p, aim, now) {
    this.smoke(p, aim, now, 9, 15);
  }

  wall(p, aim, now) {
    // A 6 m wall across the aim direction, snapped to the grid axes.
    const at = this.aimPoint(p, { y: aim.y, p: Math.min(aim.p, -0.05) }, 8);
    const f = forwardOf(aim.y);
    const alongX = Math.abs(f.z) > Math.abs(f.x);
    const half = 3;
    const thick = 0.25;
    const block = alongX
      ? { x0: at.x - half, x1: at.x + half, z0: at.z - thick, z1: at.z + thick, h: 3 }
      : { x0: at.x - thick, x1: at.x + thick, z0: at.z - half, z1: at.z + half, h: 3 };
    this.addBlock(block, { type: "wall", team: p.team, hp: 350, until: now + 8 * SECOND });
  }

  slowZone(p, aim, now) {
    const at = this.aimPoint(p, aim, 30);
    this.add({ type: "slow", team: p.team, x: at.x, z: at.z, r: 7, until: now + 8 * SECOND });
  }

  // ---------- skirmisher ----------

  dash(p, aim, now) {
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

  jumpPad(p, aim, now) {
    const at = this.aimPoint(p, { y: aim.y, p: Math.min(aim.p, -0.3) }, 5);
    this.add({ type: "pad", team: p.team, x: at.x, z: at.z, r: 1.1, until: now + 20 * SECOND });
  }

  teamJump(p, aim, now) {
    for (const q of this.teamOf(p)) if (flat(q.body, p.body) < 12) q.abil.jumpUntil = now + 10 * SECOND;
  }

  // ---------- assault ----------

  grenade(p, aim, now) {
    const dir = aimDirection(aim.y, aim.p + 0.15);
    const eye = eyeHeight(p.body);
    this.add({ type: "grenade", team: p.team, owner: p.id, x: p.body.x + dir.x * 0.6, y: eye, z: p.body.z + dir.z * 0.6, vx: dir.x * 17, vy: dir.y * 17 + 2, vz: dir.z * 17, explodeAt: now + 1.6 * SECOND, dmg: 85, r: 5 });
  }

  barrage(p, aim, now) {
    const at = this.aimPoint(p, aim, 40);
    const shots = [];
    for (let i = 0; i < 9; i++) {
      const a = this.room.rng() * Math.PI * 2;
      const d = Math.sqrt(this.room.rng()) * 6;
      shots.push({ at: now + 400 + i * 300, x: at.x + Math.cos(a) * d, z: at.z + Math.sin(a) * d });
    }
    this.add({ type: "barrage", team: p.team, owner: p.id, x: at.x, z: at.z, r: 6, shots, until: now + 3.6 * SECOND });
  }

  pull(p, aim, now) {
    // The enemy closest to the crosshair within 20 m and in clear sight.
    const eye = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
    const dir = aimDirection(aim.y, aim.p);
    let best = null;
    for (const e of this.enemiesOf(p)) {
      const chest = { x: e.body.x, y: e.body.y + 1.2, z: e.body.z };
      const to = { x: chest.x - eye.x, y: chest.y - eye.y, z: chest.z - eye.z };
      const dist = Math.hypot(to.x, to.y, to.z);
      if (dist > 20) continue;
      const cos = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / dist;
      if (cos < 0.96 || !lineOfSight(this.room.map, eye, chest)) continue;
      if (!best || cos > best.cos) best = { e, cos, dist };
    }
    if (!best) return false;
    const e = best.e;
    const pullDist = Math.min(4.5, best.dist - 1.5);
    const k = 0.35;
    this.pushes.push({ id: e.id, vx: ((p.body.x - e.body.x) / best.dist) * (pullDist / k), vz: ((p.body.z - e.body.z) / best.dist) * (pullDist / k), until: now + k * SECOND });
    this.room.broadcast({ t: "beam", from: p.id, to: e.id });
  }

  vortex(p, aim, now) {
    const at = this.aimPoint(p, aim, 30);
    this.add({ type: "vortex", team: p.team, x: at.x, z: at.z, r: 7, until: now + 1.6 * SECOND });
    for (const e of this.enemiesOf(p)) if (flat(e.body, at) < 7) e.abil.slowUntil = Math.max(e.abil.slowUntil, now + 3 * SECOND);
  }

  // ---------- support ----------

  heal(p, aim, now) {
    const at = this.aimPoint(p, { y: aim.y, p: Math.min(aim.p, -0.4) }, 6);
    this.add({ type: "heal", team: p.team, x: at.x, z: at.z, r: 4, until: now + 6 * SECOND });
  }

  revive(p, aim, now) {
    // The teammate who fell most recently comes back beside the caster.
    const fallen = this.fallen.filter((f) => f.team === p.team && !this.room.players.get(f.id)?.alive).at(-1);
    if (fallen) {
      const q = this.room.players.get(fallen.id);
      const spot = this.freeSpotNear(p.body);
      Object.assign(q.body, { x: spot.x, z: spot.z, y: 0, vx: 0, vy: 0, vz: 0, dashT: 0 });
      q.alive = true;
      q.hp = 60;
      q.weapon = this.room.bestWeapon(q);
      this.room.broadcast({ t: "revived", id: q.id, by: p.id });
    }
    for (const q of this.teamOf(p)) {
      q.abil.shield = 40;
      q.abil.shieldUntil = now + 10 * SECOND;
    }
  }

  freeSpotNear(body) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) {
      const x = body.x + dx * 1.2;
      const z = body.z + dz * 1.2;
      if (!collides(this.room.map, x, z)) return { x, z };
    }
    return { x: body.x, z: body.z };
  }

  shield(p, aim, now) {
    const f = forwardOf(aim.y);
    const at = { x: p.body.x + f.x * 1.6, z: p.body.z + f.z * 1.6 };
    const alongX = Math.abs(f.z) > Math.abs(f.x);
    const half = 1.5;
    const thick = 0.15;
    const block = alongX
      ? { x0: at.x - half, x1: at.x + half, z0: at.z - thick, z1: at.z + thick, h: 2 }
      : { x0: at.x - thick, x1: at.x + thick, z0: at.z - half, z1: at.z + half, h: 2 };
    this.addBlock(block, { type: "barrier", team: p.team, hp: 400, until: now + 10 * SECOND });
  }

  dome(p, aim, now) {
    this.add({ type: "dome", team: p.team, x: p.body.x, z: p.body.z, r: 4.5, hp: 1200, until: now + 8 * SECOND });
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
    this.room.broadcast({ t: "scan", id: p.id, yaw: aim.y });
  }

  reveal(p, aim, now) {
    for (const e of this.enemiesOf(p)) if (now >= e.abil.stealthUntil) this.revealPlayer(e, now + 3 * SECOND);
  }

  revealPlayer(e, until) {
    e.abil.revealUntil = Math.max(e.abil.revealUntil, until);
    // Bots on the other side learn where they are.
    for (const q of this.room.players.values()) {
      if (q.team !== e.team && q.brain) q.brain.heard = { x: e.body.x, z: e.body.z, at: this.now };
    }
  }

  sensor(p, aim, now) {
    const mine = this.effects.filter((e) => e.type === "sensor" && e.owner === p.id);
    if (mine.length >= 2) this.effects.splice(this.effects.indexOf(mine[0]), 1);
    const at = this.aimPoint(p, { y: aim.y, p: Math.min(aim.p, -0.1) }, 15);
    this.add({ type: "sensor", team: p.team, owner: p.id, x: at.x, z: at.z, r: 3.5, until: Infinity });
  }

  drone(p, aim, now) {
    this.add({ type: "drone", team: p.team, owner: p.id, x: p.body.x, y: 2.2, z: p.body.z, until: now + 10 * SECOND });
  }

  // ---------- walls ----------

  addBlock(block, effect) {
    // Don't trap anyone inside a new wall: nudge them out along the thin side.
    for (const q of this.room.players.values()) {
      if (!q.alive) continue;
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

  // Bullets chip walls and barriers; returns true if a wall took the hit at this point.
  hitBlockAt(point, damage) {
    for (const e of this.effects) {
      const b = e.block;
      if (!b) continue;
      if (point.x >= b.x0 - 0.05 && point.x <= b.x1 + 0.05 && point.z >= b.z0 - 0.05 && point.z <= b.z1 + 0.05 && point.y <= b.h + 0.05) {
        e.hp -= damage;
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
      const cy = 0;
      const ox = origin.x - d.x;
      const oy = origin.y - cy;
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
    // Explosions shred walls, barriers and domes.
    for (const fx of this.effects) {
      if (fx.block && flat(blockCenter(fx.block), center) < r + 2) fx.hp -= dmg * 2.5;
      if (fx.type === "dome" && flat(fx, center) < r + fx.r) fx.hp -= dmg * 3;
    }
  }

  // ---------- per tick ----------

  smokes() {
    return this.effects.filter((e) => e.type === "smoke");
  }

  speedFactor(p, now = this.now) {
    let k = 1;
    if (now < p.abil.stealthUntil) k *= 1.3;
    if (now < p.abil.slowUntil) k *= 0.55;
    else if (this.effects.some((e) => e.type === "slow" && e.team !== p.team && flat(e, p.body) < e.r)) k *= 0.5;
    return k;
  }

  jumpFactor(p, now = this.now) {
    return now < p.abil.jumpUntil ? 1.75 : 1;
  }

  padsFor(p) {
    return this.effects.filter((e) => e.type === "pad" && e.team === p.team).map((e) => ({ x: e.x, z: e.z, r: e.r }));
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
      if (this.update(e, now, dt) === false || now >= e.until || (e.hp !== undefined && e.hp <= 0)) {
        if (e.block) this.removeBlock(e.block);
        if (e.hp !== undefined && e.hp <= 0) room.broadcast({ t: "broken", fx: e.id, x: e.x ?? blockCenter(e.block).x, z: e.z ?? blockCenter(e.block).z });
        continue;
      }
      keep.push(e);
    }
    this.effects = keep;
  }

  // Is there something solid at this height at (x, z)? Crates are COVER_HEIGHT tall, walls taller.
  solidAt(x, y, z) {
    const c = cellAt(this.room.map, toCell(x), toCell(z));
    if (c === "#") return y < WALL_HEIGHT;
    if (c === "=") return y < COVER_HEIGHT;
    return (this.room.map.blocks ?? []).some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y < b.h);
  }

  // Returns false to remove the effect.
  update(e, now, dt) {
    const room = this.room;
    if (e.type === "grenade") {
      e.vy -= GRAVITY * dt;
      const nx = e.x + e.vx * dt;
      const ny = e.y + e.vy * dt;
      const nz = e.z + e.vz * dt;
      // Bounce off walls and the floor; it flies over crates and walls lower than it is.
      if (this.solidAt(nx, e.y, e.z)) e.vx *= -0.4;
      else e.x = nx;
      if (this.solidAt(e.x, e.y, nz)) e.vz *= -0.4;
      else e.z = nz;
      if (ny <= 0.1) {
        e.y = 0.1;
        e.vy = Math.abs(e.vy) * 0.35;
        e.vx *= 0.6;
        e.vz *= 0.6;
      } else e.y = ny;
      if (now >= e.explodeAt) {
        this.explode(e.owner, e, e.dmg, e.r);
        return false;
      }
    } else if (e.type === "barrage") {
      while (e.shots.length && now >= e.shots[0].at) {
        const s = e.shots.shift();
        this.explode(e.owner, { x: s.x, y: 0.3, z: s.z }, 45, 3.2);
      }
    } else if (e.type === "vortex") {
      for (const q of this.enemiesOf({ team: e.team })) {
        const d = flat(q.body, e);
        if (d > e.r || d < 0.6) continue;
        const pull = 6 * dt;
        const nx = q.body.x + ((e.x - q.body.x) / d) * pull;
        const nz = q.body.z + ((e.z - q.body.z) / d) * pull;
        if (!collides(room.map, nx, q.body.z)) q.body.x = nx;
        if (!collides(room.map, q.body.x, nz)) q.body.z = nz;
      }
    } else if (e.type === "heal") {
      for (const q of this.teamOf({ team: e.team })) if (flat(q.body, e) < e.r) q.hp = Math.min(PLAYER.maxHealth, q.hp + 14 * dt);
    } else if (e.type === "sensor") {
      const victim = this.enemiesOf({ team: e.team }).find((q) => flat(q.body, e) < e.r);
      if (victim) {
        this.revealPlayer(victim, now + 4 * SECOND);
        victim.abil.slowUntil = Math.max(victim.abil.slowUntil, now + 2 * SECOND);
        victim.abil.stealthUntil = 0;
        room.broadcast({ t: "sensor_trip", x: e.x, z: e.z, victim: victim.id });
        return false;
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
    this.fallen.push({ id: victim.id, team: victim.team, at: this.now });
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

  // What one player gets told: their own state, and the effects their team may see.
  snapshotFor(me, now) {
    const effects = [];
    for (const e of this.effects) {
      // Enemy sensors stay hidden unless you're right next to them.
      if (e.type === "sensor" && e.team !== me.team && flat(e, me.body) > 6) continue;
      const out = { id: e.id, type: e.type, team: e.team };
      if (e.block) Object.assign(out, { x0: e.block.x0, z0: e.block.z0, x1: e.block.x1, z1: e.block.z1, h: e.block.h });
      else Object.assign(out, { x: round(e.x), y: round(e.y ?? 0), z: round(e.z), r: e.r });
      effects.push(out);
    }
    const a = me.abil;
    return {
      effects,
      ab: {
        cd: Math.max(0, a.cdUntil - now),
        ult: Math.floor(a.ult),
        sh: a.shield > 0 && now < a.shieldUntil ? Math.round(a.shield) : 0,
        sf: this.speedFactor(me, now),
        jf: this.jumpFactor(me, now),
        st: now < a.stealthUntil ? a.stealthUntil - now : 0,
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
