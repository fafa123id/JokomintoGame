import * as THREE from "/asset/vendor/three/three.module.min.js";
import { clone as cloneSkinned } from "/asset/vendor/three/addons/utils/SkeletonUtils.js";
import { findNode, measure } from "./assets.js";
import { makeWeapon } from "./models.js";
import { WEAPON_IDS } from "./shared/weapons.js";

// A rigged character loaded from soldier.glb (Mixamo-style rigs work out of the box). Same interface
// as the procedural Humanoid: update(state, now, dt) drives animations from movement, the spine
// follows the aim pitch, and the held weapon sits at the right hand pointing where the player aims.
const WEAPON_INDEX = WEAPON_IDS;
const TEAM = { red: 0xb3342b, blue: 0x2f5fb3 };
// Clip names are matched by these words when models.json doesn't name them.
const CLIP_WORDS = {
  idle: ["idle", "stand"],
  walk: ["walk"],
  run: ["run", "sprint", "jog"],
  crouch: ["crouchidle", "crouch"],
  crouchWalk: ["crouchwalk", "crouchedwalk", "sneak"],
  death: ["death", "die", "dying"],
  jump: ["jump", "fall"],
};

function pickClip(clips, wanted, words) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (wanted) return clips.find((c) => c.name === wanted) ?? null;
  for (const w of words) {
    const hit = clips.find((c) => norm(c.name).endsWith(w)) ?? clips.find((c) => norm(c.name).includes(w));
    if (hit) return hit;
  }
  return null;
}

export class GltfSoldier {
  constructor(gltf, spec, team, weaponMats) {
    this.spec = spec;
    this.weaponMats = weaponMats;
    this.root = new THREE.Group();
    const model = cloneSkinned(gltf.scene);
    this.model = model;
    model.rotation.y = spec.yaw ?? Math.PI;
    let box = measure(model);
    model.scale.multiplyScalar((spec.height ?? 1.75) / box.getSize(new THREE.Vector3()).y);
    box = measure(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    this.root.add(model);

    const tint = new Set(spec.teamMaterials ?? []);
    const teamColor = new THREE.Color(spec.teamColors?.[team] ?? TEAM[team] ?? TEAM.red);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      if (tint.size && o.material && tint.has(o.material.name)) {
        o.material = o.material.clone();
        o.material.color = teamColor.clone();
      }
    });

