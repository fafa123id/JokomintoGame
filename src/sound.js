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

export function setMuted(next) {
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

export function initSound() {
  applyMute();
}
