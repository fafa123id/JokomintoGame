import crypto from "node:crypto";
import { step, createBody, eyeHeight, aimDirection, hitboxes, rayBox, rayWorld, lineOfSight, forwardOf, toCell, traceShot, smokeBetween, PLAYER } from "../../src/fps/shared/physics.js";
import { WEAPONS, WEAPON_ORDER, GUNS, SPRAY_RECOVERY } from "../../src/fps/shared/weapons.js";
import { MAPS, siteAt, isWalkable } from "../../src/fps/shared/maps.js";
import { RULES, SIDES } from "../../src/fps/shared/rules.js";
import { createBrain, think, hearShot } from "./bot.js";
import { Abilities, abilityState } from "./abilities.js";
import { HEROES, HERO_IDS, PICK_SECONDS, heroById, ULT } from "../../src/fps/shared/heroes.js";

// One authoritative 5v5 Bomb match. Humans send inputs and shots; bots fill the empty slots
// (and take over for anyone who disconnects). Everything that matters is decided here.
const TICK_MS = 1000 / RULES.tickRate;
const HISTORY_MS = 450;
const BOT_NAMES = ["Jokobot", "Botjo", "Robojoko", "Jokotron", "Mecha Joko", "Joko-9000", "Bit Joko", "Jokodroid", "Sir Botjo", "Jokomatic"];

const fullAmmo = () => Object.fromEntries(GUNS.map((id) => [id, { mag: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve }]));
const NO_AMMO = { mag: 0, reserve: 0 };
const CHAT_MAX = 120;
const CHAT_GAP_MS = 500;
const DROP_LOCK_MS = 1200;
// Bomb beep stages by remaining fuse; the exact detonation time is never sent to clients.
const BLINK_STAGES = [20_000, 10_000, 5_000];
const shuffle = (list, rng) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const round2 = (v) => Math.round(v * 100) / 100;
// View angles need finer steps than positions, or spectators see the camera tick.
const round3 = (v) => Math.round(v * 1000) / 1000;
const pt = (p) => [round2(p.x), round2(p.y), round2(p.z)];

