import { html } from "./modal.js";

const KEY = "jm_sound";
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

function setMuted(next) {
  muted = next;
  try {
    localStorage.setItem(KEY, next ? "off" : "on");
  } catch {
    // preference lasts for this page only
  }
  applyMute();
  window.dispatchEvent(new Event("sound:change"));
}

// Muting the elements themselves silences every playback path, including code that bypasses playSoundEffect.
function applyMute() {
  document.querySelectorAll("audio").forEach((audio) => {
    audio.muted = muted;
    if (muted) audio.pause();
  });
}

export function initSoundToggle() {
  const toolbar = document.querySelector("[data-open-leaderboard]")?.parentElement;
  if (!toolbar) return;
  const button = html(`<button type="button" class="h-12 w-12 rounded-full bg-white/90 text-xl shadow-lg hover:bg-white"></button>`);
  const render = () => {
    button.textContent = muted ? "🔇" : "🔊";
    button.setAttribute("aria-label", muted ? "Unmute sounds" : "Mute sounds");
    button.setAttribute("aria-pressed", String(muted));
    button.title = muted ? "Sound: off" : "Sound: on";
  };
  button.addEventListener("click", () => {
    setMuted(!muted);
    render();
  });
  render();
  applyMute();
  toolbar.appendChild(button);
}
