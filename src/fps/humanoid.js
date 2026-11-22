import * as THREE from "/asset/vendor/three/three.module.min.js";
import { makeWeapon } from "./models.js";
import { WEAPON_IDS } from "./shared/weapons.js";
import { heroById } from "./shared/heroes.js";

// Tactical soldier built from capsules and boxes with a joint hierarchy: hips -> spine -> chest ->
// neck/head and shoulders, hips -> thighs -> shins -> feet. Legs run a walk cycle driven by distance
// moved, the upper body leans with the aim pitch, arms reach for the held weapon (two-bone IK),
// and a death plays as a fall instead of vanishing.
const TEAM = { red: 0x8c2f28, blue: 0x2a4f8c };
const UP = new THREE.Vector3(0, 1, 0);
const STRIDE = 1.5;
const WEAPON_INDEX = WEAPON_IDS;

export function createHumanKit(weaponMats) {
  const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
  const mat = (color, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    weaponMats,
    geo: {
      pelvis: capsule(0.13, 0.06),
      abdomen: capsule(0.13, 0.08),
      chest: capsule(0.15, 0.14),
      plate: new THREE.BoxGeometry(0.3, 0.26, 0.05),
      backPlate: new THREE.BoxGeometry(0.3, 0.3, 0.05),
      shoulderPad: new THREE.SphereGeometry(0.075, 10, 8),
      belt: new THREE.TorusGeometry(0.14, 0.02, 6, 16),
      pouch: new THREE.BoxGeometry(0.07, 0.08, 0.05),
      neck: capsule(0.05, 0.06),
      head: new THREE.SphereGeometry(0.105, 16, 12),
      helmet: new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      goggles: new THREE.BoxGeometry(0.16, 0.045, 0.06),
      cap: new THREE.SphereGeometry(0.113, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      brim: new THREE.BoxGeometry(0.15, 0.012, 0.09),
      beanie: new THREE.SphereGeometry(0.116, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
      fold: new THREE.TorusGeometry(0.108, 0.016, 6, 18),
      hood: new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.66),
      mask: new THREE.BoxGeometry(0.15, 0.07, 0.07),
      earCup: new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12),
      band: new THREE.TorusGeometry(0.12, 0.008, 6, 18, Math.PI),
      upperArm: capsule(0.05, 0.16),
      forearm: capsule(0.044, 0.16),
      hand: new THREE.BoxGeometry(0.07, 0.09, 0.05),
      thigh: capsule(0.075, 0.26),
      shin: capsule(0.06, 0.28),
      knee: new THREE.SphereGeometry(0.07, 10, 8),
      foot: new THREE.BoxGeometry(0.11, 0.08, 0.26),
    },
    mats: {
      red: mat(TEAM.red, 0.7),
      blue: mat(TEAM.blue, 0.7),
      cloth: mat(0x4a4d42, 0.95),
      shirt: mat(0x5b5e52, 0.95),
      dark: mat(0x1f2124, 0.8),
      skin: mat(0xc9906b, 0.6),
      boots: mat(0x24201c, 0.75),
      lens: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.8 }),
    },
  };
}

const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};
const pivot = (parent, x, y, z) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};

export class Humanoid {
  // Hero accent material, shared by every soldier wearing that hero.
  static accent(kit, hero) {
    const key = `hero_${hero?.id ?? "none"}`;
    kit.mats[key] ??= new THREE.MeshStandardMaterial({ color: hero?.color ?? 0x3f3f46, roughness: 0.75 });
    return kit.mats[key];
  }

