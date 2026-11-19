import { sendEvent } from "../stateManager.js";
import { api } from "../api.js";
import { showMessage, playSoundEffect, stopAudio } from "../components.js";
import { createPointsTicker, scoreSummary } from "./points.js";
import { celebrate, sulk } from "../pet.js";

let session = null;
let time = 20;
let gameTimer = null;
let busy = false;
const charTebakKata = document.getElementById("charTebakKata");
const points = createPointsTicker("wordPoints", "wordCoins");

function setFormEnabled(enabled) {
  document.getElementById("inputTebakKata").disabled = !enabled;
  document.getElementById("tebakKataForm").querySelector('button[type="submit"]').disabled = !enabled;
  document.querySelector('button[data-action="reveal-hint"]').disabled = !enabled;
}

async function pageTebakKata() {
  sendEvent("GAME_SELECTED");
  charTebakKata.src = "/asset/char/idle.png";
  document.getElementById("menuGame").style.display = "none";
  document.getElementById("tebakKata").style.display = "flex";
  document.getElementById("wordDisplay").innerHTML = "Loading word...";
  setFormEnabled(false);
  resetTimer();
  document.getElementById("time").innerHTML = "Loading...";

  const res = await api("/api/game/start", { type: "word" });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    sendEvent("BACK");
    return;
  }
  session = res;
  time = res.timeLeft;
  points.update(res.points);
  playSoundEffect("ding");
  updateDisplay();
  setFormEnabled(true);
  startTimer();
}

function updateDisplay() {
  if (session) document.getElementById("wordDisplay").textContent = session.masked.join(" ");
}

async function revealHint() {
  if (!session || busy) return;
  busy = true;
  const res = await api("/api/game/hint", { sessionId: session.sessionId });
  busy = false;
  if (res.result === "timeout") return onTimeUp(res.answer);
  if (res.error) {
    showMessage(res.error, "error", 1000, true);
    return;
  }
  session.masked = res.masked;
  points.update(res.points);
  showMessage("You've paid 20 coin for hint", "success", 1000);
  playSoundEffect("ding");
  updateDisplay();
}

const resetTimer = () => {
  time = 20;
  document.getElementById("inputTebakKata").value = "";
  stopTimer();
  points.reset();
};

const startTimer = () => {
  stopTimer();
  document.getElementById("time").innerHTML = time;
  gameTimer = setInterval(async () => {
    time--;
    points.tick();
    playSoundEffect("tick");
    if (time <= 0) {
      stopTimer();
      document.getElementById("time").innerHTML = "0";
      const res = session ? await api("/api/game/end", { sessionId: session.sessionId }) : {};
      onTimeUp(res.answer);
    } else {
      document.getElementById("time").innerHTML = time;
    }
  }, 1000);
};

function onTimeUp(answer) {
  stopTimer();
  session = null;
  setFormEnabled(false);
  showMessage(`Time up!${answer ? ` The word is ${answer}!` : ""}`, "error", 2000, true);
  charTebakKata.src = "/asset/char/wrong.png";
  setTimeout(() => sendEvent("BACK"), 2000);
}

const stopTimer = () => {
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
    stopAudio();
  }
};

const tebakKataSubmit = async () => {
  const input = document.getElementById("inputTebakKata");
  const guess = input.value.trim().toLowerCase();
  if (!session || busy || !guess) return;

  busy = true;
  const res = await api("/api/game/guess", { sessionId: session.sessionId, answer: guess });
  busy = false;

  if (res.result === "win") {
    session = null;
    resetTimer();
    charTebakKata.src = "/asset/char/happy.png";
    celebrate("charTebakKata", "Yeay, benar! 🎉");
    sendEvent("WIN");
    showMessage(
      `Correct! +${res.reward.coin} coin, +${res.reward.mood} mood, ${scoreSummary(res.scoring)}`,
      "success",
      3000,
      true
    );
  } else if (res.result === "timeout") {
    onTimeUp(res.answer);
  } else if (res.result === "lose") {
    stopTimer();
    session = null;
    setFormEnabled(false);
    charTebakKata.src = "/asset/char/wrong.png";
    showMessage(`Too many wrong answers! The word is ${res.answer}`, "error", 2000, true);
    setTimeout(() => sendEvent("BACK"), 2000);
  } else if (res.result === "wrong") {
    charTebakKata.src = "/asset/char/wrong.png";
    sulk("charTebakKata", "Salah... 😣");
    setTimeout(() => {
      charTebakKata.src = "/asset/char/idle.png";
    }, 2000);
    points.update(res.points);
    showMessage(`Wrong answer! ${res.attemptsLeft} attempt(s) left`, "error", 1500, true);
    input.value = "";
  } else if (res.error) {
    showMessage(res.error, "error", 1500, true);
  }
};

function backToMainMenuFromWord() {
  resetTimer();
  if (session) {
    api("/api/game/end", { sessionId: session.sessionId });
    session = null;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("tebakKataForm");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    tebakKataSubmit();
  });
});

export { pageTebakKata, backToMainMenuFromWord };

window.pageTebakKata = pageTebakKata;
window.submitGuess = tebakKataSubmit;
window.tebakKataSubmit = tebakKataSubmit;
window.revealHint = revealHint;
