import * as THREE from "/asset/vendor/three/three.module.min.js";
import { clone as cloneSkinned } from "/asset/vendor/three/addons/utils/SkeletonUtils.js";
import { assets, findNode, measure } from "./assets.js";

// Weapon and bomb models built from simple solids with PBR materials. Barrels point down -z,
// the origin sits at the pistol grip. Shared by the first-person view, other players and the floor.

export function weaponMaterials() {
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.85, roughness: 0.38 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.1, roughness: 0.75 }),
    tan: new THREE.MeshStandardMaterial({ color: 0x8c7752, metalness: 0.05, roughness: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.18 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 1, roughness: 0.3 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4b5320, metalness: 0.1, roughness: 0.8 }),
    led: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a2a1a, emissive: 0x29ff7a, emissiveIntensity: 0.6, roughness: 0.2 }),
    wireRed: new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 }),
    wireBlue: new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.5 }),
  };
}

const box = (w, h, d, mat, x = 0, y = 0, z = 0, rx = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
};
const tube = (r, len, mat, x = 0, y = 0, z = 0, seg = 10) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
};

export function buildRifle(m) {
  const g = new THREE.Group();
  g.add(
    box(0.06, 0.085, 0.34, m.metal, 0, 0.02, -0.06), // receiver
    box(0.03, 0.018, 0.36, m.metal, 0, 0.072, -0.08), // top rail
    box(0.07, 0.07, 0.26, m.polymer, 0, 0.022, -0.36), // handguard
    tube(0.011, 0.24, m.metal, 0, 0.03, -0.6), // barrel
    tube(0.017, 0.06, m.metal, 0, 0.03, -0.73, 8), // muzzle brake
    box(0.045, 0.09, 0.2, m.tan, 0, 0.0, 0.22), // stock
    box(0.05, 0.12, 0.03, m.polymer, 0, -0.005, 0.33), // butt pad
    box(0.038, 0.1, 0.045, m.tan, 0, -0.07, 0.05, 0.35), // grip
    box(0.032, 0.04, 0.07, m.polymer, 0, 0.1, -0.03), // optic body
    tube(0.02, 0.05, m.polymer, 0, 0.1, -0.08, 12), // optic lens housing
    box(0.012, 0.035, 0.012, m.metal, 0, 0.075, -0.47), // front sight
    box(0.04, 0.03, 0.09, m.metal, 0, -0.015, -0.13) // trigger guard / mag well
  );
  const mag = new THREE.Group();
  mag.add(box(0.034, 0.1, 0.065, m.tan, 0, -0.05, 0), box(0.034, 0.08, 0.06, m.tan, 0, -0.13, -0.02, -0.3));
  mag.position.set(0, -0.04, -0.13);
  g.add(mag);
  return { group: g, mag, muzzle: -0.77, hands: { right: new THREE.Vector3(0, -0.06, 0.06), left: new THREE.Vector3(0, -0.03, -0.36) } };
}

export function buildPistol(m) {
  const g = new THREE.Group();
  g.add(
    box(0.032, 0.035, 0.19, m.metal, 0, 0.035, -0.06), // slide
    box(0.03, 0.025, 0.15, m.polymer, 0, 0.005, -0.05), // frame
    box(0.03, 0.105, 0.045, m.polymer, 0, -0.05, 0.02, 0.25), // grip
    tube(0.007, 0.02, m.metal, 0, 0.035, -0.16, 8), // muzzle
    box(0.006, 0.012, 0.01, m.metal, 0, 0.058, -0.14), // sight
    box(0.02, 0.012, 0.035, m.metal, 0, -0.012, -0.02) // trigger guard
  );
  const mag = new THREE.Group();
  mag.add(box(0.026, 0.02, 0.04, m.metal, 0, 0, 0));
  mag.position.set(0, -0.105, 0.035);
  g.add(mag);
  return { group: g, mag, muzzle: -0.17, hands: { right: new THREE.Vector3(0, -0.05, 0.02), left: new THREE.Vector3(-0.02, -0.06, 0.0) } };
}

