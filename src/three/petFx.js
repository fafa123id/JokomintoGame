import * as THREE from "/asset/vendor/three/three.module.min.js";
import { perf } from "./perf.js";

// World units match petRenderer: sprite (x, y-down) -> ((x - 100) / 100, (330 - y) / 100).
const W = (sx, sy, z = 0) => new THREE.Vector3((sx - 100) * 0.01, (330 - sy) * 0.01, z);
const MOUTH = W(100, 174, 0.44);
const HEAD = W(100, 140, 0.3);
const HEAD_TOP = W(100, 72, 0.2);
const FOOD_START = W(178, 40, 0.5);
const FOOD_SCALE = 1.9;
const SOAP_SCALE = 1.7;
const BALL_SCALE = 1.6;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const phase = (t, a, b) => clamp01((t - a) / (b - a));
const rand = (min, max) => min + Math.random() * (max - min);
const ease = {
  outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
};

// ---------- shared assets (built once, reused by every pet) ----------

let shared = null;

function heartGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.35);
  s.bezierCurveTo(-0.5, 0, -0.45, 0.42, 0, 0.18);
  s.bezierCurveTo(0.45, 0.42, 0.5, 0, 0, -0.35);
  return new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false }).center();
}

function beachBallGeometry() {
  const geometry = new THREE.SphereGeometry(0.16, 16, 12);
  const palette = [0xef4444, 0xfacc15, 0x3b82f6, 0xffffff].map((c) => new THREE.Color(c));
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const angle = Math.atan2(pos.getX(i), pos.getZ(i)) + Math.PI;
    const color = Math.abs(pos.getY(i)) > 0.145 ? palette[3] : palette[Math.floor((angle / (Math.PI * 2)) * 6) % 3];
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function getShared() {
  if (shared) return shared;
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  shared = {
    geo: {
      crumb: new THREE.TetrahedronGeometry(1, 0),
      foam: new THREE.IcosahedronGeometry(1, 1),
      drop: new THREE.SphereGeometry(1, 6, 4),
      sparkle: new THREE.OctahedronGeometry(1, 0),
      heart: heartGeometry(),
      ball: beachBallGeometry(),
      coin: new THREE.CylinderGeometry(1, 1, 0.22, 16).rotateX(Math.PI / 2),
      confetti: new THREE.BoxGeometry(1, 0.55, 0.06),
    },
    mat: {
      crumb: lambert({ flatShading: true }),
      foam: lambert({ color: 0xffffff, emissive: 0x2a3340, transparent: true, opacity: 0.92 }),
      water: lambert({ color: 0xffffff, emissive: 0x1d4ed8, emissiveIntensity: 0.25, transparent: true, opacity: 0.7 }),
      sparkle: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      heart: lambert({ emissive: 0x4a0f2a }),
      stink: lambert({ color: 0xffffff, emissive: 0x1a2e05, transparent: true, opacity: 0.55 }),
      coin: lambert({ color: 0xffffff, emissive: 0x5c3d00 }),
      confetti: lambert({ side: THREE.DoubleSide, emissive: 0x222222 }),
    },
  };
  return shared;
}

const lambertMesh = (geometry, color, extra = {}) =>
  new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra }));

