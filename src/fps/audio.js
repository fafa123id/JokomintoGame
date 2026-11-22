import { isMuted, getVolume } from "../sound.js";
import { WEAPONS } from "./shared/weapons.js";

// Synthesized FPS sounds: shots, hits, kills, bomb beeps. No audio files.
let ctx = null;
let master = null;
let noise = null;

function audio() {
  if (isMuted()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) {
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.55 * getVolume("effects");
    master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  master.gain.value = 0.55 * getVolume("effects");
  return ctx;
}

function burst(at, { gain, from, to, duration, type = "lowpass", pan = 0, dest = null }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(to, at + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.001, at + duration);
  const panner = ctx.createStereoPanner?.();
  if (panner) panner.pan.value = pan;
  src.connect(filter).connect(env);
  if (dest) env.connect(dest);
  else if (panner) env.connect(panner).connect(master);
  else env.connect(master);
  src.start(at, Math.random() * 0.2, duration + 0.05);
  return src;
}

function tone(at, freq, { gain = 0.15, duration = 0.15, type = "sine", glide, dest = null } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, at + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.001, at + duration);
  osc.connect(env).connect(dest ?? master);
  osc.start(at);
  osc.stop(at + duration + 0.05);
  return osc;
}

const now = () => ctx.currentTime + 0.005;

// ---------- 3D positioning (HRTF): footsteps, remote shots and knives come from where they happen ----------

export function setListener(x, y, z, yaw) {
  if (!ctx) return;
  const l = ctx.listener;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  if (l.positionX) {
    l.positionX.value = x;
    l.positionY.value = y;
    l.positionZ.value = z;
    l.forwardX.value = fx;
    l.forwardY.value = 0;
    l.forwardZ.value = fz;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  } else {
    l.setPosition?.(x, y, z);
    l.setOrientation?.(fx, 0, fz, 0, 1, 0);
  }
}

function spatial(pos, { ref = 3, max = 70, rolloff = 1.1 } = {}) {
  const p = ctx.createPanner();
  p.panningModel = "HRTF";
  p.distanceModel = "inverse";
  p.refDistance = ref;
  p.maxDistance = max;
  p.rolloffFactor = rolloff;
  if (p.positionX) {
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
  } else p.setPosition(pos.x, pos.y, pos.z);
  p.connect(master);
  setTimeout(() => p.disconnect(), 3000);
  return p;
}

// Gunshot character per weapon family: [crack gain, crack from Hz, length s, thump Hz, thump gain, echo gain].
const SHOTS = {
  pistol: [0.5, 6500, 0.12, 160, 0.28, 0.08],
  revolver: [0.85, 4200, 0.2, 90, 0.45, 0.18],
  smg: [0.45, 7000, 0.09, 180, 0.22, 0.06],
  rifle: [0.7, 5200, 0.16, 120, 0.28, 0.12],
  lmg: [0.75, 4600, 0.15, 100, 0.32, 0.12],
  shotgun: [1, 3200, 0.3, 70, 0.55, 0.22],
  sniper: [1, 3800, 0.35, 60, 0.6, 0.3],
};

// pos: world position for other players' shots; omit for your own.
export function shot(weapon = "rifle", { pos = null } = {}) {
  if (!audio()) return;
  const t = now();
  const dest = pos ? spatial(pos, { ref: 6, max: 140, rolloff: 0.9 }) : null;
  const [gain, from, length, thump, thumpGain, echo] = SHOTS[WEAPONS[weapon]?.family] ?? SHOTS.rifle;
  burst(t, { gain, from, to: 300, duration: length, dest });
  tone(t, thump, { gain: thumpGain, duration: 0.09 + length * 0.3, type: "triangle", glide: 45, dest });
  // Tail echo off the walls.
  burst(t + 0.06, { gain: echo, from: 1800, to: 200, duration: 0.35 + length, dest });
}

// Two-part footfall (heel, then toe). Running is loud; others' steps are positional.
export function footstep({ pos = null, self = false } = {}) {
  if (!audio()) return;
  const t = now();
  const dest = pos ? spatial(pos, { ref: 2.5, max: 40, rolloff: 1.4 }) : null;
  const g = self ? 0.09 : 0.32;
  const pitch = 0.85 + Math.random() * 0.3;
  burst(t, { gain: g, from: 900 * pitch, to: 120, duration: 0.07, dest });
  burst(t + 0.045, { gain: g * 0.7, from: 2400 * pitch, to: 400, duration: 0.05, type: "bandpass", dest });
  tone(t, 70 * pitch, { gain: g * 0.6, duration: 0.06, type: "sine", glide: 40, dest });
}

