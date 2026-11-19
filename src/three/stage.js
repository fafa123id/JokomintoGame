import * as THREE from "/asset/vendor/three/three.module.min.js";

const COUNT = { star: 10, coin: 9, heart: 7, bubble: 12 };
const BOUNDS = { x: 9, y: 6, zNear: -2, zFar: -10 };
const BURST_LIFE = 1.6;

const MOODS = {
  default: { light: 1.0, speed: 1.0, bubbles: 0.35, tint: 0xffffff },
  sleep: { light: 0.35, speed: 0.35, bubbles: 0.15, tint: 0x8fa3ff },
  bathing: { light: 1.0, speed: 1.4, bubbles: 0.9, tint: 0xd8f3ff },
  eating: { light: 1.1, speed: 1.2, bubbles: 0.3, tint: 0xfff1d6 },
  playing: { light: 1.05, speed: 1.6, bubbles: 0.35, tint: 0xffffff },
};

function starShape() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.22;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function heartShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.35);
  shape.bezierCurveTo(-0.5, 0, -0.45, 0.42, 0, 0.18);
  shape.bezierCurveTo(0.45, 0.42, 0.5, 0, 0, -0.35);
  return shape;
}

const extrude = (shape, depth) =>
  new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 2 }).center();

function createAssets() {
  return {
    star: {
      geometry: extrude(starShape(), 0.14),
      material: new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0x7a5a00, roughness: 0.35, metalness: 0.2, flatShading: true }),
    },
    coin: {
      geometry: new THREE.CylinderGeometry(0.34, 0.34, 0.09, 24).rotateX(Math.PI / 2),
      material: new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x5c3d00, roughness: 0.25, metalness: 0.75 }),
    },
    heart: {
      geometry: extrude(heartShape(), 0.16),
      material: new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0x5b0f36, roughness: 0.4, flatShading: true }),
    },
    bubble: {
      geometry: new THREE.SphereGeometry(0.3, 20, 16),
      material: new THREE.MeshStandardMaterial({ color: 0xbfe9ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 }),
    },
  };
}

const random = (min, max) => min + Math.random() * (max - min);