export function buildKnife(m) {
  const g = new THREE.Group();
  const handle = tube(0.014, 0.11, m.polymer, 0, 0, 0.03, 8);
  const guard = box(0.012, 0.04, 0.012, m.metal, 0, 0, -0.03);
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.012);
  shape.lineTo(0.17, -0.012);
  shape.quadraticCurveTo(0.2, -0.008, 0.21, 0.012);
  shape.quadraticCurveTo(0.12, 0.02, 0, 0.016);
  shape.lineTo(0, -0.012);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.002, bevelSegments: 1 }), m.steel);
  blade.rotation.y = Math.PI / 2;
  blade.position.set(-0.002, 0, -0.035);
  g.add(handle, guard, blade);
  return { group: g, hands: { right: new THREE.Vector3(0, -0.005, 0.03) } };
}

export function buildBomb(m) {
  const g = new THREE.Group();
  g.add(box(0.2, 0.08, 0.13, m.olive, 0, 0.04, 0));
  const screen = box(0.07, 0.005, 0.04, m.glass, -0.04, 0.083, -0.02);
  const keypad = new THREE.Group();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) keypad.add(box(0.014, 0.006, 0.012, m.polymer, 0.03 + c * 0.018, 0.083, -0.03 + r * 0.018));
  const wireA = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 12, Math.PI), m.wireRed);
  wireA.position.set(-0.06, 0.08, 0.04);
  const wireB = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 6, 12, Math.PI), m.wireBlue);
  wireB.position.set(-0.03, 0.08, 0.045);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 8), m.led);
  light.position.set(0.08, 0.088, 0.04);
  g.add(screen, keypad, wireA, wireB, light);
  return { group: g, light, hands: { right: new THREE.Vector3(0.09, 0.02, 0.03), left: new THREE.Vector3(-0.09, 0.02, 0.03) } };
}

// Auto pistol: the sidearm with a longer magazine and a compensator.
export function buildRentet(m) {
  const w = buildPistol(m);
  w.group.add(tube(0.012, 0.04, m.metal, 0, 0.035, -0.18, 8));
  w.mag.add(box(0.026, 0.07, 0.04, m.polymer, 0, -0.04, 0));
  w.muzzle = -0.21;
  return w;
}

// Revolver: long barrel and a cylinder (the "magazine" for the reload animation).
export function buildSabit(m) {
  const g = new THREE.Group();
  g.add(
    tube(0.012, 0.2, m.steel, 0, 0.035, -0.15, 10), // barrel
    box(0.012, 0.03, 0.2, m.metal, 0, 0.055, -0.15), // rib
    box(0.03, 0.035, 0.08, m.metal, 0, 0.02, 0), // frame
    box(0.032, 0.11, 0.045, m.tan, 0, -0.05, 0.04, 0.35) // grip
  );
  const cylinder = new THREE.Group();
  cylinder.add(tube(0.024, 0.045, m.steel, 0, 0, 0, 6));
  cylinder.position.set(0, 0.025, -0.04);
  g.add(cylinder);
  return { group: g, mag: cylinder, muzzle: -0.26, hands: { right: new THREE.Vector3(0, -0.05, 0.03), left: new THREE.Vector3(-0.02, -0.06, 0.01) } };
}

// SMG: short body, vertical magazine, folding stock.
export function buildTawon(m) {
  const g = new THREE.Group();
  g.add(
    box(0.055, 0.075, 0.28, m.metal, 0, 0.02, -0.05),
    tube(0.01, 0.12, m.metal, 0, 0.03, -0.25),
    box(0.03, 0.02, 0.18, m.polymer, 0, 0.065, -0.05),
    box(0.035, 0.09, 0.04, m.polymer, 0, -0.06, 0.05, 0.3),
    box(0.02, 0.02, 0.18, m.metal, 0, 0.01, 0.17)
  );
  const mag = new THREE.Group();
  mag.add(box(0.03, 0.16, 0.035, m.polymer, 0, -0.08, 0));
  mag.position.set(0, -0.02, -0.08);
  g.add(mag);
  return { group: g, mag, muzzle: -0.32, hands: { right: new THREE.Vector3(0, -0.05, 0.05), left: new THREE.Vector3(0, -0.09, -0.08) } };
}

