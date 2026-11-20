import { sendEvent } from "../stateManager.js";
import { api, refreshPet } from "../api.js";
import { showMessage, updateContext } from "../components.js";
import { playCondition } from "../condition.js";
import { react, say, hush, stopReaction, gameFx, floatStats } from "../pet.js";
import { focusPet } from "./gameUi.js";
import { moveTone, roundUp, fanfare, failTone } from "./arcadeSound.js";

const PET = "charSimon";
const MOVE_NAMES = ["Tangan kiri", "Tangan kanan", "Lompat", "Goyang"];
const PRAISE = ["Bagus! 👏", "Hafal banget! 🧠", "Keren! 🔥", "Lanjut! 💃"];

let session = null;
let sequence = [];
let progress = 0;
let accepting = false;
let finished = false;
let queue = Promise.resolve();
let runId = 0;

const el = (id) => document.getElementById(id);
const pads = () => [...el("simonPads").querySelectorAll(".simon-pad")];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Joko speeds up as the pattern gets longer.
const stepMs = () => Math.max(380, 680 - sequence.length * 22);

const finishButton = () => document.querySelector('[data-action="simon-finish"]');

function setStatus(text) {
  el("simonStatus").textContent = text;
}

function setInput(enabled) {
  accepting = enabled;
  for (const pad of pads()) pad.disabled = !enabled;
  el("simonPads").classList.toggle("is-watching", !enabled && !finished);
}

function light(move, ms) {
  const pad = pads()[move];
  pad.classList.add("is-lit");
  moveTone(move, Math.min(0.5, ms / 1000));
  setTimeout(() => pad.classList.remove("is-lit"), ms);
}

async function showSequence() {
  const id = runId;
  setInput(false);
  setStatus("Watch Joko! 👀");
  await sleep(500);
  for (const move of sequence) {
    if (id !== runId) return;
    const ms = stepMs();
    react(PET, `pet-dance${move}`, ms);
    light(move, ms * 0.75);
    await sleep(ms);
  }
  if (id !== runId) return;
  progress = 0;
  setStatus("Your turn! Repeat the moves 🎯");
  setInput(true);
}

async function start() {
  if (!playCondition()) return;
  if (window.getGameService?.()?.state.value !== "playing") sendEvent("GAME_SELECTED");
  runId++;
  el("menuGame").style.display = "none";
  el("simonGame").style.display = "flex";
  document.querySelector('[data-action="simon-again"]').classList.add("hidden");
  finishButton().classList.add("hidden");
  stopReaction(PET);
  hush(PET);
  el(PET).src = "/asset/char/idle.png";
  finished = false;
  setInput(false);
  setStatus("Getting ready...");

  const res = await api("/api/game/start", { type: "simon" });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    sendEvent("BACK");
    return;
  }
  session = res;
  sequence = res.sequence;
  queue = Promise.resolve();
  updateContext();
  el("simonRound").textContent = res.round;
  el("simonWinRounds").textContent = res.rewards.winRounds;
  el("simonCoins").textContent = res.rewards.maxCoin;
  gameFx(PET, "ready");
  say(PET, "Ikuti gerakanku ya! 💃", 1600, { mood: "happy" });
  await sleep(900);
  showSequence();
}

function press(move) {
  if (!session || !accepting) return;
  const expected = sequence[progress];
  light(move, 220);
  progress++;

  if (move !== expected) {
    setInput(false);
    el("simonPads").classList.add("is-wrong");
    setTimeout(() => el("simonPads").classList.remove("is-wrong"), 500);
  } else if (progress === sequence.length) {
    setInput(false);
  }

  const sessionId = session.sessionId;
  queue = queue.then(() => api("/api/game/simon/press", { sessionId, move })).then(handle);
}

