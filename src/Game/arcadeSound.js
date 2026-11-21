import { isMuted, getVolume } from "../sound.js";

// Card and dance sounds synthesized with Web Audio: no asset files, tiny CPU cost.
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
    master.gain.value = 0.6 * getVolume("effects");
    master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.3);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  master.gain.value = 0.6 * getVolume("effects");
  return ctx;
}

function tone(at, freq, { type = "sine", gain = 0.2, attack = 0.008, decay = 0.4, glideTo } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + decay);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(gain, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(env).connect(master);
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

function swish(at, duration, from, to, gain = 0.12) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.2;
  band.frequency.setValueAtTime(from, at);
  band.frequency.exponentialRampToValueAtTime(to, at + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(gain, at + duration * 0.3);
  env.gain.exponentialRampToValueAtTime(0.001, at + duration);
  src.connect(band).connect(env).connect(master);
  src.start(at, 0, duration + 0.02);
}

const now = () => ctx.currentTime + 0.01;

export function cardFlip() {
  if (!audio()) return;
  const t = now();
  swish(t, 0.14, 900, 3200);
  tone(t + 0.1, 1400, { gain: 0.05, decay: 0.06 });
}

export function cardMatch() {
  if (!audio()) return;
  const t = now();
  tone(t, 880, { gain: 0.16, decay: 0.5 });
  tone(t + 0.09, 1318.5, { gain: 0.16, decay: 0.7 });
  tone(t + 0.09, 2637, { gain: 0.03, decay: 0.25 });
}

export function cardMiss() {
  if (!audio()) return;
  const t = now();
  tone(t, 330, { type: "triangle", gain: 0.12, decay: 0.22, glideTo: 220 });
}

// One pleasant note per dance move (an A-major chord), so the pattern can be learned by ear.
const MOVE_NOTES = [440, 554.37, 659.25, 880];

export function moveTone(move, duration = 0.42) {
  if (!audio()) return;
  const t = now();
  tone(t, MOVE_NOTES[move], { type: "triangle", gain: 0.2, decay: duration });
  tone(t, MOVE_NOTES[move] * 2, { gain: 0.04, decay: duration * 0.6 });
}

export function roundUp() {
  if (!audio()) return;
  const t = now();
  [659.25, 830.61, 987.77].forEach((f, i) => tone(t + i * 0.08, f, { gain: 0.12, decay: 0.3 }));
}

export function fanfare() {
  if (!audio()) return;
  const t = now();
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.11, f, { type: "triangle", gain: 0.16, decay: 0.9 }));
  tone(t + 0.44, 1567.98, { gain: 0.05, decay: 1.1 });
}

export function failTone() {
  if (!audio()) return;
  const t = now();
  tone(t, 392, { type: "triangle", gain: 0.14, decay: 0.3, glideTo: 330 });
  tone(t + 0.22, 311.13, { type: "triangle", gain: 0.14, decay: 0.55, glideTo: 246.94 });
}
