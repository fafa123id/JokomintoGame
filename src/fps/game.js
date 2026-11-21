import { step, createBody, PLAYER, CELL, aimDirection, rayWorld } from "./shared/physics.js";
import { Minimap } from "./minimap.js";
import { MAPS, siteAt } from "./shared/maps.js";
import { RULES } from "./shared/rules.js";
import { WEAPONS, WEAPON_ORDER, GUNS, SPRAY_RECOVERY } from "./shared/weapons.js";
import { FpsRenderer } from "./renderer.js";
import { createControls } from "./controls.js";
import { createHud } from "./hud.js";
import * as sfx from "./audio.js";

// One match on the client. Local movement is predicted with the shared physics in fixed 30 Hz steps
// and corrected by the server's acknowledged state; other players are drawn 100 ms in the past,
// interpolated between snapshots. Shots are only decided by the server.
const STEP = 1 / 30;
const REASONS = { elimination: "Team eliminated", time: "Time ran out", defuse: "Bomb defused", explode: "Bomb exploded" };
const SWITCH_MS = 350;
const SWING_MS = 320;
// Beep interval per blink stage sent by the server (it speeds up as the fuse burns down).
const BEEP_MS = [1000, 650, 380, 170];

const copyBody = (b) => ({ ...b });
const SPECTATE_MODES = ["first", "third", "free"];
const MODE_LABELS = { first: "First person", third: "Third person", free: "Free look" };
const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class FpsGame {
  constructor(root, send, welcome, { onLeave }) {
    this.root = root;
    this.send = send;
    this.onLeave = onLeave;
    this.roomId = welcome.room;
    this.map = MAPS[welcome.map];
    this.meId = welcome.you;
    this.team = welcome.team;
    this.players = new Map(welcome.players.map((p) => [p.id, { ...p }]));
    this.body = createBody(0, 0);
    this.prev = copyBody(this.body);
    this.pending = [];
    this.seq = 0;
    this.acc = 0;
    this.snaps = [];
    this.offset = null;
    this.round = { n: welcome.round, phase: "buy", ends: 0, attack: "red", score: welcome.score };
    this.bomb = {};
    this.me = { hp: 100, alive: true, w: "rifle", mag: WEAPONS.rifle.magazine, res: WEAPONS.rifle.reserve, rl: 0, ammo: [] };
    this.nextShot = 0;
    this.spray = 0;
    this.lastShot = 0;
    this.lastUse = false;
    this.lastBeep = 0;
    this.synced = false;
    this.wanted = null;
    this.drawAt = 0;
    this.swingAt = -Infinity;
    this.reload = null;
    this.clutch = { round: 0, last: false, one: false };
    this.everLocked = false;

    this.renderer = new FpsRenderer(root, this.map);
    this.controls = createControls(root, {
      onReload: () => this.send({ t: "reload" }),
      onSwitch: (w) => this.switchWeapon(w),
      onCycle: (dir) => this.cycleWeapon(dir),
      onDrop: () => this.dropBomb(),
      onChat: () => this.openChat(),
      onScoreboard: (on) => this.hud?.board(on, this.players.values(), this.meId),
      onLockChange: (locked) => this.onLockChange(locked),
      onPrimary: () => !this.me.alive && this.cycleSpectateMode(),
      onWheel: (dir) => (this.me.alive ? this.cycleWeapon(dir) : this.cycleSpectateTarget(dir)),
      onSpectate: (action) => (action === "mode" ? this.cycleSpectateMode() : this.cycleSpectateTarget(action === "next" ? 1 : -1)),
    });
    this.hud = createHud(root, { touch: this.controls.touch, ctrlCrouch: this.controls.ctrlCrouchSupported });
    root.classList.toggle("is-touch", this.controls.touch);
    if (!this.controls.touch) this.hud.pause(true, { first: true });
    this.minimap = new Minimap(this.hud.el, this.map, { size: this.controls.touch ? 112 : 168 });
    this.seen = new Set();
    this.spec = { id: null, mode: "first" };
    this.roundSeen = 0;
    this.hud.on("menu", () => (this.controls.touch ? this.hud.pause(!this.hud.paused) : this.controls.unlock()));
    this.hud.on("resume", () => (this.controls.touch ? this.hud.pause(false) : this.controls.requestLock()));
    this.hud.on("leave", () => this.onLeave());
    this.hud.on("slot", (w) => this.switchWeapon(w));
    this.hud.on("drop", () => this.dropBomb());
    this.hud.on("chatSend", (text, all) => this.send({ t: "chat", text, all }));
    this.hud.on("chatClosed", () => this.controls.setTyping(false));
    this.hud.score(this.round.score, this.round.attack);
    this.last = performance.now();
    this.frame = requestAnimationFrame((t) => this.loop(t));
  }

  // Same match after a reconnect: the server restarted our input numbering, so drop stale predictions.
  resync(welcome) {
    for (const p of welcome.players) this.players.set(p.id, { ...this.players.get(p.id), ...p });
    this.pending = [];
  }

  get serverNow() {
    return Date.now() + (this.offset ?? 0);
  }

  get isAttacker() {
    return this.round.attack === this.team;
  }

  onLockChange(locked) {
    if (locked) this.everLocked = true;
    // Losing the mouse while typing in chat isn't a pause.
    if (!this.controls.touch && !this.hud.chatOpen) this.hud.pause(!locked, { first: !this.everLocked });
  }

  // ---------- network in ----------

  handle(msg) {
    switch (msg.t) {
      case "snap":
        return this.onSnap(msg);
      case "shot":
        return this.onShot(msg);
      case "slash":
        return this.onSlash(msg);
      case "hit": {
        const big = msg.part === "head" || msg.part === "back";
        this.hud.hitmarker(big, msg.kill);
        sfx.hitMarker(big);
        if (msg.kill) sfx.killConfirm();
        return;
      }
      case "hurt":
        this.hud.hurt();
        return sfx.hurt();
      case "kill":
        return this.onKill(msg);
      case "chat": {
        this.hud.chatMessage(msg, msg.from === this.meId);
        if (msg.from !== this.meId) sfx.chatBlip();
        return;
      }
      case "round": {
        const side = msg.attack === this.team ? "ATTACK" : "DEFEND";
        this.hud.banner(`Round ${msg.n}`, side === "ATTACK" ? "You attack: plant the bomb 💣" : "You defend: protect the sites 🛡️", "", 2600);
        sfx.roundStart();
        return;
      }
      case "live":
        return this.hud.banner("GO!", "", "is-go", 900);
      case "round_end": {
        const won = msg.winner === this.team;
        this.hud.banner(won ? "Round won" : "Round lost", REASONS[msg.reason] ?? "", won ? "is-win" : "is-lose", 3000);
        sfx.result(won);
        return;
      }
      case "planted":
        // Defenders aren't told the site; they have to find it.
        if (msg.site) this.hud.banner(`Bomb planted at ${msg.site}`, "Protect it until it blows", "is-bomb", 2000);
        else this.hud.banner("Bomb planted", "Find it and defuse it", "is-bomb", 2000);
        return sfx.beep(true);
      case "defused":
        return this.hud.banner("Bomb defused", "", "is-go", 1800);
      case "exploded":
        return sfx.explosion();
    }
  }

  onSnap(msg) {
    const sample = msg.tm - Date.now();
    this.offset = this.offset === null ? sample : this.offset + (sample - this.offset) * 0.1;
    this.snaps.push({ tm: msg.tm, ps: new Map(msg.ps.map((p) => [p[0], p])) });
    if (this.snaps.length > 40) this.snaps.shift();
    const wasPhase = this.round.phase;
    const prevWeapon = this.me.w;
    this.round = msg.round;
    this.bomb = msg.bomb;
    this.me = msg.me;
    this.seen = new Set(msg.seen);
    const now = performance.now();
    // Keep showing the weapon we just picked until the server has caught up.
    if (this.wanted && now < this.wanted.until && this.me.w !== this.wanted.w) this.me.w = this.wanted.w;
    else this.wanted = null;
    if (this.me.w !== prevWeapon) this.drawAt = now;
    this.trackReload(now);
    // New round: face the way the server spawned us.
    if (msg.round.n !== this.roundSeen && msg.me.alive) {
      this.roundSeen = msg.round.n;
      this.controls.state.yaw = msg.me.yaw;
      this.controls.state.pitch = 0;
    }
    this.hud.score(msg.round.score, msg.round.attack);
    this.checkClutch(msg);

    // Reconcile: take the server's state at the last input it processed, then replay the rest.
    const m = msg.me;
    if (!this.synced || wasPhase !== msg.round.phase || !m.alive) this.synced = m.alive;
    const crouch = this.body.crouch;
    this.body = { ...this.body, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, grounded: !!m.g, crouch };
    this.pending = this.pending.filter((input) => input.s > msg.ack);
    const frozen = msg.round.phase !== "live" || !m.alive;
    for (const input of this.pending) step(this.map, this.body, input.k, input.y, input.p, input.d / 1000, { frozen });
  }

  // Reload animation and sound follow the server's reload timer.
  trackReload(now) {
    const rl = this.me.rl;
    if (rl > 0 && (!this.reload || this.reload.w !== this.me.w)) {
      const total = WEAPONS[this.me.w].reload * 1000;
      this.reload = { w: this.me.w, start: now - (total - rl), total };
      sfx.reload(this.me.w, rl / 1000);
    } else if (rl <= 0 && this.reload) {
      if (now - this.reload.start < this.reload.total - 150) sfx.cancelReload();
      this.reload = null;
    }
  }

  // Valorant-style callouts when a side is down to its last player.
  checkClutch(msg) {
    if (this.clutch.round !== msg.round.n) this.clutch = { round: msg.round.n, last: false, one: false };
    if (msg.round.phase !== "live") return;
    let mates = msg.me.alive ? 1 : 0;
    let enemies = 0;
    for (const p of msg.ps) {
      if (!p[7]) continue;
      if (this.players.get(p[0])?.team === this.team) mates += 1;
      else enemies += 1;
    }
    if (!enemies || !mates) return;
    const last = mates === 1 && msg.me.alive && !this.clutch.last;
    const one = enemies === 1 && !this.clutch.one;
    if (last) this.clutch.last = true;
    if (one) this.clutch.one = true;
    if (last) this.hud.banner("LAST ONE STANDING", enemies === 1 ? "1 enemy remaining" : `${enemies} enemies remaining`, "is-clutch", 2600);
    else if (one) this.hud.banner("1 ENEMY REMAINING", "", "is-clutch", 2200);
  }

  positional(from) {
    const dx = from[0] - this.body.x;
    const dz = from[2] - this.body.z;
    const distance = Math.hypot(dx, dz);
    const yaw = this.controls.state.yaw;
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    return { distance, pan: Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / Math.max(distance, 1))) };
  }

  onShot(msg) {
    this.renderer.tracer(msg.from, msg.to, msg.hit);
    if (msg.id !== this.meId) sfx.shot(msg.w, this.positional(msg.from));
  }

  onSlash(msg) {
    if (msg.id === this.meId) return;
    const s = this.lastRemote?.get(msg.id);
    if (s) sfx.slash(this.positional([s.x, s.y, s.z]));
  }

  onKill(msg) {
    const killer = this.players.get(msg.killer);
    const victim = this.players.get(msg.victim);
    if (killer) killer.kills = (killer.kills ?? 0) + 1;
    if (victim) victim.deaths = (victim.deaths ?? 0) + 1;
    if (killer && victim) {
      this.hud.kill(killer, victim, { head: msg.head, back: !!msg.back, weapon: msg.w, mine: msg.killer === this.meId, me: msg.victim === this.meId });
    }
    this.renderer.hideAvatar(msg.victim);
  }

  // ---------- local actions ----------

  get carrying() {
    return this.isAttacker && this.bomb.carrier === this.meId && !this.bomb.planted;
  }

  inventory() {
    return WEAPON_ORDER.filter((id) => id !== "bomb" || this.carrying);
  }

  switchWeapon(weapon) {
    if (!this.me.alive || !weapon || weapon === this.me.w || !this.inventory().includes(weapon)) return;
    this.send({ t: "switch", w: weapon });
    const now = performance.now();
    this.wanted = { w: weapon, until: now + 400 };
    this.me.w = weapon;
    this.drawAt = now;
    this.nextShot = now + SWITCH_MS;
    if (this.reload) {
      sfx.cancelReload();
      this.reload = null;
    }
    sfx.equip();
  }

  cycleWeapon(dir) {
    const list = this.inventory();
    const i = list.indexOf(this.me.w);
    this.switchWeapon(list[(i + dir + list.length) % list.length]);
  }

  dropBomb() {
    if (!this.carrying || !this.me.alive) return;
    this.send({ t: "drop" });
    sfx.bombDrop();
    if (this.me.w === "bomb") {
      this.wanted = { w: "rifle", until: performance.now() + 400 };
      this.me.w = "rifle";
      this.drawAt = performance.now();
    }
  }

  openChat() {
    if (this.hud.chatOpen) return;
    this.controls.setTyping(true);
    this.hud.openChat();
  }

  tryFire(now) {
    const c = this.controls.state;
    const weapon = WEAPONS[this.me.w];
    if (!c.fire || !c.locked || c.typing || !this.me.alive || this.round.phase !== "live" || this.me.rl > 0 || now < this.nextShot) return;
    if (weapon.melee) {
      this.nextShot = now + weapon.interval * 1000;
      this.swingAt = now;
      this.send({ t: "fire", y: c.yaw, p: c.pitch, vt: Math.round(this.serverNow - RULES.interpMs) });
      sfx.slash();
      return;
    }
    if (!weapon.gun) return;
    if (this.me.mag <= 0) {
      this.send({ t: "reload" });
      this.nextShot = now + 400;
      return;
    }
    this.spray = Math.max(0, this.spray - (SPRAY_RECOVERY * (now - this.lastShot)) / 1000) + weapon.sprayStep;
    this.lastShot = now;
    this.nextShot = now + weapon.interval * 1000;
    this.me.mag -= 1;
    this.send({ t: "fire", y: c.yaw, p: c.pitch, vt: Math.round(this.serverNow - RULES.interpMs) });
    this.renderer.muzzle();
    sfx.shot(this.me.w);
    // Visual kick; the server applies the real spread.
    c.pitch = Math.min(1.45, c.pitch + weapon.sprayStep * 0.6);
  }

  simulate() {
    const c = this.controls.state;
    const frozen = this.round.phase !== "live" || !this.me.alive;
    this.prev = copyBody(this.body);
    step(this.map, this.body, c.keys, c.yaw, c.pitch, STEP, { frozen });
    const input = { t: "in", s: ++this.seq, k: c.keys, y: Math.round(c.yaw * 1e4) / 1e4, p: Math.round(c.pitch * 1e4) / 1e4, d: Math.round(STEP * 1000) };
    this.pending.push(input);
    if (this.pending.length > 90) this.pending.shift();
    this.send(input);
    // Holding fire with the bomb in hand plants it, same as the use key.
    const use = c.use || (c.fire && c.locked && !c.typing && this.me.w === "bomb");
    if (use !== this.lastUse) {
      this.lastUse = use;
      this.send({ t: "use", on: use });
    }
  }

  // ---------- spectating (teammates only) ----------

  aliveMates(remote) {
    return [...remote]
      .filter(([id, s]) => s.alive && this.players.get(id)?.team === this.team)
      .map(([id]) => id)
      .sort((a, b) => a - b);
  }

  cycleSpectateTarget(dir) {
    const ids = this.aliveMates(this.lastRemote ?? new Map());
    if (!ids.length) return;
    const i = ids.indexOf(this.spec.id);
    this.spec.id = ids[(i + dir + ids.length) % ids.length];
  }

  cycleSpectateMode() {
    const i = SPECTATE_MODES.indexOf(this.spec.mode);
    this.spec.mode = SPECTATE_MODES[(i + 1) % SPECTATE_MODES.length];
    if (this.spec.mode === "free") {
      const target = this.lastRemote?.get(this.spec.id);
      if (target) {
        this.controls.state.yaw = target.yaw;
        this.controls.state.pitch = -0.35;
      }
    }
  }

  // Camera for watching a teammate: their own eyes, behind their shoulder, or orbiting freely.
  spectateView(target) {
    const head = { x: target.x, y: target.y + (target.crouch ? 1.1 : 1.5), z: target.z };
    if (this.spec.mode === "first") {
      return { x: target.x, y: target.y, z: target.z, yaw: target.yaw, pitch: target.pitch, eye: target.crouch ? PLAYER.crouchEye : PLAYER.eye, showGun: false, hide: true };
    }
    const c = this.controls.state;
    const yaw = this.spec.mode === "free" ? c.yaw : target.yaw;
    const pitch = this.spec.mode === "free" ? Math.max(-1.2, Math.min(0.6, c.pitch)) : -0.18;
    const look = aimDirection(yaw, pitch);
    const back = { x: -look.x, y: -look.y + 0.15, z: -look.z };
    const len = Math.hypot(back.x, back.y, back.z);
    const dir = { x: back.x / len, y: back.y / len, z: back.z / len };
    const want = this.spec.mode === "free" ? 4.5 : 3.2;
    const dist = Math.max(0.6, rayWorld(this.map, head, dir, want) - 0.3);
    const cam = { x: head.x + dir.x * dist, y: head.y + dir.y * dist, z: head.z + dir.z * dist };
    const dx = head.x - cam.x;
    const dy = head.y - cam.y;
    const dz = head.z - cam.z;
    return { x: cam.x, y: cam.y, z: cam.z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), eye: 0, showGun: false, hide: false };
  }

  // The bomb's position, if this client is allowed to know it (defenders only once it's been spotted).
  bombSpot() {
    const b = this.bomb;
    if (b.planted && Number.isFinite(b.planted.x)) return { x: b.planted.x, z: b.planted.z, planted: true };
    if (!b.planted && b.dropped) return { x: b.dropped[0], z: b.dropped[1], planted: false };
    return null;
  }

  drawMinimap(now, remote, view) {
    const mates = [];
    const enemies = [];
    for (const [id, s] of remote) {
      if (!s.alive) continue;
      const entry = { id, x: s.x, z: s.z, yaw: s.yaw };
      (this.players.get(id)?.team === this.team ? mates : enemies).push(entry);
    }
    const me = this.me.alive ? { x: view.x, z: view.z, yaw: this.controls.state.yaw } : null;
    this.minimap.draw(now, { me, mates, enemies, seen: this.seen, bomb: this.bombSpot() });
  }

  // ---------- frame ----------

  remoteState(renderTime) {
    const snaps = this.snaps;
    if (!snaps.length) return new Map();
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].tm <= renderTime) {
        a = snaps[i - 1];
        b = snaps[i];
        break;
      }
    }
    const k = b.tm === a.tm ? 1 : Math.max(0, Math.min(1, (renderTime - a.tm) / (b.tm - a.tm)));
    const out = new Map();
    for (const [id, pb] of b.ps) {
      const pa = a.ps.get(id) ?? pb;
      out.set(id, {
        x: lerp(pa[1], pb[1], k),
        y: lerp(pa[2], pb[2], k),
        z: lerp(pa[3], pb[3], k),
        yaw: lerpAngle(pa[4], pb[4], k),
        pitch: lerp(pa[5], pb[5], k),
        crouch: !!pb[6],
        alive: !!pb[7],
        hp: pb[8],
        weapon: pb[9],
      });
    }
    return out;
  }

  updateObjectiveHud(now) {
    const bomb = this.bomb;
    const carrier = this.carrying;
    const live = this.me.alive && this.round.phase === "live";
    const touch = this.controls.touch;
    this.hud.carrier(carrier && live, touch ? "💣 You carry the bomb" : "💣 You carry the bomb · 4 equip · G drop");
    let prompt = null;
    let progress;
    const site = siteAt(this.map, this.body.x, this.body.z);
    const spot = this.bombSpot();
    if (live) {
      if (carrier && site) {
        prompt = bomb.plant > 0 ? "Planting..." : touch ? "Hold 💣 to plant" : "Hold F (or click with the bomb) to plant";
        progress = bomb.plant;
      } else if (!this.isAttacker && spot?.planted && Math.hypot(spot.x - this.body.x, spot.z - this.body.z) <= RULES.defuseRange) {
        prompt = bomb.defuse > 0 ? "Defusing..." : touch ? "Hold 💣 to defuse" : "Hold F to defuse";
        progress = bomb.defuse;
      }
    }
    this.hud.prompt(prompt, progress);
    this.controls.setUseVisible(!!prompt);

    // No countdown after the plant: a beep and a blinking icon that speed up instead.
    let lit = false;
    if (bomb.planted && this.round.phase === "live") {
      const interval = BEEP_MS[bomb.planted.blink ?? 0] ?? 1000;
      if (now - this.lastBeep > interval) {
        this.lastBeep = now;
        const volume = spot ? Math.max(0.15, 1 - Math.hypot(spot.x - this.body.x, spot.z - this.body.z) / 40) : 0.35;
        sfx.beep((bomb.planted.blink ?? 0) >= 2, volume);
        this.hud.bombBlink();
      }
      lit = now - this.lastBeep < 120;
    }
    this.renderer.setBomb(spot, !!spot?.planted, spot?.planted ? lit : true);
  }

  viewAnim(now) {
    const anim = { reload: null, swing: null, draw: null };
    if (this.reload) anim.reload = Math.min(1, (now - this.reload.start) / this.reload.total);
    if (now - this.swingAt < SWING_MS) anim.swing = (now - this.swingAt) / SWING_MS;
    if (now - this.drawAt < SWITCH_MS) anim.draw = (now - this.drawAt) / SWITCH_MS;
    return anim;
  }

  loop(now) {
    this.frame = requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.simulate();
      this.acc -= STEP;
    }
    this.tryFire(now);

    const renderTime = this.serverNow - RULES.interpMs;
    const remote = this.remoteState(renderTime);
    for (const [id, s] of remote) {
      const p = this.players.get(id);
      if (p) this.renderer.updateAvatar(p, s, { teammate: p.team === this.team });
    }

    const c = this.controls.state;
    let view;
    if (this.me.alive) {
      const k = this.acc / STEP;
      const pos = { x: lerp(this.prev.x, this.body.x, k), y: lerp(this.prev.y, this.body.y, k), z: lerp(this.prev.z, this.body.z, k) };
      view = { ...pos, yaw: c.yaw, pitch: c.pitch, eye: this.body.crouch ? PLAYER.crouchEye : PLAYER.eye, showGun: true, weapon: this.me.w, anim: this.viewAnim(now) };
      this.hud.dead(false);
    } else {
      // Spectate living teammates only (no enemy cameras, no free-flying ghost cam).
      const ids = this.aliveMates(remote);
      if (!ids.includes(this.spec.id)) this.spec.id = ids[0] ?? null;
      const target = this.spec.id !== null ? remote.get(this.spec.id) : null;
      if (target) {
        view = this.spectateView(target);
        if (view.hide) this.renderer.hideAvatar(this.spec.id);
        this.hud.dead(true, { name: this.players.get(this.spec.id)?.name, hp: target.hp, mode: MODE_LABELS[this.spec.mode], count: ids.length, touch: this.controls.touch });
      } else {
        view = { x: (this.map.width * CELL) / 2, y: 18, z: (this.map.height * CELL) / 2 + 20, yaw: 0, pitch: -0.75, eye: 0, showGun: false };
        this.hud.dead(true, null);
      }
    }
    this.root.classList.toggle("is-dead", !this.me.alive);
    this.lastRemote = remote;
    this.drawMinimap(now, remote, view);

    const weapon = WEAPONS[this.me.w];
    if (weapon.gun) {
      const moving = Math.hypot(this.body.vx, this.body.vz) / PLAYER.speed;
      const spreadNow = weapon.spread + Math.max(0, this.spray - (SPRAY_RECOVERY * (now - this.lastShot)) / 1000) + weapon.moveSpread * Math.min(1, moving) + (this.body.grounded ? 0 : weapon.airSpread);
      this.hud.crosshair(spreadNow * 380);
    } else this.hud.crosshair(0, true);
    const gunAmmo = this.me.ammo?.[GUNS.indexOf(this.me.w)];
    this.hud.vitals({
      hp: this.me.hp,
      weapon: this.me.w,
      mag: gunAmmo && this.wanted ? gunAmmo[0] : this.me.mag,
      reserve: gunAmmo && this.wanted ? gunAmmo[1] : this.me.res,
      reloadProgress: this.reload ? Math.min(1, (now - this.reload.start) / this.reload.total) : null,
    });
    this.hud.slots(this.inventory().map((id) => ({ id })), this.me.w, this.carrying && this.me.alive);
    this.hud.clock(((this.round.ends ?? 0) - this.serverNow) / 1000, this.round.phase, !!this.bomb.planted);
    this.updateObjectiveHud(now);
    this.renderer.render(view);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    sfx.cancelReload();
    this.root.classList.remove("is-dead");
    this.minimap.dispose();
    this.controls.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }
}
