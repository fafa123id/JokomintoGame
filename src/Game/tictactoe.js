import { sendEvent } from "../stateManager.js";
import { api } from "../api.js";
import { showMessage, updateContext } from "../components.js";
import { markSound, resultSound } from "./xoxSound.js";
import { confirmDialog } from "../modal.js";
import { playCondition } from "../condition.js";
import { react, say, hush, stopReaction, gameFx, floatStats } from "../pet.js";
import { focusPet } from "./gameUi.js";

const PET_IMG = "charXox";
const SVG_NS = "http://www.w3.org/2000/svg";
const CENTERS = [50, 150, 250];

const THINKING = ["Hmm... 🤔", "Let me think...", "Ooh, tricky! 🧐", "Wait wait..."];
const TAUNTS = ["Your turn! 😼", "Hehe~ 😏", "Try this! ✍️", "Gotcha? 😜", "Not bad! 👀"];

let session = null;
let busy = false;

const el = (id) => document.getElementById(id);
const board = () => el("xoxBoard");
const cells = () => [...board().querySelectorAll(".xox-cell")];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function svg(viewBox, children) {
  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("viewBox", viewBox);
  root.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    root.appendChild(node);
  }
  return root;
}

function drawMark(cell, mark) {
  const target = cells()[cell];
  target.replaceChildren(
    mark === "X"
      ? svg("0 0 100 100", [
          ["line", { x1: 15, y1: 15, x2: 85, y2: 85, class: "xox-stroke xox-x", style: "--len: 100" }],
          ["line", { x1: 85, y1: 15, x2: 15, y2: 85, class: "xox-stroke xox-stroke--late xox-x", style: "--len: 100" }],
        ])
      : svg("0 0 100 100", [
          ["circle", { cx: 50, cy: 50, r: 36, class: "xox-stroke xox-o", style: "--len: 227", transform: "rotate(-90 50 50)" }],
        ])
  );
  target.disabled = true;
  target.dataset.mark = mark;
  target.setAttribute("aria-label", mark === "X" ? "Your mark" : "Joko's mark");
}