export class Stage {
  constructor(container) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "stage3d";
    container.prepend(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
    this.camera.position.set(0, 0, 6);

    this.ambient = new THREE.AmbientLight(0xffffff, 1.1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(3, 5, 6);
    this.scene.add(this.ambient, this.sun);

    this.assets = createAssets();
    this.floaters = [];
    this.bursts = [];
    for (const [kind, count] of Object.entries(COUNT)) {
      for (let i = 0; i < count; i++) this.floaters.push(this.spawnFloater(kind, true));
    }

    this.mood = { ...MOODS.default };
    this.targetMood = MOODS.default;
    this.pointer = new THREE.Vector2();
    this.tint = new THREE.Color(0xffffff);
    this.last = 0;

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("pointermove", (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
    this.resize();
    requestAnimationFrame((t) => this.loop(t));
  }

  spawnFloater(kind, scatter) {
    const { geometry, material } = this.assets[kind];
    const mesh = new THREE.Mesh(geometry, kind === "bubble" ? material.clone() : material);
    const z = random(BOUNDS.zFar, BOUNDS.zNear);
    mesh.position.set(random(-BOUNDS.x, BOUNDS.x), scatter ? random(-BOUNDS.y, BOUNDS.y) : -BOUNDS.y - 1, z);
    mesh.rotation.set(random(0, Math.PI), random(0, Math.PI), random(0, Math.PI));
    const scale = random(0.55, 1.15);
    mesh.scale.setScalar(scale);
    mesh.userData = {
      kind,
      rise: random(0.15, 0.45) * (kind === "bubble" ? 1.6 : 1),
      sway: random(0.2, 0.6),
      phase: random(0, Math.PI * 2),
      spin: new THREE.Vector3(random(-0.6, 0.6), random(-0.9, 0.9), random(-0.4, 0.4)),
    };
    this.scene.add(mesh);
    return mesh;
  }

  setMood(state) {
    this.targetMood = MOODS[state] ?? MOODS.default;
  }

  screenToWorld(x, y, z = 0) {
    const ndc = new THREE.Vector3((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const distance = (z - this.camera.position.z) / dir.z;
    return this.camera.position.clone().add(dir.multiplyScalar(distance));
  }

  burst(kind = "coins", x = window.innerWidth / 2, y = window.innerHeight / 2) {
    const assetKind = kind === "coins" ? "coin" : kind === "hearts" ? "heart" : kind === "bubbles" ? "bubble" : "star";
    const origin = this.screenToWorld(x, y, 1.5);
    const { geometry, material } = this.assets[assetKind];
    for (let i = 0; i < 22; i++) {
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.material.transparent = true;
      mesh.position.copy(origin);
      mesh.scale.setScalar(random(0.25, 0.45));
      const angle = random(0, Math.PI * 2);
      const speed = random(2.2, 4.2);
      mesh.userData = {
        velocity: new THREE.Vector3(Math.cos(angle) * speed * 0.7, random(2.5, 5), Math.sin(angle) * speed * 0.4),
        spin: new THREE.Vector3(random(-8, 8), random(-8, 8), random(-8, 8)),
        age: 0,
      };
      this.scene.add(mesh);
      this.bursts.push(mesh);
    }
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  loop(time) {
    requestAnimationFrame((t) => this.loop(t));
    if (document.hidden) return;
    const dt = Math.min(0.05, (time - this.last) / 1000 || 0.016);
    this.last = time;
    const t = time / 1000;

    const blend = Math.min(1, dt * 1.5);
    for (const key of ["light", "speed", "bubbles"]) this.mood[key] += (this.targetMood[key] - this.mood[key]) * blend;
    this.tint.lerp(new THREE.Color(this.targetMood.tint), blend);
    this.ambient.intensity = 1.1 * this.mood.light;
    this.sun.intensity = 1.6 * this.mood.light;
    this.ambient.color.copy(this.tint);

    for (const mesh of this.floaters) {
      const data = mesh.userData;
      mesh.position.y += data.rise * this.mood.speed * dt;
      mesh.position.x += Math.sin(t * data.sway + data.phase) * 0.004;
      mesh.rotation.x += data.spin.x * dt * this.mood.speed;
      mesh.rotation.y += data.spin.y * dt * this.mood.speed;
      mesh.rotation.z += data.spin.z * dt * this.mood.speed;
      if (data.kind === "bubble") mesh.material.opacity = this.mood.bubbles;
      if (mesh.position.y > BOUNDS.y + 1) {
        mesh.position.y = -BOUNDS.y - 1;
        mesh.position.x = random(-BOUNDS.x, BOUNDS.x);
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const mesh = this.bursts[i];
      const data = mesh.userData;
      data.age += dt;
      data.velocity.y -= 9 * dt;
      mesh.position.addScaledVector(data.velocity, dt);
      mesh.rotation.x += data.spin.x * dt;
      mesh.rotation.y += data.spin.y * dt;
      mesh.material.opacity = Math.max(0, 1 - data.age / BURST_LIFE);
      if (data.age > BURST_LIFE) {
        this.scene.remove(mesh);
        mesh.material.dispose();
        this.bursts.splice(i, 1);
      }
    }

    this.camera.position.x += (this.pointer.x * 0.6 - this.camera.position.x) * Math.min(1, dt * 2);
    this.camera.position.y += (-this.pointer.y * 0.4 - this.camera.position.y) * Math.min(1, dt * 2);
    this.camera.lookAt(0, 0, -4);

    this.renderer.render(this.scene, this.camera);
  }
}

export function createStage(container) {
  const stage = new Stage(container);
  window.addEventListener("pet:state", (e) => stage.setMood(e.detail));
  window.addEventListener("stage:burst", (e) => stage.burst(e.detail.kind, e.detail.x, e.detail.y));
  return stage;
}
