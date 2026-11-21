import { html, openModal } from "./modal.js";
import { isMuted, setMuted, getLevel, setVolume } from "./sound.js";
import { motionEnabled, setMotionEnabled } from "./motion.js";
import { state } from "./api.js";

// Device-wide preferences, kept in localStorage.
const KEY = "jm_settings";
const DEFAULTS = { skipCareScenes: false, askAddFriend: true };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = load();

export const getSetting = (name) => settings[name];

function setSetting(name, value) {
  settings = { ...settings, [name]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

function row({ icon, title, hint, checked, onChange, disabled = false }) {
  const item = html(`
    <label class="settings-row${disabled ? " is-disabled" : ""}">
      <span class="settings-icon" aria-hidden="true"></span>
      <span class="settings-text"><strong></strong><small></small></span>
      <input type="checkbox" class="settings-switch" role="switch">
    </label>`);
  item.querySelector(".settings-icon").textContent = icon;
  item.querySelector("strong").textContent = title;
  item.querySelector("small").textContent = hint;
  const input = item.querySelector("input");
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(input.checked));
  return item;
}

function slider({ icon, title, kind }) {
  const item = html(`
    <label class="settings-row settings-row--slider">
      <span class="settings-icon" aria-hidden="true"></span>
      <span class="settings-text"><strong></strong><small></small></span>
      <input type="range" class="settings-range" min="0" max="100" step="5">
    </label>`);
  item.querySelector(".settings-icon").textContent = icon;
  item.querySelector("strong").textContent = title;
  const value = item.querySelector("small");
  const input = item.querySelector("input");
  input.value = Math.round(getLevel(kind) * 100);
  input.setAttribute("aria-label", `${title} volume`);
  value.textContent = `${input.value}%`;
  input.addEventListener("input", () => {
    value.textContent = `${input.value}%`;
    setVolume(kind, input.value / 100);
  });
  return item;
}

function openSettings() {
  const view = html(`
    <div>
      <h2 class="font-game text-2xl text-center text-gray-800 mb-1">⚙️ Settings</h2>
      <p class="text-center text-gray-500 text-sm mb-5">Saved on this device</p>
      <div data-rows class="space-y-2"></div>
    </div>`);
  const rows = view.querySelector("[data-rows]");
  rows.append(
    row({ icon: "🔊", title: "Sound & music", hint: "Sound effects and background music", checked: !isMuted(), onChange: (on) => setMuted(!on) }),
    slider({ icon: "🎚️", title: "Master volume", kind: "master" }),
    slider({ icon: "🎵", title: "Music", kind: "music" }),
    slider({ icon: "💥", title: "Sound effects", kind: "effects" }),
    slider({ icon: "🎙️", title: "Announcer (Jokoman)", kind: "voice" }),
    row({
      icon: "✨",
      title: "3D animations",
      hint: "Turn off on slower phones (reloads the page)",
      checked: motionEnabled(),
      onChange: (on) => setMotionEnabled(on),
    }),
    row({
      icon: "⏩",
      title: "Always skip eat & bath animations",
      hint: "Jump straight to the result",
      checked: getSetting("skipCareScenes"),
      onChange: (on) => setSetting("skipCareScenes", on),
    }),
    row({
      icon: "🤝",
      title: "Ask to add opponents as friends",
      hint: state.user && !state.user.isGuest ? "Shown after online matches" : "Needs a registered account",
      checked: getSetting("askAddFriend"),
      disabled: !state.user || state.user.isGuest,
      onChange: (on) => setSetting("askAddFriend", on),
    })
  );
  openModal(view);
}

export function initSettings() {
  const toolbar = document.querySelector("[data-open-leaderboard]")?.parentElement;
  if (!toolbar) return;
  const button = html(`<button type="button" aria-label="Settings" title="Settings"
    class="h-12 w-12 rounded-full bg-white/90 text-xl shadow-lg hover:bg-white">⚙️</button>`);
  button.addEventListener("click", openSettings);
  toolbar.appendChild(button);
}
