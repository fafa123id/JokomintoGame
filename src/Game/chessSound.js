import { isMuted, getVolume } from "../sound.js";

// Wooden piece sounds synthesized with Web Audio: no asset files, tiny CPU cost.
let ctx = null;
let noise = null;
let master = null;

function audio() {
  if (isMuted()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) {
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.9 * getVolume("effects");
    master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.12);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  if (ctx.state === "suspended") ctx.resume();
  master.gain.value = 0.9 * getVolume("effects");
  return ctx;
}

const vary = (value, amount = 0.08) => value * (1 + (Math.random() * 2 - 1) * amount);

// One piece touching the board: a filtered click for the wood plus a short low "body" thump.
function knock(at, { gain = 0.6, tone = 1700, body = 170, decay = 0.07 } = {}) {
  const c = ctx;
  const click = c.createBufferSource();
  click.buffer = noise;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = vary(tone);
  band.Q.value = 2.2;
  const clickGain = c.createGain();
  clickGain.gain.setValueAtTime(gain, at);
  clickGain.gain.exponentialRampToValueAtTime(0.001, at + decay);
  click.connect(band).connect(clickGain).connect(master);
  click.start(at);
  click.stop(at + decay + 0.02);

  const thump = c.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(vary(body), at);
  thump.frequency.exponentialRampToValueAtTime(body * 0.55, at + 0.09);
  const thumpGain = c.createGain();
  thumpGain.gain.setValueAtTime(gain * 0.55, at);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
  thump.connect(thumpGain).connect(master);
  thump.start(at);
  thump.stop(at + 0.12);
}

function tone(at, frequency, { gain = 0.12, duration = 0.35, type = "sine" } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(env).connect(master);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

function play(fn) {
  if (!audio()) return;
  fn(ctx.currentTime + 0.005);
}

export const chessSound = {
  select: () => play((t) => knock(t, { gain: 0.18, tone: 2600, body: 260, decay: 0.035 })),
  move: () => play((t) => knock(t, { gain: 0.65 })),
  capture: () =>
    play((t) => {
      knock(t, { gain: 0.8, tone: 1400, body: 150, decay: 0.08 });
      knock(t + 0.055, { gain: 0.45, tone: 2300, body: 220, decay: 0.05 });
    }),
  castle: () =>
    play((t) => {
      knock(t, { gain: 0.6 });
      knock(t + 0.13, { gain: 0.55, tone: 1500 });
    }),
  check: () =>
    play((t) => {
      knock(t, { gain: 0.75, tone: 1900, body: 190 });
      tone(t + 0.04, 1318.5, { gain: 0.06, duration: 0.3 });
    }),
  illegal: () => play((t) => knock(t, { gain: 0.3, tone: 900, body: 110, decay: 0.05 })),
  win: () => play((t) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.11, f, { gain: 0.1, duration: 0.5, type: "triangle" }))),
  lose: () => play((t) => [392, 329.63, 261.63].forEach((f, i) => tone(t + i * 0.16, f, { gain: 0.1, duration: 0.55, type: "triangle" }))),
  draw: () => play((t) => [440, 440].forEach((f, i) => tone(t + i * 0.18, f, { gain: 0.08, duration: 0.4, type: "triangle" }))),
};

// Picks the right sound for a move returned by the server (chess.js flags).
export function moveSound(move) {
  if (!move) return;
  if (/[+#]$/.test(move.san ?? "")) chessSound.check();
  else if (move.flags?.includes("k") || move.flags?.includes("q")) chessSound.castle();
  else if (move.captured) chessSound.capture();
  else chessSound.move();
}