// Pump shotgun: long barrel over a tube magazine, wooden pump and stock.
export function buildGledek(m) {
  const g = new THREE.Group();
  const wood = m.tan;
  g.add(
    box(0.06, 0.07, 0.2, m.metal, 0, 0.02, 0), // receiver
    tube(0.016, 0.55, m.metal, 0, 0.035, -0.37), // barrel
    tube(0.013, 0.45, m.metal, 0, 0.0, -0.32), // tube magazine
    box(0.05, 0.08, 0.26, wood, 0, -0.01, 0.2), // stock
    box(0.035, 0.09, 0.04, wood, 0, -0.06, 0.06, 0.35)
  );
  const pump = new THREE.Group();
  pump.add(box(0.05, 0.05, 0.14, wood, 0, 0, 0));
  pump.position.set(0, 0.0, -0.28);
  g.add(pump);
  return { group: g, mag: pump, muzzle: -0.66, hands: { right: new THREE.Vector3(0, -0.06, 0.06), left: new THREE.Vector3(0, -0.03, -0.28) } };
}

// Tactical rifle: the rifle without the optic, iron sights and a different furniture color.
export function buildTombak(m) {
  const w = buildRifle({ ...m, tan: m.olive });
  w.group.children.filter((c) => c.position.y >= 0.09).forEach((c) => w.group.remove(c));
  w.group.add(box(0.012, 0.03, 0.02, m.metal, 0, 0.09, 0.02));
  return w;
}

// LMG: heavy barrel, box magazine and a bipod.
export function buildGerinda(m) {
  const g = new THREE.Group();
  g.add(
    box(0.075, 0.1, 0.4, m.metal, 0, 0.02, -0.05),
    tube(0.016, 0.38, m.metal, 0, 0.03, -0.45),
    box(0.08, 0.05, 0.22, m.polymer, 0, 0.06, -0.25), // heat shield
    box(0.05, 0.1, 0.22, m.polymer, 0, 0, 0.24),
    box(0.04, 0.1, 0.045, m.polymer, 0, -0.07, 0.07, 0.35)
  );
  for (const x of [-0.03, 0.03]) {
    const leg = box(0.01, 0.12, 0.01, m.metal, x, -0.04, -0.55, 0.4);
    g.add(leg);
  }
  const mag = new THREE.Group();
  mag.add(box(0.09, 0.1, 0.1, m.olive, 0, 0, 0));
  mag.position.set(0, -0.06, -0.1);
  g.add(mag);
  return { group: g, mag, muzzle: -0.66, hands: { right: new THREE.Vector3(0, -0.07, 0.07), left: new THREE.Vector3(0, -0.02, -0.3) } };
}

// Sniper: long fluted barrel, big scope, bolt and a cheek rest.
export function buildElang(m) {
  const g = new THREE.Group();
  g.add(
    box(0.06, 0.08, 0.36, m.olive, 0, 0.01, -0.02),
    tube(0.013, 0.55, m.metal, 0, 0.03, -0.48),
    tube(0.02, 0.06, m.metal, 0, 0.03, -0.77, 8),
    tube(0.03, 0.26, m.polymer, 0, 0.11, -0.05, 14), // scope
    tube(0.036, 0.04, m.polymer, 0, 0.11, -0.18, 14),
    tube(0.034, 0.04, m.polymer, 0, 0.11, 0.08, 14),
    box(0.05, 0.11, 0.26, m.olive, 0, -0.01, 0.26),
    box(0.035, 0.1, 0.04, m.polymer, 0, -0.06, 0.07, 0.3),
    box(0.014, 0.014, 0.05, m.steel, 0.04, 0.04, 0.04) // bolt
  );
  const mag = new THREE.Group();
  mag.add(box(0.04, 0.06, 0.08, m.polymer, 0, 0, 0));
  mag.position.set(0, -0.05, -0.06);
  g.add(mag);
  return { group: g, mag, muzzle: -0.8, hands: { right: new THREE.Vector3(0, -0.06, 0.07), left: new THREE.Vector3(0, -0.03, -0.32) } };
}