  constructor(kit, team, heroId = null) {
    this.hero = heroById(heroId);
    const { geo, mats } = kit;
    this.kit = kit;
    this.root = new THREE.Group();
    const teamMat = mats[team] ?? mats.red;

    this.hips = pivot(this.root, 0, 0.93, 0);
    const pelvis = mesh(geo.pelvis, mats.cloth);
    pelvis.scale.set(1.2, 0.75, 0.85);
    const belt = mesh(geo.belt, mats.dark, 0, 0.05, 0);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.2, 0.85, 1);
    this.hips.add(pelvis, belt);
    this.spine = pivot(this.hips, 0, 0.08, 0);
    const abdomen = mesh(geo.abdomen, mats.shirt, 0, 0.1, 0);
    abdomen.scale.set(1.1, 1, 0.78);
    this.spine.add(abdomen);
    this.chest = pivot(this.spine, 0, 0.2, 0);
    const torso = mesh(geo.chest, mats.shirt, 0, 0.13, 0);
    torso.scale.set(1.3, 1, 0.82);
    // Plate carrier in team colors, pads on the shoulders.
    this.chest.add(torso, mesh(geo.plate, teamMat, 0, 0.12, -0.12), mesh(geo.backPlate, teamMat, 0, 0.14, 0.12));
    const accent = Humanoid.accent(kit, this.hero);
    for (const x of [-0.21, 0.21]) this.chest.add(mesh(geo.shoulderPad, this.hero ? accent : teamMat, x, 0.25, 0));
    for (const x of [-0.1, 0, 0.1]) this.chest.add(mesh(geo.pouch, mats.cloth, x, 0.04, -0.155));
    this.neck = pivot(this.chest, 0, 0.29, 0);
    this.neck.add(mesh(geo.neck, mats.skin, 0, 0.04, 0));
    this.head = pivot(this.neck, 0, 0.08, 0);
    this.head.add(mesh(geo.head, mats.skin, 0, 0.09, 0));
    this.dressHead(geo, mats, teamMat, accent);
    // Heavier heroes are a little broader.
    const build = this.hero?.build ?? 1;
    this.root.scale.set(build, 1, build);

    // Arms are placed between points every pose (shoulder -> elbow -> hand).
    this.arms = ["right", "left"].map((side) => ({
      side,
      shoulder: new THREE.Vector3(side === "right" ? 0.24 : -0.24, 0.25, 0),
      upper: mesh(geo.upperArm, mats.cloth),
      fore: mesh(geo.forearm, mats.cloth),
      hand: mesh(geo.hand, mats.dark),
    }));
    for (const a of this.arms) this.chest.add(a.upper, a.fore, a.hand);

    this.legs = [-1, 1].map((s) => {
      const hip = pivot(this.hips, s * 0.1, -0.04, 0);
      hip.add(mesh(geo.thigh, mats.cloth, 0, -0.2, 0));
      const knee = pivot(hip, 0, -0.42, 0);
      knee.add(mesh(geo.knee, mats.dark, 0, 0, -0.03), mesh(geo.shin, mats.cloth, 0, -0.21, 0));
      const ankle = pivot(knee, 0, -0.44, 0);
      ankle.add(mesh(geo.foot, mats.boots, 0, -0.01, -0.05));
      return { hip, knee, ankle, side: s };
    });

