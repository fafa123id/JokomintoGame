import * as THREE from "/asset/vendor/three/three.module.min.js";
import { CELL, WALL_HEIGHT, COVER_HEIGHT, PLAYER } from "./shared/physics.js";
import { perf } from "../three/perf.js";

// Low-cost scene: instanced walls/covers, flat-shaded Jokoman figures with Joko's face on a billboard,
// a first-person gun, short-lived tracers. No shadows, capped pixel ratio, fog to keep draw distance short.
const TEAM_COLORS = { red: 0xef4444, blue: 0x3b82f6 };
const SITE_COLORS = { A: 0xf59e0b, B: 0x8b5cf6 };
const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
// 0 -> 1 between a and b.
const phase = (p, a, b) => clamp01((p - a) / (b - a));

function labelTexture(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.font = "bold 200px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 140);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class FpsRenderer {
  constructor(container, map) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ antialias: perf.tier === "high", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perf.tier === "high" ? 1.5 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.prepend(this.renderer.domElement);
    // If the GPU drops the context, stop drawing instead of throwing every frame.
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.renderer.domElement.addEventListener("webglcontextrestored", () => (this.lost = false));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(map.theme.sky);
    this.scene.fog = new THREE.Fog(map.theme.fog, 25, 85);
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 140);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);

    this.faceTexture = new THREE.TextureLoader().load("/asset/char/idle.png");
    this.faceTexture.colorSpace = THREE.SRGBColorSpace;
    this.avatars = new Map();
    this.tracers = [];
    this.buildMap();
    this.buildGun();
    this.bombMesh = this.makeBomb();
    this.scene.add(this.bombMesh);
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener("resize", this.onResize);
  }

  buildMap() {
    const { map } = this;
    const w = map.width * CELL;
    const h = map.height * CELL;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ color: map.theme.floor }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w / 2, 0, h / 2);
    this.scene.add(floor);

    const walls = [];
    const covers = [];
    const tiles = { A: [], B: [], T: [], D: [] };
    const open = (x, z) => map.grid[z]?.[x] && map.grid[z][x] !== "#";
    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        const c = map.grid[z][x];
        if (c === "#" && (open(x + 1, z) || open(x - 1, z) || open(x, z + 1) || open(x, z - 1))) walls.push([x, z]);
        else if (c === "=") covers.push([x, z]);
        else if (tiles[c]) tiles[c].push([x, z]);
      }
    }
    const place = (cells, height, color) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, height, CELL), new THREE.MeshLambertMaterial({ color }), cells.length);
      const m = new THREE.Matrix4();
      cells.forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation((x + 0.5) * CELL, height / 2, (z + 0.5) * CELL)));
      this.scene.add(mesh);
    };
    place(walls, WALL_HEIGHT, map.theme.wall);
    place(covers, COVER_HEIGHT, map.theme.cover);

    const tint = (cells, color, opacity) => {
      if (!cells.length) return;
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(CELL, CELL),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
        cells.length
      );
      const m = new THREE.Matrix4();
      const r = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
      cells.forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation((x + 0.5) * CELL, 0.02, (z + 0.5) * CELL).multiply(r)));
      this.scene.add(mesh);
    };
    tint(tiles.A, SITE_COLORS.A, 0.25);
    tint(tiles.B, SITE_COLORS.B, 0.25);
    tint(tiles.T, 0xef4444, 0.12);
    tint(tiles.D, 0x3b82f6, 0.12);
    for (const site of ["A", "B"]) {
      const cells = map.sites[site];
      const cx = cells.reduce((s, c) => s + c.x + 0.5, 0) / cells.length;
      const cz = cells.reduce((s, c) => s + c.z + 0.5, 0) / cells.length;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: labelTexture(site, "#ffffff"), transparent: true, depthWrite: false }));
      label.rotation.x = -Math.PI / 2;
      label.position.set(cx * CELL, 0.03, cz * CELL);
      this.scene.add(label);
    }
  }

  // First-person models, one per slot. Guns keep a reference to their magazine for the reload animation.
  buildGun() {
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b2d42 });
    const accent = new THREE.MeshLambertMaterial({ color: 0xf59e0b });
    const steel = new THREE.MeshLambertMaterial({ color: 0xd4d4d8 });
    const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      return m;
    };
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
    this.flash.visible = false;

    const rifle = new THREE.Group();
    const rifleMag = box(0.05, 0.12, 0.08, accent, 0, -0.1, -0.08);
    rifle.add(box(0.08, 0.1, 0.5, dark), box(0.04, 0.04, 0.3, dark, 0, 0.02, -0.38), box(0.06, 0.14, 0.07, accent, 0, -0.1, 0.1), rifleMag);

    const pistol = new THREE.Group();
    const pistolMag = box(0.045, 0.1, 0.05, accent, 0, -0.1, 0.04);
    pistol.add(box(0.06, 0.08, 0.26, dark, 0, 0, -0.06), box(0.05, 0.13, 0.06, accent, 0, -0.08, 0.04), pistolMag);

    const knife = new THREE.Group();
    knife.add(box(0.04, 0.05, 0.12, accent), box(0.02, 0.05, 0.28, steel, 0, 0, -0.2));

    const bomb = new THREE.Group();
    this.handLight = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    this.handLight.position.set(0.04, 0.06, 0.02);
    bomb.add(box(0.16, 0.09, 0.12, new THREE.MeshLambertMaterial({ color: 0x3f3f46 })), box(0.11, 0.015, 0.08, accent, 0, 0.05, 0), this.handLight);

    this.viewmodels = {
      rifle: { group: rifle, mag: rifleMag, magRest: rifleMag.position.clone(), muzzle: -0.56, rest: new THREE.Vector3(0.22, -0.22, -0.45) },
      pistol: { group: pistol, mag: pistolMag, magRest: pistolMag.position.clone(), muzzle: -0.22, rest: new THREE.Vector3(0.2, -0.2, -0.38) },
      knife: { group: knife, rest: new THREE.Vector3(0.24, -0.22, -0.36) },
      bomb: { group: bomb, rest: new THREE.Vector3(0.2, -0.24, -0.5) },
    };
    for (const vm of Object.values(this.viewmodels)) {
      vm.group.position.copy(vm.rest);
      vm.group.visible = false;
      this.camera.add(vm.group);
    }
    this.weapon = null;
    this.recoil = 0;
  }

  setViewmodel(weapon) {
    if (this.weapon === weapon) return;
    this.weapon = weapon;
    for (const [id, vm] of Object.entries(this.viewmodels)) vm.group.visible = id === weapon;
    const vm = this.viewmodels[weapon];
    if (vm?.muzzle !== undefined) {
      vm.group.add(this.flash);
      this.flash.position.set(0, 0.02, vm.muzzle);
    }
  }

  // anim: { reload: 0..1 | null, swing: 0..1 | null, draw: 0..1 | null }
  animateViewmodel(weapon, anim, t) {
    const vm = this.viewmodels[weapon];
    if (!vm) return;
    const g = vm.group;
    this.recoil *= 0.82;
    const bob = Math.sin(t / 160) * 0.004;
    g.position.set(vm.rest.x, vm.rest.y + this.recoil * 0.02 + bob, vm.rest.z + this.recoil * 0.06);
    g.rotation.set(this.recoil * 0.05, 0, 0);
    if (anim.draw !== null) {
      const k = 1 - ease(anim.draw);
      g.position.y -= k * 0.25;
      g.rotation.x -= k * 0.6;
    }
    if (vm.mag) {
      vm.mag.position.copy(vm.magRest);
      vm.mag.visible = true;
    }
    if (anim.reload !== null && vm.mag) {
      const p = anim.reload;
      // Tilt the gun, drop the old magazine, push in a new one, then rack it.
      const tilt = ease(phase(p, 0, 0.15)) * (1 - ease(phase(p, 0.82, 1)));
      g.rotation.z = tilt * 0.55;
      g.rotation.x += tilt * 0.18;
      g.position.y -= tilt * 0.05;
      const out = ease(phase(p, 0.18, 0.36));
      const back = ease(phase(p, 0.45, 0.62));
      vm.mag.position.y = vm.magRest.y - out * 0.3 + back * 0.3;
      vm.mag.visible = !(p > 0.36 && p < 0.45);
      const rack = phase(p, 0.8, 0.9);
      g.position.z += Math.sin(rack * Math.PI) * 0.05;
    }
    if (anim.swing !== null) {
      const s = anim.swing;
      const arc = Math.sin(s * Math.PI);
      g.rotation.y = 0.9 - s * 1.8;
      g.rotation.x += arc * 0.4;
      g.position.x -= arc * 0.18;
      g.position.z -= arc * 0.12;
    }
  }

  makeBomb() {
    const bomb = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.35), new THREE.MeshLambertMaterial({ color: 0x3f3f46 }));
    box.position.y = 0.13;
    this.bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    this.bombLight.position.set(0, 0.3, 0);
    bomb.add(box, this.bombLight);
    bomb.visible = false;
    return bomb;
  }

  avatar(player) {
    let a = this.avatars.get(player.id);
    if (a) return a;
    const group = new THREE.Group();
    const color = TEAM_COLORS[player.team];
    const suit = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, PLAYER.height * 0.45, 0.3), dark);
    legs.position.y = PLAYER.height * 0.225;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, PLAYER.height * 0.36, 0.34), suit);
    torso.position.y = PLAYER.height * 0.63;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.55), dark);
    gun.position.set(0.22, PLAYER.height * 0.62, -0.3);
    const held = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.22), new THREE.MeshLambertMaterial({ color: 0x3f3f46 }));
    held.position.set(0.22, PLAYER.height * 0.55, -0.25);
    held.visible = false;
    group.add(held);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.faceTexture }));
    head.scale.set(0.62, 0.98, 1);
    head.position.y = PLAYER.height - 0.2;
    group.add(legs, torso, gun, head);
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
    marker.scale.set(0.18, 0.18, 1);
    marker.position.y = PLAYER.height + 0.45;
    marker.visible = false;
    group.add(marker);
    this.scene.add(group);
    a = { group, legs, torso, marker, gun, held, weapon: -1 };
    this.avatars.set(player.id, a);
    return a;
  }

  updateAvatar(player, state, { teammate }) {
    const a = this.avatar(player);
    a.group.visible = state.alive;
    if (!state.alive) return;
    a.group.position.set(state.x, state.y, state.z);
    a.group.rotation.y = state.yaw;
    a.group.scale.y = state.crouch ? PLAYER.crouchHeight / PLAYER.height : 1;
    a.marker.visible = teammate;
    if (a.weapon !== state.weapon) {
      // Held item by WEAPON_ORDER index: rifle, pistol, knife, bomb.
      a.weapon = state.weapon;
      const len = [1, 0.45, 0.5, 0][state.weapon] ?? 1;
      a.gun.visible = len > 0;
      a.gun.scale.set(state.weapon === 2 ? 0.4 : 1, state.weapon === 2 ? 0.6 : 1, len || 1);
      a.gun.position.z = -0.3 * (len || 1) - 0.05;
      a.held.visible = state.weapon === 3;
    }
  }

  hideAvatar(id) {
    const a = this.avatars.get(id);
    if (a) a.group.visible = false;
  }

  setBomb(position, planted, blink) {
    this.bombMesh.visible = !!position;
    if (!position) return;
    this.bombMesh.position.set(position.x, 0, position.z);
    this.bombLight.visible = !planted || blink;
  }

  tracer(from, to, hit) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: hit ? 0xff6b6b : 0xfff3b0, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(hit ? 0.12 : 0.08, 6, 6), new THREE.MeshBasicMaterial({ color: hit ? 0xff4d4d : 0xd6d3d1, transparent: true }));
    puff.position.set(...to);
    this.scene.add(puff);
    this.tracers.push({ objects: [line, puff], until: performance.now() + 110 });
  }

  muzzle() {
    this.flash.visible = true;
    this.flashUntil = performance.now() + 45;
    this.recoil = Math.min(1, this.recoil + 0.45);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement.parentElement;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render({ x, y, z, yaw, pitch, eye, showGun, weapon = "rifle", anim = {} }) {
    if (this.lost) return;
    const t = performance.now();
    this.camera.position.set(x, y + eye, z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.setViewmodel(showGun ? weapon : null);
    if (showGun) this.animateViewmodel(weapon, { reload: anim.reload ?? null, swing: anim.swing ?? null, draw: anim.draw ?? null }, t);
    this.handLight.visible = Math.floor(t / 500) % 2 === 0;
    if (this.flash.visible && t > this.flashUntil) this.flash.visible = false;
    this.tracers = this.tracers.filter((tr) => {
      if (t < tr.until) return true;
      for (const o of tr.objects) {
        this.scene.remove(o);
        o.geometry.dispose();
        o.material.dispose();
      }
      return false;
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) [].concat(o.material).forEach((m) => (m.map?.dispose(), m.dispose()));
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