async function handle(res) {
  if (finished || !session) return;
  if (res.error) return stopOnError(res);
  if (res.status === "ok") return;
  if (res.status === "round") {
    sequence = res.sequence;
    el("simonRound").textContent = res.round;
    if (res.round - 1 >= session.rewards.winRounds) finishButton().classList.remove("hidden");
    roundUp();
    react(PET, "pet-squish", 500);
    say(PET, res.round - 1 === session.rewards.winRounds ? "Kamu menang! Lanjut atau akhiri? 🏆" : pick(PRAISE), 1400, { mood: "happy" });
    setStatus(`Nice! Round ${res.round} 🎉`);
    await sleep(900);
    return showSequence();
  }
  finish(res);
}

// The server and the pads are out of step after a failed request, so the run stops here.
function stopOnError(res) {
  finished = true;
  session = null;
  runId++;
  setInput(false);
  finishButton().classList.add("hidden");
  document.querySelector('[data-action="simon-again"]').classList.remove("hidden");
  setStatus("Connection problem, tap Play Again");
  if (!res.offline) showMessage(res.error, "error", 2500, true);
}

// Ends a winning run on the player's terms (rounds are otherwise unlimited).
function cashOut() {
  if (!session || finished) return;
  const sessionId = session.sessionId;
  runId++;
  setInput(false);
  finishButton().disabled = true;
  queue = queue
    .then(() => api("/api/game/simon/finish", { sessionId }))
    .then((res) => {
      finishButton().disabled = false;
      if (res.error) {
        showMessage(res.error, "error", 2000, true);
        return showSequence();
      }
      finish(res);
    });
}

function finish(res) {
  finished = true;
  session = null;
  runId++;
  setInput(false);
  finishButton().classList.add("hidden");
  document.querySelector('[data-action="simon-again"]').classList.remove("hidden");
  focusPet(PET);
  refreshPet().then(updateContext);

  const { score = 0, coin = 0, mood = 0, rounds = 0 } = res.reward ?? {};
  const stats = [
    score && { text: `+${score} pts`, tone: "purple" },
    coin && { text: `+${coin} 🪙`, tone: "gold" },
    mood && { text: `+${mood} 😊`, tone: "good" },
  ].filter(Boolean);

  if (res.outcome === "win") {
    fanfare();
    el(PET).src = "/asset/char/happy.png";
    gameFx(PET, "victory", { coins: Math.ceil(coin / 15) });
    say(PET, res.status === "finished" ? `Juara dansa! ${rounds} ronde! 🏆` : `Hebat! ${rounds} ronde! 🎉`, 2600, { mood: "happy" });
    setStatus(`You win! ${rounds} rounds · +${score} pts · +${coin} coin`);
  } else {
    failTone();
    el(PET).src = "/asset/char/wrong.png";
    gameFx(PET, "fail");
    const hint = res.expected !== undefined ? ` Harusnya: ${MOVE_NAMES[res.expected]}` : "";
    say(PET, res.status === "timeout" ? "Waktu habis! 😢" : `Ups, salah!${hint} 😅`, 2600, { mood: "sad" });
    setStatus(`Game over · ${rounds} rounds${score ? ` · +${score} pts` : ""}`);
    if (res.expected !== undefined) setTimeout(() => light(res.expected, 700), 300);
  }
  if (stats.length) floatStats(PET, stats);
}

function leave() {
  if (session) api("/api/game/end", { sessionId: session.sessionId });
  session = null;
  runId++;
  setInput(false);
  finishButton().classList.add("hidden");
}

export function initSimon() {
  document.querySelector('[data-action="simon"]')?.addEventListener("click", start);
  document.querySelector('[data-action="simon-again"]')?.addEventListener("click", start);
  finishButton()?.addEventListener("click", cashOut);
  for (const pad of pads()) {
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      press(Number(pad.dataset.move));
    });
    // Keyboard activation (Enter/Space) arrives as a click without a pointer.
    pad.addEventListener("click", (e) => e.detail === 0 && press(Number(pad.dataset.move)));
  }
  window.leaveSimon = leave;
}