const FOODS = {
  biskuit: {
    crumbs: [0xd4a05a, 0xb57a35, 0x4a2a12],
    build(g) {
      const base = lambertMesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 18), 0xd4a05a);
      base.rotation.x = Math.PI / 2;
      g.add(base);
      for (let i = 0; i < 6; i++) {
        const chip = lambertMesh(new THREE.SphereGeometry(0.028, 6, 4), 0x4a2a12);
        const a = (i / 6) * Math.PI * 2 + 0.4;
        chip.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.035);
        g.add(chip);
      }
    },
  },
  roti: {
    crumbs: [0xe2a35a, 0xf7d9a8, 0xb8742c],
    build(g) {
      const loaf = lambertMesh(new THREE.CapsuleGeometry(0.12, 0.2, 4, 12), 0xe2a35a);
      loaf.rotation.z = Math.PI / 2;
      loaf.scale.set(1, 1, 0.85);
      g.add(loaf);
      for (let i = -1; i <= 1; i++) {
        const slash = lambertMesh(new THREE.BoxGeometry(0.025, 0.12, 0.02), 0xb8742c);
        slash.position.set(i * 0.09, 0.02, 0.1);
        slash.rotation.z = 0.5;
        g.add(slash);
      }
    },
  },
  nasigoreng: {
    crumbs: [0xc2710c, 0xf59e0b, 0x16a34a, 0xffffff],
    build(g) {
      const profile = [[0, -0.09], [0.12, -0.09], [0.2, 0], [0.23, 0.06], [0.21, 0.06]].map(([x, y]) => new THREE.Vector2(x, y));
      const bowl = lambertMesh(new THREE.LatheGeometry(profile, 18), 0xf5f5f4, { side: THREE.DoubleSide });
      const rice = lambertMesh(new THREE.SphereGeometry(0.19, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xc2710c);
      rice.position.y = 0.02;
      const egg = lambertMesh(new THREE.CylinderGeometry(0.085, 0.09, 0.015, 16), 0xffffff);
      egg.position.set(0.02, 0.19, 0.02);
      const yolk = lambertMesh(new THREE.SphereGeometry(0.04, 10, 6), 0xfacc15);
      yolk.scale.y = 0.5;
      yolk.position.set(0.02, 0.205, 0.02);
      g.add(bowl, rice, egg, yolk);
      g.rotation.x = 0.55;
    },
  },
  pizza: {
    crumbs: [0xfcd34d, 0xdc2626, 0xd97706],
    build(g) {
      const shape = new THREE.Shape();
      shape.moveTo(0, -0.24);
      shape.lineTo(0.2, 0.2);
      shape.lineTo(-0.2, 0.2);
      shape.closePath();
      const slice = lambertMesh(new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false }), 0xfcd34d);
      slice.position.z = -0.0175;
      const crust = lambertMesh(new THREE.CapsuleGeometry(0.032, 0.36, 3, 8), 0xd97706);
      crust.rotation.z = Math.PI / 2;
      crust.position.y = 0.2;
      g.add(slice, crust);
      for (const [x, y] of [[0, 0.08], [-0.07, 0.13], [0.06, 0.14], [0.01, -0.04]]) {
        const pep = lambertMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 10), 0xdc2626);
        pep.rotation.x = Math.PI / 2;
        pep.position.set(x, y, 0.025);
        g.add(pep);
      }
    },
  },
  steak: {
    crumbs: [0x8b3a1a, 0x5c2410, 0xf97316],
    build(g) {
      const meat = lambertMesh(new THREE.SphereGeometry(0.22, 16, 10), 0x8b3a1a);
      meat.scale.set(1, 0.68, 0.34);
      g.add(meat);
      for (let i = -1; i <= 1; i++) {
        const mark = lambertMesh(new THREE.BoxGeometry(0.3, 0.016, 0.01), 0x3b1a0c);
        mark.position.set(0, i * 0.06, 0.075);
        mark.rotation.z = 0.45;
        g.add(mark);
      }
      const bone = lambertMesh(new THREE.CylinderGeometry(0.028, 0.028, 0.24, 8), 0xf5f5f4);
      bone.rotation.z = Math.PI / 2;
      bone.position.set(0.26, -0.02, 0);
      const knob = lambertMesh(new THREE.SphereGeometry(0.045, 8, 6), 0xf5f5f4);
      knob.position.set(0.38, -0.02, 0);
      g.add(bone, knob);
    },
  },
};

const SOAPS = {
  biasa: { soap: 0x7dd3fc, foam: 0xffffff, sparkle: [0xffffff, 0xbae6fd], sparkles: 10 },
  wangi: { soap: 0xf9a8d4, foam: 0xffe4f1, sparkle: [0xf9a8d4, 0xffffff, 0xfbcfe8], sparkles: 14 },
  premium: { soap: 0xfde047, foam: 0xfff7cc, sparkle: [0xfde047, 0xffffff, 0xfbbf24], sparkles: 22, emissive: 0x6b4a00 },
};

// ---------- instanced particles ----------

