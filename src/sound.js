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

// Volume levels (0..1): master scales everything; music, effects and voice (the FPS announcer) on top.
const VOLUME_KEY = "jm_volume";
const VOLUME_DEFAULTS = { master: 1, music: 0.8, effects: 1, voice: 1 };
let volumes = readVolumes();

function readVolumes() {
  try {
    return { ...VOLUME_DEFAULTS, ...JSON.parse(localStorage.getItem(VOLUME_KEY) || "{}") };
  } catch {
    return { ...VOLUME_DEFAULTS };
  }
}

export function getLevel(kind) {
  return volumes[kind] ?? 1;
}

// Effective volume for a kind of sound, including master and mute.
export function getVolume(kind) {
  if (muted) return 0;
  return Math.max(0, Math.min(1, volumes.master * (volumes[kind] ?? 1)));
}

export function setVolume(kind, value) {
  volumes = { ...volumes, [kind]: Math.max(0, Math.min(1, value)) };
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
  } catch {}
  window.dispatchEvent(new Event("sound:change"));
}

export function initSound() {
  applyMute();
}
