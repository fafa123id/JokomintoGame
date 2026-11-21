import { isMuted, getVolume } from "./sound.js";

// Cat-like purr synthesized with Web Audio: low filtered noise, amplitude-modulated at ~24 Hz,
// with a slow in/out "breathing" swell.
let ctx = null;
let purr = null;

function context() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx ??= new Ctx();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function noiseBuffer(c) {
  const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
    data[i] = last * 3.5;
  }
  return buffer;
}

export function startPurr() {
  if (purr || isMuted()) return;
  const c = context();
  if (!c) return;

  const source = c.createBufferSource();
  source.buffer = noiseBuffer(c);
  source.loop = true;

  const lowpass = c.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 260;
  lowpass.Q.value = 0.8;

  const flutter = c.createGain();
  flutter.gain.value = 0.55;
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 24;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 0.45;
  lfo.connect(lfoDepth).connect(flutter.gain);

  const breath = c.createGain();
  breath.gain.value = 0.0001;
  const level = c.createGain();
  level.gain.value = getVolume("effects");
  source.connect(lowpass).connect(flutter).connect(breath).connect(level).connect(c.destination);

  const now = c.currentTime;
  source.start(now);
  lfo.start(now);

  const schedule = () => {
    const t = c.currentTime;
    breath.gain.cancelScheduledValues(t);
    breath.gain.setValueAtTime(Math.max(0.0001, breath.gain.value), t);
    breath.gain.exponentialRampToValueAtTime(0.5, t + 0.7);
    breath.gain.exponentialRampToValueAtTime(0.22, t + 1.5);
    lfo.frequency.setValueAtTime(24, t);
    lfo.frequency.linearRampToValueAtTime(21, t + 1.5);
  };
  schedule();
  const timer = setInterval(schedule, 1500);
  purr = { source, lfo, breath, timer };
}

export function stopPurr() {
  if (!purr || !ctx) return;
  const { source, lfo, breath, timer } = purr;
  purr = null;
  clearInterval(timer);
  const t = ctx.currentTime;
  breath.gain.cancelScheduledValues(t);
  breath.gain.setValueAtTime(Math.max(0.0001, breath.gain.value), t);
  breath.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  source.stop(t + 0.45);
  lfo.stop(t + 0.45);
}