class Particles {
  constructor(parent, geometry, material, max) {
    this.max = Math.max(4, Math.round(max * perf.particles));
    this.mesh = new THREE.InstancedMesh(geometry, material, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.items = [];
    this.dummy = new THREE.Object3D();
  }

  spawn(o) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      pos: o.pos.clone(),
      vel: o.vel ? o.vel.clone() : new THREE.Vector3(),
      age: 0,
      life: o.life ?? 1,
      size: o.size ?? 0.05,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 0,
      spin: o.spin ?? 0,
      rot: Math.random() * Math.PI * 2,
      color: new THREE.Color(o.color ?? 0xffffff),
      grow: o.grow ?? 0.15,
      shrink: o.shrink ?? 0.35,
      wobble: o.wobble ?? 0,
      stretch: o.stretch ?? 1,
      upright: !!o.upright,
      sway: o.sway ?? 0,
      seed: Math.random() * 10,
    });
  }

  update(dt, t) {
    const items = this.items;
    let alive = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vel.y -= p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.sway) p.pos.x += Math.sin(t * 3 + p.seed) * p.sway * dt;
      p.rot += p.spin * dt;

      const k = p.age / p.life;
      let s = p.size * Math.min(1, k / p.grow) * Math.min(1, (1 - k) / p.shrink);
      if (p.wobble) s *= 1 + p.wobble * Math.sin(t * 11 + p.seed);
      const d = this.dummy;
      d.position.copy(p.pos);
      if (p.upright) d.rotation.set(0, 0, 0);
      else d.rotation.set(p.rot * 0.7, p.rot, p.rot * 0.3);
      d.scale.set(s, s * p.stretch, s);
      d.updateMatrix();
      this.mesh.setMatrixAt(alive, d.matrix);
      this.mesh.setColorAt(alive, p.color);
      items[alive++] = p;
    }
    items.length = alive;
    this.mesh.count = alive;
    if (alive) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.items.length = 0;
    this.mesh.count = 0;
  }
}

// ---------- scenes ----------