    this.bones = {
      spine: findNode(model, spec.bones?.spine, ["spine1", "spine2", "spine"]),
      hand: findNode(model, spec.bones?.rightHand, ["righthand", "handr", "hand_r"]),
      leftArm: findNode(model, spec.bones?.leftArm, ["leftarm", "upperarml", "upperarm_l"]),
    };
    // Without team materials, an armband in team color tells the sides apart.
    if (!tint.size && this.bones.leftArm) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.022, 8, 16), new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6 }));
      band.rotation.x = Math.PI / 2;
      band.scale.setScalar(1 / this.bones.leftArm.getWorldScale(new THREE.Vector3()).x);
      band.position.y = 0.12 / this.bones.leftArm.getWorldScale(new THREE.Vector3()).y;
      this.bones.leftArm.add(band);
    }

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [key, words] of Object.entries(CLIP_WORDS)) {
      const clip = pickClip(gltf.animations, spec.animations?.[key], words);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (key === "death") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[key] = action;
    }
    this.current = null;
    this.play("idle");

    this.weaponMount = new THREE.Group();
    this.root.add(this.weaponMount);
    this.weapons = {};
    this.weapon = null;
    this.last = null;
    this.deadAt = 0;
  }

  play(key, timeScale = 1) {
    const action = this.actions[key] ?? this.actions.idle;
    if (!action) return;
    action.timeScale = timeScale;
    if (this.current === action) return;
    action.reset().setEffectiveWeight(1).fadeIn(0.2).play();
    this.current?.fadeOut(0.2);
    this.current = action;
  }

  setWeapon(index) {
    const id = WEAPON_INDEX[index] ?? "rifle";
    if (this.weapon === id) return;
    this.weapon = id;
    for (const w of Object.values(this.weapons)) w.group.visible = false;
    this.weapons[id] ??= makeWeapon(id, this.weaponMats);
    const w = this.weapons[id];
    if (!w.group.parent) {
      w.group.traverse((o) => (o.castShadow = true));
      this.weaponMount.add(w.group);
    }
    w.group.visible = true;
  }

  update(state, now, dt) {
    const root = this.root;
    if (!state.alive) {
      if (!this.deadAt) {
        this.deadAt = now;
        this.weaponMount.visible = false;
        if (this.actions.death) this.play("death");
      }
      if (!this.actions.death) {
        const k = Math.min(1, (now - this.deadAt) / 450);
        root.rotation.x = (1 - (1 - k) * (1 - k)) * 1.45;
      }
      this.mixer.update(dt);
      root.visible = now - this.deadAt < 3500;
      return;
    }
    if (this.deadAt) {
      this.deadAt = 0;
      root.rotation.x = 0;
      this.weaponMount.visible = true;
      this.actions.death?.stop();
      this.current = null;
      this.last = null;
    }
    root.visible = true;
    const act = state.act ?? 0;
    const busy = act & 6;
    // Planting shows the bomb in hand; defusing puts the gun away.
    this.setWeapon(act & 2 ? 3 : state.weapon);
    this.weaponMount.visible = !(act & 4);

    const moved = this.last ? Math.hypot(state.x - this.last.x, state.z - this.last.z) : 0;
    const speed = dt > 0 ? Math.min(8, moved / dt) : 0;
    this.last = { x: state.x, z: state.z };
    root.position.set(state.x, state.y, state.z);
    root.rotation.set(0, state.yaw, 0);

    const run = this.spec.runSpeed ?? 5.4;
    const walk = this.spec.walkSpeed ?? 2.4;
    if (state.y > 0.25 && this.actions.jump) this.play("jump");
    else if (state.crouch || busy) this.play(busy ? (this.actions.crouch ? "crouch" : "idle") : speed > 0.5 && this.actions.crouchWalk ? "crouchWalk" : this.actions.crouch ? "crouch" : "idle");
    else if (speed > 3.2) this.play(this.actions.run ? "run" : "walk", Math.min(1.4, Math.max(0.7, speed / (this.actions.run ? run : walk))));
    else if (speed > 0.4) this.play(this.actions.walk ? "walk" : "run", Math.min(1.4, Math.max(0.6, speed / (this.actions.walk ? walk : run))));
    else this.play("idle");
    this.mixer.update(dt);

    // Lean the spine with the aim (on top of the animation), then put the weapon in the hand.
    // Busy with the bomb: bend down over it.
    const pitch = busy ? -1.1 : state.pitch ?? 0;
    if (this.bones.spine) this.bones.spine.rotation.x += pitch * 0.6 * (this.spec.aimSign ?? -1);
    root.updateMatrixWorld(true);
    const off = this.spec.weaponOffset ?? [0.02, 0, -0.08];
    if (this.bones.hand) {
      const hand = this.bones.hand.getWorldPosition(new THREE.Vector3());
      root.worldToLocal(hand);
      this.weaponMount.position.set(hand.x + off[0], hand.y + off[1], hand.z + off[2]);
    } else {
      this.weaponMount.position.set(0.15, 1.35, -0.3);
    }
    if (busy) {
      const tap = Math.abs(Math.sin(now / 90)) * 0.04;
      this.weaponMount.position.set(0, (state.crouch || busy ? 0.35 : 0.6) + tap, -0.45);
      this.weaponMount.rotation.set(0, 0, 0);
    } else this.weaponMount.rotation.set(pitch, 0, act & 1 ? 0.45 + Math.sin(now / 260) * 0.1 : 0);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
  }
}
