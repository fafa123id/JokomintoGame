import { isMuted } from "../sound.js";

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
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function burst(at, { gain, from, to, duration, type = "lowpass", pan = 0 }) {
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
  if (panner) env.connect(panner).connect(master);
  else env.connect(master);
  src.start(at, Math.random() * 0.2, duration + 0.05);
  return src;
}

function tone(at, freq, { gain = 0.15, duration = 0.15, type = "sine", glide } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, at + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.001, at + duration);
  osc.connect(env).connect(master);
  osc.start(at);
  osc.stop(at + duration + 0.05);
  return osc;
}

const now = () => ctx.currentTime + 0.005;

// distance in meters and pan in [-1, 1] make remote shots quieter and positional.
export function shot(weapon = "rifle", { distance = 0, pan = 0 } = {}) {
  if (!audio()) return;
  const t = now();
  const fall = Math.max(0.08, 1 - distance / 70);
  const heavy = weapon === "rifle";
  burst(t, { gain: (heavy ? 0.7 : 0.5) * fall, from: heavy ? 5200 : 6500, to: 300, duration: heavy ? 0.16 : 0.12, pan });
  tone(t, heavy ? 120 : 160, { gain: 0.28 * fall, duration: 0.09, type: "triangle", glide: 50 });
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
  const pistol = weapon === "pistol";
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

export function slash({ distance = 0, pan = 0 } = {}) {
  if (!audio()) return;
  const fall = Math.max(0, 1 - distance / 20);
  if (fall <= 0) return;
  burst(now(), { gain: 0.35 * fall, from: 900, to: 5000, duration: 0.18, type: "bandpass", pan });
}

export function equip() {
  if (!audio()) return;
  burst(now(), { gain: 0.18, from: 2600, to: 1200, duration: 0.05, type: "bandpass" });
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
