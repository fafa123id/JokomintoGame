import { isMuted } from "./sound.js";

const DIR = "/asset/music";
const PLAYLISTS = {
  menu: ["menu-1.mp3", "menu-2.ogg", "menu-3.mp3"],
  word: ["word-1.mp3", "word-2.mp3"],
  image: ["image-1.ogg", "image-2.mp3"],
  xox: ["xox-1.mp3", "xox-2.mp3"],
  chess: ["chess-1.mp3", "chess-2.ogg"],
  memory: ["memory-1.mp3", "memory-2.mp3"],
  simon: ["simon-1.mp3", "simon-2.mp3"],
};
const GAME_VIEWS = {
  tebakKata: "word",
  tebakGambar: "image",
  xoxGame: "xox",
  chessGame: "chess",
  memoryGame: "memory",
  simonGame: "simon",
  versusGame: "versus",
};
const VOLUME = 0.32;
const SLEEP_VOLUME = 0.12;
const FADE_MS = 700;

const player = new Audio();
player.preload = "none";
player.dataset.music = "1";

let scene = "menu";
let order = {};
let unlocked = false;
let target = VOLUME;
let fadeTimer = null;

function playable(file) {
  const type = file.endsWith(".ogg") ? 'audio/ogg; codecs="vorbis"' : "audio/mpeg";
  return player.canPlayType(type) !== "";
}

const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

function nextTrack(name) {
  if (!order[name]?.length) order[name] = shuffle(PLAYLISTS[name].filter(playable));
  return order[name].shift();
}

function fadeTo(volume, done) {
  clearInterval(fadeTimer);
  const step = (volume - player.volume) / (FADE_MS / 50);
  if (!step) return done?.();
  fadeTimer = setInterval(() => {
    const next = player.volume + step;
    if ((step > 0 && next >= volume) || (step < 0 && next <= volume)) {
      player.volume = Math.min(1, Math.max(0, volume));
      clearInterval(fadeTimer);
      done?.();
    } else {
      player.volume = next;
    }
  }, 50);
}

function start(name) {
  const file = nextTrack(name);
  if (!file) return;
  player.src = `${DIR}/${file}`;
  player.volume = 0;
  player.play().then(() => fadeTo(target)).catch(() => {});
}

function canPlay() {
  return unlocked && !isMuted() && !document.hidden;
}

function switchScene(name) {
  if (name === scene && !player.paused) return;
  scene = name;
  if (!canPlay()) return;
  if (player.paused || !player.src) return start(name);
  fadeTo(0, () => start(name));
}

function resume() {
  if (!canPlay()) return;
  if (!player.src) return start(scene);
  player.play().then(() => fadeTo(target)).catch(() => {});
}

function setLevel(volume) {
  target = volume;
  if (!player.paused) fadeTo(volume);
}

function sceneFor(state) {
  if (state !== "playing") return "menu";
  const view = Object.keys(GAME_VIEWS).find((id) => document.getElementById(id)?.style.display === "flex");
  if (view === "versusGame") return document.getElementById(view).dataset.music || "xox";
  return view ? GAME_VIEWS[view] : scene;
}

export function initMusic() {
  player.addEventListener("ended", () => canPlay() && start(scene));
  player.addEventListener("error", () => canPlay() && start(scene));

  // Browsers only allow audio after a user gesture.
  const unlock = () => {
    unlocked = true;
    resume();
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });

  window.addEventListener("pet:state", (e) => {
    setLevel(e.detail === "sleep" ? SLEEP_VOLUME : VOLUME);
    // Game views become visible right after the state change.
    setTimeout(() => switchScene(sceneFor(e.detail)), 60);
  });

  window.addEventListener("sound:change", () => (isMuted() ? player.pause() : resume()));
  document.addEventListener("visibilitychange", () => (document.hidden ? player.pause() : resume()));
}