    // Weapon held in front of the chest; it pitches with the aim.
    this.weaponMount = pivot(this.chest, 0.1, 0.12, -0.3);
    this.mountRest = this.weaponMount.position.clone();
    this.weapons = {};
    this.weapon = null;
    this.phase = 0;
    this.last = null;
    this.deadAt = 0;
    this.crouch = 0;
  }

  // Headgear tells heroes apart at a glance.
  dressHead(geo, mats, teamMat, accent) {
    const head = this.head;
    const gear = this.hero?.gear ?? "helmet";
    const add = (m) => head.add(m);
    if (gear === "cap") {
      add(mesh(geo.cap, accent, 0, 0.12, 0));
      add(mesh(geo.brim, accent, 0, 0.13, -0.1));
    } else if (gear === "beanie") {
      add(mesh(geo.beanie, accent, 0, 0.11, 0));
      const fold = mesh(geo.fold, mats.dark, 0, 0.12, 0);
      fold.rotation.x = Math.PI / 2;
      add(fold);
    } else if (gear === "hood") {
      const hood = mesh(geo.hood, accent, 0, 0.09, 0.02);
      hood.rotation.x = -0.25;
      add(hood);
      add(mesh(geo.mask, mats.dark, 0, 0.05, -0.07));
    } else if (gear === "mask") {
      add(mesh(geo.mask, mats.dark, 0, 0.06, -0.07));
      const band = mesh(geo.band, accent, 0, 0.13, 0);
      band.rotation.x = Math.PI / 2;
      add(band);
    } else {
      add(mesh(geo.helmet, teamMat, 0, 0.11, 0.005));
      if (gear === "headset") {
        for (const x of [-0.12, 0.12]) {
          const cup = mesh(geo.earCup, accent, x, 0.09, 0);
          cup.rotation.z = Math.PI / 2;
          add(cup);
        }
      } else {
        const stripe = mesh(geo.band, accent, 0, 0.11, 0.005);
        stripe.rotation.y = Math.PI / 2;
        add(stripe);
      }
    }
    if (gear !== "cap" && gear !== "beanie") add(mesh(geo.goggles, mats.lens, 0, 0.12, -0.085));
  }

  setWeapon(index) {
    const id = WEAPON_INDEX[index] ?? "rifle";
    if (this.weapon === id) return;
    this.weapon = id;
    for (const w of Object.values(this.weapons)) w.group.visible = false;
    if (!this.weapons[id]) {
      const w = makeWeapon(id, this.kit.weaponMats);
      w.group.traverse((o) => (o.castShadow = true));
      this.weapons[id] = w;
      this.weaponMount.add(w.group);
    }
    const w = this.weapons[id];
    w.group.visible = true;
    // Hand targets in chest space.
    const rest = new THREE.Matrix4().makeTranslation(this.mountRest);
    this.targets = {};
    for (const side of ["right", "left"]) {
      const local = w.hands[side] ?? (side === "left" ? new THREE.Vector3(-0.15, -0.25, 0.1).sub(this.mountRest) : null);
      this.targets[side] = local.clone().applyMatrix4(rest);
    }
    this.placeArms();
  }

  placeLimb(part, from, to) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    part.position.copy(from).addScaledVector(dir, 0.5);
    part.quaternion.setFromUnitVectors(UP, dir.normalize());
    part.scale.set(1, Math.max(0.5, len / 0.26), 1);
  }

  // Two-bone arm: elbow bends down and outward from the line shoulder -> hand.
  placeArms() {
    for (const arm of this.arms) {
      const hand = this.targets[arm.side];
      const shoulder = arm.shoulder;
      const mid = shoulder.clone().lerp(hand, 0.5);
      const reach = shoulder.distanceTo(hand);
      const bend = Math.sqrt(Math.max(0, 0.28 * 0.28 - (reach / 2) ** 2));
      const elbow = mid.add(new THREE.Vector3(arm.side === "right" ? 0.08 : -0.08, -1, 0.15).normalize().multiplyScalar(bend));
      this.placeLimb(arm.upper, shoulder, elbow);
      this.placeLimb(arm.fore, elbow, hand);
      arm.hand.visible = arm.upper.visible = arm.fore.visible = true;
      arm.hand.position.copy(hand);
      arm.hand.quaternion.copy(arm.fore.quaternion);
    }
  }

  // state: {x, y, z, yaw, pitch, crouch, alive, weapon}
  update(state, now, dt) {
    const root = this.root;
    if (!state.alive) {
      if (!this.deadAt) this.deadAt = now;
      // Collapse backward and sink, then disappear.
      const k = Math.min(1, (now - this.deadAt) / 450);
      const e = 1 - (1 - k) * (1 - k);
      root.rotation.x = e * 1.45;
      root.position.y = (this.last?.y ?? 0) + e * 0.1;
      this.hips.position.y = 0.93 - e * 0.25;
      for (const leg of this.legs) leg.knee.rotation.x = -e * 0.9;
      root.visible = now - this.deadAt < 3500;
      return;
    }
    if (this.deadAt) {
      this.deadAt = 0;
      root.rotation.x = 0;
      this.last = null;
    }
    root.visible = true;
    const act = state.act ?? 0;
    const planting = !!(act & 2);
    const defusing = !!(act & 4);
    // Planting shows the bomb in hand; defusing puts the gun away.
    this.setWeapon(planting ? 3 : state.weapon);
    this.weaponMount.visible = !defusing;

    const moved = this.last ? Math.hypot(state.x - this.last.x, state.z - this.last.z) : 0;
    const speed = dt > 0 ? Math.min(8, moved / dt) : 0;
    this.last = { x: state.x, y: state.y, z: state.z };
    root.position.set(state.x, state.y, state.z);
    root.rotation.set(0, state.yaw, 0);

    this.crouch += ((state.crouch || planting || defusing ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    const c = this.crouch;
    const air = state.y > 0.05;
    this.phase += (moved / STRIDE) * Math.PI * 2;
    const swing = Math.min(1, speed / 4.5) * (air ? 0 : 1);
    const s = Math.sin(this.phase);

    this.hips.position.y = 0.93 - c * 0.4 - Math.abs(Math.cos(this.phase)) * 0.03 * swing;
    for (const leg of this.legs) {
      const p = Math.sin(this.phase + (leg.side > 0 ? Math.PI : 0));
      // Positive x swings a leg forward; knees bend the other way.
      leg.hip.rotation.x = p * 0.55 * swing + c * 1.15 + (air ? 0.6 : 0);
      leg.knee.rotation.x = -Math.max(0, -p) * 0.9 * swing - c * 2.0 - (air ? 1.1 : 0);
      leg.ankle.rotation.x = c * 0.85;
    }
    // Upper body: lean into the aim, a little forward when crouched, a breathing bob when idle.
    const pitch = state.pitch ?? 0;
    this.spine.rotation.x = -c * 0.25 + pitch * 0.35;
    this.chest.rotation.x = pitch * 0.45;
    this.chest.rotation.y = s * 0.05 * swing;
    this.head.rotation.x = pitch * 0.2 + c * 0.15;
    this.spine.position.y = 0.08 + Math.sin(now / 600) * 0.004;
    this.pose(act, now);
  }

  // Busy poses: hunched over the bomb tapping keys or cutting wires, or swapping a magazine.
  pose(act, now) {
    const busy = act & 6;
    if (busy) {
      this.spine.rotation.x = -0.45;
      this.chest.rotation.x = -0.5;
      this.head.rotation.x = -0.35;
      const tap = Math.abs(Math.sin(now / (act & 2 ? 90 : 160))) * 0.05;
      this.weaponMount.position.set(0, -0.2, -0.38);
      this.weaponMount.rotation.set(0, 0, 0);
      this.placeArmsAt({ right: new THREE.Vector3(0.08, -0.22 + tap, -0.36), left: new THREE.Vector3(-0.1, -0.22 + (act & 4 ? Math.sin(now / 130) * 0.04 : 0), -0.34) });
      this.posed = true;
      return;
    }
    if (this.posed) {
      this.posed = false;
      this.weaponMount.position.copy(this.mountRest);
    }
    if (act & 1) {
      // Reload: tip the gun and bring the left hand to the magazine and back.
      const k = Math.sin(now / 260);
      this.weaponMount.rotation.set(0.15, 0, 0.45);
      const left = this.targets.left.clone().lerp(new THREE.Vector3(0.02, -0.02, -0.2), 0.6 + k * 0.4);
      this.placeArmsAt({ right: this.targets.right, left });
      this.reloading = true;
    } else if (this.reloading) {
      this.reloading = false;
      this.weaponMount.rotation.set(0, 0, 0);
      this.placeArms();
    }
  }

  placeArmsAt(targets) {
    const saved = this.targets;
    this.targets = targets;
    this.placeArms();
    this.targets = saved;
  }

  dispose() {
    this.root.removeFromParent();
    for (const w of Object.values(this.weapons)) w.group.traverse((o) => o.geometry?.dispose());
  }
}
