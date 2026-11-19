import { html } from "./modal.js";
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

export function initMotionToggle() {
  const toolbar = document.querySelector("[data-open-leaderboard]")?.parentElement;
  if (!toolbar) return;

  const enabled = motionEnabled();
  const button = html(`<button type="button" class="h-12 w-12 rounded-full bg-white/90 text-xl shadow-lg hover:bg-white"></button>`);
  button.textContent = enabled ? "✨" : "💤";
  button.setAttribute("aria-label", enabled ? "Turn animations off" : "Turn animations on");
  button.title = enabled ? "Animations: on" : "Animations: off";
  button.addEventListener("click", () => {
    store(KEY, enabled ? "reduced" : "full");
    location.reload();
  });
  toolbar.appendChild(button);

  if (!enabled && !stored(KEY) && !stored(HINT_KEY)) {
    store(HINT_KEY, "1");
    setTimeout(() => showMessage("Animations are reduced by your system setting. Tap 💤 to turn them on.", "success", 5000), 2500);
  }
}