export const BUILDERS = { rifle: buildRifle, pistol: buildPistol, knife: buildKnife, bomb: buildBomb, rentet: buildRentet, sabit: buildSabit, tawon: buildTawon, gledek: buildGledek, tombak: buildTombak, gerinda: buildGerinda, elang: buildElang };

// Default real-world lengths (m) used to scale downloaded models.
const LENGTHS = { rifle: 0.9, pistol: 0.22, knife: 0.3, bomb: 0.24, rentet: 0.24, sabit: 0.3, tawon: 0.55, gledek: 1.0, tombak: 0.9, gerinda: 1.05, elang: 1.15 };

// A weapon from models.json when one was loaded, otherwise the built-in model. Loaded models are
// rotated (spec.rotation, radians) so the barrel points down -z, scaled to spec.length, and placed
// with the grip near the origin (fine-tune with spec.offset). Optional named nodes: spec.mag (moves
// during reloads) and spec.light (the bomb LED).
export function makeWeapon(id, mats) {
  const gltf = assets.weapons[id];
  const spec = assets.config?.weapons?.[id] ?? {};
  if (!gltf) return BUILDERS[id](mats);
  const model = cloneSkinned(gltf.scene);
  model.rotation.set(...(spec.rotation ?? [0, 0, 0]));
  let box = measure(model);
  const size = box.getSize(new THREE.Vector3());
  const length = spec.length ?? LENGTHS[id];
  model.scale.multiplyScalar(length / Math.max(size.x, size.y, size.z));
  box = measure(model);
  const center = box.getCenter(new THREE.Vector3());
  const rear = id === "bomb" ? 0.5 : 0.3;
  model.position.set(-center.x, 0.05 - box.max.y, rear * length - box.max.z);
  model.position.add(new THREE.Vector3(...(spec.offset ?? [0, 0, 0])));
  const group = new THREE.Group();
  group.add(model);
  model.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  box = measure(group);
  const v = (a, fallback) => (a ? new THREE.Vector3(...a) : fallback);
  const muzzleZ = spec.muzzle ? spec.muzzle[2] : box.min.z;
  const hands =
    id === "knife"
      ? { right: v(spec.hands?.right, new THREE.Vector3(0, -0.01, 0.05)) }
      : { right: v(spec.hands?.right, new THREE.Vector3(0, -0.06, 0.04)), left: v(spec.hands?.left, new THREE.Vector3(0, -0.03, -0.38 * length)) };
  if (id === "bomb") Object.assign(hands, { right: v(spec.hands?.right, new THREE.Vector3(length * 0.45, 0, 0)), left: v(spec.hands?.left, new THREE.Vector3(-length * 0.45, 0, 0)) });
  const mag = spec.mag !== false && id !== "knife" && id !== "bomb" ? findNode(model, spec.mag, ["magazine", "mag"]) : null;
  let light = id === "bomb" ? findNode(model, spec.light, ["light", "led"]) : null;
  if (id === "bomb" && !light) {
    light = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 8), mats.led);
    light.position.set(length * 0.35, box.max.y + 0.005, 0);
    group.add(light);
  }
  // Magazine travel during reloads, in the magazine's own parent units.
  const magDrop = mag ? 0.3 / mag.parent.getWorldScale(new THREE.Vector3()).y : 0.3;
  return { group, mag, magDrop, muzzle: muzzleZ, hands, light };
}
