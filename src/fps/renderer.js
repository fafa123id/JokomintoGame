import * as THREE from "/asset/vendor/three/three.module.min.js";
import { CELL, WALL_HEIGHT, COVER_HEIGHT, PLAYER } from "./shared/physics.js";
import { perf } from "../three/perf.js";
import { wallTexture, floorTexture, coverTexture, siteDecal, floorOcclusion, bulletHoleTexture } from "./textures.js";
import { weaponMaterials, makeWeapon } from "./models.js";
import { WEAPONS, WEAPON_IDS } from "./shared/weapons.js";
import { createHumanKit, Humanoid } from "./humanoid.js";
import { GltfSoldier } from "./soldier.js";
import { assets } from "./assets.js";
import { EffectsView } from "./effects.js";

// Realistic-looking scene on a budget: procedural PBR textures with normal maps, a shader sky that
// also lights the scene (environment map), a sun with soft shadows, fake ambient occlusion on the
// floor, articulated soldiers, detailed weapons with first-person arms drawn in their own pass,
// and a color-grading pass. Heavier features (shadows, grading, MSAA) only on capable devices.
const QUALITY = {
  high: { shadows: true, post: true, texture: 512, pixelRatio: 1.5, light: true },
  mobile: { shadows: false, post: false, texture: 512, pixelRatio: 1.25, light: false },
  low: { shadows: false, post: false, texture: 256, pixelRatio: 1, light: false },
}[perf.tier] ?? { shadows: false, post: false, texture: 256, pixelRatio: 1, light: false };

// Surface style per map: walls, floor, cover.
const STYLES = {
  pasar: ["brick", "pavers", "crate"],
  pabrik: ["concrete", "concrete", "metal"],
  stasiun: ["brick", "tiles", "metal"],
  kampung: ["plaster", "dirt", "crate"],
  pantai: ["planks", "sand", "metal"],
};
const SITE_COLORS = { A: "#f59e0b", B: "#a78bfa" };
const ARM_COLORS = { red: 0x4f2a26, blue: 0x263a57 };
const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
// 0 -> 1 between a and b.
const phase = (p, a, b) => clamp01((p - a) / (b - a));
const UP = new THREE.Vector3(0, 1, 0);

