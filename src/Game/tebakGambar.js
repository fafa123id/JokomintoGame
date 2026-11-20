import { sendEvent } from "../stateManager.js";
import { api, refreshPet } from "../api.js";
import { showMessage, playSoundEffect, stopAudio, updateContext } from "../components.js";
import { createPointsTicker } from "./points.js";
import { createTimerBar, isLowTime, shake, focusPet, answerFeedback, createRoundTimers } from "./gameUi.js";
import { say, gameFx, setNervous, floatStats } from "../pet.js";

const PET = "charTebakGambar";
const charTebakGambar = document.getElementById(PET);
const points = createPointsTicker("imagePoints", "imageCoins");
const timerBar = createTimerBar("imageTime");
const roundTimers = createRoundTimers();

let session = null;
let imageTimer = null;
let timeLeft = 30;
let busy = false;

const input = () => document.getElementById("inputTebakGambar");
const form = () => document.getElementById("tebakGambarForm");

function updatePoints(next) {
  if (!next) return;
  points.update(next);
  if (next.visibility !== undefined) {
    document.getElementById("imageVisibility").textContent = `${Math.round(next.visibility * 100)}%`;
  }
}

function showHintCost(cost) {
  const label = document.querySelector("#revealImageBtn [data-hint-cost]");
  if (label && cost) label.textContent = cost;
}

function setFormEnabled(enabled) {
  input().disabled = !enabled;
  document.getElementById("tebakGambarForm").querySelector('button[type="submit"]').disabled = !enabled;
  document.getElementById("revealImageBtn").disabled = !enabled;
}

async function pageTebakGambar() {
  roundTimers.clear();
  sendEvent("GAME_SELECTED");
  charTebakGambar.src = "/asset/char/idle.png";
  document.getElementById("menuGame").style.display = "none";
  document.getElementById("tebakGambar").style.display = "flex";
  setFormEnabled(false);
  clearTiles();
  document.getElementById("imageTime").textContent = "...";
  resetImageTimer();

  const res = await api("/api/game/start", { type: "image" });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    sendEvent("BACK");
    return;
  }
  session = res;
  tileBase = res.tileUrl;
  timeLeft = res.timeLeft;
  showHintCost(res.nextHintCost);
  updatePoints(res.points);
  updateContext();
  document.getElementById("imageCredit").classList.toggle("hidden", !res.credit);

  try {
    await updateTiles(session.revealed);
    document.getElementById("tebakGambar").classList.remove("hidden");
    document.getElementById("optionButton").classList.add("hidden");
    resetImageForm();
    playSoundEffect("ding");
    gameFx(PET, "ready");
    say(PET, "Gambar apa ini ya? 🧐", 1700, { mood: "happy" });
    timerBar.start(timeLeft);
    startImageTimer();
    input().focus();
  } catch (error) {
    console.error("Failed to load game:", error);
    showMessage("Failed to load game. Please try again.", "error");
    sendEvent("BACK");
  }
}

const cells = () => [...document.querySelectorAll("#imageGrid .image-cell")];
let tileBase = null;

function loadTile(img, url) {
  if (img.dataset.url === url) return Promise.resolve();
  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Image failed to load!"));
    img.dataset.url = url;
    img.src = url;
  });
}

function clearTiles() {
  cells().forEach((cell) => {
    const img = cell.querySelector(".tile-img");
    img.removeAttribute("src");
    delete img.dataset.url;
    const cover = cell.querySelector(".overlay-tile");
    cover.style.transitionDelay = "0ms";
    cover.classList.remove("is-open");
  });
}

// Tiles are fetched one by one, only after the server allows them.
async function updateTiles(revealed, { stagger = 70, base = tileBase } = {}) {
  if (!base) return;
  const opening = cells().filter((cell, index) => revealed.includes(index) && !cell.querySelector(".is-open"));
  await Promise.all(
    opening.map((cell) => loadTile(cell.querySelector(".tile-img"), `${base}/${cell.dataset.index}`).catch(() => {}))
  );
  opening.forEach((cell, order) => {
    const cover = cell.querySelector(".overlay-tile");
    cover.style.transitionDelay = `${order * stagger}ms`;
    cover.classList.add("is-open");
  });
}

const revealAll = () => updateTiles([...Array(9).keys()], { stagger: 90 });

const resetImageTimer = () => {
  timeLeft = 30;
  input().value = "";
  clearTimer();
  timerBar.reset();
  setNervous(PET, false);
};

function startImageTimer() {
  clearTimer();
  document.getElementById("imageTime").textContent = timeLeft;
  imageTimer = setInterval(async () => {
    timeLeft--;
    points.tick();
    timerBar.set(timeLeft);
    document.getElementById("imageTime").textContent = Math.max(0, timeLeft);
    playSoundEffect("tick");
    setNervous(PET, isLowTime(timeLeft));
    if (timeLeft === 5) say(PET, "Waktunya mepet! ⏰", 1400, { mood: "hungry" });
    if (timeLeft <= 0) {
      clearTimer();
      const res = session ? await api("/api/game/end", { sessionId: session.sessionId }) : {};
      roundOver(res.answer, "timeout", res.reward?.mood);
    }
  }, 1000);
}

