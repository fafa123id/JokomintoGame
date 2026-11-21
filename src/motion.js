import { showMessage } from "./components.js";

const KEY = "jm_motion";
const HINT_KEY = "jm_motion_hint";

const systemPrefersReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable; preference lasts for this page only
  }
}

export function motionEnabled() {
  const preference = stored(KEY);
  if (preference) return preference === "full";
  return !systemPrefersReduced();
}

export function applyMotionClass() {
  document.documentElement.classList.toggle("motion-reduced", !motionEnabled());
}

// Switching between 3D and simple animations needs a reload to rebuild the renderers.
export function setMotionEnabled(enabled) {
  store(KEY, enabled ? "full" : "reduced");
  location.reload();
}

export function initMotionHint() {
  if (!motionEnabled() && !stored(KEY) && !stored(HINT_KEY)) {
    store(HINT_KEY, "1");
    setTimeout(() => showMessage("Animations are reduced by your system setting. Turn them on in ⚙️ Settings.", "success", 5000), 2500);
  }
}