function drawWinLine(line) {
  const [a, , c] = line;
  const point = (i) => ({ x: CENTERS[i % 3], y: CENTERS[Math.floor(i / 3)] });
  const from = point(a);
  const to = point(c);
  const overlay = svg("0 0 300 300", [["line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y }]]);
  overlay.classList.add("xox-winline");
  board().appendChild(overlay);
}

async function petWrites(cell) {
  const pencil = board().querySelector(".xox-pencil");
  const target = cells()[cell];
  pencil.style.transform = `translate(${target.offsetLeft + target.offsetWidth * 0.45}px, ${target.offsetTop - 6}px)`;
  pencil.style.opacity = "1";
  await sleep(450);
  pencil.classList.add("is-writing");
  drawMark(cell, "O");
  markSound("O");
  await sleep(420);
  pencil.classList.remove("is-writing");
  pencil.style.opacity = "0";
}

function setBoardEnabled(enabled) {
  for (const cell of cells()) cell.disabled = !enabled || !!cell.dataset.mark;
}

function setStatus(text) {
  el("xoxStatus").textContent = text;
}

function resetBoard() {
  for (const cell of cells()) {
    cell.replaceChildren();
    delete cell.dataset.mark;
    cell.disabled = true;
    cell.setAttribute("aria-label", `Cell ${Number(cell.dataset.cell) + 1}`);
  }
  board().querySelector(".xox-winline")?.remove();
  board().classList.remove("is-shaking");
  el(PET_IMG).src = "/asset/char/idle.png";
  document.querySelector('[data-action="xox-again"]').classList.add("hidden");
  resignButton().classList.remove("hidden");
  stopReaction(PET_IMG);
  hush(PET_IMG);
}

async function start() {
  if (!playCondition()) return;
  if (window.getGameService?.()?.state.value !== "playing") sendEvent("GAME_SELECTED");
  el("menuGame").style.display = "none";
  el("xoxGame").style.display = "flex";
  resetBoard();
  setStatus("Getting ready...");

  const res = await api("/api/game/start", { type: "tictactoe" });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    sendEvent("BACK");
    return;
  }
  session = res;
  updateContext();
  el("xoxPoints").textContent = res.rewards.maxScore;
  el("xoxCoins").textContent = res.rewards.maxCoin;
  setStatus("Your turn! ❌");
  say(PET_IMG, "Ayo main! 😼", 1800, { mood: "happy" });
  gameFx(PET_IMG, "ready");
  setBoardEnabled(true);
}

const resignButton = () => document.querySelector('[data-action="xox-resign"]');

async function resign() {
  if (!session || busy) return;
  const ok = await confirmDialog({
    title: "Menyerah?",
    message: "Joko menang dan ronde ini selesai tanpa hadiah. Yakin mau resign?",
    confirmText: "🏳️ Resign",
    cancelText: "Lanjut main",
    image: "/asset/char/happy.png",
  });
  if (!ok || !session) return;
  const current = session;
  session = null;
  setBoardEnabled(false);
  await api("/api/game/end", { sessionId: current.sessionId });
  finish({ status: "resign" });
}

function finish(res) {
  session = null;
  if (res.winLine) drawWinLine(res.winLine);
  document.querySelector('[data-action="xox-again"]').classList.remove("hidden");
  resignButton().classList.add("hidden");
  updateContext();

  const { coin = 0, score = 0, mood = 0 } = res.reward ?? {};
  const rewards = [
    score && { text: `+${score} pts`, tone: "purple" },
    coin && { text: `+${coin} 🪙`, tone: "gold" },
    mood && { text: `${mood > 0 ? "+" : ""}${mood} 😊`, tone: mood > 0 ? "good" : "bad" },
  ].filter(Boolean);

  resultSound(res.status);
  focusPet(PET_IMG);

  if (res.status === "win") {
    el(PET_IMG).src = "/asset/char/sad.png";
    gameFx(PET_IMG, "victory", { coins: Math.ceil(coin / 15), cheer: false });
    say(PET_IMG, "Nooo! Kamu menang 😭", 2400, { mood: "sad" });
    setStatus(`You win! +${score} pts · +${coin} coin`);
  } else if (res.status === "lose") {
    el(PET_IMG).src = "/asset/char/happy.png";
    gameFx(PET_IMG, "victory", { coins: 0 });
    say(PET_IMG, "Hehe, aku menang! 😎", 2400, { mood: "happy" });
    board().classList.add("is-shaking");
    setStatus("Joko wins! Try again?");
  } else if (res.status === "resign") {
    el(PET_IMG).src = "/asset/char/happy.png";
    gameFx(PET_IMG, "victory", { coins: 0 });
    say(PET_IMG, "Yah, nyerah? Aku menang deh 😏", 2400, { mood: "happy" });
    setStatus("You resigned");
  } else if (res.status === "draw") {
    gameFx(PET_IMG, "ready");
    say(PET_IMG, "Seri! Tos dulu 🤝", 2200, { mood: "fresh" });
    setStatus(`Draw! +${score} pts · +${coin} coin`);
  } else {
    gameFx(PET_IMG, "fail");
    say(PET_IMG, "Waktu habis! ⏰", 2000, { mood: "sad" });
    setStatus("Time's up!");
  }
  if (rewards.length) floatStats(PET_IMG, rewards);
}

async function onCellClick(cell) {
  if (!session || busy || cells()[cell].dataset.mark) return;
  busy = true;
  setBoardEnabled(false);
  drawMark(cell, "X");
  markSound("X");
  react(PET_IMG, "pet-squish", 500);

  const res = await api("/api/game/move", { sessionId: session.sessionId, cell });
  if (res.error) {
    cells()[cell].replaceChildren();
    delete cells()[cell].dataset.mark;
    showMessage(res.error, "error", 1500, true);
    setBoardEnabled(true);
    busy = false;
    return;
  }

  if (res.petCell !== null && res.petCell !== undefined) {
    setStatus("Joko is thinking...");
    react(PET_IMG, "pet-think", 0);
    say(PET_IMG, pick(THINKING), 0);
    await sleep(650 + Math.random() * 500);
    stopReaction(PET_IMG);
    hush(PET_IMG);
    await petWrites(res.petCell);
  }

  busy = false;
  if (res.status === "playing") {
    say(PET_IMG, pick(TAUNTS), 1400);
    setStatus("Your turn! ❌");
    setBoardEnabled(true);
  } else {
    finish(res);
  }
}

function leave() {
  if (session) api("/api/game/end", { sessionId: session.sessionId });
  session = null;
  busy = false;
}

export { start as startTicTacToe };

export function initTicTacToe() {
  document.querySelector('[data-action="xox-again"]')?.addEventListener("click", start);
  resignButton()?.addEventListener("click", resign);
  for (const cell of cells()) {
    cell.addEventListener("click", () => onCellClick(Number(cell.dataset.cell)));
  }
  window.leaveTicTacToe = leave;
}
