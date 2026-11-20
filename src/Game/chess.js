import { sendEvent } from "../stateManager.js";
import { confirmDialog } from "../modal.js";
import { api } from "../api.js";
import { showMessage, updateContext } from "../components.js";
import { playCondition } from "../condition.js";
import { react, say, hush, stopReaction, gameFx, floatStats } from "../pet.js";
import { focusPet } from "./gameUi.js";
import { chessSound, moveSound } from "./chessSound.js";

const PET_IMG = "charChess";
const FILES = "abcdefgh";
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const SLIDE_MS = 220;

const THINKING = ["Hmm... 🤔", "Strategi dulu...", "Tunggu ya ♟️", "Biar kupikir..."];
const PET_CAPTURES = ["Nyam! Bidakmu kumakan 😏", "Hap! Punyaku sekarang 😼", "Kena kamu! 😆"];
const PLAYER_CAPTURES = ["Aduh! 😖", "Yah, bidakku... 😢", "Hmph, bagus juga 😤"];

let session = null;
let board = [];
let legal = {};
let selected = null;
let lastMove = null;
let busy = false;

const el = (id) => document.getElementById(id);
const boardEl = () => el("chessBoard");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function parseFen(fen) {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const squares = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) squares.push(null);
      else squares.push({ type: ch.toLowerCase(), color: ch === ch.toLowerCase() ? "b" : "w" });
    }
    return squares;
  });
}

const toIndex = (square) => ({ row: 8 - Number(square[1]), col: FILES.indexOf(square[0]) });
const squareAt = (row, col) => `${FILES[col]}${8 - row}`;
const pieceAt = (square) => {
  const { row, col } = toIndex(square);
  return board[row]?.[col] ?? null;
};
const cell = (square) => boardEl().querySelector(`[data-square="${square}"]`);

function buildBoard() {
  const root = boardEl();
  if (root.childElementCount) return;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = squareAt(row, col);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chess-square ${(row + col) % 2 ? "is-dark" : "is-light"}`;
      button.dataset.square = square;
      button.setAttribute("aria-label", square);
      if (col === 0) button.dataset.rank = 8 - row;
      if (row === 7) button.dataset.file = FILES[col];
      button.addEventListener("click", () => onSquare(square));
      root.appendChild(button);
    }
  }
}

function render({ check = false } = {}) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = squareAt(row, col);
      const piece = board[row][col];
      const target = cell(square);
      target.replaceChildren();
      if (piece) {
        const span = document.createElement("span");
        span.className = `chess-piece chess-piece--${piece.color}`;
        span.textContent = `${GLYPH[piece.type]}︎`;
        target.appendChild(span);
      }
      const isTarget = !!selected && (legal[selected] ?? []).includes(square);
      target.classList.toggle("is-selected", square === selected);
      target.classList.toggle("is-target", isTarget && !piece);
      target.classList.toggle("is-capture", isTarget && !!piece);
      target.classList.toggle("is-last", !!lastMove && (square === lastMove.from || square === lastMove.to));
      target.classList.toggle("is-check", check && piece?.type === "k" && piece.color === "w");
      target.setAttribute("aria-label", piece ? `${square} ${piece.color === "w" ? "white" : "black"} ${piece.type}` : square);
    }
  }
}

function applyLocal(move) {
  const from = toIndex(move.from);
  const to = toIndex(move.to);
  const piece = board[from.row][from.col];
  board[from.row][from.col] = null;
  if (move.flags?.includes("e")) board[from.row][to.col] = null;
  board[to.row][to.col] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
  if (move.flags?.includes("k") || move.flags?.includes("q")) {
    const kingSide = move.flags.includes("k");
    const rookFrom = { row: from.row, col: kingSide ? 7 : 0 };
    const rookTo = { row: from.row, col: kingSide ? 5 : 3 };
    board[rookTo.row][rookTo.col] = board[rookFrom.row][rookFrom.col];
    board[rookFrom.row][rookFrom.col] = null;
  }
}

async function slide(from, to) {
  const piece = cell(from)?.querySelector(".chess-piece");
  if (!piece || document.documentElement.classList.contains("motion-reduced")) return;
  const a = cell(from).getBoundingClientRect();
  const b = cell(to).getBoundingClientRect();
  piece.classList.add("is-moving");
  piece.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(1.12)`;
  cell(to).querySelector(".chess-piece")?.classList.add("is-captured");
  await sleep(SLIDE_MS);
}

function setStatus(text) {
  el("chessStatus").textContent = text;
}

function setInteractive(enabled) {
  boardEl().classList.toggle("is-locked", !enabled);
}

async function start() {
  if (!playCondition()) return;
  if (window.getGameService?.()?.state.value !== "playing") sendEvent("GAME_SELECTED");
  el("menuGame").style.display = "none";
  el("chessGame").style.display = "flex";
  document.querySelector('[data-action="chess-again"]').classList.add("hidden");
  document.querySelector('[data-action="chess-resign"]').classList.remove("hidden");
  el(PET_IMG).src = "/asset/char/idle.png";
  stopReaction(PET_IMG);
  hush(PET_IMG);
  buildBoard();
  setStatus("Setting up the board...");
  setInteractive(false);

  const res = await api("/api/game/start", { type: "chess" });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    sendEvent("BACK");
    return;
  }
  session = res;
  board = parseFen(res.fen);
  legal = res.legal;
  selected = null;
  lastMove = null;
  updateContext();
  el("chessPoints").textContent = res.rewards.maxScore;
  el("chessCoins").textContent = res.rewards.maxCoin;
  render();
  setStatus("Your turn! ♙");
  say(PET_IMG, "Siap main catur? ♟️", 1800, { mood: "happy" });
  gameFx(PET_IMG, "ready");
  setInteractive(true);
}

