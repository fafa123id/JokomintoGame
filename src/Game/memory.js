import { sendEvent } from "../stateManager.js";
import { api, refreshPet } from "../api.js";
import { showMessage, playSoundEffect, updateContext } from "../components.js";
import { playCondition } from "../condition.js";
import { react, say, hush, stopReaction, gameFx, floatStats, setNervous } from "../pet.js";
import { createTimerBar, isLowTime, focusPet } from "./gameUi.js";
import { cardFlip, cardMatch, cardMiss, fanfare, failTone } from "./arcadeSound.js";

const PET = "charMemory";
const CARDS = 16;
const FACES = { biskuit: "🍪", roti: "🍞", nasigoreng: "🍛", pizza: "🍕", steak: "🥩", normal: "🧼", fragrance: "🌸", premium: "🫧" };
const FACE_NAMES = { biskuit: "cookie", roti: "bread", nasigoreng: "fried rice", pizza: "pizza", steak: "steak", normal: "soap", fragrance: "flower soap", premium: "bubbles" };
const FLIP_MS = 450;
const MISS_SHOW_MS = 900;
const CHEERS = ["Pas! 🎉", "Ingatanmu tajam! 🧠", "Mantap! ✨", "Cocok! 😻"];
const MISSES = ["Hampir! 😅", "Bukan pasangannya~", "Ingat-ingat lagi 🤔", "Hmm... 🙈"];

let session = null;
let busy = false;
let timer = null;
let timeLeft = 0;
let streak = 0;
let runId = 0;

const el = (id) => document.getElementById(id);
const cards = () => [...el("memoryBoard").querySelectorAll(".memory-card")];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timerBar = createTimerBar("memoryTime");

function buildBoard() {
  el("memoryBoard").replaceChildren(
    ...Array.from({ length: CARDS }, (_, i) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "memory-card";
      card.dataset.index = i;
      card.disabled = true;
      card.setAttribute("aria-label", `Card ${i + 1}`);
      card.innerHTML = `<span class="memory-card-inner"><span class="memory-face memory-face--back">🐰</span><span class="memory-face memory-face--front"><span class="memory-emoji"></span></span></span>`;
      card.addEventListener("click", () => flip(i));
      return card;
    })
  );
}

function showFace(index, face) {
  const card = cards()[index];
  card.querySelector(".memory-emoji").textContent = FACES[face] ?? "❓";
  card.classList.add("is-open");
  card.setAttribute("aria-label", `Card ${index + 1}: ${FACE_NAMES[face] ?? face}`);
}

function hideFace(index) {
  const card = cards()[index];
  card.classList.remove("is-open", "is-miss");
  card.setAttribute("aria-label", `Card ${index + 1}`);
  // Clear the face once the card has turned back over.
  setTimeout(() => {
    if (!card.classList.contains("is-open")) card.querySelector(".memory-emoji").textContent = "";
  }, 450);
}

function setEnabled(enabled) {
  for (const card of cards()) card.disabled = !enabled || card.classList.contains("is-matched");
}

function setStatus(text) {
  el("memoryStatus").textContent = text;
}

function clearTimer() {
  clearInterval(timer);
  timer = null;
  setNervous(PET, false);
}

function startTimer() {
  clearTimer();
  timerBar.start(timeLeft);
  el("memoryTime").textContent = timeLeft;
  timer = setInterval(async () => {
    timeLeft--;
    el("memoryTime").textContent = Math.max(0, timeLeft);
    timerBar.set(timeLeft);
    setNervous(PET, isLowTime(timeLeft));
    if (timeLeft <= 10 && timeLeft > 0) playSoundEffect("tick");
    if (timeLeft === 10) say(PET, "Cepat, waktunya mepet! ⏰", 1500, { mood: "hungry" });
    if (timeLeft <= 0) {
      clearTimer();
      if (!session) return;
      const res = await api("/api/game/end", { sessionId: session.sessionId });
      lose(res.reward?.mood);
    }
  }, 1000);
}

async function start() {
  if (!playCondition()) return;
  if (window.getGameService?.()?.state.value !== "playing") sendEvent("GAME_SELECTED");
  el("menuGame").style.display = "none";
  el("memoryGame").style.display = "flex";
  document.querySelector('[data-action="memory-again"]').classList.add("hidden");
  stopReaction(PET);
  hush(PET);
  el(PET).src = "/asset/char/idle.png";
  buildBoard();
  setStatus("Shuffling cards...");
  el("memoryMoves").textContent = "0";
  streak = 0;
  const id = ++runId;

  const res = await api("/api/game/start", { type: "memory" });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    sendEvent("BACK");
    return;
  }
  session = res;
  updateContext();
  el("memoryCoins").textContent = res.rewards.maxCoin;
  const previewMs = res.preview ? res.previewMs : 0;
  el("memoryTime").textContent = Math.max(0, res.timeLeft - Math.ceil(previewMs / 1000));
  if (res.preview) await preview(res.preview, previewMs, id);
  if (id !== runId || !session) return;
  timeLeft = Math.max(1, res.timeLeft - Math.ceil(previewMs / 1000));
  setStatus("Find the pairs! 🃏");
  say(PET, "Sekarang cari pasangannya! 🔍", 1500, { mood: "happy" });
  setEnabled(true);
  startTimer();
}