const SKY_VERTEX = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAGMENT = `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, ground, pow(-h, 0.4));
  float sun = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.9, 0.7) * (pow(sun, 900.0) * 12.0 + pow(sun, 12.0) * 0.35);
  // Soft cloud bands.
  float band = sin(d.x * 7.0 + d.z * 3.0) * sin(d.z * 5.0 - d.x * 2.0);
  col = mix(col, vec3(1.0), smoothstep(0.55, 1.0, band) * smoothstep(0.05, 0.35, h) * 0.25);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const POST_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
// ACES tone curve, sRGB, gentle contrast/saturation, warm highlights, vignette and fine grain.
const POST_FRAGMENT = `
uniform sampler2D tScene;
uniform float time;
uniform float hurt;
varying vec2 vUv;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  c = aces(c * 1.05);
  c = toSRGB(c);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.12);
  c = (c - 0.5) * 1.06 + 0.5;
  c *= mix(vec3(0.97, 0.99, 1.04), vec3(1.04, 1.0, 0.94), l);
  vec2 q = vUv - 0.5;
  float v = smoothstep(0.85, 0.25, length(q * vec2(1.1, 1.0)));
  c *= mix(0.72, 1.0, v);
  c = mix(c, vec3(0.6, 0.0, 0.0), hurt * (1.0 - v) * 0.6);
  float n = fract(sin(dot(vUv * (time + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.025;
  gl_FragColor = vec4(c, 1.0);
}`;

export class FpsRenderer {
  constructor(container, map, { team = "red" } = {}) {
    this.map = map;
    this.team = team;
    this.renderer = new THREE.WebGLRenderer({ antialias: !QUALITY.post && perf.tier !== "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.autoClear = false;
    if (QUALITY.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    container.prepend(this.renderer.domElement);
    // If the GPU drops the context, stop drawing instead of throwing every frame.
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.renderer.domElement.addEventListener("webglcontextrestored", () => (this.lost = false));

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(map.theme.fog, 35, 120);
    this.baseFog = [35, 120];
    this.fogColor = new THREE.Color(map.theme.fog);
    this.smokeFogColor = new THREE.Color(0xa7acb4);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    this.weaponMats = weaponMaterials();
    this.kit = createHumanKit(this.weaponMats);
    this.avatars = new Map();
    this.tracers = [];
    this.impacts = [];
    this.decals = [];
    this.sparks = [];
    this.shells = [];
    this.groundMeshes = new Map();
    this.fx = {
      streak: new THREE.BoxGeometry(0.02, 0.02, 1),
      streakMat: new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      streakHitMat: new THREE.MeshBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      puff: new THREE.SphereGeometry(0.08, 8, 6),
      spark: new THREE.PlaneGeometry(0.04, 0.04),
      sparkMat: new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      decal: new THREE.PlaneGeometry(0.13, 0.13),
      decalMat: new THREE.MeshStandardMaterial({ map: bulletHoleTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }),
      shell: new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6),
    };

    this.buildLighting();
    this.buildMap();
    this.abilityFx = new EffectsView(this.scene, { myTeam: team });
    this.buildViewmodels();
    const bomb = makeWeapon("bomb", this.weaponMats);
    bomb.group.scale.setScalar(1.6);
    bomb.group.traverse((o) => (o.castShadow = true));
    this.bombMesh = bomb.group;
    this.bombLight = bomb.light;
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);
    if (QUALITY.post) this.buildPost();
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener("resize", this.onResize);
  }

  // ---------- world ----------

  buildLighting() {
    const theme = this.map.theme;
    const sunDir = new THREE.Vector3(0.45, 0.75, 0.35).normalize();
    const horizon = new THREE.Color(theme.fog);
    const zenith = new THREE.Color(theme.sky).multiplyScalar(0.75);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: { zenith: { value: zenith }, horizon: { value: horizon }, ground: { value: new THREE.Color(theme.floor).multiplyScalar(0.5) }, sunDir: { value: sunDir } },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.sky = sky;

    // The sky doubles as the reflection/ambient environment for every PBR material.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;

    this.scene.add(new THREE.HemisphereLight(theme.sky, theme.floor, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    const w = this.map.width * CELL;
    const h = this.map.height * CELL;
    sun.position.set(w / 2 + sunDir.x * 60, sunDir.y * 60, h / 2 + sunDir.z * 60);
    sun.target.position.set(w / 2, 0, h / 2);
    if (QUALITY.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const half = Math.max(w, h) * 0.62;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 160 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
    }
    this.scene.add(sun, sun.target);
    // Muzzle light (desktop only: adding lights costs fragment time).
    if (QUALITY.light) {
      this.muzzleLight = new THREE.PointLight(0xffb45c, 0, 7, 2);
      this.scene.add(this.muzzleLight);
    }
  }

  buildMap() {
    const { map } = this;
    const [wallStyle, floorStyle, coverStyle] = STYLES[map.id] ?? ["concrete", "concrete", "crate"];
    const size = QUALITY.texture;
    const w = map.width * CELL;
    const h = map.height * CELL;
    const solid = (x, z) => map.grid[z]?.[x] === "#" || map.grid[z]?.[x] === "=";

    const floorTex = floorTexture(floorStyle, map.theme.floor, size, map.id.length * 7);
    floorTex.map.repeat.set(map.width, map.height);
    floorTex.normalMap.repeat.set(map.width, map.height);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ ...floorTex, roughness: floorStyle === "tiles" ? 0.55 : 0.92, aoMap: floorOcclusion(map, solid), aoMapIntensity: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w / 2, 0, h / 2);
    floor.receiveShadow = true;
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
    const place = (cells, geometry, material, y) => {
      if (!cells.length) return null;
      const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
      const m = new THREE.Matrix4();
      cells.forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation((x + 0.5) * CELL, y, (z + 0.5) * CELL)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    };
    const wallTex = wallTexture(wallStyle, map.theme.wall, size, map.id.length * 13);
    place(walls, new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL), new THREE.MeshStandardMaterial({ ...wallTex, roughness: wallStyle === "planks" ? 0.8 : 0.93 }), WALL_HEIGHT / 2);
    // Concrete caps along the wall tops.
    place(walls, new THREE.BoxGeometry(CELL + 0.08, 0.14, CELL + 0.08), new THREE.MeshStandardMaterial({ color: 0x8b8680, roughness: 0.9 }), WALL_HEIGHT + 0.07);

    // Cover crates: side faces tile the crate texture so a 3 m block reads as a row of crates.
    const coverGeo = new THREE.BoxGeometry(CELL, COVER_HEIGHT, CELL);
    const uv = coverGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      if (face !== 2 && face !== 3) uv.setX(i, uv.getX(i) * 3);
      else uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
    }
    const coverTex = coverTexture(coverStyle, map.theme.cover, size, map.id.length * 31);
    place(covers, coverGeo, new THREE.MeshStandardMaterial({ ...coverTex, roughness: coverStyle === "metal" ? 0.55 : 0.85, metalness: coverStyle === "metal" ? 0.55 : 0 }), COVER_HEIGHT / 2);

    // Painted site markings and faint spawn tints.
    for (const site of ["A", "B"]) {
      const cells = map.sites[site];
      const xs = cells.map((c) => c.x);
      const zs = cells.map((c) => c.z);
      const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs) + 1) / 2;
      const side = Math.min(Math.max(...xs) - Math.min(...xs) + 1, Math.max(...zs) - Math.min(...zs) + 1) * CELL * 0.6;
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(side, side),
        new THREE.MeshStandardMaterial({ map: siteDecal(site, SITE_COLORS[site]), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.8 })
      );
      decal.rotation.x = -Math.PI / 2;
      decal.position.set(cx * CELL, 0.01, cz * CELL);
      decal.receiveShadow = true;
      this.scene.add(decal);
    }
    const tint = (cells, color, opacity) => {
      if (!cells.length) return;
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(CELL, CELL), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), cells.length);
      const m = new THREE.Matrix4();
      const r = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
      cells.forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation((x + 0.5) * CELL, 0.015, (z + 0.5) * CELL).multiply(r)));
      this.scene.add(mesh);
    };
    tint(tiles.A, 0xf59e0b, 0.08);
    tint(tiles.B, 0x8b5cf6, 0.08);
    tint(tiles.T, 0xef4444, 0.05);
    tint(tiles.D, 0x3b82f6, 0.05);
  }

  // ---------- first person ----------

  buildViewmodels() {
    this.vmScene = new THREE.Scene();
    this.vmScene.environment = this.envMap;
    this.vmScene.environmentIntensity = 0.6;
    this.vmCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x5a5048, 0.9));
    const key = new THREE.DirectionalLight(0xfff0d8, 2);
    key.position.set(1, 2, 1);
    this.vmScene.add(key);
    this.vmRoot = new THREE.Group();
    this.vmScene.add(this.vmRoot);

    const rest = {
      rifle: new THREE.Vector3(0.19, -0.2, -0.46),
      pistol: new THREE.Vector3(0.15, -0.17, -0.42),
      knife: new THREE.Vector3(0.21, -0.2, -0.38),
      bomb: new THREE.Vector3(0.06, -0.25, -0.46),
      rentet: new THREE.Vector3(0.15, -0.17, -0.42),
      sabit: new THREE.Vector3(0.15, -0.17, -0.44),
      tawon: new THREE.Vector3(0.17, -0.19, -0.42),
      gledek: new THREE.Vector3(0.18, -0.2, -0.44),
      tombak: new THREE.Vector3(0.19, -0.2, -0.46),
      gerinda: new THREE.Vector3(0.2, -0.22, -0.46),
      elang: new THREE.Vector3(0.19, -0.21, -0.46),
    };
    this.viewmodels = {};
    for (const id of WEAPON_IDS) {
      const vm = makeWeapon(id, this.weaponMats);
      vm.rest = rest[id];
      vm.group.position.copy(vm.rest);
      vm.group.visible = false;
      if (vm.mag) vm.magRest = vm.mag.position.clone();
      // Anchors that move with the gun, for the hands.
      vm.anchors = {};
      for (const [side, p] of Object.entries(vm.hands)) {
        const a = new THREE.Object3D();
        a.position.copy(p);
        vm.group.add(a);
        vm.anchors[side] = a;
      }
      this.vmRoot.add(vm.group);
      this.viewmodels[id] = vm;
    }
    this.handLight = this.viewmodels.bomb.light;

    // Sleeved arms with gloves, from just below the screen edge to each hand.
    const sleeve = new THREE.MeshStandardMaterial({ color: ARM_COLORS[this.team] ?? ARM_COLORS.red, roughness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.7 });
    const limb = (r) => new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.21, 4, 10), sleeve);
    this.vmArms = {
      right: { shoulder: new THREE.Vector3(0.3, -0.46, 0.06), upper: limb(0.042), fore: limb(0.034), hand: new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.065, 0.08), glove) },
      left: { shoulder: new THREE.Vector3(-0.28, -0.48, 0.02), upper: limb(0.042), fore: limb(0.034), hand: new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.075, 0.09), glove) },
    };
    for (const arm of Object.values(this.vmArms)) this.vmRoot.add(arm.upper, arm.fore, arm.hand);

    // Muzzle flash: a bright star sprite at the barrel.
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,230,1)");
    grad.addColorStop(0.3, "rgba(255,200,90,0.9)");
    grad.addColorStop(1, "rgba(255,120,0,0)");
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 12 : 32;
      g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.fill();
    const flashTex = new THREE.CanvasTexture(c);
    flashTex.colorSpace = THREE.SRGBColorSpace;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.flash.scale.setScalar(0.16);
    this.flash.visible = false;
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
      this.flash.position.set(0, 0.03, vm.muzzle - 0.03);
    }
  }

  placeLimb(part, from, to) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    part.position.copy(from).addScaledVector(dir, 0.5);
    part.quaternion.setFromUnitVectors(UP, dir.normalize());
    part.scale.set(1, Math.max(0.3, len / 0.29), 1);
  }

  placeArms(vm, anim) {
    for (const [side, arm] of Object.entries(this.vmArms)) {
      const anchor = vm?.anchors[side];
      const show = !!anchor;
      arm.upper.visible = arm.fore.visible = arm.hand.visible = show;
      if (!show) continue;
      const hand = new THREE.Vector3();
      anchor.getWorldPosition(hand);
      // During a reload the left hand goes to the magazine.
      if (side === "left" && anim.reload !== null && vm.mag) {
        const k = Math.sin(phase(anim.reload, 0.12, 0.7) * Math.PI);
        const mag = new THREE.Vector3();
        vm.mag.getWorldPosition(mag);
        hand.lerp(mag, k);
      }
      const mid = arm.shoulder.clone().lerp(hand, 0.5);
      const elbow = mid.add(new THREE.Vector3(side === "right" ? 0.06 : -0.06, -0.06, 0.04));
      this.placeLimb(arm.upper, arm.shoulder, elbow);
      this.placeLimb(arm.fore, elbow, hand);
      arm.hand.position.copy(hand);
      arm.hand.quaternion.copy(vm.group.quaternion);
    }
  }

  // anim: { reload, swing, draw, plant, defuse }: each 0..1 or null
  animateViewmodel(weapon, anim, t) {
    const vm = this.viewmodels[weapon];
    if (!vm) return this.placeArms(null, anim);
    const g = vm.group;
    this.recoil *= 0.8;
    const bob = Math.sin(t / 160) * 0.003;
    g.position.set(vm.rest.x, vm.rest.y + this.recoil * 0.015 + bob, vm.rest.z + this.recoil * 0.05);
    g.rotation.set(this.recoil * 0.07, 0, 0);
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
      const drop = vm.magDrop ?? 0.3;
      vm.mag.position.y = vm.magRest.y - out * drop + back * drop;
      vm.mag.visible = !(p > 0.36 && p < 0.45);
      const rack = phase(p, 0.8, 0.9);
      g.position.z += Math.sin(rack * Math.PI) * 0.05;
    }
    if (anim.plant !== null) {
      // Kneeling over the bomb, tapping in the code.
      g.position.set(vm.rest.x - 0.05, vm.rest.y - 0.08, vm.rest.z + 0.05);
      g.rotation.set(0.7 + Math.sin(t / 70) * 0.03, 0, 0);
      g.position.y += Math.abs(Math.sin(t / 90)) * 0.01;
    }
    if (anim.defuse !== null) {
      // Working the wires with the knife tip.
      g.position.set(vm.rest.x - 0.1, vm.rest.y - 0.08, vm.rest.z - 0.05 + Math.sin(t / 110) * 0.03);
      g.rotation.set(-0.6, 0.4 + Math.sin(t / 160) * 0.2, Math.sin(t / 90) * 0.15);
    }
    if (anim.swing !== null) {
      const s = anim.swing;
      const arc = Math.sin(s * Math.PI);
      g.rotation.y = 0.9 - s * 1.8;
      g.rotation.x += arc * 0.4;
      g.position.x -= arc * 0.18;
      g.position.z -= arc * 0.12;
    }
    g.updateMatrixWorld(true);
    this.placeArms(vm, anim);
  }

  // ---------- players ----------

  avatar(player) {
    let a = this.avatars.get(player.id);
    // Rebuild once the hero is known (it changes after hero select).
    if (a && a.hero !== (player.hero ?? null)) {
      a.human.dispose();
      this.avatars.delete(player.id);
      a = null;
    }
    if (a) return a;
    // A downloaded soldier model when one is configured, otherwise the built-in one.
    const heroGltf = assets.heroes[player.hero] ?? assets.soldier;
    const spec = { ...(assets.config?.soldier ?? {}), ...(assets.config?.heroes?.[player.hero] ?? {}) };
    const human = heroGltf ? new GltfSoldier(heroGltf, spec, player.team, this.weaponMats) : new Humanoid(this.kit, player.team, player.hero);
    this.scene.add(human.root);
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ color: player.team === "blue" ? 0x60a5fa : 0xf87171, depthTest: false, transparent: true, opacity: 0.9 }));
    marker.scale.set(0.14, 0.14, 1);
    marker.position.y = PLAYER.height + 0.4;
    marker.visible = false;
    human.root.add(marker);
    // Shown over enemies a scan or scout drone revealed, through walls.
    const revealed = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3b3b, depthTest: false, transparent: true, opacity: 0.95 }));
    revealed.scale.set(0.22, 0.22, 1);
    revealed.position.y = PLAYER.height + 0.55;
    revealed.renderOrder = 10;
    revealed.visible = false;
    human.root.add(revealed);
    a = { human, marker, revealed, hero: player.hero ?? null, lastUpdate: performance.now() };
    this.avatars.set(player.id, a);
    return a;
  }

  updateAvatar(player, state, { teammate }) {
    const a = this.avatar(player);
    const now = performance.now();
    const dt = Math.min(0.1, (now - a.lastUpdate) / 1000);
    a.lastUpdate = now;
    a.human.update(state, now, dt);
    a.marker.visible = teammate && state.alive;
    const status = state.status ?? 0;
    a.revealed.visible = !teammate && state.alive && !!(status & 2);
    // Stealthed enemies only show up close; a stealthed teammate flickers.
    if (state.alive && status & 1) {
      const close = Math.hypot(state.x - this.camera.position.x, state.z - this.camera.position.z) < 4;
      a.human.root.visible = teammate ? Math.floor(now / 120) % 3 !== 0 : close && Math.floor(now / 90) % 2 === 0;
    }
  }

  hideAvatar(id) {
    const a = this.avatars.get(id);
    if (a) a.human.root.visible = false;
  }

  setBomb(position, planted, blink) {
    this.bombMesh.visible = !!position;
    if (!position) return;
    this.bombMesh.position.set(position.x, 0, position.z);
    this.bombLight.visible = !planted || blink;
  }

  // Guns lying on the floor: [id, weaponIndex, x, z]. 0 = rifle, 1 = pistol.
  setGround(list) {
    const keep = new Set();
    for (const [id, w, x, z] of list) {
      keep.add(id);
      let mesh = this.groundMeshes.get(id);
      if (!mesh) {
        mesh = makeWeapon(WEAPON_IDS[w] ?? "rifle", this.weaponMats).group;
        mesh.rotation.set(0, (id * 1.7) % (Math.PI * 2), Math.PI / 2);
        mesh.scale.setScalar(1.2);
        mesh.traverse((o) => (o.castShadow = true));
        this.scene.add(mesh);
        this.groundMeshes.set(id, mesh);
      }
      mesh.position.set(x, 0.05, z);
    }
    for (const [id, mesh] of this.groundMeshes) {
      if (keep.has(id)) continue;
      this.scene.remove(mesh);
      mesh.traverse((o) => o.geometry?.dispose());
      this.groundMeshes.delete(id);
    }
  }

  // ---------- shots ----------

  // A short glowing streak that flies along the bullet's (slightly dropping) path at its real speed.
  tracer(path, speed, hit, { own = false } = {}) {
    const points = path.map((p) => new THREE.Vector3(...p));
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    const mesh = new THREE.Mesh(this.fx.streak, hit ? this.fx.streakHitMat : this.fx.streakMat);
    mesh.visible = false;
    this.scene.add(mesh);
    if (this.tracers.length > 40) this.scene.remove(this.tracers.shift().mesh);
    this.tracers.push({ points, lengths, total: lengths.at(-1), speed, start: performance.now(), skip: own ? 1.2 : 0, mesh, hit, landed: false });
  }

  pointAlong(tr, d) {
    const { points, lengths } = tr;
    if (d <= 0) return points[0].clone();
    for (let i = 1; i < points.length; i++) {
      if (d <= lengths[i]) return points[i - 1].clone().lerp(points[i], (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1));
    }
    return points.at(-1).clone();
  }

  // Where a bullet stopped: blood on players, otherwise a hole, sparks and dust on the surface it hit.
  impact(tr) {
    const at = tr.points.at(-1);
    const puff = new THREE.Mesh(this.fx.puff, new THREE.MeshBasicMaterial({ color: tr.hit ? 0x9b1111 : 0xb8b0a2, transparent: true, depthWrite: false }));
    puff.position.copy(at);
    this.scene.add(puff);
    this.impacts.push({ mesh: puff, start: performance.now() });
    if (tr.hit) return;
    const before = tr.points.at(-2) ?? tr.points[0];
    const dir = at.clone().sub(before).normalize();
    const normal = this.surfaceNormal(at, dir);
    const decal = new THREE.Mesh(this.fx.decal, this.fx.decalMat);
    decal.position.copy(at).addScaledVector(normal, 0.01);
    decal.lookAt(at.clone().add(normal));
    decal.rotateZ(Math.random() * Math.PI);
    decal.scale.setScalar(0.7 + Math.random() * 0.5);
    this.scene.add(decal);
    this.decals.push(decal);
    if (this.decals.length > 60) this.scene.remove(this.decals.shift());
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(this.fx.spark, this.fx.sparkMat);
      s.position.copy(at);
      const v = normal.clone().multiplyScalar(2 + Math.random() * 2).add(new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(2.5));
      this.scene.add(s);
      this.sparks.push({ mesh: s, v, start: performance.now() });
    }
  }

  // Normal of the wall, cover top or floor at a hit point (the map is made of axis-aligned blocks).
  surfaceNormal(at, dir) {
    if (at.y < 0.03) return new THREE.Vector3(0, 1, 0);
    const fx = at.x / CELL - Math.floor(at.x / CELL);
    const fz = at.z / CELL - Math.floor(at.z / CELL);
    const ex = Math.min(fx, 1 - fx);
    const ez = Math.min(fz, 1 - fz);
    if (Math.abs(at.y - COVER_HEIGHT) < 0.03 && dir.y < 0) return new THREE.Vector3(0, 1, 0);
    return ex < ez ? new THREE.Vector3(-Math.sign(dir.x) || 1, 0, 0) : new THREE.Vector3(0, 0, -Math.sign(dir.z) || 1);
  }

  updateEffects(t, dt) {
    this.tracers = this.tracers.filter((tr) => {
      const head = tr.skip + ((t - tr.start) / 1000) * tr.speed;
      const tail = Math.max(tr.skip, head - 3);
      if (!tr.landed && head >= tr.total) {
        tr.landed = true;
        this.impact(tr);
      }
      if (tail >= tr.total) {
        this.scene.remove(tr.mesh);
        return false;
      }
      const a = this.pointAlong(tr, tail);
      const b = this.pointAlong(tr, Math.min(head, tr.total));
      const len = a.distanceTo(b);
      tr.mesh.visible = len > 0.05;
      if (tr.mesh.visible) {
        tr.mesh.position.copy(a).lerp(b, 0.5);
        tr.mesh.lookAt(b);
        tr.mesh.scale.set(1, 1, len);
      }
      return true;
    });
    this.impacts = this.impacts.filter((fx) => {
      const k = (t - fx.start) / 260;
      if (k >= 1) {
        this.scene.remove(fx.mesh);
        fx.mesh.material.dispose();
        return false;
      }
      fx.mesh.scale.setScalar(1 + k * 3);
      fx.mesh.position.y += dt * 0.4;
      fx.mesh.material.opacity = (1 - k) * 0.8;
      return true;
    });
    this.sparks = this.sparks.filter((s) => {
      const age = t - s.start;
      if (age > 260) {
        this.scene.remove(s.mesh);
        return false;
      }
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.quaternion.copy(this.camera.quaternion);
      s.mesh.scale.setScalar(1 - age / 260);
      return true;
    });
    // Brass casings: thrown out to the right, they fall, bounce once or twice and fade.
    this.shells = this.shells.filter((s) => {
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.spin * dt;
      s.mesh.rotation.z += s.spin * 0.7 * dt;
      if (s.mesh.position.y < 0.01) {
        s.mesh.position.y = 0.01;
        s.v.y = Math.abs(s.v.y) * 0.35;
        s.v.x *= 0.5;
        s.v.z *= 0.5;
        s.spin *= 0.5;
        if (!s.bounced) {
          s.bounced = true;
          this.onShellBounce?.();
        }
      }
      if (t - s.start > 2000) {
        this.scene.remove(s.mesh);
        return false;
      }
      return true;
    });
  }

  ejectShell() {
    const pos = this.camera.localToWorld(new THREE.Vector3(0.14, -0.1, -0.35));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const v = right.multiplyScalar(1.6 + Math.random()).add(new THREE.Vector3(0, 2 + Math.random(), 0));
    const mesh = new THREE.Mesh(this.fx.shell, this.weaponMats.brass);
    mesh.position.copy(pos);
    mesh.castShadow = QUALITY.shadows;
    this.scene.add(mesh);
    this.shells.push({ mesh, v, spin: 15 + Math.random() * 10, start: performance.now(), bounced: false });
    if (this.shells.length > 24) this.scene.remove(this.shells.shift().mesh);
  }

  muzzle(weapon = "rifle") {
    const family = WEAPONS[weapon]?.family ?? "rifle";
    const small = family === "pistol" || family === "revolver";
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.scale.setScalar(small ? 0.11 : family === "shotgun" || family === "sniper" ? 0.26 : 0.16 + Math.random() * 0.04);
    this.flashUntil = performance.now() + 40;
    if (this.muzzleLight) {
      this.muzzleLight.position.copy(this.camera.localToWorld(new THREE.Vector3(0.1, -0.05, -0.8)));
      this.muzzleLight.intensity = 6;
    }
    this.recoil = Math.min(1, this.recoil + ({ pistol: 0.6, revolver: 0.9, shotgun: 1, sniper: 1, smg: 0.35, lmg: 0.4 }[family] ?? 0.45));
    this.ejectShell();
  }

  // ---------- frame ----------

  buildPost() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      uniforms: { tScene: { value: this.target.texture }, time: { value: 0 }, hurt: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  hurt() {
    this.hurtAt = performance.now();
  }

  // Sniper zoom: narrower field of view.
  setZoom(factor) {
    const fov = factor > 1 ? 75 / factor : 75;
    this.zoomed = factor > 1;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // Camera shake from nearby explosions (0..1).
  shake(amount) {
    this.shakeAmt = Math.max(this.shakeAmt ?? 0, amount);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement.parentElement;
    this.renderer.setSize(w, h, false);
    for (const cam of [this.camera, this.vmCamera]) {
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    }
    if (this.target) {
      const ratio = this.renderer.getPixelRatio();
      this.target.setSize(Math.round(w * ratio), Math.round(h * ratio));
    }
  }

  render({ x, y, z, yaw, pitch, eye, showGun, weapon = "rifle", anim = {} }) {
    if (this.lost) return;
    const t = performance.now();
    const dt = Math.min(0.05, (t - (this.lastFrame ?? t)) / 1000);
    this.lastFrame = t;
    this.camera.position.set(x, y + eye, z);
    this.camera.rotation.set(pitch, yaw, 0);
    if (this.shakeAmt > 0.01) {
      this.camera.rotation.x += (Math.random() - 0.5) * 0.05 * this.shakeAmt;
      this.camera.rotation.y += (Math.random() - 0.5) * 0.05 * this.shakeAmt;
      this.shakeAmt *= 0.86;
    }
    this.camera.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
    this.setViewmodel(showGun ? weapon : null);
    // Scoped in: the scope overlay replaces the gun.
    this.vmRoot.visible = showGun && !this.zoomed;
    if (showGun) this.animateViewmodel(weapon, { reload: anim.reload ?? null, swing: anim.swing ?? null, draw: anim.draw ?? null, plant: anim.plant ?? null, defuse: anim.defuse ?? null }, t);
    this.handLight.visible = Math.floor(t / 500) % 2 === 0;
    if (this.flash.visible && t > this.flashUntil) this.flash.visible = false;
    if (this.muzzleLight) this.muzzleLight.intensity *= 0.6;
    this.updateEffects(t, dt);
    // Fog closes in inside smoke: a light haze in your own, thick in the enemy's.
    const smoke = this.abilityFx.update(t, dt, this.camera);
    const fog = this.scene.fog;
    const want = smoke === "enemy" ? [0.4, 5] : smoke === "ally" ? [3, 22] : this.baseFog;
    fog.near += (want[0] - fog.near) * Math.min(1, dt * 10);
    fog.far += (want[1] - fog.far) * Math.min(1, dt * 10);
    fog.color.lerp(smoke ? this.smokeFogColor : this.fogColor, Math.min(1, dt * 10));

    const r = this.renderer;
    r.setRenderTarget(this.target ?? null);
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.vmScene, this.vmCamera);
    if (this.target) {
      this.post.uniforms.time.value = (t / 1000) % 100;
      this.post.uniforms.hurt.value = this.hurtAt ? Math.max(0, 1 - (t - this.hurtAt) / 450) : 0;
      r.setRenderTarget(null);
      r.clear();
      r.render(this.postScene, this.postCamera);
    }
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    for (const item of Object.values(this.fx)) item.dispose?.();
    this.abilityFx.dispose();
    for (const a of this.avatars.values()) a.human.dispose();
    for (const scene of [this.scene, this.vmScene, this.postScene].filter(Boolean)) {
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) [].concat(o.material).forEach((m) => (m.map?.dispose(), m.normalMap?.dispose(), m.aoMap?.dispose(), m.dispose()));
      });
    }
    for (const group of Object.values(this.kit.geo)) group.dispose();
    for (const m of Object.values(this.kit.mats)) m.dispose();
    for (const m of Object.values(this.weaponMats)) m.dispose();
    this.envMap?.dispose();
    this.target?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
