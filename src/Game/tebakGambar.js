import { sendEvent } from "../stateManager.js";
import { api } from "../api.js";
import { showMessage, playSoundEffect, stopAudio } from "../components.js";
import { createPointsTicker, scoreSummary } from "./points.js";
import { celebrate, sulk } from "../pet.js";

let session = null;
let imageTimer = null;
let timeLeft = 30;
let busy = false;
const charTebakGambar = document.getElementById("charTebakGambar");
const points = createPointsTicker("imagePoints", "imageCoins");

function updatePoints(next) {
  if (!next) return;
  points.update(next);
  if (next.visibility !== undefined) {
    document.getElementById("imageVisibility").textContent = `${Math.round(next.visibility * 100)}%`;
  }
}

function setFormEnabled(enabled) {
  document.getElementById("inputTebakGambar").disabled = !enabled;
  document.getElementById("tebakGambarForm").querySelector('button[type="submit"]').disabled = !enabled;
  document.getElementById("revealImageBtn").disabled = !enabled;
}

async function pageTebakGambar() {
  sendEvent("GAME_SELECTED");
  charTebakGambar.src = "/asset/char/idle.png";
  document.getElementById("menuGame").style.display = "none";
  document.getElementById("tebakGambar").style.display = "flex";
  setFormEnabled(false);
  document.getElementById("gameImage").src = "";
  document.getElementById("gameImage").alt = "Loading image...";
  document.getElementById("imageTime").innerHTML = "Loading...";
  resetImageTimer();

  const res = await api("/api/game/start", { type: "image" });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    sendEvent("BACK");
    return;
  }
  session = res;
  timeLeft = res.timeLeft;
  updatePoints(res.points);
  document.getElementById("imageCredit").classList.toggle("hidden", !res.credit);

  try {
    updateTiles([]);
    await loadImage(res.imageUrl);
    updateTiles(session.revealed);
    document.getElementById("tebakGambar").classList.remove("hidden");
    document.getElementById("optionButton").classList.add("hidden");
    resetImageForm();
    playSoundEffect("ding");
    startImageTimer();
  } catch (error) {
    console.error("Failed to load game:", error);
    showMessage("Failed to load game. Please try again.", "error");
    sendEvent("BACK");
  }
}

function loadImage(url) {
  const img = document.getElementById("gameImage");
  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Image failed to load!"));
    img.alt = "Guess this image";
    img.src = url;
  });
}

function updateTiles(revealed) {
  document.querySelectorAll(".overlay-tile").forEach((tile, index) => {
    tile.style.opacity = revealed.includes(index) ? "0" : "1";
  });
}

const resetImageTimer = () => {
  timeLeft = 30;
  document.getElementById("inputTebakGambar").value = "";
  clearTimer();
};

function startImageTimer() {
  clearTimer();
  document.getElementById("imageTime").textContent = timeLeft;
  imageTimer = setInterval(async () => {
    timeLeft--;
    points.tick();
    document.getElementById("imageTime").textContent = Math.max(0, timeLeft);
    playSoundEffect("tick");
    if (timeLeft <= 0) {
      clearTimer();
      const res = session ? await api("/api/game/end", { sessionId: session.sessionId }) : {};
      timeUp(res.answer);
    }
  }, 1000);
}

function timeUp(answer) {
  clearTimer();
  session = null;
  showMessage(`Time up!${answer ? ` The answer is ${answer}` : ""}`, "error", 3000, true);
  sendEvent("LOSE");
  setFormEnabled(false);
  charTebakGambar.src = "/asset/char/wrong.png";
}

async function revealImageTile() {
  if (!session || busy) return;
  busy = true;
  const res = await api("/api/game/hint", { sessionId: session.sessionId });
  busy = false;
  if (res.result === "timeout") return timeUp(res.answer);
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    return;
  }
  session.revealed = res.revealed;
  updatePoints(res.points);
  updateTiles(session.revealed);
  showMessage("Tile opened! -20 coin", "success", 1500);
  playSoundEffect("ding");
}

document.getElementById("tebakGambarForm").addEventListener("submit", function (e) {
  e.preventDefault();
  checkImageAnswer();
});

async function checkImageAnswer() {
  const input = document.getElementById("inputTebakGambar");
  const answer = input.value.trim().toLowerCase();
  if (!session || busy || !answer) return;

  busy = true;
  const res = await api("/api/game/guess", { sessionId: session.sessionId, answer });
  busy = false;

  if (res.result === "win") {
    session = null;
    clearTimer();
    charTebakGambar.src = "/asset/char/happy.png";
    celebrate("charTebakGambar", "Yeay, benar! 🎉");
    showMessage(`Correct! +${res.reward.coin} coin, +${res.reward.mood} mood, ${scoreSummary(res.scoring)}`, "success", 3000, true);
    sendEvent("WIN");
  } else if (res.result === "timeout") {
    timeUp(res.answer);
  } else if (res.result === "lose") {
    clearTimer();
    session = null;
    setFormEnabled(false);
    charTebakGambar.src = "/asset/char/wrong.png";
    showMessage(`Too many wrong answers! The answer is ${res.answer}`, "error", 3000, true);
    sendEvent("LOSE");
  } else if (res.result === "wrong") {
    updatePoints(res.points);
    showMessage(`Wrong! -5 mood, ${res.attemptsLeft} attempt(s) left`, "error", 2000, true);
    charTebakGambar.src = "/asset/char/wrong.png";
    sulk("charTebakGambar", "Bukan itu... 😣");
    setTimeout(() => {
      charTebakGambar.src = "/asset/char/idle.png";
    }, 2000);
    input.value = "";
  } else if (res.error) {
    showMessage(res.error, "error", 1500, true);
  }
}

function returnToMenuFromImage() {
  clearTimer();
  if (session) {
    api("/api/game/end", { sessionId: session.sessionId });
    session = null;
  }
  document.getElementById("tebakGambar").classList.add("hidden");
  document.getElementById("optionButton").classList.remove("hidden");
  resetImageForm();
}

function resetImageForm() {
  document.getElementById("inputTebakGambar").value = "";
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
