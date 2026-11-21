import { step, createBody, PLAYER, CELL, KEY, aimDirection, rayWorld, forwardOf } from "./shared/physics.js";
import { Minimap } from "./minimap.js";
import { MAPS, siteAt } from "./shared/maps.js";
import { RULES } from "./shared/rules.js";
import { WEAPONS, WEAPON_ORDER, GUNS, SPRAY_RECOVERY } from "./shared/weapons.js";
import { FpsRenderer } from "./renderer.js";
import { createControls } from "./controls.js";
import { createHud } from "./hud.js";
import * as sfx from "./audio.js";
import { announce, preloadAnnouncer, stopAnnouncer } from "./announcer.js";
import { createHeroSelect } from "./heroSelect.js";
import { heroById } from "./shared/heroes.js";

// One match on the client. Local movement is predicted with the shared physics in fixed 30 Hz steps
// and corrected by the server's acknowledged state; other players are drawn 100 ms in the past,
// interpolated between snapshots. Shots are only decided by the server.
const STEP = 1 / 30;
const REASONS = { elimination: "Team eliminated", time: "Time ran out", defuse: "Bomb defused", explode: "Bomb exploded" };
const SWITCH_MS = 350;
const SWING_MS = 320;
// Beep interval per blink stage sent by the server (it speeds up as the fuse burns down).
const BEEP_MS = [1000, 650, 380, 170];
// Multi-kill callouts by streak length, with the announcer line for each.
const STREAKS = [null, ["KILL", "kill"], ["DOUBLE KILL", "double-kill"], ["TRIPLE KILL", "triple-kill"], ["MANIAC", "quadra-kill"], ["SAVAGE", "pentakill"]];
// Running above walking speed makes noise; steps land about every stride.
const STEP_SPEED = 3.3;
const STRIDE = 2.3;

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
    // Our own copy: ability walls from snapshots go into blocks so prediction collides with them.
    this.map = { ...MAPS[welcome.map], blocks: [] };
    this.effects = [];
    this.ab = { cd: 0, ult: 0, sh: 0, sf: 1, jf: 1, st: 0 };
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

    this.renderer = new FpsRenderer(root, this.map, { team: this.team });
    this.controls = createControls(root, {
      onReload: () => this.send({ t: "reload" }),
      onSwitch: (w) => this.switchWeapon(w),
      onCycle: (dir) => this.cycleWeapon(dir),
      onDrop: () => this.dropWeapon(),
      onChat: () => this.openChat(),
      onScoreboard: (on) => this.hud?.board(on, this.players.values(), this.meId),
      onLockChange: (locked) => this.onLockChange(locked),
      onPrimary: () => !this.me.alive && this.cycleSpectateMode(),
      onWheel: (dir) => (this.me.alive ? this.cycleWeapon(dir) : this.cycleSpectateTarget(dir)),
      onAbility: (slot) => this.useAbility(slot),
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
    this.hud.on("drop", () => this.dropWeapon());
    this.ground = [];
    this.specAnim = { id: null, weapon: null, drawAt: 0, reloadStart: 0, swingAt: -Infinity };
    this.specView = { id: null, yaw: 0, pitch: 0, at: 0 };
    this.steps = new Map();
    this.selfStride = 0;
    this.wasGrounded = true;
    this.plantTickAt = 0;
    this.defuseTickAt = 0;
    preloadAnnouncer();
    this.heroSelect = createHeroSelect(root, {
      meId: this.meId,
      onHover: (id) => this.send({ t: "hero", action: "hover", id }),
      onLock: (id) => this.send({ t: "hero", action: "lock", id }),
      onUnlock: () => this.send({ t: "hero", action: "unlock" }),
    });
    this.heroSelect.hide();
    if (welcome.phase === "pick") this.hud.pause(false);
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
    if (this.round.phase === "pick") return;
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
        if (this.me.w === "knife") sfx.stab();
        if (msg.kill) sfx.killConfirm();
        return;
      }
      case "pick":
        this.hud.pause(false);
        return this.heroSelect.update(msg, this.offset ?? 0);
      case "pick_done": {
        for (const p of msg.players) this.players.set(p.id, { ...this.players.get(p.id), ...p });
        this.heroSelect.hide();
        if (!this.controls.touch && !this.controls.state.locked) this.hud.pause(true, { first: !this.everLocked });
        return;
      }
      case "pickup":
        sfx.equip(msg.w);
        return this.hud.callout(`Picked up ${WEAPONS[msg.w].name}`, "", "is-small", 1200);
      case "hurt":
        this.hud.hurt();
        this.renderer.hurt();
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
        const goal = side === "ATTACK" ? "You attack: plant the bomb 💣" : "You defend: protect the sites 🛡️";
        if (msg.swap) {
          this.hud.banner("SWITCHING SIDES", goal, "is-swap", 3200);
          announce("switching-sides");
        }
        else this.hud.banner(`Round ${msg.n}`, goal, "", 2600);
        sfx.roundStart();
        if (msg.matchPoint?.length) {
          const ours = msg.matchPoint.includes(this.team);
          // After a side switch, let that banner land first.
          clearTimeout(this.matchPointTimer);
          this.matchPointTimer = setTimeout(() => {
            this.hud.callout("MATCH POINT", msg.matchPoint.length > 1 ? "Next round decides it" : ours ? "One more round to win" : "Don't let them close it out", "is-matchpoint", 2800);
            announce("match-point");
          }, msg.swap ? 1800 : 300);
        }
        return;
      }
      case "live":
        return this.hud.banner("GO!", "", "is-go", 900);
      case "round_end": {
        const won = msg.winner === this.team;
        this.hud.banner(won ? "Round won" : "Round lost", REASONS[msg.reason] ?? "", won ? "is-win" : "is-lose", 3000);
        sfx.result(won);
        announce(won ? "round-win" : "round-lose");
        if (msg.clutch) {
          const who = msg.clutch.id === this.meId ? "You" : this.players.get(msg.clutch.id)?.name ?? "";
          this.hud.callout(`CLUTCH 1v${msg.clutch.vs}`, who, won ? "is-clutch" : "is-enemy", 3200);
        }
        return;
      }
      case "planted":
        // Defenders aren't told the site; they have to find it.
        if (msg.site) this.hud.banner(`Bomb planted at ${msg.site}`, "Protect it until it blows", "is-bomb", 2000);
        else this.hud.banner("Bomb planted", "Find it and defuse it", "is-bomb", 2000);
        if (msg.by === this.meId) sfx.bombPlace();
        announce("bomb-planted");
        return sfx.beep(true);
      case "defused":
        sfx.defuseDone();
        announce("bomb-defused");
        return this.hud.banner("Bomb defused", "", "is-go", 1800);
      case "ability":
        return this.onAbility(msg);
      case "boom": {
        this.renderer.abilityFx.explosion(msg.x, msg.y, msg.z, msg.r);
        sfx.blast({ pos: { x: msg.x, y: msg.y, z: msg.z } });
        const d = Math.hypot(msg.x - this.body.x, msg.z - this.body.z);
        if (d < msg.r * 2.5) this.renderer.shake?.(Math.max(0.2, 1 - d / (msg.r * 2.5)));
        return;
      }
      case "beam": {
        const from = this.positionOf(msg.from);
        const to = this.positionOf(msg.to);
        if (from && to) this.renderer.abilityFx.beam(from, to);
        if (msg.to === this.meId) this.hud.callout("PULLED!", "", "is-enemy", 900);
        return;
      }
      case "scan": {
        const p = this.positionOf(msg.id);
        if (p) this.renderer.abilityFx.wave(p.x, p.z, 0x4ade80, 40, 800, Math.PI / 3, msg.yaw);
        return;
      }
      case "sensor_trip":
        this.renderer.abilityFx.wave(msg.x, msg.z, 0xff4040, 5, 600);
        if (msg.victim === this.meId) this.hud.callout("DETECTED", "A motion sensor revealed you", "is-enemy", 1600);
        return sfx.beep(true, 0.6);
      case "revived": {
        const p = this.positionOf(msg.id);
        if (p) this.renderer.abilityFx.column(p.x, p.z);
        if (msg.id === this.meId) this.hud.callout("REVIVED", "Back in the fight", "is-clutch", 1600);
        return;
      }
      case "broken":
        this.renderer.abilityFx.wave(msg.x, msg.z, 0xd6d3d1, 3, 400);
        return sfx.hurt();
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
    this.effects = msg.effects ?? [];
    this.ab = msg.ab ?? this.ab;
    this.map.blocks = this.effects.filter((e) => e.x0 !== undefined).map((e) => ({ x0: e.x0, z0: e.z0, x1: e.x1, z1: e.z1, h: e.h }));
    this.renderer.abilityFx.sync(this.effects);
    this.ground = msg.ground ?? [];
    const now = performance.now();
    // Keep showing the weapon we just picked until the server has caught up.
    if (this.wanted && now < this.wanted.until && this.me.w !== this.wanted.w) this.me.w = this.wanted.w;
    else this.wanted = null;
    if (this.me.w !== prevWeapon) {
      this.drawAt = now;
      // The server switched for us (picked up a gun, dropped one, planted the bomb).
      if (!this.wanted && this.me.alive) sfx.equip(this.me.w);
    }
    this.trackReload(now);
    // New round: face the way the server spawned us.
    if (msg.round.n !== this.roundSeen && msg.me.alive) {
      this.roundSeen = msg.round.n;
      this.controls.state.yaw = msg.me.yaw;
      this.controls.state.pitch = 0;
    }
    this.hud.score(msg.round.score, msg.round.attack);
    this.updateRoster(msg);
    this.checkClutch(msg);

    // Reconcile: take the server's state at the last input it processed, then replay the rest.
    const m = msg.me;
    if (!this.synced || wasPhase !== msg.round.phase || !m.alive) this.synced = m.alive;
    const crouch = this.body.crouch;
    this.body = { ...this.body, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, grounded: !!m.g, crouch };
    this.pending = this.pending.filter((input) => input.s > msg.ack);
    const frozen = msg.round.phase !== "live" || !m.alive;
    for (const input of this.pending) step(this.map, this.body, input.k, input.y, input.p, input.d / 1000, this.moveOptions(frozen, input.w));
  }

  updateRoster(msg) {
    const alive = new Map(msg.ps.map((p) => [p[0], { alive: !!p[7], hp: p[8] }]));
    alive.set(this.meId, { alive: msg.me.alive, hp: msg.me.hp });
    const entries = [...this.players.values()].map((p) => {
      const hero = heroById(p.hero);
      const state = alive.get(p.id) ?? { alive: true, hp: -1 };
      return {
        id: p.id,
        team: p.team,
        name: `${p.name}${hero ? ` · ${hero.name}` : ""}`,
        icon: hero?.icon ?? p.name.slice(0, 1).toUpperCase(),
        alive: state.alive,
        me: p.id === this.meId,
        hp: state.hp >= 0 ? state.hp : undefined,
      };
    });
    this.hud.roster(entries);
  }

  // ---------- abilities ----------

  get hero() {
    return heroById(this.players.get(this.meId)?.hero);
  }

  positionOf(id) {
    if (id === this.meId) return { x: this.body.x, y: this.body.y + 1.3, z: this.body.z };
    const s = this.lastRemote?.get(id);
    return s ? { x: s.x, y: s.y + 1.3, z: s.z } : null;
  }

  // Movement modifiers the server applies too: weapon weight, slow zones, stealth, jump boost, pads.
  moveOptions(frozen, weapon) {
    const pads = this.effects.filter((e) => e.type === "pad" && e.team === this.team).map((e) => ({ x: e.x, z: e.z, r: e.r }));
    return { frozen, speed: (WEAPONS[weapon]?.speed ?? 1) * (this.ab.sf ?? 1), jump: this.ab.jf ?? 1, pads };
  }

  useAbility(slot) {
    const hero = this.hero;
    const c = this.controls.state;
    if (!hero || !this.me.alive || this.round.phase !== "live" || c.typing) return;
    if (slot === "skill" && this.ab.cd > 0) return this.hud.callout("Not ready", `${Math.ceil(this.ab.cd / 1000)}s`, "is-small", 700);
    if (slot === "ult" && this.ab.ult < 100) return this.hud.callout("Ultimate charging", `${this.ab.ult}%`, "is-small", 700);
    this.send({ t: "ability", slot, y: c.yaw, p: c.pitch });
    // Predict our own dash so it feels instant; the server does the same from our last keys.
    if (slot === "skill" && hero.skill.id === "dash") {
      const f = forwardOf(c.yaw);
      const r = { x: -f.z, z: f.x };
      let dx = 0;
      let dz = 0;
      if (c.keys & KEY.FORWARD) (dx += f.x), (dz += f.z);
      if (c.keys & KEY.BACK) (dx -= f.x), (dz -= f.z);
      if (c.keys & KEY.RIGHT) (dx += r.x), (dz += r.z);
      if (c.keys & KEY.LEFT) (dx -= r.x), (dz -= r.z);
      if (!dx && !dz) (dx = f.x), (dz = f.z);
      const len = Math.hypot(dx, dz);
      Object.assign(this.body, { dashT: 0.22, dvx: (dx / len) * 32, dvz: (dz / len) * 32 });
    }
    this.drawAt = performance.now();
  }

  onAbility(msg) {
    const hero = heroById(msg.hero);
    const mine = msg.id === this.meId;
    const p = this.positionOf(msg.id);
    sfx.ability(msg.kind, mine ? {} : { pos: p });
    if (mine) {
      const ability = hero?.skill.id === msg.kind ? hero.skill : hero?.ult;
      if (ability && hero.ult.id === msg.kind) this.hud.callout(ability.name.toUpperCase(), "Ultimate", "is-ace", 1600);
    } else if (hero?.ult.id === msg.kind) {
      // Ultimates are loud: everyone hears and sees them called out.
      const who = this.players.get(msg.id);
      const ally = who?.team === this.team;
      this.hud.callout(hero.ult.name.toUpperCase(), `${ally ? "Ally" : "Enemy"} ${hero.name}`, ally ? "is-clutch" : "is-enemy", 1400);
    }
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
    // Counts the whole team, so it also fires when the last one left is a teammate being spectated.
    let mates = msg.me.alive ? 1 : 0;
    let lastId = msg.me.alive ? this.meId : null;
    let enemies = 0;
    for (const p of msg.ps) {
      if (!p[7]) continue;
      if (this.players.get(p[0])?.team === this.team) {
        mates += 1;
        lastId = p[0];
      } else enemies += 1;
    }
    if (!enemies || !mates) return;
    const last = mates === 1 && !this.clutch.last;
    const one = enemies === 1 && !this.clutch.one;
    if (last) this.clutch.last = true;
    if (one) this.clutch.one = true;
    if (last) {
      const who = lastId === this.meId ? "" : `${this.players.get(lastId)?.name ?? "Teammate"} · `;
      this.hud.banner("LAST ONE STANDING", `${who}${enemies === 1 ? "1 enemy remaining" : `${enemies} enemies remaining`}`, "is-clutch", 2600);
      announce("last-player-standing");
    } else if (one) {
      this.hud.banner("1 ENEMY REMAINING", "", "is-clutch", 2200);
      announce("one-enemy-remaining");
    }
  }

  // Watching this player through their own eyes.
  watching(id) {
    return !this.me.alive && this.spec.mode === "first" && this.spec.id === id;
  }

  onShot(msg) {
    const own = msg.id === this.meId;
    const pov = this.watching(msg.id);
    this.renderer.tracer(msg.path, msg.v, msg.hit, { own: own || pov });
    if (pov) {
      this.renderer.muzzle(msg.w);
      // Their recoil, felt through their eyes.
      this.specKick = Math.min(0.12, (this.specKick ?? 0) + (WEAPONS[msg.w]?.sprayStep ?? 0.01) * 1.2);
    }
    if (!own) {
      const [x, y, z] = msg.path[0];
      sfx.shot(msg.w, { pos: { x, y, z } });
    }
  }

  onSlash(msg) {
    if (msg.id === this.meId) return;
    if (this.watching(msg.id)) this.specAnim.swingAt = performance.now();
    const s = this.lastRemote?.get(msg.id);
    if (s) sfx.slash({ pos: { x: s.x, y: s.y + 1.3, z: s.z } });
  }

  onKill(msg) {
    const killer = this.players.get(msg.killer);
    const victim = this.players.get(msg.victim);
    if (killer) killer.kills = (killer.kills ?? 0) + 1;
    if (victim) victim.deaths = (victim.deaths ?? 0) + 1;
    const helpers = (msg.assists ?? []).map((id) => this.players.get(id)).filter(Boolean);
    for (const h of helpers) h.assists = (h.assists ?? 0) + 1;
    const assisted = msg.assists?.includes(this.meId);
    if (killer && victim) {
      this.hud.kill(killer, victim, { head: msg.head, back: !!msg.back, weapon: msg.w, mine: msg.killer === this.meId, me: msg.victim === this.meId, helpers, assisted });
    }
    // The victim plays a fall animation; the renderer hides the body afterwards.
    if (assisted) {
      this.hud.callout("ASSIST", `${killer?.name ?? ""} finished ${victim?.name ?? ""}`, "is-kill", 1200);
      sfx.assist();
    }
    if (msg.killer !== this.meId) return;
    // Your own kill streak: kill, double, triple, maniac, savage, and an ace for wiping the whole team.
    const [title, line] = STREAKS[Math.min(msg.streak ?? 1, 5)];
    this.hud.callout(title, msg.streak >= 2 ? `${msg.streak} kills this round` : "", msg.streak >= 4 ? "is-ace" : msg.streak >= 2 ? "is-streak" : "is-kill", msg.streak >= 2 ? 2000 : 1100);
    announce(line);
    if (msg.ace) {
      this.hud.callout("ACE", "Whole team, solo", "is-ace", 3000);
      announce("ace");
    }
  }

  // ---------- local actions ----------

  get carrying() {
    return this.isAttacker && this.bomb.carrier === this.meId && !this.bomb.planted;
  }

  inventory() {
    return this.me.inv ?? WEAPON_ORDER.filter((id) => id !== "bomb" || this.carrying);
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
    sfx.equip(weapon);
  }

  cycleWeapon(dir) {
    const list = this.inventory();
    const i = list.indexOf(this.me.w);
    this.switchWeapon(list[(i + dir + list.length) % list.length]);
  }

  // G: throw away whatever is in hand. The knife always stays.
  dropWeapon() {
    if (!this.me.alive || this.me.w === "knife" || !this.inventory().includes(this.me.w)) return;
    this.send({ t: "drop" });
    sfx.bombDrop();
    const rest = this.inventory().filter((id) => id !== this.me.w && id !== "bomb");
    const next = ["rifle", "pistol", "knife"].find((id) => rest.includes(id)) ?? "knife";
    this.me.inv = this.inventory().filter((id) => id !== this.me.w);
    this.wanted = { w: next, until: performance.now() + 400 };
    this.me.w = next;
    this.drawAt = performance.now();
    if (this.reload) {
      sfx.cancelReload();
      this.reload = null;
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
    this.renderer.muzzle(this.me.w);
    sfx.shot(this.me.w);
    // Visual kick; the server applies the real spread.
    c.pitch = Math.min(1.45, c.pitch + weapon.sprayStep * 0.6);
  }

  simulate() {
    const c = this.controls.state;
    const frozen = this.round.phase !== "live" || !this.me.alive;
    this.prev = copyBody(this.body);
    step(this.map, this.body, c.keys, c.yaw, c.pitch, STEP, this.moveOptions(frozen, this.me.w));
    const input = { t: "in", s: ++this.seq, k: c.keys, y: Math.round(c.yaw * 1e4) / 1e4, p: Math.round(c.pitch * 1e4) / 1e4, d: Math.round(STEP * 1000) };
    this.pending.push({ ...input, w: this.me.w });
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
  // Viewmodel state for the watched player: weapon draws, reloads, knife swings, planting, defusing.
  spectateAnim(id, target, now) {
    const a = this.specAnim;
    const weapon = WEAPON_ORDER[target.weapon] ?? "rifle";
    if (a.id !== id || a.weapon !== weapon) Object.assign(a, { id, weapon, drawAt: now, reloadStart: 0 });
    if (target.act & 1) a.reloadStart ||= now;
    else a.reloadStart = 0;
    const anim = {
      draw: now - a.drawAt < SWITCH_MS ? (now - a.drawAt) / SWITCH_MS : null,
      reload: a.reloadStart && WEAPONS[weapon].gun ? Math.min(1, (now - a.reloadStart) / (WEAPONS[weapon].reload * 1000)) : null,
      swing: now - a.swingAt < SWING_MS ? (now - a.swingAt) / SWING_MS : null,
      plant: target.act & 2 ? this.bomb.plant ?? 0 : null,
      defuse: target.act & 4 ? this.bomb.defuse ?? 0 : null,
    };
    const held = anim.plant !== null ? "bomb" : anim.defuse !== null ? "knife" : weapon;
    return { anim, held };
  }

  // Snapshots arrive 20 times a second: ease the watched player's view between them and add a
  // decaying kick for their shots so it feels like their own screen.
  smoothSpecView(id, target, now) {
    const v = this.specView;
    const dt = Math.min(0.1, (now - (v.at || now)) / 1000);
    v.at = now;
    if (v.id !== id) Object.assign(v, { id, yaw: target.yaw, pitch: target.pitch });
    const k = 1 - Math.exp(-dt * 22);
    v.yaw += Math.atan2(Math.sin(target.yaw - v.yaw), Math.cos(target.yaw - v.yaw)) * k;
    v.pitch += (target.pitch - v.pitch) * k;
    this.specKick = (this.specKick ?? 0) * Math.exp(-dt * 9);
    return { yaw: v.yaw, pitch: v.pitch + this.specKick };
  }

  spectateView(target, id = this.spec.id, now = performance.now()) {
    const head = { x: target.x, y: target.y + (target.crouch ? 1.1 : 1.5), z: target.z };
    if (this.spec.mode === "first") {
      const { anim, held } = this.spectateAnim(id, target, now);
      const { yaw, pitch } = this.smoothSpecView(id, target, now);
      return { x: target.x, y: target.y, z: target.z, yaw, pitch, eye: target.crouch ? PLAYER.crouchEye : PLAYER.eye, showGun: true, weapon: held, anim, hide: true };
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
    const smokes = this.effects.filter((e) => e.type === "smoke").map((e) => ({ x: e.x, z: e.z, r: e.r }));
    this.minimap.draw(now, { me, mates, enemies, seen: this.seen, bomb: this.bombSpot(), smokes });
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
        act: pb[10] ?? 0,
        status: pb[11] ?? 0,
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

  // Planting/defusing: viewmodel animation plus keypad presses or wire snips while the bar fills.
  objectiveAction(now) {
    const bomb = this.bomb;
    const spot = this.bombSpot();
    const planting = this.me.alive && this.carrying && bomb.plant > 0;
    const defusing = this.me.alive && !this.isAttacker && bomb.defuse > 0 && this.controls.state.use && spot?.planted && Math.hypot(spot.x - this.body.x, spot.z - this.body.z) <= RULES.defuseRange;
    if (planting && now - this.plantTickAt > 230 + Math.random() * 80) {
      this.plantTickAt = now;
      sfx.keypad();
    }
    if (defusing && now - this.defuseTickAt > 160 + Math.random() * 140) {
      this.defuseTickAt = now;
      sfx.defuseTick();
    }
    return { plant: planting ? bomb.plant : null, defuse: defusing ? bomb.defuse : null };
  }

  // Footsteps: other players' come from where they are (3D audio); walking and crouching are silent.
  footsteps(now, remote, view, dt) {
    sfx.setListener(view.x, view.y + (view.eye ?? 0), view.z, view.yaw);
    for (const [id, s] of remote) {
      let track = this.steps.get(id);
      if (!track) this.steps.set(id, (track = { x: s.x, z: s.z, y: s.y, stride: 0 }));
      const moved = Math.hypot(s.x - track.x, s.z - track.z);
      const speed = dt > 0 ? moved / dt : 0;
      if (s.alive && s.y < 0.05 && track.y > 0.4) sfx.land({ pos: { x: s.x, y: s.y, z: s.z } });
      // Stealthed players make no sound.
      if (s.alive && !(s.status & 1) && s.y < 0.05 && speed > STEP_SPEED && speed < 12) {
        track.stride += moved;
        if (track.stride >= STRIDE) {
          track.stride = 0;
          sfx.footstep({ pos: { x: s.x, y: s.y + 0.05, z: s.z } });
        }
      }
      Object.assign(track, { x: s.x, z: s.z, y: s.y });
    }
    if (!this.me.alive) return;
    const speed = Math.hypot(this.body.vx, this.body.vz);
    if (this.body.grounded && !this.wasGrounded) sfx.land();
    this.wasGrounded = this.body.grounded;
    if (this.body.grounded && speed > STEP_SPEED) {
      this.selfStride += speed * dt;
      if (this.selfStride >= STRIDE) {
        this.selfStride = 0;
        sfx.footstep({ self: true });
      }
    }
  }

  viewAnim(now) {
    const anim = { reload: null, swing: null, draw: null, ...this.objectiveAction(now) };
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
      const anim = this.viewAnim(now);
      const held = anim.plant !== null ? "bomb" : anim.defuse !== null ? "knife" : this.me.w;
      view = { ...pos, yaw: c.yaw, pitch: c.pitch, eye: this.body.crouch ? PLAYER.crouchEye : PLAYER.eye, showGun: true, weapon: held, anim };
      this.hud.dead(false);
    } else {
      // Spectate living teammates only (no enemy cameras, no free-flying ghost cam).
      const ids = this.aliveMates(remote);
      if (!ids.includes(this.spec.id)) this.spec.id = ids[0] ?? null;
      const target = this.spec.id !== null ? remote.get(this.spec.id) : null;
      if (target) {
        view = this.spectateView(target, this.spec.id, now);
        if (view.hide) this.renderer.hideAvatar(this.spec.id);
        this.hud.dead(true, { name: this.players.get(this.spec.id)?.name, hp: target.hp, mode: MODE_LABELS[this.spec.mode], count: ids.length, touch: this.controls.touch });
      } else {
        view = { x: (this.map.width * CELL) / 2, y: 18, z: (this.map.height * CELL) / 2 + 20, yaw: 0, pitch: -0.75, eye: 0, showGun: false };
        this.hud.dead(true, null);
      }
    }
    this.root.classList.toggle("is-dead", !this.me.alive);
    this.root.classList.toggle("is-pov", !this.me.alive && this.spec.mode === "first" && !!view.showGun);
    this.lastRemote = remote;
    this.footsteps(now, remote, view, dt);
    this.renderer.setGround(this.ground);
    this.drawMinimap(now, remote, view);

    const weapon = WEAPONS[this.me.w];
    if (weapon.gun) {
      const moving = Math.hypot(this.body.vx, this.body.vz) / PLAYER.speed;
      const spreadNow = weapon.spread + Math.max(0, this.spray - (SPRAY_RECOVERY * (now - this.lastShot)) / 1000) + weapon.moveSpread * Math.min(1, moving) + (this.body.grounded ? 0 : weapon.airSpread);
      this.hud.crosshair(spreadNow * 380);
    } else this.hud.crosshair(0, true);
    const gunAmmo = this.me.ammo?.[GUNS.indexOf(this.me.w)];
    this.hud.abilities({ hero: this.hero, cd: this.ab.cd ?? 0, ult: this.ab.ult ?? 0, stealth: this.ab.st ?? 0 });
    this.hud.shield(this.ab.sh ?? 0);
    this.hud.vitals({
      hp: this.me.hp,
      weapon: this.me.w,
      mag: gunAmmo && this.wanted ? gunAmmo[0] : this.me.mag,
      reserve: gunAmmo && this.wanted ? gunAmmo[1] : this.me.res,
      reloadProgress: this.reload ? Math.min(1, (now - this.reload.start) / this.reload.total) : null,
    });
    this.hud.slots(this.inventory().map((id) => ({ id })), this.me.w, this.me.alive && this.me.w !== "knife");
    this.hud.clock(((this.round.ends ?? 0) - this.serverNow) / 1000, this.round.phase, !!this.bomb.planted);
    this.updateObjectiveHud(now);
    this.renderer.render(view);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.heroSelect.dispose();
    clearTimeout(this.matchPointTimer);
    sfx.cancelReload();
    stopAnnouncer();
    this.root.classList.remove("is-dead");
    this.minimap.dispose();
    this.controls.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }
}