export class PetFx {
  constructor(pet, { ambient = false } = {}) {
    this.ambientEnabled = ambient;
    this.nervous = false;
    this.nextSweat = 0;
    this.pet = pet;
    const { geo, mat } = getShared();
    this.group = new THREE.Group();
    pet.rig.add(this.group);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a6cc8, 1.6);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-1.5, 3, 4);
    pet.scene.add(hemi, sun);

    this.crumbs = new Particles(this.group, geo.crumb, mat.crumb, 60);
    this.foam = new Particles(this.group, geo.foam, mat.foam, 80);
    this.water = new Particles(this.group, geo.drop, mat.water, 80);
    this.sparkles = new Particles(this.group, geo.sparkle, mat.sparkle, 40);
    this.hearts = new Particles(this.group, geo.heart, mat.heart, 10);
    this.stink = new Particles(this.group, geo.foam, mat.stink, 14);
    this.coins = new Particles(this.group, geo.coin, mat.coin, 24);
    this.confetti = new Particles(this.group, geo.confetti, mat.confetti, 60);

    this.props = {};
    this.active = null;
    this.rimBoost = 0;
    this.ambient = { dirty: false, hungry: false, nextStink: 0, nextRumble: 0 };
  }

  prop(key, build) {
    if (!this.props[key]) {
      const g = new THREE.Group();
      build(g);
      g.visible = false;
      this.group.add(g);
      this.props[key] = g;
    }
    return this.props[key];
  }

  hideProps() {
    for (const p of Object.values(this.props)) p.visible = false;
  }

  play(name, data = {}, onDone) {
    this.finish(false);
    this.active = { name, data, start: performance.now(), flags: {}, onDone };
  }

  finish(callDone = true) {
    const done = this.active?.onDone;
    this.active = null;
    this.hideProps();
    if (callDone) done?.();
  }

  skip() {
    this.finish(false);
    for (const system of [this.crumbs, this.foam, this.water]) system.clear();
    this.pet.stop();
  }

  lookAt(target, now) {
    const head = HEAD;
    const x = THREE.MathUtils.clamp((target.x - head.x) * 1.4, -1, 1);
    const y = THREE.MathUtils.clamp(-(target.y - head.y) * 1.4, -1, 1);
    this.pet.glance = { x, y, until: now + 120, forced: true };
  }

  burst(system, at, count, { colors, speed = 1.6, up = 1.2, size = [0.03, 0.06], life = [0.6, 1.1], gravity = 4, spin = 8 } = {}) {
    const n = Math.max(1, Math.round(count * perf.particles));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      system.spawn({
        pos: at,
        vel: new THREE.Vector3(Math.cos(a) * speed * rand(0.4, 1), rand(0.3, 1) * up + Math.sin(a) * speed * 0.3, rand(0.2, 0.8)),
        size: rand(size[0], size[1]),
        life: rand(life[0], life[1]),
        gravity,
        spin: rand(-spin, spin),
        color: colors[i % colors.length],
      });
    }
  }

  // ---- eat ----
  eat(t, dt, now, s) {
    const kind = FOODS[s.data.food] ? s.data.food : "roti";
    const food = this.prop(`food:${kind}`, (g) => FOODS[kind].build(g));
    const pet = this.pet;
    food.visible = t < 1.78;

    if (t < 0.45) {
      const k = ease.outBack(t / 0.45);
      food.position.copy(FOOD_START);
      food.scale.setScalar(Math.max(0.001, k * FOOD_SCALE));
      food.rotation.y = t * 7;
      this.lookAt(food.position, now);
      s.scale = 1;
    } else if (t < 0.85) {
      const k = ease.inOut(phase(t, 0.45, 0.85));
      food.position.lerpVectors(FOOD_START, MOUTH, k);
      food.position.y += Math.sin(k * Math.PI) * 0.35;
      food.rotation.y += dt * 9;
      this.lookAt(food.position, now);
      if (!s.flags.open) {
        s.flags.open = true;
        pet.springs.squash.kick(-1.4);
        pet.springs.earL.kick(-4);
        pet.springs.earR.kick(4);
      }
    } else {
      const bites = [0.9, 1.22, 1.54];
      const targets = [0.7, 0.42, 0.001];
      bites.forEach((at, i) => {
        if (t >= at && !s.flags[`bite${i}`]) {
          s.flags[`bite${i}`] = true;
          s.target = targets[i];
          pet.springs.squash.kick(2.4);
          pet.springs.headY.kick(55);
          this.burst(this.crumbs, MOUTH, 10, { colors: FOODS[kind].crumbs, speed: 1.4, up: 0.9 });
        }
      });
      if (!s.flags.chomp) {
        s.flags.chomp = true;
        pet.setMode("chomp", now + 900);
      }
      s.scale += ((s.target ?? 1) - s.scale) * Math.min(1, dt * 16);
      food.scale.setScalar(Math.max(0.001, s.scale * FOOD_SCALE));
      food.position.copy(MOUTH);
      food.position.y += Math.sin(t * 40) * 0.01 * s.scale;
      food.rotation.y = Math.sin(t * 6) * 0.4;
      food.rotation.z = Math.sin(t * 30) * 0.08;
    }

    if (t >= 1.8 && !s.flags.yum) {
      s.flags.yum = true;
      pet.springs.jump.kick(3);
      pet.springs.earL.kick(-6);
      pet.springs.earR.kick(6);
      for (let i = 0; i < 3; i++) {
        this.hearts.spawn({
          pos: HEAD_TOP.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.1, 0.2), 0.3)),
          vel: new THREE.Vector3(rand(-0.15, 0.15), rand(0.7, 1.0), 0),
          size: rand(0.18, 0.26),
          life: rand(1.1, 1.5),
          color: [0xf472b6, 0xfb7185, 0xf9a8d4][i],
          upright: true,
          sway: 0.4,
          wobble: 0.08,
        });
      }
      this.burst(this.sparkles, MOUTH, 8, { colors: [0xfde047, 0xffffff], speed: 1.2, up: 1.4, gravity: 1, size: [0.025, 0.045] });
    }
    return t > 2.6;
  }

  // ---- bath ----
  bath(t, dt, now, s) {
    const kind = SOAPS[s.data.soap] ? s.data.soap : "biasa";
    const style = SOAPS[kind];
    const pet = this.pet;
    const soap = this.prop(`soap:${kind}`, (g) => {
      const bar = lambertMesh(new THREE.CapsuleGeometry(0.075, 0.15, 4, 10), style.soap, style.emissive ? { emissive: style.emissive } : {});
      bar.rotation.z = Math.PI / 2;
      bar.scale.z = 0.6;
      g.add(bar);
    });
    const cloud = this.prop("cloud", (g) => {
      for (const [x, y, r] of [[-0.2, 0, 0.17], [0.02, 0.06, 0.22], [0.24, 0, 0.16], [0.05, -0.06, 0.16]]) {
        const puff = lambertMesh(new THREE.SphereGeometry(r, 12, 8), 0xffffff, { flatShading: false, emissive: 0x2a3340 });
        puff.position.set(x, y, 0);
        g.add(puff);
      }
      g.scale.set(1, 0.8, 0.8);
    });
    cloud.position.set(0, 3.78, 0.25);

    // soap appears and scrubs
    if (t < 1.55) {
      soap.visible = true;
      const appear = ease.outBack(phase(t, 0, 0.3));
      const a = Math.max(0, t - 0.3) * 9;
      soap.position.set(Math.sin(a) * 0.55, 1.55 + Math.cos(a * 0.5) * 0.55, 0.45);
      soap.rotation.z = Math.sin(a * 2) * 0.5;
      soap.scale.setScalar(Math.max(0.001, appear * (1 - phase(t, 1.4, 1.55)) * SOAP_SCALE));
      if (t > 0.3) {
        if (!s.flags.wash) {
          s.flags.wash = true;
          pet.setMode("wash", now + 1250);
        }
        s.foamTimer = (s.foamTimer ?? 0) - dt;
        while (s.foamTimer <= 0) {
          s.foamTimer += 0.028 / perf.particles;
          this.foam.spawn({
            pos: soap.position.clone().add(new THREE.Vector3(rand(-0.12, 0.12), rand(-0.12, 0.12), rand(-0.18, -0.1))),
            size: rand(0.045, 0.09),
            life: 4,
            grow: 0.03,
            shrink: 0.02,
            wobble: 0.12,
            color: style.foam,
          });
        }
      }
      this.lookAt(soap.position, now);
    } else {
      soap.visible = false;
    }

    // rain cloud rinses the foam away
    const cloudIn = ease.outBack(phase(t, 1.25, 1.55));
    const cloudOut = 1 - ease.out(phase(t, 2.35, 2.6));
    cloud.visible = t > 1.25 && t < 2.6;
    cloud.scale.set(cloudIn * cloudOut, 0.8 * cloudIn * cloudOut, 0.8 * cloudIn * cloudOut);
    cloud.position.x = Math.sin(t * 3) * 0.08;

    if (t > 1.5 && t < 2.35) {
      if (!s.flags.rinse) {
        s.flags.rinse = true;
        for (const p of this.foam.items) p.life = p.age + rand(0.35, 0.85);
        pet.springs.squash.kick(-1);
        this.pet.glance = { x: 0, y: -1, until: now + 800, forced: true };
      }
      s.dropTimer = (s.dropTimer ?? 0) - dt;
      while (s.dropTimer <= 0) {
        s.dropTimer += 0.016 / perf.particles;
        this.water.spawn({
          pos: new THREE.Vector3(cloud.position.x + rand(-0.32, 0.32), 3.62, rand(0.2, 0.5)),
          vel: new THREE.Vector3(0, rand(-5.5, -4.5), 0),
          size: rand(0.018, 0.026),
          stretch: 3.2,
          upright: true,
          life: rand(0.65, 0.8),
          grow: 0.05,
          shrink: 0.1,
          color: 0xbfe9ff,
        });
      }
    }

    if (t >= 2.3 && !s.flags.sparkle) {
      s.flags.sparkle = true;
      this.rimBoost = 1;
      pet.springs.jump.kick(3.5);
      pet.springs.squash.kick(2);
      for (let i = 0; i < Math.round(style.sparkles * perf.particles); i++) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(0.55, 0.95);
        this.sparkles.spawn({
          pos: new THREE.Vector3(Math.cos(a) * r, 1.5 + Math.sin(a) * r * 1.2, rand(0.2, 0.6)),
          vel: new THREE.Vector3(0, rand(0.2, 0.5), 0),
          size: rand(0.03, 0.06),
          life: rand(0.6, 1.1),
          spin: rand(4, 9),
          wobble: 0.4,
          color: style.sparkle[i % style.sparkle.length],
        });
      }
    }
    return t > 2.75;
  }

  // ---- play intro ----
  playIntro(t, dt, now, s) {
    const pet = this.pet;
    const ball = this.prop("ball", (g) => g.add(new THREE.Mesh(getShared().geo.ball, new THREE.MeshLambertMaterial({ vertexColors: true }))));
    ball.visible = true;
    if (!s.ball) s.ball = { pos: W(130, -100, 0.35), vel: new THREE.Vector3(-0.6, 0, 0) };
    const b = s.ball;
    b.vel.y -= 9 * dt;
    b.pos.addScaledVector(b.vel, dt);
    if (!s.flags.bounce && b.pos.y <= HEAD_TOP.y + 0.2) {
      s.flags.bounce = true;
      b.pos.y = HEAD_TOP.y + 0.2;
      b.vel.set(1.6, 3.4, 0.5);
      pet.springs.squash.kick(3.2);
      pet.springs.jump.kick(5);
      pet.springs.earL.kick(-8);
      pet.springs.earR.kick(8);
      pet.setMode("cheer", now + 650);
      this.burst(this.sparkles, HEAD_TOP, 8, { colors: [0xfde047, 0xffffff, 0x60a5fa], speed: 1.4, up: 1.2, gravity: 2, size: [0.025, 0.05] });
    }
    ball.position.copy(b.pos);
    ball.scale.setScalar(BALL_SCALE);
    ball.rotation.z -= dt * 9;
    ball.rotation.x += dt * 4;
    this.lookAt(b.pos, now);
    return t > 1.05;
  }

  cloud(key, color) {
    return this.prop(key, (g) => {
      for (const [x, y, r] of [[-0.2, 0, 0.17], [0.02, 0.06, 0.22], [0.24, 0, 0.16], [0.05, -0.06, 0.16]]) {
        const puff = lambertMesh(new THREE.SphereGeometry(r, 12, 8), color, { flatShading: false, emissive: 0x111827 });
        puff.position.set(x, y, 0);
        g.add(puff);
      }
      g.scale.set(1, 0.8, 0.8);
    });
  }

  rain(cloud, rate, dt, s, color = 0x93c5fd) {
    s.rainTimer = (s.rainTimer ?? 0) - dt;
    while (s.rainTimer <= 0) {
      s.rainTimer += rate / perf.particles;
      this.water.spawn({
        pos: new THREE.Vector3(cloud.position.x + rand(-0.3, 0.3), cloud.position.y - 0.12, rand(0.2, 0.45)),
        vel: new THREE.Vector3(0, rand(-4.5, -3.6), 0),
        size: rand(0.016, 0.024),
        stretch: 3,
        upright: true,
        life: rand(0.5, 0.7),
        grow: 0.05,
        shrink: 0.1,
        color,
      });
    }
  }

  confettiBurst(at, count) {
    const colors = [0xf472b6, 0xa78bfa, 0x60a5fa, 0x34d399, 0xfbbf24, 0xf87171];
    const n = Math.round(count * perf.particles);
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
      const speed = rand(2.2, 3.6);
      this.confetti.spawn({
        pos: at.clone().add(new THREE.Vector3(rand(-0.15, 0.15), 0, rand(0, 0.3))),
        vel: new THREE.Vector3(Math.cos(a) * speed * 0.8, -Math.sin(a) * speed, rand(0, 0.6)),
        size: rand(0.045, 0.07),
        life: rand(1.3, 1.9),
        gravity: 4.2,
        drag: 1.4,
        spin: rand(6, 14),
        grow: 0.04,
        shrink: 0.25,
        color: colors[i % colors.length],
      });
    }
  }

  // ---- game: correct answer ----
  victory(t, dt, now, s) {
    const pet = this.pet;
    if (!s.flags.start) {
      s.flags.start = true;
      if (s.data.cheer === false) {
        pet.setMode("sigh", now + 1600);
        pet.springs.squash.kick(-1.5);
      } else {
        pet.setMode("cheer", now + 1300);
        pet.springs.jump.kick(6);
        pet.springs.squash.kick(2.5);
        this.rimBoost = 0.8;
      }
      this.confettiBurst(HEAD_TOP.clone().add(new THREE.Vector3(0, 0.3, 0)), 40);
      this.burst(this.sparkles, HEAD, 10, { colors: [0xfde047, 0xffffff], speed: 1.8, up: 1.6, gravity: 1.5, size: [0.03, 0.06] });
    }
    const coinCount = Math.min(12, s.data.coins ?? 6);
    s.coinTimer = (s.coinTimer ?? 0) - dt;
    if (t < 0.9 && (s.spawned ?? 0) < coinCount && s.coinTimer <= 0) {
      s.coinTimer = 0.07;
      s.spawned = (s.spawned ?? 0) + 1;
      this.coins.spawn({
        pos: W(100, 150, 0.5),
        vel: new THREE.Vector3(rand(-1.3, 1.3), rand(3, 4.2), rand(0.1, 0.5)),
        size: rand(0.07, 0.09),
        life: 1.2,
        gravity: 7,
        spin: rand(8, 14),
        grow: 0.05,
        shrink: 0.2,
        color: 0xfbbf24,
      });
    }
    if (t > 0.55 && !s.flags.second) {
      s.flags.second = true;
      this.confettiBurst(HEAD_TOP.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0.4, 0)), 24);
    }
    return t > 1.9;
  }

  // ---- game: wrong answer ----
  oops(t, dt, now, s) {
    const pet = this.pet;
    const cloud = this.cloud("cloud:grey", 0x9ca3af);
    if (!s.flags.start) {
      s.flags.start = true;
      pet.play("pet-shake", 600);
      pet.springs.squash.kick(-1.2);
    }
    const inK = ease.outBack(phase(t, 0, 0.25));
    const outK = 1 - ease.out(phase(t, 1.05, 1.3));
    cloud.visible = t < 1.3;
    cloud.position.set(Math.sin(t * 4) * 0.06, 3.35, 0.3);
    cloud.scale.set(0.75 * inK * outK, 0.6 * inK * outK, 0.6 * inK * outK);
    if (t > 0.2 && t < 1.05) this.rain(cloud, 0.05, dt, s);
    if (t > 0.15 && !s.flags.sweat) {
      s.flags.sweat = true;
      this.sweatDrop(1);
    }
    return t > 1.35;
  }

  // ---- game: time up / out of attempts ----
  fail(t, dt, now, s) {
    const pet = this.pet;
    const cloud = this.cloud("cloud:storm", 0x6b7280);
    if (!s.flags.start) {
      s.flags.start = true;
      pet.setMode("sigh", now + 1800);
    }
    const inK = ease.outBack(phase(t, 0, 0.3));
    const outK = 1 - ease.out(phase(t, 1.7, 2));
    cloud.visible = t < 2;
    cloud.position.set(Math.sin(t * 3) * 0.08, 3.45, 0.3);
    cloud.scale.set(inK * outK, 0.8 * inK * outK, 0.8 * inK * outK);
    const flash = t > 0.45 && t < 0.55 ? 1 : t > 0.65 && t < 0.7 ? 0.7 : 0;
    for (const puff of cloud.children) puff.material.emissive.setHex(flash ? 0xfef08a : 0x111827);
    if (flash && !s.flags.zap) {
      s.flags.zap = true;
      pet.springs.jump.kick(3);
      pet.springs.earL.kick(-9);
      pet.springs.earR.kick(9);
    }
    if (t > 0.3 && t < 1.7) this.rain(cloud, 0.03, dt, s, 0x60a5fa);
    return t > 2.05;
  }

  // ---- game: hint ----
  hint(t, dt, now, s) {
    const pet = this.pet;
    const bulb = this.prop("bulb", (g) => {
      const glass = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 16, 12),
        new THREE.MeshLambertMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 0.9 })
      );
      const base = lambertMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.09, 10), 0x9ca3af);
      base.position.y = -0.14;
      g.add(glass, base);
    });
    if (!s.flags.start) {
      s.flags.start = true;
      pet.springs.jump.kick(3);
      pet.springs.earL.kick(-6);
      pet.springs.earR.kick(6);
      this.pet.glance = { x: 0, y: -1, until: now + 900, forced: true };
    }
    const inK = ease.outBack(phase(t, 0, 0.3));
    const outK = 1 - ease.out(phase(t, 0.95, 1.2));
    bulb.visible = t < 1.2;
    bulb.position.set(0, 3.2 + Math.sin(t * 6) * 0.04, 0.35);
    bulb.scale.setScalar(Math.max(0.001, inK * outK * (1 + Math.sin(t * 18) * 0.06)));
    if (t > 0.3 && !s.flags.spark) {
      s.flags.spark = true;
      this.burst(this.sparkles, bulb.position, 10, { colors: [0xfde047, 0xffffff], speed: 1.4, up: 0.6, gravity: 0.5, size: [0.025, 0.045] });
    }
    return t > 1.25;
  }

  // ---- game: round start ----
  ready(t, dt, now, s) {
    if (!s.flags.start) {
      s.flags.start = true;
      this.pet.springs.squash.kick(2.4);
      this.pet.springs.jump.kick(4.5);
      this.pet.setMode("cheer", now + 500);
      for (let i = 0; i < Math.round(12 * perf.particles); i++) {
        const a = (i / 12) * Math.PI * 2;
        this.sparkles.spawn({
          pos: new THREE.Vector3(Math.cos(a) * 0.9, 0.2, Math.sin(a) * 0.4 + 0.2),
          vel: new THREE.Vector3(0, rand(1.2, 1.8), 0),
          size: rand(0.03, 0.05),
          life: rand(0.7, 1),
          spin: 8,
          color: i % 2 ? 0xa78bfa : 0xfde047,
        });
      }
    }
    return t > 0.9;
  }

  sweatDrop(side = 1) {
    this.water.spawn({
      pos: W(100 + side * 52, 105, 0.42),
      vel: new THREE.Vector3(side * 0.15, -0.35, 0),
      size: 0.035,
      stretch: 1.5,
      upright: true,
      life: 0.9,
      gravity: 1.2,
      grow: 0.2,
      shrink: 0.3,
      color: 0x93c5fd,
    });
  }

  // ---- ambient (dirty / hungry) ----
  updateAmbient(now, dt, t, stats) {
    if (this.nervous && now > this.nextSweat) {
      this.nextSweat = now + 450;
      this.sweatDrop(Math.random() < 0.5 ? -1 : 1);
    }
    if (!this.ambientEnabled) return;
    const a = this.ambient;
    a.dirty = !!stats && stats.hygiene <= 30;
    a.hungry = !!stats && stats.hunger >= 70;
    this.pet.ambientPose = { hungry: a.hungry };

    const flies = this.prop("flies", (g) => {
      for (let i = 0; i < 2; i++) {
        const fly = new THREE.Group();
        fly.add(lambertMesh(new THREE.SphereGeometry(0.028, 8, 6), 0x1f2937));
        for (const side of [-1, 1]) {
          const wing = new THREE.Mesh(
            new THREE.PlaneGeometry(0.05, 0.032),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
          );
          wing.position.set(side * 0.03, 0.02, 0);
          wing.rotation.z = side * 0.4;
          wing.name = "wing";
          fly.add(wing);
        }
        g.add(fly);
      }
    });
    flies.visible = a.dirty && !this.active;
    if (flies.visible) {
      flies.children.forEach((fly, i) => {
        const w = 2.4 + i * 0.7;
        const ph = i * Math.PI;
        fly.position.set(Math.cos(t * w + ph) * 0.62, HEAD.y + 0.35 + Math.sin(t * w * 1.7 + ph) * 0.28, 0.25 + Math.sin(t * w + ph) * 0.35);
        const flap = 0.3 + Math.abs(Math.sin(t * 70 + i));
        for (const wing of fly.children) if (wing.name === "wing") wing.scale.y = flap;
      });
      if (now > a.nextStink) {
        a.nextStink = now + rand(450, 800) / perf.particles;
        this.stink.spawn({
          pos: new THREE.Vector3(rand(-0.7, 0.7), rand(0.4, 1.2), rand(0.1, 0.4)),
          vel: new THREE.Vector3(0, rand(0.25, 0.45), 0),
          size: rand(0.05, 0.08),
          life: rand(1.4, 2),
          sway: 0.5,
          wobble: 0.15,
          color: 0xa3e635,
        });
      }
    }

    if (a.hungry && !this.active && now > a.nextRumble) {
      a.nextRumble = now + rand(3500, 6000);
      this.pet.play("pet-shake", 450);
      this.pet.springs.squash.kick(1.2);
    }
  }

  update(now, dt, stats) {
    const t = now / 1000;
    const s = this.active;
    if (s) {
      const local = (now - s.start) / 1000;
      const done = this[s.name]?.(local, dt, now, s) ?? true;
      if (done) this.finish(true);
    }
    this.updateAmbient(now, dt, t, stats);

    this.crumbs.update(dt, t);
    this.foam.update(dt, t);
    this.water.update(dt, t);
    this.sparkles.update(dt, t);
    this.hearts.update(dt, t);
    this.stink.update(dt, t);
    this.coins.update(dt, t);
    this.confetti.update(dt, t);

    if (this.rimBoost > 0) this.rimBoost = Math.max(0, this.rimBoost - dt * 1.1);
    this.pet.uniforms.uRim.value = 0.32 + this.rimBoost * 0.9;
    this.pet.uniforms.uShade.value = 0.22 - this.rimBoost * 0.1;
  }
}