function roundOver(answer, reason, moodGain = 0) {
  if (moodGain) {
    floatStats(PET, [{ text: `+${moodGain} 😊`, tone: "good" }]);
    refreshPet().then(updateContext);
  }
  clearTimer();
  setNervous(PET, false);
  session = null;
  setFormEnabled(false);
  revealAll();
  charTebakGambar.src = "/asset/char/wrong.png";
  playSoundEffect("error");
  answerFeedback(form(), answer ? `✗ Jawabannya: ${answer.toUpperCase()}` : "✗ Waktu habis", "bad");
  focusPet(PET);
  gameFx(PET, "fail");
  const lead = reason === "timeout" ? "Waktu habis!" : "Kesempatan habis!";
  say(PET, answer ? `${lead} Itu ${answer.toUpperCase()} 😢` : `${lead} 😢`, 2600, { mood: "sad" });
  roundTimers.later(() => sendEvent("LOSE"), 2800);
}

async function revealImageTile() {
  if (!session || busy) return;
  busy = true;
  const res = await api("/api/game/hint", { sessionId: session.sessionId });
  busy = false;
  if (res.result === "timeout") return roundOver(res.answer, "timeout", res.reward?.mood);
  if (res.error) {
    say(PET, res.error.replace(/!$/, "") + " 😅", 1800, { mood: "sad" });
    return;
  }
  session.revealed = res.revealed;
  showHintCost(res.nextHintCost);
  updatePoints(res.points);
  updateContext();
  updateTiles(session.revealed);
  playSoundEffect("ding");
  gameFx(PET, "hint");
  say(PET, "Kebuka satu! 💡", 1400, { mood: "fresh" });
  floatStats(PET, [{ text: `-${res.hintPaid} 🪙`, tone: "bad" }]);
}

document.getElementById("tebakGambarForm").addEventListener("submit", function (e) {
  e.preventDefault();
  checkImageAnswer();
});

async function checkImageAnswer() {
  const field = input();
  const answer = field.value.trim().toLowerCase();
  if (!session || busy || !answer) return;

  busy = true;
  const res = await api("/api/game/guess", { sessionId: session.sessionId, answer });
  busy = false;

  if (res.result === "win") {
    session = null;
    clearTimer();
    setNervous(PET, false);
    setFormEnabled(false);
    updateContext();
    revealAll();
    charTebakGambar.src = "/asset/char/happy.png";
    playSoundEffect("success");
    answerFeedback(form(), "✓ Benar!", "good");
    focusPet(PET);
    gameFx(PET, "victory", { coins: Math.ceil(res.reward.coin / 15) });
    say(PET, `Betul! +${res.reward.score} pts 🎉`, 2600, { mood: "happy" });
    floatStats(PET, [
      { text: `+${res.reward.score} pts`, tone: "purple" },
      { text: `+${res.reward.coin} 🪙`, tone: "gold" },
      { text: `+${res.reward.mood} 😊`, tone: "good" },
    ]);
    roundTimers.later(() => sendEvent("WIN"), 2600);
  } else if (res.result === "timeout") {
    roundOver(res.answer, "timeout", res.reward?.mood);
  } else if (res.result === "lose") {
    roundOver(res.answer, "lose", res.reward?.mood);
  } else if (res.result === "wrong") {
    updatePoints(res.points);
    updateContext();
    playSoundEffect("error");
    answerFeedback(form(), `✗ Salah! Sisa ${res.attemptsLeft}x`, "bad");
    gameFx(PET, "oops");
    shake(field);
    say(PET, `Bukan itu... sisa ${res.attemptsLeft}x 😣`, 1600, { mood: "sad" });
    charTebakGambar.src = "/asset/char/wrong.png";
    setTimeout(() => {
      if (session) charTebakGambar.src = "/asset/char/idle.png";
    }, 1600);
    field.value = "";
  } else if (res.error) {
    showMessage(res.error, "error", 1500, true);
  }
}

function returnToMenuFromImage() {
  roundTimers.clear();
  clearTimer();
  setNervous(PET, false);
  if (session) {
    api("/api/game/end", { sessionId: session.sessionId });
    session = null;
  }
  document.getElementById("tebakGambar").classList.add("hidden");
  document.getElementById("optionButton").classList.remove("hidden");
  resetImageForm();
}

function resetImageForm() {
  input().value = "";
  setFormEnabled(true);
}

function clearTimer() {
  if (imageTimer) {
    clearInterval(imageTimer);
    imageTimer = null;
    stopAudio();
  }
}

export { pageTebakGambar, revealImageTile, returnToMenuFromImage };

window.revealImageTile = revealImageTile;
