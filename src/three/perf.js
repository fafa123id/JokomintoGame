// Picks render settings once per page load so weaker phones stay smooth.
const cores = navigator.hardwareConcurrency || 8;
const memory = navigator.deviceMemory || 8;
const coarse = window.matchMedia("(pointer: coarse)").matches;
const tier = cores <= 4 || memory <= 4 ? "low" : coarse ? "mobile" : "high";

const SETTINGS = {
  low: { pixelRatio: 1.25, segments: { x: 56, y: 80 }, particles: 0.5, floaters: 0.4, fps: 30 },
  mobile: { pixelRatio: 1.5, segments: { x: 70, y: 100 }, particles: 0.75, floaters: 0.6, fps: 45 },
  high: { pixelRatio: 2, segments: { x: 84, y: 120 }, particles: 1, floaters: 1, fps: 60 },
};

export const perf = { tier, ...SETTINGS[tier] };

export function pixelRatio(max = perf.pixelRatio) {
  return Math.min(window.devicePixelRatio || 1, max);
}

// Returns true when a frame should be drawn for the given fps budget.
export function frameGate(fps = perf.fps) {
  const interval = 1000 / fps - 2;
  let last = 0;
  return (time) => {
    if (time - last < interval) return false;
    last = time;
    return true;
  };
}