export function land({ pos = null } = {}) {
  if (!audio()) return;
  const dest = pos ? spatial(pos, { ref: 2.5, max: 40 }) : null;
  burst(now(), { gain: 0.3, from: 700, to: 90, duration: 0.12, dest });
}

// Hit confirmation: a dry tick plus a short body thud; headshots add a bright ding.
export function hitMarker(head) {
  if (!audio()) return;
  const t = now();
  burst(t, { gain: 0.35, from: 4200, to: 1800, duration: 0.035, type: "bandpass" });
  tone(t, head ? 1750 : 1150, { gain: 0.13, duration: head ? 0.2 : 0.07, type: "square" });
  tone(t, 140, { gain: 0.22, duration: 0.08, type: "sine", glide: 70 });
  if (head) tone(t + 0.05, 2600, { gain: 0.1, duration: 0.22 });
}

export function assist() {
  if (!audio()) return;
  const t = now();
  [660, 990].forEach((f, i) => tone(t + i * 0.06, f, { gain: 0.07, duration: 0.14, type: "triangle" }));
}

export function killConfirm() {
  if (!audio()) return;
  const t = now();
  [880, 1320].forEach((f, i) => tone(t + i * 0.07, f, { gain: 0.12, duration: 0.18, type: "triangle" }));
}

export function hurt() {
  if (!audio()) return;
  burst(now(), { gain: 0.35, from: 900, to: 120, duration: 0.18 });
}

// Reload in three parts timed to the animation: magazine out, magazine in, charging handle.
let reloadNodes = [];
export function reload(weapon = "rifle", seconds = 2) {
  cancelReload();
  if (!audio()) return;
  const t = now();
  const pistol = ["pistol", "revolver"].includes(WEAPONS[weapon]?.family);
  const at = (k) => t + seconds * k;
  reloadNodes = [
    burst(at(0.22), { gain: 0.3, from: 2200, to: 900, duration: 0.07, type: "bandpass" }),
    tone(at(0.22), pistol ? 520 : 380, { gain: 0.07, duration: 0.05, type: "square", glide: 200 }),
    burst(at(0.58), { gain: 0.4, from: 3200, to: 1400, duration: 0.05, type: "bandpass" }),
    tone(at(0.6), pistol ? 900 : 700, { gain: 0.1, duration: 0.04, type: "square" }),
    burst(at(0.82), { gain: 0.35, from: 5000, to: 2000, duration: 0.05, type: "highpass" }),
    burst(at(0.88), { gain: 0.45, from: 4200, to: 1500, duration: 0.06, type: "bandpass" }),
    tone(at(0.88), pistol ? 1300 : 1000, { gain: 0.08, duration: 0.05, type: "square" }),
  ];
}

export function cancelReload() {
  for (const node of reloadNodes) {
    try {
      node.stop();
    } catch {}
  }
  reloadNodes = [];
}

// Knife swing: an air whoosh rising in pitch.
export function slash({ pos = null } = {}) {
  if (!audio()) return;
  const t = now();
  const dest = pos ? spatial(pos, { ref: 2, max: 25, rolloff: 1.5 }) : null;
  burst(t, { gain: 0.45, from: 700, to: 5200, duration: 0.2, type: "bandpass", dest });
  burst(t + 0.03, { gain: 0.2, from: 3000, to: 8000, duration: 0.12, type: "highpass", dest });
}

// Knife connecting.
export function stab() {
  if (!audio()) return;
  const t = now();
  burst(t, { gain: 0.5, from: 1200, to: 150, duration: 0.12 });
  tone(t, 95, { gain: 0.3, duration: 0.1, type: "sine", glide: 50 });
  burst(t + 0.02, { gain: 0.15, from: 6000, to: 2500, duration: 0.05, type: "highpass" });
}

// Drawing a weapon: rifle charging handle, pistol slide, knife unsheathing, bomb strap.
export function equip(weapon = "rifle") {
  if (!audio()) return;
  const t = now();
  if (weapon === "knife") {
    burst(t, { gain: 0.25, from: 4000, to: 9000, duration: 0.22, type: "highpass" });
    tone(t + 0.15, 3200, { gain: 0.05, duration: 0.25, type: "sine", glide: 3000 });
  } else if (weapon === "bomb") {
    burst(t, { gain: 0.2, from: 900, to: 400, duration: 0.08 });
    tone(t + 0.08, 1500, { gain: 0.06, duration: 0.06, type: "square" });
  } else {
    const pistol = ["pistol", "revolver"].includes(WEAPONS[weapon]?.family);
    burst(t, { gain: 0.3, from: pistol ? 3800 : 2800, to: 1200, duration: 0.05, type: "bandpass" });
    burst(t + (pistol ? 0.1 : 0.14), { gain: 0.4, from: pistol ? 4500 : 3500, to: 1500, duration: 0.05, type: "bandpass" });
    tone(t + (pistol ? 0.1 : 0.14), pistol ? 1100 : 850, { gain: 0.08, duration: 0.04, type: "square" });
  }
}