function onSquare(square) {
  if (!session || busy) return;
  const piece = pieceAt(square);
  if (selected && (legal[selected] ?? []).includes(square)) {
    playMove(selected, square);
    return;
  }
  selected = piece?.color === "w" && legal[square] ? square : null;
  if (selected) chessSound.select();
  render();
}

async function playMove(from, to) {
  busy = true;
  selected = null;
  setInteractive(false);
  const movingPiece = pieceAt(from);
  const promotion = movingPiece?.type === "p" && to[1] === "8" ? "q" : undefined;
  render();

  const request = api("/api/game/chess/move", { sessionId: session.sessionId, from, to, promotion });
  await slide(from, to);
  const res = await request;

  if (res.error) {
    chessSound.illegal();
    showMessage(res.error, "error", 1500);
    render();
    busy = false;
    setInteractive(true);
    return;
  }
  if (res.status === "timeout") {
    finish(res);
    return;
  }

  applyLocal(res.playerMove);
  lastMove = res.playerMove;
  render({ check: false });
  moveSound(res.playerMove);
  if (res.playerMove.captured) {
    react(PET_IMG, "pet-shake", 500);
    say(PET_IMG, pick(PLAYER_CAPTURES), 1400, { mood: "sad" });
  }

  if (res.petMove) {
    setStatus("Joko is thinking...");
    react(PET_IMG, "pet-think", 0);
    if (!res.playerMove.captured) say(PET_IMG, pick(THINKING), 0);
    await sleep(550 + Math.random() * 450);
    stopReaction(PET_IMG);
    hush(PET_IMG);
    await slide(res.petMove.from, res.petMove.to);
    applyLocal(res.petMove);
    lastMove = res.petMove;
    moveSound(res.petMove);
    if (res.check && res.status === "playing") say(PET_IMG, "Skak! ⚔️", 1500, { mood: "happy" });
    else if (res.petMove.captured) say(PET_IMG, pick(PET_CAPTURES), 1500, { mood: "happy" });
    else if (Math.random() < 0.3) say(PET_IMG, "Giliranmu 😼", 1200);
  }

  board = parseFen(res.fen);
  legal = res.legal;
  render({ check: res.check && res.status === "playing" });
  busy = false;

  if (res.status === "playing") {
    setStatus(res.check ? "Check! Protect your king ⚔️" : "Your turn! ♙");
    setInteractive(true);
  } else {
    finish(res);
  }
}

function finish(res) {
  session = null;
  setInteractive(false);
  document.querySelector('[data-action="chess-again"]').classList.remove("hidden");
  document.querySelector('[data-action="chess-resign"]').classList.add("hidden");
  updateContext();
  if (res.status === "win") chessSound.win();
  else if (res.status === "draw") chessSound.draw();
  else chessSound.lose();
  focusPet(PET_IMG);

  const { coin = 0, score = 0, mood = 0 } = res.reward ?? {};
  const rewards = [
    score && { text: `+${score} pts`, tone: "purple" },
    coin && { text: `+${coin} 🪙`, tone: "gold" },
    mood && { text: `${mood > 0 ? "+" : ""}${mood} 😊`, tone: mood > 0 ? "good" : "bad" },
  ].filter(Boolean);

  if (res.status === "win") {
    el(PET_IMG).src = "/asset/char/sad.png";
    gameFx(PET_IMG, "victory", { coins: Math.ceil(coin / 15), cheer: false });
    say(PET_IMG, "Skakmat?! Kamu hebat 😭", 2600, { mood: "sad" });
    setStatus(`Checkmate! You win · +${score} pts`);
  } else if (res.status === "lose" || res.status === "resign") {
    el(PET_IMG).src = "/asset/char/happy.png";
    gameFx(PET_IMG, "victory", { coins: 0 });
    say(PET_IMG, res.status === "resign" ? "Yah nyerah? Aku menang! 😎" : "Skakmat! Aku menang 😎", 2600, { mood: "happy" });
    setStatus(res.status === "resign" ? "You resigned" : "Checkmate! Joko wins");
  } else if (res.status === "draw") {
    gameFx(PET_IMG, "ready");
    say(PET_IMG, "Remis! Seimbang nih 🤝", 2400, { mood: "fresh" });
    setStatus(`Draw · +${score} pts`);
  } else {
    gameFx(PET_IMG, "fail");
    say(PET_IMG, "Waktu habis! ⏰", 2000, { mood: "sad" });
    setStatus("Time's up!");
  }
  if (rewards.length) floatStats(PET_IMG, rewards);
}

async function resign() {
  if (!session || busy) return;
  const ok = await confirmDialog({
    title: "Menyerah?",
    message: "Joko bakal menang dan ronde ini selesai tanpa hadiah. Yakin mau resign?",
    confirmText: "🏳️ Resign",
    cancelText: "Lanjut main",
    image: "/asset/char/happy.png",
  });
  if (!ok || !session) return;
  const current = session;
  session = null;
  await api("/api/game/end", { sessionId: current.sessionId });
  finish({ status: "resign" });
}

function leave() {
  if (session) api("/api/game/end", { sessionId: session.sessionId });
  session = null;
  busy = false;
  selected = null;
  el("chessGame").style.display = "none";
}

export function initChess() {
  document.querySelector('[data-action="chess"]')?.addEventListener("click", start);
  document.querySelector('[data-action="chess-again"]')?.addEventListener("click", start);
  document.querySelector('[data-action="chess-resign"]')?.addEventListener("click", resign);
  window.leaveChess = leave;
}