// All cards face up for a few seconds, then they turn over together.
async function preview(deck, ms, id) {
  gameFx(PET, "ready");
  say(PET, "Hafalkan posisinya! 🧠", 1800, { mood: "happy" });
  deck.forEach((face, i) => setTimeout(() => id === runId && showFace(i, face), i * 40));
  cardFlip();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (id !== runId) return;
    setStatus(`Memorize! ${Math.ceil((end - Date.now()) / 1000)}... 👀`);
    await sleep(Math.min(250, end - Date.now()));
  }
  if (id !== runId) return;
  cardFlip();
  for (let i = 0; i < deck.length; i++) hideFace(i);
  await sleep(450);
}

async function flip(index) {
  const card = cards()[index];
  if (!session || busy || card.classList.contains("is-open") || card.classList.contains("is-matched")) return;
  busy = true;
  cardFlip();
  const res = await api("/api/game/memory/flip", { sessionId: session.sessionId, index });
  if (res.error) {
    busy = false;
    if (!res.offline) showMessage(res.error, "error", 2000, true);
    return;
  }
  if (res.status === "timeout") {
    busy = false;
    return lose(res.reward?.mood);
  }

  showFace(index, res.face);
  if (res.status === "open") {
    busy = false;
    return;
  }

  el("memoryMoves").textContent = res.moves;
  const [first, second] = res.pair;
  if (res.match) {
    streak++;
    for (const i of res.pair) cards()[i].classList.add("is-matched");
    await sleep(120);
    cardMatch();
    react(PET, "pet-squish", 500);
    if (streak >= 2 || Math.random() < 0.4) say(PET, streak >= 2 ? `Combo ${streak}x! 🔥` : pick(CHEERS), 1100, { mood: "happy" });
  } else {
    streak = 0;
    await sleep(FLIP_MS);
    cards()[first].classList.add("is-miss");
    cards()[second].classList.add("is-miss");
    cardMiss();
    react(PET, "pet-sigh", 900);
    if (Math.random() < 0.35) say(PET, pick(MISSES), 1100, { mood: "sad" });
    await sleep(MISS_SHOW_MS);
    hideFace(first);
    hideFace(second);
  }

  if (res.status === "win") return win(res);
  setEnabled(true);
  busy = false;
}

function finish() {
  session = null;
  busy = false;
  clearTimer();
  setEnabled(false);
  document.querySelector('[data-action="memory-again"]').classList.remove("hidden");
  focusPet(PET);
  refreshPet().then(updateContext);
}

function win(res) {
  const { score, coin, mood } = res.reward;
  finish();
  fanfare();
  el(PET).src = "/asset/char/happy.png";
  gameFx(PET, "victory", { coins: Math.ceil(coin / 15) });
  say(PET, `Semua ketemu dalam ${res.moves} langkah! 🎉`, 2600, { mood: "happy" });
  setStatus(`You win! +${score} pts · +${coin} coin`);
  const stats = [
    score && { text: `+${score} pts`, tone: "purple" },
    coin && { text: `+${coin} 🪙`, tone: "gold" },
    mood && { text: `+${mood} 😊`, tone: "good" },
  ].filter(Boolean);
  if (stats.length) floatStats(PET, stats);
}

function lose(moodGain = 0) {
  finish();
  failTone();
  el(PET).src = "/asset/char/wrong.png";
  gameFx(PET, "fail");
  say(PET, "Waktu habis! Coba lagi yuk 😢", 2400, { mood: "sad" });
  setStatus("Time's up!");
  if (moodGain) floatStats(PET, [{ text: `+${moodGain} 😊`, tone: "good" }]);
}

function leave() {
  if (session) api("/api/game/end", { sessionId: session.sessionId });
  runId++;
  session = null;
  busy = false;
  clearTimer();
}

export function initMemory() {
  document.querySelector('[data-action="memory"]')?.addEventListener("click", start);
  document.querySelector('[data-action="memory-again"]')?.addEventListener("click", start);
  window.leaveMemory = leave;
}
