import * as THREE from "/asset/vendor/three/three.module.min.js";
import { GLTFLoader } from "/asset/vendor/three/addons/loaders/GLTFLoader.js";

// Optional 3D models (.glb) listed in /asset/models/models.json. Anything missing or broken falls back
// to the procedural models, so the game always runs. Loaded once and shared by every match.
const BASE = "/asset/models/";
let ready = null;

export const assets = { config: null, soldier: null, weapons: {}, heroes: {} };

async function loadGlb(loader, file) {
  try {
    return await loader.loadAsync(BASE + file);
  } catch (err) {
    console.warn(`model ${file} could not be loaded`, err);
    return null;
  }
}

export function loadModels() {
  ready ??= (async () => {
    let config;
    try {
      const res = await fetch(`${BASE}models.json`, { cache: "no-cache" });
      if (!res.ok) return assets;
      config = await res.json();
    } catch {
      return assets;
    }
    assets.config = config;
    const loader = new GLTFLoader();
    const jobs = [];
    if (config.soldier?.file) jobs.push(loadGlb(loader, config.soldier.file).then((gltf) => (assets.soldier = gltf)));
    // Optional per-hero characters; heroes without one use the shared soldier.
    for (const [id, spec] of Object.entries(config.heroes ?? {})) {
      if (spec?.file) jobs.push(loadGlb(loader, spec.file).then((gltf) => gltf && (assets.heroes[id] = gltf)));
    }
    for (const [id, spec] of Object.entries(config.weapons ?? {})) {
      if (spec?.file) jobs.push(loadGlb(loader, spec.file).then((gltf) => gltf && (assets.weapons[id] = gltf)));
    }
    await Promise.all(jobs);
    return assets;
  })();
  return ready;
}

// Resolves when models are in, or after `ms` so a slow download never blocks a match.
export function modelsReady(ms = 6000) {
  return Promise.race([loadModels(), new Promise((r) => setTimeout(r, ms))]);
}

// Finds a node by exact name first, then by a case-insensitive fragment (rigs name bones differently).
export function findNode(root, name, fragments = []) {
  if (!root) return null;
  let found = name ? root.getObjectByName(name) : null;
  if (found) return found;
  const keys = [name, ...fragments].filter(Boolean).map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ""));
  root.traverse((o) => {
    if (found) return;
    const n = o.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (keys.some((k) => n.endsWith(k))) found = o;
  });
  return found;
}

// Bounding box of a loaded scene in its own space.
export function measure(object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}
