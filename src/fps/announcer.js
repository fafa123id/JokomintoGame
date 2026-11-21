import { isMuted, getVolume } from "../sound.js";

// One voice line per moment. Lines that fire together (a kill that also ends the round, a multi-kill
// while you become the last one standing) are gathered for a moment and only the most important
// plays. A bigger line cuts off a smaller one already playing; smaller lines arriving while
// something plays are dropped. The only exceptions are natural follow-ups (savage -> ace,
// switching sides -> match point), which wait for their lead-in to finish.
const PRIORITY = {
  kill: 1,
  "one-enemy-remaining": 2,
  "double-kill": 2,
  "triple-kill": 2.5,
  "quadra-kill": 3,
  "last-player-standing": 3,
  "bomb-planted": 3.5,
  "bomb-defused": 3.5,
  "switching-sides": 3.5,
  "match-point": 3.5,
  "round-win": 4,
  "round-lose": 4,
  pentakill: 5,
  ace: 5,
  "attackers-win": 6,
  "defenders-win": 6,
  "match-win": 6,
  "match-lose": 6,
};
const FOLLOW_UPS = { pentakill: ["ace"], "switching-sides": ["match-point"] };
// Optional lines: played when the file exists, silently skipped otherwise.
const OPTIONAL = new Set(["ace"]);
const GATHER_MS = 220;

const cache = new Map();
const missing = new Set();
let current = null;
let next = null;
let pending = null;
let gatherTimer = null;

function clip(name) {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(`/asset/announcer/${name}.mp3`);
    audio.preload = "auto";
    audio.addEventListener("error", () => OPTIONAL.has(name) && missing.add(name));
    cache.set(name, audio);
  }
  return audio;
}

export function preloadAnnouncer() {
  for (const name of Object.keys(PRIORITY)) clip(name).load();
}

function stop() {
  if (!current) return;
  const audio = clip(current);
  audio.onended = null;
  audio.pause();
  current = null;
}

function play(name) {
  stop();
  if (isMuted() || missing.has(name)) return finished();
  const audio = clip(name);
  current = name;
  audio.volume = 0.9 * getVolume("voice");
  audio.currentTime = 0;
  audio.onended = finished;
  audio.play().catch(finished);
}

function finished() {
  current = null;
  const follow = next;
  next = null;
  if (follow) play(follow);
}

function flush() {
  gatherTimer = null;
  const name = pending;
  pending = null;
  if (!name || (current && PRIORITY[name] <= PRIORITY[current])) return;
  if (!FOLLOW_UPS[name]?.includes(next)) next = null;
  play(name);
}

export function announce(name) {
  if (isMuted() || !(name in PRIORITY) || missing.has(name)) return;
  // A follow-up of whatever is playing (or about to) waits for it instead of competing.
  const lead = pending ?? current;
  if (lead && FOLLOW_UPS[lead]?.includes(name)) {
    next = name;
    return;
  }
  if (!pending || PRIORITY[name] > PRIORITY[pending]) pending = name;
  gatherTimer ??= setTimeout(flush, GATHER_MS);
}

export function stopAnnouncer() {
  clearTimeout(gatherTimer);
  gatherTimer = null;
  pending = null;
  next = null;
  stop();
}