// Planting: keypad presses while the bar fills, then the bomb set down.
export function keypad() {
  if (!audio()) return;
  const keys = [1209, 1336, 1477, 1633];
  const t = now();
  tone(t, keys[Math.floor(Math.random() * keys.length)], { gain: 0.08, duration: 0.07, type: "sine" });
  tone(t, 697 + Math.floor(Math.random() * 4) * 80, { gain: 0.06, duration: 0.07, type: "sine" });
  burst(t, { gain: 0.08, from: 5000, to: 2500, duration: 0.02, type: "highpass" });
}

export function bombPlace() {
  if (!audio()) return;
  const t = now();
  burst(t, { gain: 0.5, from: 800, to: 80, duration: 0.18 });
  tone(t, 110, { gain: 0.3, duration: 0.15, type: "sine", glide: 55 });
  tone(t + 0.2, 1760, { gain: 0.1, duration: 0.08, type: "square" });
  tone(t + 0.32, 1760, { gain: 0.1, duration: 0.08, type: "square" });
}

// Defusing: wire snips and fiddling clicks; done is a falling chime.
export function defuseTick() {
  if (!audio()) return;
  const t = now();
  if (Math.random() < 0.4) burst(t, { gain: 0.3, from: 7000, to: 3000, duration: 0.03, type: "highpass" });
  else burst(t, { gain: 0.15, from: 2500, to: 1200, duration: 0.04, type: "bandpass" });
}

// Heard by everyone nearby when a defuse starts: the kit snapping open.
export function defuseStart({ pos = null } = {}) {
  if (!audio()) return;
  const t = now();
  const dest = pos ? spatial(pos, { ref: 8, max: 70, rolloff: 0.7 }) : null;
  burst(t, { gain: 0.8, from: 3500, to: 600, duration: 0.12, type: "bandpass", dest });
  tone(t, 420, { gain: 0.25, duration: 0.18, type: "square", glide: 260, dest });
  burst(t + 0.15, { gain: 0.6, from: 6000, to: 2500, duration: 0.06, type: "highpass", dest });
}

// Someone else's defuse in progress: wire snips, tool clicks and a chirp, loud and directional.
export function defuseLoud({ pos = null, progress = 0 } = {}) {
  if (!audio()) return;
  const t = now();
  const dest = pos ? spatial(pos, { ref: 8, max: 70, rolloff: 0.7 }) : null;
  if (Math.random() < 0.5) burst(t, { gain: 0.7, from: 8000, to: 3000, duration: 0.04, type: "highpass", dest });
  else burst(t, { gain: 0.55, from: 2800, to: 1300, duration: 0.05, type: "bandpass", dest });
  tone(t + 0.02, 2200 + progress * 900, { gain: 0.14, duration: 0.05, type: "square", dest });
}

export function defuseDone() {
  if (!audio()) return;
  const t = now();
  [1760, 1320, 880].forEach((f, i) => tone(t + i * 0.09, f, { gain: 0.08, duration: 0.12, type: "sine" }));
}

export function bombDrop() {
  if (!audio()) return;
  const t = now();
  tone(t, 180, { gain: 0.25, duration: 0.12, type: "triangle", glide: 80 });
  burst(t, { gain: 0.25, from: 1500, to: 300, duration: 0.1 });
}

export function chatBlip() {
  if (!audio()) return;
  tone(now(), 990, { gain: 0.05, duration: 0.06, type: "sine" });
}

export function beep(urgent = false, volume = 1) {
  if (!audio()) return;
  tone(now(), urgent ? 1760 : 1320, { gain: 0.1 * volume, duration: 0.09, type: "square" });
}

export function roundStart() {
  if (!audio()) return;
  const t = now();
  [523.25, 659.25, 783.99].forEach((f, i) => tone(t + i * 0.1, f, { gain: 0.12, duration: 0.3, type: "triangle" }));
}

// A grenade or firecracker going off nearby.
export function blast({ pos = null } = {}) {
  if (!audio()) return;
  const t = now();
  const dest = pos ? spatial(pos, { ref: 5, max: 90, rolloff: 0.9 }) : null;
  burst(t, { gain: 0.9, from: 2600, to: 60, duration: 0.7, dest });
  tone(t, 70, { gain: 0.45, duration: 0.5, type: "sine", glide: 30, dest });
}