export class Room {
  constructor({ mapId, humans = [], onEnd = () => {}, clock = () => Date.now(), rng = Math.random, autoTick = true, heroPick = false }) {
    this.id = crypto.randomUUID();
    // Each room gets its own blocks list (ability walls); the grid itself is shared and read-only.
    this.map = { ...MAPS[mapId], blocks: [] };
    this.abilities = new Abilities(this);
    this.clock = clock;
    this.rng = rng;
    this.onEnd = onEnd;
    this.players = new Map();
    this.history = [];
    this.score = { red: 0, blue: 0 };
    this.round = { n: 0, phase: "buy", ends: 0, winner: null, reason: null };
    this.bomb = null;
    this.over = false;
    this.nextId = 1;
    this.lastHumanAt = clock();

    const teams = { red: [], blue: [] };
    humans.forEach((h, i) => teams[i % 2 === 0 ? "red" : "blue"].push(h));
    let botIndex = 0;
    for (const team of ["red", "blue"]) {
      for (const human of teams[team]) this.addPlayer({ ...human, team, bot: false });
      while (teams[team].length < RULES.teamSize) {
        teams[team].push(null);
        this.addPlayer({ name: BOT_NAMES[botIndex++ % BOT_NAMES.length], skin: "classic", team, bot: true });
      }
    }

    this.startRound();
    if (heroPick) this.beginPick();
    else this.assignHeroes();
    if (autoTick) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.timer.unref?.();
    }
  }

  addPlayer({ userId = null, name, skin, team, bot, socket = null }) {
    const pick = { hero: null, hover: null, locked: false, pickAt: 0, lockAt: 0 };
    const id = this.nextId++;
    this.players.set(id, {
      id,
      userId,
      name,
      skin,
      team,
      bot,
      socket,
      body: createBody(0, 0),
      hp: PLAYER.maxHealth,
      alive: true,
      weapon: "rifle",
      ammo: fullAmmo(),
      reloadUntil: 0,
      nextShot: 0,
      spray: 0,
      lastShotAt: 0,
      chatAt: 0,
      roundKills: 0,
      streak: 0,
      lastKillAt: 0,
      using: false,
      ack: 0,
      simulatedMs: 0,
      clockStart: this.clock(),
      kills: 0,
      deaths: 0,
      assists: 0,
      damageFrom: new Map(),
      brain: bot ? createBrain(this.rng) : null,
      ...pick,
      abil: abilityState(),
      lastKeys: 0,
    });
  }

  // ---------- sides and rounds ----------

  sideOf(team, n = this.round.n) {
    const redAttacks = Math.floor((Math.max(1, n) - 1) / RULES.swapAfter) % 2 === 0;
    return (team === "red") === redAttacks ? SIDES.ATTACK : SIDES.DEFEND;
  }

  teamOf(side) {
    return this.sideOf("red") === side ? "red" : "blue";
  }

  playersOn(side) {
    return [...this.players.values()].filter((p) => this.sideOf(p.team) === side);
  }

  startRound() {
    const now = this.clock();
    const previous = this.round.n;
    this.round = { n: this.round.n + 1, phase: "buy", ends: now + RULES.buySec * 1000, winner: null, reason: null };
    const swap = previous > 0 && this.sideOf("red", previous) !== this.sideOf("red");
    this.ground = [];
    this.groundId = 1;
    this.clutch = { red: null, blue: null };
    for (const side of [SIDES.ATTACK, SIDES.DEFEND]) {
      const spawns = shuffle(this.map.spawns[side], this.rng);
      this.playersOn(side).forEach((p, i) => {
        const spot = spawns[i % spawns.length];
        const towardCenter = Math.atan2(-((this.map.width * 1.5) - spot.x), -((this.map.height * 1.5) - spot.z));
        p.body = createBody(spot.x, spot.z, towardCenter);
        p.hp = PLAYER.maxHealth;
        p.alive = true;
        p.weapon = "rifle";
        p.ammo = fullAmmo();
        p.reloadUntil = 0;
        p.spray = 0;
        p.using = false;
        p.roundKills = 0;
        p.body.dashT = 0;
        p.damageFrom = new Map();
        p.streak = 0;
        p.lastKillAt = 0;
        if (p.brain) p.brain.reset?.();
      });
    }
    const attackers = this.playersOn(SIDES.ATTACK);
    const humans = attackers.filter((p) => !p.bot && p.socket);
    const bots = attackers.filter((p) => !humans.includes(p));
    const pool = humans.length && (!bots.length || this.rng() < RULES.humanCarrierChance) ? humans : bots;
    const carrier = pool[Math.floor(this.rng() * pool.length)];
    this.bomb = { carrier: carrier.id, dropped: null, planted: null, plantStart: null, defuseStart: null, botSite: this.rng() < 0.5 ? "A" : "B", dropBy: null, dropUntil: 0, revealed: false };
    this.history = [];
    this.abilities.resetRound();
    const matchPoint = Object.keys(this.score).filter((team) => this.score[team] === RULES.roundsToWin - 1);
    this.broadcast({ t: "round", n: this.round.n, attack: this.teamOf(SIDES.ATTACK), score: this.score, swap, matchPoint });
  }

  endRound(winnerSide, reason) {
    if (this.round.phase !== "live") return;
    const team = this.teamOf(winnerSide);
    this.score[team] += 1;
    this.round.phase = "end";
    this.round.winner = team;
    this.round.reason = reason;
    this.round.ends = this.clock() + RULES.endSec * 1000;
    // A clutch: the last one standing against two or more, and the round still went their way.
    const clutch = this.clutch[team];
    this.broadcast({ t: "round_end", winner: team, side: winnerSide, reason, score: this.score, clutch: clutch && clutch.vs >= 2 ? clutch : null });
  }

  // ---------- simulation ----------

  tick() {
    if (this.over) return;
    const now = this.clock();
    const round = this.round;

    if (round.phase === "pick") this.updatePick(now);
    else if (round.phase === "buy" && now >= round.ends) {
      round.phase = "live";
      round.ends = now + RULES.roundSec * 1000;
      this.broadcast({ t: "live" });
    } else if (round.phase === "end" && now >= round.ends) {
      const winner = Object.entries(this.score).find(([, v]) => v >= RULES.roundsToWin)?.[0];
      if (winner) return this.finish(winner);
      this.startRound();
    }

    for (const p of this.players.values()) {
      if (p.reloadUntil && now >= p.reloadUntil) this.completeReload(p);
      if (!p.alive || !(p.bot || !p.socket)) continue;
      // Bots, and humans who dropped out, are driven by the bot brain.
      p.brain ??= createBrain(this.rng);
      this.armBot(p);
      const input = think(this, p, now);
      step(this.map, p.body, input.keys, input.yaw, input.pitch, TICK_MS / 1000, this.moveOptions(p));
      if (input.ability) this.abilities.use(p, input.ability.slot, { y: input.ability.y ?? input.yaw, p: input.ability.p ?? input.pitch });
      p.using = input.use;
      if (input.fire) this.fire(p, input.yaw, input.pitch, now);
      if (input.reload) this.startReload(p);
    }

    this.updateGround(now);
    this.abilities.tick(now, TICK_MS / 1000);
    if (round.phase === "live") this.updateBomb(now);
    this.recordHistory(now);
    this.spotted = this.computeVision();
    this.sendSnapshots(now);
  }

  updateBomb(now) {
    const bomb = this.bomb;
    const attackers = this.playersOn(SIDES.ATTACK);
    const defenders = this.playersOn(SIDES.DEFEND);
    const near = (p, spot, range) => Math.hypot(p.body.x - spot.x, p.body.z - spot.z) <= range;
    const still = (p) => Math.hypot(p.body.vx, p.body.vz) < 0.3 && p.body.grounded;

    if (!bomb.planted) {
      if (bomb.dropped) {
        const taker = attackers.find((p) => p.alive && near(p, bomb.dropped, RULES.pickupRange) && !(p.id === bomb.dropBy && now < bomb.dropUntil));
        if (taker) {
          bomb.carrier = taker.id;
          bomb.dropped = null;
        }
      }
      const carrier = this.players.get(bomb.carrier);
      const site = carrier?.alive ? siteAt(this.map, carrier.body.x, carrier.body.z) : null;
      if (carrier?.alive && carrier.using && site && still(carrier)) {
        bomb.plantStart ??= now;
        if (now - bomb.plantStart >= RULES.plantSec * 1000) {
          bomb.planted = { x: carrier.body.x, z: carrier.body.z, site, explodeAt: now + RULES.fuseSec * 1000 };
          bomb.carrier = null;
          bomb.plantStart = null;
          this.holsterBomb(carrier);
          carrier.abil.ult = Math.min(100, carrier.abil.ult + ULT.plant);
          this.round.ends = bomb.planted.explodeAt;
          // Defenders only learn that it was planted, not where.
          for (const p of this.players.values()) {
            this.sendTo(p, this.sideOf(p.team) === SIDES.ATTACK ? { t: "planted", site, by: carrier.id } : { t: "planted" });
          }
        }
      } else bomb.plantStart = null;
    } else {
      const defuser = defenders.find((p) => p.alive && p.using && near(p, bomb.planted, RULES.defuseRange) && still(p));
      if (defuser && (!bomb.defuseStart || bomb.defuseStart.id === defuser.id)) {
        bomb.defuseStart ??= { id: defuser.id, at: now };
        if (now - bomb.defuseStart.at >= RULES.defuseSec * 1000) {
          defuser.abil.ult = Math.min(100, defuser.abil.ult + ULT.defuse);
          this.broadcast({ t: "defused", by: defuser.id });
          return this.endRound(SIDES.DEFEND, "defuse");
        }
      } else bomb.defuseStart = null;
      if (now >= bomb.planted.explodeAt) {
        this.broadcast({ t: "exploded", site: bomb.planted.site });
        return this.endRound(SIDES.ATTACK, "explode");
      }
    }

    const attackersAlive = attackers.some((p) => p.alive);
    const defendersAlive = defenders.some((p) => p.alive);
    if (!defendersAlive) return this.endRound(SIDES.ATTACK, "elimination");
    if (!attackersAlive && !bomb.planted) return this.endRound(SIDES.DEFEND, "elimination");
    if (!bomb.planted && now >= this.round.ends) return this.endRound(SIDES.DEFEND, "time");
  }

  // Which enemies each team can currently see (range + field of view + clear line of sight).
  computeVision() {
    const now = this.clock();
    const smokes = this.abilities.smokes();
    const spotted = { red: [], blue: [] };
    const halfFov = ((RULES.visionFovDeg / 2) * Math.PI) / 180;
    const alive = [...this.players.values()].filter((p) => p.alive);
    for (const enemy of alive) {
      const chest = { x: enemy.body.x, y: enemy.body.y + (enemy.body.crouch ? 0.85 : 1.2), z: enemy.body.z };
      const head = { x: enemy.body.x, y: enemy.body.y + (enemy.body.crouch ? 1.15 : 1.6), z: enemy.body.z };
      const seen = alive.some((viewer) => {
        if (viewer.team === enemy.team) return false;
        const dx = enemy.body.x - viewer.body.x;
        const dz = enemy.body.z - viewer.body.z;
        const dist = Math.hypot(dx, dz);
        if (dist > RULES.visionRange) return false;
        const f = forwardOf(viewer.body.yaw);
        if (dist > 1.5 && Math.acos(Math.max(-1, Math.min(1, (dx * f.x + dz * f.z) / dist))) > halfFov) return false;
        // Stealth hides anyone not right next to you; smoke blocks sight.
        if (now < enemy.abil.stealthUntil && dist > 4) return false;
        const eye = { x: viewer.body.x, y: eyeHeight(viewer.body), z: viewer.body.z };
        if (smokeBetween(smokes, eye, chest) && smokeBetween(smokes, eye, head)) return false;
        return lineOfSight(this.map, eye, chest) || lineOfSight(this.map, eye, head);
      });
      // Scans and sensors reveal through walls.
      if (seen || now < enemy.abil.revealUntil) spotted[enemy.team === "red" ? "blue" : "red"].push(enemy.id);
    }
    return spotted;
  }

  // Whether any living defender has a clear view of a bomb position (no field-of-view check: it beeps).
  bombVisibleToDefenders(spot) {
    const target = { x: spot.x, y: 0.3, z: spot.z };
    return this.playersOn(SIDES.DEFEND).some((d) => {
      if (!d.alive || Math.hypot(d.body.x - spot.x, d.body.z - spot.z) > RULES.visionRange) return false;
      return lineOfSight(this.map, { x: d.body.x, y: eyeHeight(d.body), z: d.body.z }, target);
    });
  }

  recordHistory(now) {
    const bodies = {};
    for (const p of this.players.values()) bodies[p.id] = { x: p.body.x, y: p.body.y, z: p.body.z, crouch: p.body.crouch };
    this.history.push({ t: now, bodies });
    while (this.history.length && now - this.history[0].t > HISTORY_MS) this.history.shift();
  }

  // Where a player was at a past server time (lag compensation).
  bodyAt(p, t) {
    const h = this.history;
    if (!h.length || t >= h[h.length - 1].t) return p.body;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1];
      const b = h[i];
      if (t >= a.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        const A = a.bodies[p.id];
        const B = b.bodies[p.id];
        if (!A || !B) return p.body;
        return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, z: A.z + (B.z - A.z) * k, crouch: k < 0.5 ? A.crouch : B.crouch };
      }
    }
    return h[0].bodies[p.id] ?? p.body;
  }

  // ---------- human input ----------

  input(p, { s, k, y, p: pitch, d }) {
    if (!Number.isInteger(s) || s <= p.ack || ![k, y, pitch, d].every(Number.isFinite)) return;
    const now = this.clock();
    const dtMs = Math.min(Math.max(d, 1), 100);
    // Speed-hack guard: simulated time can't run ahead of real time.
    if (p.simulatedMs + dtMs > now - p.clockStart + 250) return;
    p.simulatedMs += dtMs;
    p.ack = s;
    p.lastKeys = k | 0;
    if (!p.alive) return;
    step(this.map, p.body, k | 0, y, pitch, dtMs / 1000, this.moveOptions(p));
  }

  // Movement modifiers from weapon weight and abilities; the client predicts with the same values.
  moveOptions(p) {
    return {
      frozen: this.round.phase !== "live",
      speed: WEAPONS[p.weapon].speed * this.abilities.speedFactor(p),
      jump: this.abilities.jumpFactor(p),
      pads: this.abilities.padsFor(p),
    };
  }

  useAbility(p, { slot, y, p: pitch }) {
    if (slot !== "skill" && slot !== "ult") return;
    this.abilities.use(p, slot, { y, p: pitch });
  }

  fire(p, yaw, pitch, viewTime = null) {
    const now = this.clock();
    if (!p.alive || this.round.phase !== "live" || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    const weapon = WEAPONS[p.weapon];
    if (now < p.nextShot - 15 || p.reloadUntil) return;
    if (weapon.melee) return this.slash(p, yaw, pitch, now, viewTime);
    if (!weapon.gun) return;
    const ammo = p.ammo[p.weapon];
    if (!ammo) return;
    if (ammo.mag <= 0) return this.startReload(p);

    p.spray = Math.max(0, p.spray - (SPRAY_RECOVERY * (now - p.lastShotAt)) / 1000);
    const moving = Math.hypot(p.body.vx, p.body.vz) / PLAYER.speed;
    let spread = weapon.spread + p.spray + weapon.moveSpread * Math.min(1, moving) + (p.body.grounded ? 0 : weapon.airSpread);
    if (p.body.crouch) spread *= weapon.crouchFactor;
    const angle = this.rng() * Math.PI * 2;
    const radius = Math.sqrt(this.rng()) * spread;
    const dir = aimDirection(yaw + Math.cos(angle) * radius, pitch + Math.sin(angle) * radius);
    const origin = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };

    ammo.mag -= 1;
    p.nextShot = now + weapon.interval * 1000;
    p.spray = Math.min(weapon.sprayMax, p.spray + weapon.sprayStep);
    p.lastShotAt = now;

    const rewindTo = Math.min(now, Math.max(now - RULES.maxRewindMs, viewTime ?? now));
    // Human shots are checked against where targets were on the shooter's screen; bots see the present.
    const bodies = [...this.players.values()]
      .filter((target) => target !== p && target.alive && target.team !== p.team)
      .map((target) => ({ target, body: p.bot || !p.socket ? target.body : this.bodyAt(target, rewindTo) }));
    p.abil.stealthUntil = 0;
    // Domes stop shots coming from outside; walls and barriers are part of the world ray.
    const hitTest = (o, d, maxDist) => {
      let best = this.abilities.domeHit(o, d, maxDist);
      for (const { target, body } of bodies) {
        for (const box of hitboxes(body)) {
          const t = rayBox(o, d, box.min, box.max);
          if (t !== null && t < (best?.t ?? maxDist)) best = { t, target, part: box.part };
        }
      }
      return best;
    };
    hearShot(this, p, now);
    const shot = traceShot(this.map, origin, dir, { speed: weapon.velocity, range: weapon.range }, hitTest);
    // Send a thinned path: enough for the client to draw the arc.
    const path = shot.points.filter((_, i) => i % 4 === 0 || i === shot.points.length - 1).map(pt);
    this.broadcast({ t: "shot", id: p.id, w: p.weapon, path, v: weapon.velocity, hit: !!shot.hit });
    if (shot.hit?.dome) shot.hit.dome.hp -= weapon.damage;
    else if (shot.hit) this.damage(p, shot.hit.target, Math.round(weapon.damage * weapon.multipliers[shot.hit.part]), shot.hit.part);
    else this.abilities.hitBlockAt(shot.end, weapon.damage);
  }

  // Knife: short ray against hitboxes; hitting someone from behind is lethal.
  slash(p, yaw, pitch, now, viewTime) {
    const weapon = WEAPONS.knife;
    p.nextShot = now + weapon.interval * 1000;
    p.lastShotAt = now;
    const origin = { x: p.body.x, y: eyeHeight(p.body), z: p.body.z };
    const dir = aimDirection(yaw, pitch);
    const rewindTo = Math.min(now, Math.max(now - RULES.maxRewindMs, viewTime ?? now));
    let range = rayWorld(this.map, origin, dir, weapon.range);
    let hit = null;
    for (const target of this.players.values()) {
      if (target === p || !target.alive || target.team === p.team) continue;
      const body = p.bot || !p.socket ? target.body : this.bodyAt(target, rewindTo);
      for (const box of hitboxes(body)) {
        const t = rayBox(origin, dir, box.min, box.max);
        if (t !== null && t < range) {
          range = t;
          hit = { target, part: box.part };
        }
      }
    }
    hearShot(this, p, now, 12);
    this.broadcast({ t: "slash", id: p.id, hit: !!hit });
    if (!hit) return;
    const facing = forwardOf(hit.target.body.yaw);
    const toAttacker = { x: p.body.x - hit.target.body.x, z: p.body.z - hit.target.body.z };
    const behind = facing.x * toAttacker.x + facing.z * toAttacker.z < -0.2 * Math.hypot(toAttacker.x, toAttacker.z);
    this.damage(p, hit.target, behind ? weapon.backstab : weapon.damage, behind ? "back" : hit.part);
  }

  damage(attacker, victim, amount, part) {
    if (!victim.alive) return;
    const raw = amount;
    amount = this.abilities.absorb(victim, amount);
    this.abilities.onDamage(attacker, raw);
    const dealt = Math.min(victim.hp, amount);
    victim.damageFrom.set(attacker.id, (victim.damageFrom.get(attacker.id) ?? 0) + dealt);
    victim.hp = Math.max(0, victim.hp - amount);
    this.sendTo(attacker, { t: "hit", part, dmg: amount, kill: victim.hp === 0 });
    this.sendTo(victim, { t: "hurt", from: attacker.id, dmg: amount });
    if (victim.brain) {
      victim.brain.hurtBy = attacker.id;
      victim.brain.hurtAt = this.clock();
    }
    if (victim.hp > 0) return;
    const now = this.clock();
    victim.alive = false;
    victim.using = false;
    victim.reloadUntil = 0;
    victim.deaths += 1;
    attacker.kills += 1;
    attacker.roundKills += 1;
    // Multi-kills count per round: 2 = double, 3 = triple, 4 = maniac, 5 = savage.
    attacker.streak = attacker.roundKills;
    attacker.lastKillAt = now;
    if (this.bomb.carrier === victim.id) {
      this.bomb.carrier = null;
      this.bomb.dropped = { x: victim.body.x, z: victim.body.z };
      this.bomb.dropBy = null;
    }
    // The best gun falls where they died.
    const gun = ["rifle", "pistol"].find((id) => victim.ammo[id]);
    if (gun) this.addGround(gun, victim.ammo[gun], victim.body.x, victim.body.z);
    victim.ammo = {};
    // An ace is one player taking out the entire enemy team in a round.
    const ace = attacker.roundKills >= [...this.players.values()].filter((q) => q.team === victim.team).length;
    // Assists: the two teammates (other than the killer) who dealt the most damage to the victim.
    const assists = [...victim.damageFrom]
      .filter(([id, dmg]) => id !== attacker.id && dmg > 0 && this.players.get(id)?.team === attacker.team)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => id);
    for (const id of assists) this.players.get(id).assists += 1;
    this.abilities.onKill(attacker, victim, assists);
    victim.damageFrom = new Map();
    this.broadcast({ t: "kill", killer: attacker.id, victim: victim.id, head: part === "head", back: part === "back", w: attacker.weapon, streak: attacker.streak, ace, assists });
    const mates = [...this.players.values()].filter((q) => q.team === victim.team && q.alive);
    const enemies = [...this.players.values()].filter((q) => q.team !== victim.team && q.alive);
    if (mates.length === 1 && !this.clutch[victim.team]) this.clutch[victim.team] = { id: mates[0].id, vs: enemies.length };
  }

  // ---------- inventory ----------

  owns(p, weapon) {
    if (weapon === "knife") return true;
    if (weapon === "bomb") return this.bomb.carrier === p.id;
    return !!p.ammo[weapon];
  }

  bestWeapon(p) {
    return ["rifle", "pistol"].find((id) => p.ammo[id] && p.ammo[id].mag + p.ammo[id].reserve > 0) ?? ["rifle", "pistol"].find((id) => p.ammo[id]) ?? "knife";
  }

  // Bots hold their best gun; they only fight with the knife when nothing else is left.
  armBot(p) {
    const best = this.bestWeapon(p);
    if (p.weapon === "bomb" || !this.owns(p, p.weapon) || (p.weapon !== best && !p.reloadUntil)) this.switchWeapon(p, best, true);
  }

  addGround(weapon, ammo, x, z, lockBy = null) {
    this.ground.push({ id: this.groundId++, w: weapon, mag: ammo.mag, reserve: ammo.reserve, x, z, lockBy, lockUntil: this.clock() + DROP_LOCK_MS });
    if (this.ground.length > RULES.groundMax) this.ground.shift();
  }

  // Walking over a gun picks it up when that slot is empty (anyone can, on either team).
  updateGround(now) {
    if (!this.ground.length) return;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (let i = 0; i < this.ground.length; i++) {
        const g = this.ground[i];
        const dist = Math.hypot(p.body.x - g.x, p.body.z - g.z);
        // Whoever dropped it has to step away first, so standing on your own gun doesn't grab it back.
        if (g.lockBy === p.id) {
          if (dist > RULES.pickupRange + 0.8 && now >= g.lockUntil) g.lockBy = null;
          continue;
        }
        if (p.ammo[g.w] || dist > RULES.pickupRange) continue;
        p.ammo[g.w] = { mag: g.mag, reserve: g.reserve };
        this.ground.splice(i, 1);
        this.sendTo(p, { t: "pickup", w: g.w });
        if (p.weapon === "knife" || !this.owns(p, p.weapon)) this.switchWeapon(p, g.w);
        break;
      }
    }
  }

  // Throw a spot a short way ahead of the player, never through a wall.
  throwSpot(p) {
    const f = forwardOf(p.body.yaw);
    const dist = Math.max(0, Math.min(1.6, rayWorld(this.map, { x: p.body.x, y: 0.4, z: p.body.z }, { x: f.x, y: 0, z: f.z }, 1.6) - 0.4));
    const spot = { x: p.body.x + f.x * dist, z: p.body.z + f.z * dist };
    return isWalkable(this.map, toCell(spot.x), toCell(spot.z)) ? spot : { x: p.body.x, z: p.body.z };
  }

  // G: drop whatever is in hand, except the knife.
  dropWeapon(p) {
    if (!p.alive || this.round.phase === "end") return;
    if (p.weapon === "bomb") return this.dropBomb(p);
    const ammo = p.ammo[p.weapon];
    if (!WEAPONS[p.weapon].gun || !ammo) return;
    const spot = this.throwSpot(p);
    this.addGround(p.weapon, ammo, spot.x, spot.z, p.id);
    delete p.ammo[p.weapon];
    p.reloadUntil = 0;
    this.switchWeapon(p, this.bestWeapon(p));
  }

  startReload(p) {
    const weapon = WEAPONS[p.weapon];
    const ammo = p.ammo[p.weapon];
    if (!weapon.gun || !ammo) return;
    if (!p.alive || p.reloadUntil || ammo.mag >= weapon.magazine || ammo.reserve <= 0) return;
    p.reloadUntil = this.clock() + weapon.reload * 1000;
  }

  completeReload(p) {
    const ammo = p.ammo[p.weapon];
    if (!WEAPONS[p.weapon].gun || !ammo) return (p.reloadUntil = 0);
    const take = Math.min(WEAPONS[p.weapon].magazine - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    p.reloadUntil = 0;
  }

  switchWeapon(p, weapon, instant = false) {
    if (!Object.hasOwn(WEAPONS, weapon) || p.weapon === weapon || !p.alive || !this.owns(p, weapon)) return;
    p.weapon = weapon;
    p.reloadUntil = 0;
    p.spray = 0;
    p.nextShot = this.clock() + (instant ? 0 : 350);
  }

  holsterBomb(p) {
    if (p?.weapon === "bomb") this.switchWeapon(p, this.bestWeapon(p));
  }

  // Throw the bomb a short way ahead so a teammate can pick it up.
  dropBomb(p) {
    const bomb = this.bomb;
    if (!p.alive || bomb.carrier !== p.id || bomb.planted || this.round.phase === "end") return;
    const spot = this.throwSpot(p);
    bomb.carrier = null;
    bomb.dropped = spot;
    bomb.dropBy = p.id;
    bomb.dropUntil = this.clock() + DROP_LOCK_MS;
    bomb.plantStart = null;
    this.holsterBomb(p);
  }

  chat(p, { text, all }) {
    const now = this.clock();
    if (typeof text !== "string" || now - p.chatAt < CHAT_GAP_MS) return;
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, CHAT_MAX);
    if (!clean) return;
    p.chatAt = now;
    const message = { t: "chat", from: p.id, name: p.name, team: p.team, all: !!all, dead: !p.alive, text: clean };
    for (const q of this.players.values()) if (all || q.team === p.team) this.sendTo(q, message);
  }

  // ---------- networking ----------

  sendTo(p, message) {
    if (p.socket?.readyState === 1) p.socket.send(JSON.stringify(message));
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const p of this.players.values()) if (p.socket?.readyState === 1) p.socket.send(data);
  }

  // ---------- hero select ----------
  // Before round 1 every team picks heroes for up to PICK_SECONDS. A hero can be taken once per team.
  // Bots pick on their own and give way when a human hovers or locks the hero they wanted.

  teammates(team) {
    return [...this.players.values()].filter((p) => p.team === team);
  }

  // Heroes a player can still take: not locked or hovered by a teammate.
  freeHeroes(p, avoid = null) {
    const taken = new Set();
    for (const q of this.teammates(p.team)) {
      if (q === p) continue;
      if (q.locked) taken.add(q.hero);
      else if (q.hover) taken.add(q.hover);
    }
    if (avoid) taken.add(avoid);
    return HEROES.filter((h) => !taken.has(h.id));
  }

  // Bots fill roles the team doesn't have yet, otherwise anything free.
  botChoice(p, avoid = null) {
    const free = this.freeHeroes(p, avoid);
    const roles = new Set(this.teammates(p.team).filter((q) => q !== p).map((q) => heroById(q.hero ?? q.hover)?.role).filter(Boolean));
    const fresh = free.filter((h) => !roles.has(h.role));
    const pool = fresh.length ? fresh : free;
    return pool[Math.floor(this.rng() * pool.length)]?.id ?? null;
  }

  beginPick() {
    const now = this.clock();
    this.round.phase = "pick";
    this.round.ends = now + PICK_SECONDS * 1000;
    for (const p of this.players.values()) {
      Object.assign(p, { hero: null, hover: null, locked: false });
      if (p.bot) {
        p.pickAt = now + 600 + this.rng() * 2500;
        p.lockAt = p.pickAt + 1200 + this.rng() * 3500;
      }
    }
    this.pickSentAt = 0;
    this.sendPick();
  }

  updatePick(now) {
    for (const p of this.players.values()) {
      if (!p.bot || p.locked) continue;
      if (!p.hover && now >= p.pickAt) {
        p.hover = this.botChoice(p);
        this.pickDirty = true;
      }
      if (p.hover && now >= p.lockAt && this.freeHeroes(p).some((h) => h.id === p.hover)) {
        p.locked = true;
        p.hero = p.hover;
        this.pickDirty = true;
      }
    }
    const everyone = [...this.players.values()];
    // Everybody locked: a short moment to see the lineup, then go.
    if (everyone.every((p) => p.locked) && !this.pickAllLocked) {
      this.pickAllLocked = true;
      this.round.ends = Math.min(this.round.ends, now + 1500);
      this.pickDirty = true;
    }
    if (now >= this.round.ends) return this.finishPick(now);
    if (this.pickDirty || now - this.pickSentAt > 1000) this.sendPick();
  }

  // A human wants this hero: bot teammates hovering or holding it switch to something else.
  botsYield(p, heroId) {
    const now = this.clock();
    for (const q of this.teammates(p.team)) {
      if (q === p || !q.bot || (q.hover !== heroId && q.hero !== heroId)) continue;
      q.locked = false;
      q.hero = null;
      q.hover = this.botChoice(q, heroId);
      q.lockAt = now + 800 + this.rng() * 1500;
    }
  }

  heroAction(p, { action, id }) {
    if (this.round.phase !== "pick" || p.bot) return;
    const takenByHuman = (heroId) => this.teammates(p.team).some((q) => q !== p && !q.bot && q.locked && q.hero === heroId);
    if (action === "unlock") {
      p.locked = false;
      p.hero = null;
    } else if (action === "hover" || action === "lock") {
      const heroId = id ?? p.hover;
      if (!HERO_IDS.includes(heroId) || takenByHuman(heroId)) return;
      if (p.locked && action === "hover") return;
      p.hover = heroId;
      if (action === "lock") {
        p.locked = true;
        p.hero = heroId;
      }
      this.botsYield(p, heroId);
    } else return;
    this.pickAllLocked = false;
    this.pickDirty = true;
    this.sendPick();
  }

  finishPick(now) {
    for (const team of ["red", "blue"]) {
      for (const p of this.teammates(team)) {
        if (p.locked) continue;
        const free = this.freeHeroes(p).map((h) => h.id);
        p.hero = free.includes(p.hover) ? p.hover : free[Math.floor(this.rng() * free.length)];
        p.hover = p.hero;
        p.locked = true;
      }
    }
    this.round.phase = "buy";
    this.round.ends = now + RULES.buySec * 1000;
    this.broadcast({ t: "pick_done", players: this.roster() });
    this.broadcast({ t: "round", n: this.round.n, attack: this.teamOf(SIDES.ATTACK), score: this.score, swap: false, matchPoint: [] });
  }

  // Each team only ever sees its own picks.
  sendPick() {
    this.pickSentAt = this.clock();
    this.pickDirty = false;
    for (const team of ["red", "blue"]) {
      const message = {
        t: "pick",
        ends: this.round.ends,
        team: this.teammates(team).map((q) => ({ id: q.id, name: q.name, bot: q.bot, hover: q.hover, hero: q.hero, locked: q.locked })),
      };
      for (const q of this.teammates(team)) this.sendTo(q, message);
    }
  }

  // Without a pick phase (tests, quick matches) everyone gets a random distinct hero.
  assignHeroes() {
    for (const team of ["red", "blue"]) {
      const ids = shuffle(HERO_IDS, this.rng);
      this.teammates(team).forEach((p, i) => Object.assign(p, { hero: ids[i % ids.length], hover: ids[i % ids.length], locked: true }));
    }
  }

  roster(forTeam = null) {
    const hidden = this.round.phase === "pick";
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      bot: p.bot,
      skin: p.skin,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      // Enemy heroes stay secret until the pick is over.
      hero: hidden && p.team !== forTeam ? null : p.hero,
    }));
  }

  welcome(p) {
    const welcome = { t: "welcome", room: this.id, you: p.id, team: p.team, map: this.map.id, players: this.roster(p.team), score: this.score, round: this.round.n, phase: this.round.phase };
    if (this.round.phase === "pick") setTimeout(() => this.sendPick(), 0);
    return welcome;
  }

  // 1 stealthed, 2 revealed to the viewer's team (scan/sensor), 4 shielded.
  statusFlags(p, viewer, now) {
    const a = p.abil;
    let flags = now < a.stealthUntil ? 1 : 0;
    if (p.team !== viewer.team && now < a.revealUntil) flags |= 2;
    if (a.shield > 0 && now < a.shieldUntil) flags |= 4;
    return flags;
  }

  // What a player is busy with, for animations: 1 reloading, 2 planting, 4 defusing.
  // Defenders never learn that someone is planting.
  actionFlags(p, attackerView) {
    let flags = p.reloadUntil ? 1 : 0;
    if (attackerView && this.bomb.plantStart && this.bomb.carrier === p.id) flags |= 2;
    if (this.bomb.defuseStart?.id === p.id) flags |= 4;
    return flags;
  }

  sendSnapshots(now) {
    const bomb = this.bomb;
    const progress = (start, total) => (start ? Math.min(1, (now - start) / (total * 1000)) : 0);
    const left = bomb.planted ? bomb.planted.explodeAt - now : 0;
    const blink = bomb.planted ? BLINK_STAGES.filter((ms) => left <= ms).length : 0;
    if (bomb.planted && !bomb.revealed) bomb.revealed = this.bombVisibleToDefenders(bomb.planted);
    const round = { n: this.round.n, phase: this.round.phase, ends: bomb.planted ? null : this.round.ends, attack: this.teamOf(SIDES.ATTACK), score: this.score };
    const attackView = {
      round,
      bomb: {
        carrier: bomb.carrier,
        dropped: bomb.dropped && [round2(bomb.dropped.x), round2(bomb.dropped.z)],
        planted: bomb.planted && { x: round2(bomb.planted.x), z: round2(bomb.planted.z), site: bomb.planted.site, blink },
        plant: progress(bomb.plantStart, RULES.plantSec),
        defuse: progress(bomb.defuseStart?.at, RULES.defuseSec),
      },
    };
    // Defenders: no carrier, no site, and positions only once someone has eyes on the bomb.
    const droppedSeen = bomb.dropped && this.bombVisibleToDefenders(bomb.dropped);
    const defendView = {
      round,
      bomb: {
        carrier: null,
        dropped: droppedSeen ? attackView.bomb.dropped : null,
        planted: bomb.planted && (bomb.revealed ? { x: attackView.bomb.planted.x, z: attackView.bomb.planted.z, blink } : { blink }),
        plant: 0,
        defuse: attackView.bomb.defuse,
      },
    };
    const attackTeam = this.teamOf(SIDES.ATTACK);
    const ground = this.ground.map((g) => [g.id, WEAPON_ORDER.indexOf(g.w), round2(g.x), round2(g.z)]);
    const players = [...this.players.values()];
    if (players.some((p) => p.socket?.readyState === 1)) this.lastHumanAt = now;
    for (const me of players) {
      if (!me.socket || me.socket.readyState !== 1) continue;
      const ps = players
        .filter((p) => p !== me)
        .map((p) => [p.id, round2(p.body.x), round2(p.body.y), round2(p.body.z), round3(p.body.yaw), round3(p.body.pitch), p.body.crouch ? 1 : 0, p.alive ? 1 : 0, p.team === me.team ? p.hp : -1, WEAPON_ORDER.indexOf(p.weapon), this.actionFlags(p, me.team === attackTeam), this.statusFlags(p, me, now)]);
      const ammo = me.ammo[me.weapon] ?? NO_AMMO;
      const inv = WEAPON_ORDER.filter((id) => this.owns(me, id));
      const shared = me.team === attackTeam ? attackView : defendView;
      me.socket.send(
        JSON.stringify({
          t: "snap",
          tm: now,
          ack: me.ack,
          me: {
            x: me.body.x,
            y: me.body.y,
            z: me.body.z,
            vx: me.body.vx,
            vy: me.body.vy,
            vz: me.body.vz,
            yaw: round2(me.body.yaw),
            g: me.body.grounded ? 1 : 0,
            hp: me.hp,
            alive: me.alive,
            w: me.weapon,
            inv,
            ammo: GUNS.map((id) => (me.ammo[id] ? [me.ammo[id].mag, me.ammo[id].reserve] : null)),
            mag: ammo.mag,
            res: ammo.reserve,
            rl: me.reloadUntil ? me.reloadUntil - now : 0,
          },
          ps,
          seen: this.spotted?.[me.team] ?? [],
          ...this.abilities.snapshotFor(me, now),
          ground,
          ...shared,
        })
      );
    }
  }

  // ---------- membership ----------

  attach(userId, socket) {
    const p = [...this.players.values()].find((x) => x.userId === userId);
    if (!p) return null;
    p.socket = socket;
    p.ack = 0;
    p.simulatedMs = 0;
    p.clockStart = this.clock();
    return p;
  }

  detach(userId) {
    const p = [...this.players.values()].find((x) => x.userId === userId);
    if (p) {
      p.socket = null;
      p.using = false;
    }
  }

  playerOf(userId) {
    return [...this.players.values()].find((x) => x.userId === userId) ?? null;
  }

  finish(winner) {
    this.over = true;
    this.round.phase = "over";
    clearInterval(this.timer);
    const results = [...this.players.values()]
      .filter((p) => !p.bot && p.userId)
      .map((p) => ({ userId: p.userId, team: p.team, won: p.team === winner, kills: p.kills, deaths: p.deaths, assists: p.assists }));
    const rewards = this.onEnd(this, { winner, results }) ?? {};
    for (const p of this.players.values()) {
      this.sendTo(p, { t: "match_end", winner, side: this.sideOf(winner), score: this.score, players: this.roster(), reward: rewards[p.userId] ?? null });
    }
  }

  dispose() {
    clearInterval(this.timer);
    this.over = true;
  }
}
