import { isMuted } from "../sound.js";

// Soft pencil and marimba sounds for tic-tac-toe, synthesized with Web Audio.
let ctx = null;
let master = null;
let grain = null;

function audio() {
  if (isMuted()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) {
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.4);
    grain = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = grain.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function stroke(at, duration, from, to) {
  const src = ctx.createBufferSource();
  src.buffer = grain;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(from, at);
  band.frequency.linearRampToValueAtTime(to, at + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(0.16, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
  src.connect(band).connect(gain).connect(master);
  src.start(at, Math.random() * 0.2, duration + 0.02);
}

function mallet(at, freq, { gain = 0.22, decay = 0.9 } = {}) {
  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.value = freq;
  const overtone = ctx.createOscillator();
  overtone.type = "sine";
  overtone.frequency.value = freq * 4;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  const shimmer = ctx.createGain();
  shimmer.gain.setValueAtTime(gain * 0.25, at);
  shimmer.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  body.connect(env).connect(master);
  overtone.connect(shimmer).connect(master);
  for (const osc of [body, overtone]) {
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

// "X" is two crossing strokes, "O" one round stroke.
export function markSound(mark) {
  if (!audio()) return;
  const t = ctx.currentTime;
  if (mark === "X") {
    stroke(t, 0.11, 2600, 3400);
    stroke(t + 0.14, 0.11, 3200, 2500);
  } else {
    stroke(t, 0.24, 2200, 3000);
  }
}

const NOTES = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, A4: 440, F4: 349.23, D5: 587.33, G4: 392 };

export function resultSound(status) {
  if (!audio()) return;
  const t = ctx.currentTime + 0.02;
  const play = (notes, gap, opts) => notes.forEach((n, i) => mallet(t + i * gap, NOTES[n], opts));
  if (status === "win") play(["C5", "E5", "G5", "C6"], 0.11, { decay: 1.1 });
  else if (status === "draw") play(["G4", "D5"], 0.16, { decay: 0.8 });
  else play(["E5", "C5", "A4"], 0.18, { gain: 0.16, decay: 0.7 });
}