// Hero ability cues, synthesized: hisses, chimes, zaps, pings.
export function ability(kind, { pos = null } = {}) {
  if (!audio()) return;
  const t = now();
  const dest = pos ? spatial(pos, { ref: 4, max: 60 }) : null;
  const o = { dest };
  switch (kind) {
    case "smoke":
    case "smokeDome":
      burst(t, { gain: 0.35, from: 1800, to: 500, duration: kind === "smokeDome" ? 1.2 : 0.8, ...o });
      break;
    case "wall":
    case "shield":
    case "dome":
      burst(t, { gain: 0.4, from: 400, to: 80, duration: 0.4, ...o });
      tone(t + 0.1, 660, { gain: 0.08, duration: 0.3, type: "triangle", glide: 990, ...o });
      break;
    case "slowZone":
    case "vortex":
      tone(t, 300, { gain: 0.16, duration: 0.8, type: "sawtooth", glide: 70, ...o });
      burst(t, { gain: 0.2, from: 900, to: 200, duration: 0.8, type: "bandpass", ...o });
      break;
    case "dash":
      burst(t, { gain: 0.45, from: 600, to: 4000, duration: 0.22, type: "bandpass", ...o });
      break;
    case "stealth":
      tone(t, 1200, { gain: 0.07, duration: 0.6, type: "sine", glide: 300, ...o });
      tone(t + 0.05, 1800, { gain: 0.05, duration: 0.5, type: "sine", glide: 500, ...o });
      break;
    case "boost":
    case "rush":
      tone(t, 300, { gain: 0.15, duration: 0.35, type: "triangle", glide: 900, ...o });
      tone(t + 0.12, 600, { gain: 0.1, duration: 0.3, type: "triangle", glide: 1400, ...o });
      break;
    case "laser":
      tone(t, 500, { gain: 0.1, duration: 0.2, type: "square", ...o });
      break;
    case "scouts":
      tone(t, 220, { gain: 0.1, duration: 0.7, type: "sawtooth", glide: 260, ...o });
      break;
    case "grenade":
    case "barrage":
      burst(t, { gain: 0.25, from: 6000, to: 3000, duration: 0.03, type: "highpass", ...o });
      burst(t + 0.08, { gain: 0.3, from: 700, to: 2500, duration: 0.18, type: "bandpass", ...o });
      break;
    case "pull":
      tone(t, 1600, { gain: 0.1, duration: 0.3, type: "sawtooth", glide: 200, ...o });
      break;
    case "heal":
    case "revive":
      [660, 880, 1320].forEach((f, i) => tone(t + i * 0.08, f, { gain: 0.08, duration: 0.3, type: "sine", ...o }));
      break;
    case "scan":
    case "reveal":
      tone(t, 1400, { gain: 0.12, duration: 0.5, type: "sine", glide: 1100, ...o });
      tone(t + 0.25, 1400, { gain: 0.06, duration: 0.5, type: "sine", glide: 1100, ...o });
      break;
    case "drone":
      tone(t, 140, { gain: 0.12, duration: 0.9, type: "sawtooth", glide: 180, ...o });
      break;
  }
}

// The laser zone arming: a rising siren everyone can hear, for the whole warning.
export function alarm({ pos = null, seconds = 4.5 } = {}) {
  if (!audio()) return;
  const t = now();
  const dest = pos ? spatial(pos, { ref: 10, max: 150, rolloff: 0.6 }) : null;
  for (let i = 0; i < seconds * 2; i++) {
    const urgent = i >= seconds * 2 - 3;
    tone(t + i * 0.5, urgent ? 1200 : 700, { gain: 0.22, duration: 0.42, type: "sawtooth", glide: urgent ? 1600 : 950, dest });
  }
}

// Electric stun.
export function zap() {
  if (!audio()) return;
  const t = now();
  burst(t, { gain: 0.5, from: 8000, to: 2000, duration: 0.25, type: "highpass" });
  tone(t, 90, { gain: 0.25, duration: 0.3, type: "square", glide: 60 });
}

export function explosion() {
  if (!audio()) return;
  const t = now();
  burst(t, { gain: 1, from: 2000, to: 40, duration: 1.4 });
  tone(t, 60, { gain: 0.5, duration: 1, type: "sine", glide: 25 });
}

export function result(won) {
  if (!audio()) return;
  const t = now();
  const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [392, 329.63, 261.63];
  notes.forEach((f, i) => tone(t + i * 0.14, f, { gain: 0.14, duration: 0.5, type: "triangle" }));
}
