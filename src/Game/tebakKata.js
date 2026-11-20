import { sendEvent } from "../stateManager.js";
import { api, refreshPet } from "../api.js";
import { showMessage, playSoundEffect, stopAudio, updateContext } from "../components.js";
import { createPointsTicker } from "./points.js";
import { createTimerBar, isLowTime, shake, renderWordTiles, renderLoadingTiles, focusPet, answerFeedback, createRoundTimers } from "./gameUi.js";
import { say, gameFx, setNervous, floatStats } from "../pet.js";

const PET = "charTebakKata";
const charTebakKata = document.getElementById(PET);
const points = createPointsTicker("wordPoints", "wordCoins");
const timerBar = createTimerBar("time");
const roundTimers = createRoundTimers();

let session = null;
let time = 20;
let gameTimer = null;
let busy = false;

const wordDisplay = () => document.getElementById("wordDisplay");
const input = () => document.getElementById("inputTebakKata");
const form = () => document.getElementById("tebakKataForm");

function showHintCost(cost) {
  const label = document.querySelector('button[data-action="reveal-hint"] [data-hint-cost]');
  if (label && cost) label.textContent = cost;
}

function setFormEnabled(enabled) {
  input().disabled = !enabled;
  document.getElementById("tebakKataForm").querySelector('button[type="submit"]').disabled = !enabled;
  document.querySelector('button[data-action="reveal-hint"]').disabled = !enabled;
}

async function pageTebakKata() {
  roundTimers.clear();
  sendEvent("GAME_SELECTED");
  charTebakKata.src = "/asset/char/idle.png";
  document.getElementById("menuGame").style.display = "none";
  document.getElementById("tebakKata").style.display = "flex";
  renderLoadingTiles(wordDisplay());
  setFormEnabled(false);
  resetTimer();
  document.getElementById("time").textContent = "...";

  const res = await api("/api/game/start", { type: "word" });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    sendEvent("BACK");
    return;
  }
  session = res;
  time = res.timeLeft;
  showHintCost(res.nextHintCost);
  points.update(res.points);
  updateContext();
  playSoundEffect("ding");
  renderWordTiles(wordDisplay(), session.masked);
  gameFx(PET, "ready");
  say(PET, "Ayo tebak! 🤔", 1600, { mood: "happy" });
  setFormEnabled(true);
  timerBar.start(time);
  startTimer();
  input().focus();
}

async function revealHint() {
  if (!session || busy) return;
  busy = true;
  const res = await api("/api/game/hint", { sessionId: session.sessionId });
  busy = false;
  if (res.result === "timeout") return onRoundOver(res.answer, "timeout", res.reward?.mood);
  if (res.error) {
    say(PET, res.error.replace(/!$/, "") + " 😅", 1800, { mood: "sad" });
    return;
  }
  session.masked = res.masked;
  showHintCost(res.nextHintCost);
  points.update(res.points);
  updateContext();
  playSoundEffect("ding");
  renderWordTiles(wordDisplay(), session.masked);
  gameFx(PET, "hint");
  say(PET, "Nih petunjuknya! 💡", 1500, { mood: "fresh" });
  floatStats(PET, [{ text: `-${res.hintPaid} 🪙`, tone: "bad" }]);
}

const resetTimer = () => {
  time = 20;
  input().value = "";
  stopTimer();
  points.reset();
  timerBar.reset();
  setNervous(PET, false);
};

const startTimer = () => {
  stopTimer();
  document.getElementById("time").textContent = time;
  gameTimer = setInterval(async () => {
    time--;
    points.tick();
    timerBar.set(time);
    playSoundEffect("tick");
    setNervous(PET, isLowTime(time));
    if (time === 5) say(PET, "Cepetan! ⏰", 1400, { mood: "hungry" });
    if (time <= 0) {
      stopTimer();
      document.getElementById("time").textContent = "0";
      const res = session ? await api("/api/game/end", { sessionId: session.sessionId }) : {};
      onRoundOver(res.answer, "timeout", res.reward?.mood);
    } else {
      document.getElementById("time").textContent = time;
    }
  }, 1000);
};

function onRoundOver(answer, reason, moodGain = 0) {
  if (moodGain) {
    floatStats(PET, [{ text: `+${moodGain} 😊`, tone: "good" }]);
    refreshPet().then(updateContext);
  }
  stopTimer();
  setNervous(PET, false);
  session = null;
  setFormEnabled(false);
  charTebakKata.src = "/asset/char/wrong.png";
  if (answer) renderWordTiles(wordDisplay(), [...answer], { state: "answer" });
  playSoundEffect("error");
  answerFeedback(form(), answer ? `✗ Jawabannya: ${answer.toUpperCase()}` : "✗ Waktu habis", "bad");
  focusPet(PET);
  gameFx(PET, "fail");
  const lead = reason === "timeout" ? "Waktu habis!" : "Kesempatan habis!";
  say(PET, answer ? `${lead} Jawabannya ${answer.toUpperCase()} 😢` : `${lead} 😢`, 2600, { mood: "sad" });
  roundTimers.later(() => sendEvent("BACK"), 2800);
}

const stopTimer = () => {
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
    stopAudio();
  }
};

const tebakKataSubmit = async () => {
  const field = input();
  const guess = field.value.trim().toLowerCase();
  if (!session || busy || !guess) return;

  busy = true;
  const res = await api("/api/game/guess", { sessionId: session.sessionId, answer: guess });
  busy = false;

  if (res.result === "win") {
    session = null;
    stopTimer();
    setNervous(PET, false);
    setFormEnabled(false);
    updateContext();
    charTebakKata.src = "/asset/char/happy.png";
    renderWordTiles(wordDisplay(), [...guess], { state: "win" });
    playSoundEffect("success");
    answerFeedback(form(), "✓ Benar!", "good");
    focusPet(PET);
    gameFx(PET, "victory", { coins: Math.ceil(res.reward.coin / 15) });
    say(PET, `Yeay, benar! +${res.reward.score} pts 🎉`, 2600, { mood: "happy" });
    floatStats(PET, [
      { text: `+${res.reward.score} pts`, tone: "purple" },
      { text: `+${res.reward.coin} 🪙`, tone: "gold" },
      { text: `+${res.reward.mood} 😊`, tone: "good" },
    ]);
    roundTimers.later(() => {
      resetTimer();
      sendEvent("WIN");
    }, 2400);
  } else if (res.result === "timeout") {
    onRoundOver(res.answer, "timeout", res.reward?.mood);
  } else if (res.result === "lose") {
    onRoundOver(res.answer, "lose", res.reward?.mood);
  } else if (res.result === "wrong") {
    charTebakKata.src = "/asset/char/wrong.png";
    playSoundEffect("error");
    answerFeedback(form(), `✗ Salah! Sisa ${res.attemptsLeft}x`, "bad");
    gameFx(PET, "oops");
    shake(field);
    say(PET, `Salah... sisa ${res.attemptsLeft}x 😣`, 1600, { mood: "sad" });
    setTimeout(() => {
      if (session) charTebakKata.src = "/asset/char/idle.png";
    }, 1600);
    points.update(res.points);
    field.value = "";
  } else if (res.error) {
    showMessage(res.error, "error", 1500, true);
  }
};

function backToMainMenuFromWord() {
  roundTimers.clear();
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
