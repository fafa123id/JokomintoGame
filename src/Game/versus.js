import { api, state, refreshPet } from "../api.js";
import { sendEvent, getGameService } from "../stateManager.js";
import { html, openModal, closeModal, ui, confirmDialog } from "../modal.js";
import { showMessage, updateContext } from "../components.js";
import { say, react, gameFx, floatStats, hush, stopReaction, setExpression } from "../pet.js";
import { startTicTacToe } from "./tictactoe.js";
import { startChess } from "./chess.js";
import { markSound, resultSound } from "./xoxSound.js";
import { chessSound, moveSound } from "./chessSound.js";
import { getSetting } from "../settings.js";
import { addFriend, formatUid } from "../friends.js";
import { dressFixedSkin } from "../skins.js";

// Online tic-tac-toe and chess between players. The server owns the game; this module
// picks the mode, handles invites and renders the match it receives over events.
const ME = "charVsMe";
const FOE = "charVsFoe";
const TITLES = { tictactoe: "Tic-Tac-Toe", chess: "Chess" };
const FILES = "abcdefgh";
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const LOW_TIME_SEC = 30;

let match = null;
let clockOffset = 0;
let clockTimer = null;
let selected = null;
let busy = false;
let lastMoveKey = null;
let invitePopup = null;
let outgoing = null;
// The player's unfinished match, shown as a "Resume match" button in the menus.
let unfinished = null;

const el = (id) => document.getElementById(id);
const screen = () => el("versusGame");
const boardEl = () => el("versusBoard");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isActive = () => match?.status === "active";

// ---------- screen entry ----------

// Moves the state machine to "playing" from wherever the player is, closing any other game.
function showScreen() {
  const svc = getGameService();
  const step = (event) => svc.send(event);
  let value = svc.state.value;
  if (value === "home") step("START");
  if (value === "sleep") step("WAKE");
  value = svc.state.value;
  if (value === "selectSoap" || value === "selectFood") step("BACK");
  if (svc.state.value === "playing") step("BACK");
  if (svc.state.value === "idle") step("PLAY");
  if (svc.state.value === "selectGame") step("GAME_SELECTED");
  el("menuGame").style.display = "none";
  screen().style.display = "flex";
  screen().dataset.music = match.type === "chess" ? "chess" : "xox";
  window.dispatchEvent(new CustomEvent("pet:state", { detail: "playing" }));
}

const busyElsewhere = () => ["bathing", "eating"].includes(getGameService()?.state.value);

// ---------- rendering ----------

function setStatus(text) {
  el("versusStatus").textContent = text;
}

function playerCard(side, player, badge) {
  const card = screen().querySelector(`.vs-player[data-side="${side}"]`);
  card.querySelector("[data-name]").textContent = side === "me" ? "You" : player.name;
  card.querySelector("[data-badge]").textContent = badge;
  card.querySelector("[data-uid]").textContent = side === "me" ? "" : formatUid(player.uid);
}

function badges() {
  if (match.type === "tictactoe") return { me: match.mark === "X" ? "❌" : "⭕", foe: match.mark === "X" ? "⭕" : "❌" };
  return { me: match.color === "w" ? "♔ White" : "♚ Black", foe: match.color === "w" ? "♚ Black" : "♔ White" };
}

function renderPlayers() {
  const b = badges();
  playerCard("me", match.me, b.me);
  playerCard("foe", match.foe, b.foe);
  const foeSprite = el(FOE).closest(".pet-sprite") ?? el(FOE).parentElement;
  dressFixedSkin(foeSprite, match.foe.skin);
  screen().querySelector('.vs-player[data-side="me"]').classList.toggle("is-turn", isActive() && match.yourTurn);
  screen().querySelector('.vs-player[data-side="foe"]').classList.toggle("is-turn", isActive() && !match.yourTurn);
}

function renderTicTacToe() {
  const root = boardEl();
  root.className = "xox-board vs-xox mx-auto mb-5";
  if (root.childElementCount !== 9) {
    root.replaceChildren(
      ...Array.from({ length: 9 }, (_, i) => {
        const cell = html(`<button type="button" class="xox-cell vs-cell" aria-label="Cell ${i + 1}"></button>`);
        cell.addEventListener("click", () => playCell(i));
        return cell;
      })
    );
  }
  [...root.children].forEach((cell, i) => {
    const mark = match.board[i];
    cell.textContent = mark === "X" ? "✕" : mark === "O" ? "◯" : "";
    cell.dataset.mark = mark ?? "";
    cell.disabled = !!mark || !isActive() || !match.yourTurn || busy;
    cell.classList.toggle("is-last", match.lastMove?.cell === i);
    cell.classList.toggle("is-win", !!match.winLine?.includes(i));
  });
}

function parseFen(fen) {
  return fen
    .split(" ")[0]
    .split("/")
    .map((row) => {
      const squares = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) squares.push(null);
        else squares.push({ type: ch.toLowerCase(), color: ch === ch.toLowerCase() ? "b" : "w" });
      }
      return squares;
    });
}

function renderChess() {
  const root = boardEl();
  root.className = "chess-board mx-auto mb-5";
  const flipped = match.color === "b";
  const board = parseFen(match.fen);
  const toMove = match.fen.split(" ")[1];
  root.classList.toggle("is-locked", !isActive() || !match.yourTurn || busy);
  if (root.childElementCount !== 64 || root.dataset.flipped !== String(flipped)) {
    root.dataset.flipped = String(flipped);
    const squares = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const row = flipped ? 7 - r : r;
        const col = flipped ? 7 - c : c;
        const square = `${FILES[col]}${8 - row}`;
        const button = html(`<button type="button" class="chess-square ${(row + col) % 2 ? "is-dark" : "is-light"}"></button>`);
        button.dataset.square = square;
        if (c === 0) button.dataset.rank = 8 - row;
        if (r === 7) button.dataset.file = FILES[col];
        button.addEventListener("click", () => onSquare(square));
        squares.push(button);
      }
    }
    root.replaceChildren(...squares);
  }
  const legal = match.legal ?? {};
  for (const button of root.children) {
    const square = button.dataset.square;
    const piece = board[8 - Number(square[1])][FILES.indexOf(square[0])];
    button.replaceChildren();
    if (piece) {
      const span = document.createElement("span");
      span.className = `chess-piece chess-piece--${piece.color}`;
      span.textContent = `${GLYPH[piece.type]}︎`;
      button.appendChild(span);
    }
    const isTarget = !!selected && (legal[selected] ?? []).includes(square);
    button.classList.toggle("is-selected", square === selected);
    button.classList.toggle("is-target", isTarget && !piece);
    button.classList.toggle("is-capture", isTarget && !!piece);
    button.classList.toggle("is-last", !!match.lastMove && (square === match.lastMove.from || square === match.lastMove.to));
    button.classList.toggle("is-check", isActive() && match.check && piece?.type === "k" && piece.color === toMove);
    button.setAttribute("aria-label", piece ? `${square} ${piece.color === "w" ? "white" : "black"} ${piece.type}` : square);
  }
}

function render() {
  renderPlayers();
  if (match.type === "tictactoe") renderTicTacToe();
  else renderChess();
  if (isActive()) setStatus(match.yourTurn ? "Your turn! 🎯" : `${match.foe.name} is thinking...`);
}

// ---------- turn clock ----------

function tickClock() {
  if (!match) return;
  const label = el("versusClock").parentElement;
  label.classList.toggle("hidden", !isActive());
  const left = Math.max(0, Math.ceil((match.deadline - (Date.now() + clockOffset)) / 1000));
  el("versusClock").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const fill = screen().querySelector(".time-bar-fill");
  fill.style.width = `${(left / match.turnSec) * 100}%`;
  screen().querySelector(".time-bar").classList.toggle("is-low", isActive() && left <= LOW_TIME_SEC);
}

function startClock() {
  clearInterval(clockTimer);
  if (!isActive()) return;
  clockTimer = setInterval(tickClock, 500);
  tickClock();
}

// ---------- moves ----------

async function sendMove(move) {
  if (!isActive() || !match.yourTurn || busy) return;
  busy = true;
  render();
  const res = await api(`/api/match/${match.id}/move`, move);
  busy = false;
  if (res.error) {
    if (match.type === "chess") chessSound.illegal();
    showMessage(res.error, "error", 1800, true);
    render();
    return;
  }
  apply(res);
}

function playCell(cell) {
  if (match?.board[cell]) return;
  sendMove({ cell });
}

function onSquare(square) {
  if (!isActive() || !match.yourTurn || busy) return;
  const legal = match.legal ?? {};
  if (selected && (legal[selected] ?? []).includes(square)) {
    const board = parseFen(match.fen);
    const piece = board[8 - Number(selected[1])][FILES.indexOf(selected[0])];
    const promotion = piece?.type === "p" && (square[1] === "8" || square[1] === "1") ? "q" : undefined;
    const from = selected;
    selected = null;
    sendMove({ from, to: square, promotion });
    return;
  }
  selected = legal[square] ? square : null;
  if (selected) chessSound.select();
  render();
}

// Applies a fresh view from the server (own move response or an event), reacting once per move.
function apply(view) {
  if (!match || view.id !== match.id) return;
  const moveKey = JSON.stringify(view.lastMove);
  const isNewMove = view.lastMove && moveKey !== lastMoveKey;
  const byFoe = isNewMove && view.yourTurn && view.status === "active";
  match = view;
  clockOffset = view.serverNow - Date.now();
  lastMoveKey = moveKey;
  selected = null;
  render();
  startClock();

  if (isNewMove) {
    if (match.type === "tictactoe") markSound(byFoe ? (match.mark === "X" ? "O" : "X") : match.mark);
    else moveSound(match.lastMove);
    if (byFoe) {
      react(FOE, "pet-squish", 450);
      if (match.type === "chess" && match.lastMove.captured) say(ME, "Aduh, bidakku! 😖", 1300, { mood: "sad" });
    } else {
      react(ME, "pet-squish", 450);
      if (match.type === "chess" && match.lastMove?.captured) say(FOE, "Hmph! 😤", 1200, { mood: "sad" });
    }
  }
  if (view.status === "finished") finish();
}

// The opponent changed skin (or name) during the match.
function updateFoe({ matchId, player }) {
  if (unfinished?.id === matchId) unfinished = { ...unfinished, foe: { ...unfinished.foe, ...player } };
  if (match?.id !== matchId) return;
  match = { ...match, foe: { ...match.foe, ...player } };
  renderPlayers();
  react(FOE, "pet-jump", 600);
  say(FOE, "Skin baru! ✨", 1400, { mood: "happy" });
}

// ---------- match end ----------

const REASONS = {
  resign: (won, foe) => (won ? `${foe} resigned` : "You resigned"),
  timeout: (won, foe) => (won ? `${foe} ran out of time` : "You ran out of time"),
  checkmate: (won) => (won ? "Checkmate!" : "Checkmated"),
  line: (won) => (won ? "Three in a row!" : "They got three in a row"),
  draw: () => "It's a draw",
};

function finish() {
  clearInterval(clockTimer);
  tickClock();
  el("versusBoard").classList.add("is-locked");
  screen().querySelector('[data-action="versus-resign"]').classList.add("hidden");
  screen().querySelector('[data-action="versus-back"]').classList.remove("hidden");
  screen().querySelectorAll(".vs-player").forEach((p) => p.classList.remove("is-turn"));

  const won = match.result === "win";
  const reason = REASONS[match.reason]?.(won, match.foe.name) ?? "";
  const headline = match.result === "draw" ? "Draw! 🤝" : won ? "You win! 🏆" : "You lose 😢";
  setStatus(`${headline} ${reason && `· ${reason}`}`);

  if (match.result === "draw") {
    resultSound("draw");
    say(ME, "Seri! 🤝", 2200, { mood: "fresh" });
    say(FOE, "GG! 🤝", 2200, { mood: "fresh" });
  } else {
    if (match.type === "chess") (won ? chessSound.win : chessSound.lose)();
    else resultSound(won ? "win" : "lose");
    setExpression(el(won ? ME : FOE), "happy");
    setExpression(el(won ? FOE : ME), "sad");
    gameFx(won ? ME : FOE, "victory", { coins: won ? Math.ceil((match.reward?.coin ?? 0) / 15) : 0 });
    say(won ? ME : FOE, "Yeay, menang! 🎉", 2400, { mood: "happy" });
    say(won ? FOE : ME, "Huhu, kalah... 😢", 2400, { mood: "sad" });
  }

  const r = match.reward ?? {};
  const stats = [
    r.score && { text: `+${r.score} pts`, tone: "purple" },
    r.coin && { text: `+${r.coin} 🪙`, tone: "gold" },
    r.mood && { text: `+${r.mood} 😊`, tone: "good" },
  ].filter(Boolean);
  if (stats.length) floatStats(ME, stats);
  refreshPet().then(updateContext);

  const foe = match.foe;
  if (match.canAddFriend && state.user && !state.user.isGuest && getSetting("askAddFriend")) {
    setTimeout(async () => {
      const ok = await confirmDialog({
        title: `Add ${foe.name} as a friend?`,
        message: "Friends can see when you're online and invite each other to matches.",
        confirmText: "Yes, add",
        cancelText: "No thanks",
        image: "/asset/char/happy.png",
        tone: "primary",
      });
      if (ok) addFriend({ userId: foe.id, name: foe.name });
    }, 1800);
  }
}

function enterMatch(view) {
  closeModal({ silent: true });
  // The accept response and the match:start event both deliver the same match.
  if (match?.id === view.id && screen().style.display === "flex") return apply(view);
  match = view;
  lastMoveKey = JSON.stringify(view.lastMove);
  selected = null;
  busy = false;
  showScreen();
  el("versusTitle").textContent = `${TITLES[view.type]} · Online`;
  screen().querySelector('[data-action="versus-resign"]').classList.toggle("hidden", !isActive());
  screen().querySelector('[data-action="versus-back"]').classList.toggle("hidden", isActive());
  for (const id of [ME, FOE]) {
    stopReaction(id);
    hush(id);
    setExpression(el(id), "idle");
  }
  render();
  startClock();
  clockOffset = view.serverNow - Date.now();
  trackMatch(view);
  if (view.status === "finished") return finish();
  gameFx(ME, "ready");
  say(ME, match.yourTurn ? "Aku duluan! 😼" : "Giliran dia dulu~", 1800, { mood: "happy" });
  say(FOE, "Ayo main! 😼", 1800, { mood: "happy" });
}

async function resign() {
  if (!isActive()) return;
  const ok = await confirmDialog({
    title: "Resign?",
    message: `${match.foe.name} wins this match and you get no reward.`,
    confirmText: "🏳️ Resign",
    cancelText: "Keep playing",
    image: "/asset/char/sad.png",
  });
  if (!ok || !isActive()) return;
  const res = await api(`/api/match/${match.id}/resign`, {});
  if (res.error) showMessage(res.error, "error", 1800, true);
  else apply(res);
}

function leave() {
  clearInterval(clockTimer);
  match = null;
  selected = null;
  busy = false;
  screen().style.display = "none";
  renderResume();
}

// ---------- resume an unfinished match ----------

function renderResume() {
  const onScreen = isActive() && match.id === unfinished?.id && screen().style.display === "flex";
  for (const button of document.querySelectorAll('[data-action="resume-match"]')) {
    button.classList.toggle("hidden", !unfinished || onScreen);
    if (!unfinished) continue;
    const turn = unfinished.yourTurn ? "your turn" : `${unfinished.foe.name}'s turn`;
    button.querySelector("[data-resume-label]").textContent = `${TITLES[unfinished.type]} vs ${unfinished.foe.name} · ${turn}`;
  }
}

function trackMatch(view) {
  if (view.status === "active") unfinished = view;
  else if (unfinished?.id === view.id) unfinished = null;
  renderResume();
}

async function refreshUnfinished() {
  if (!state.user) {
    unfinished = null;
    return renderResume();
  }
  const res = await api("/api/match/current");
  unfinished = res.match ?? null;
  renderResume();
  return unfinished;
}

async function resumeMatch() {
  const current = await refreshUnfinished();
  if (current) enterMatch(current);
  else showMessage("That match has already ended", "error", 2000, true);
}

// ---------- invites and matchmaking ----------

function waitingDialog({ title, message, seconds, onCancel }) {
  const view = html(`
    <div class="text-center">
      <div class="vs-wait-spinner" aria-hidden="true"></div>
      <h2 class="font-game text-2xl text-gray-800 mb-1"></h2>
      <p class="text-gray-500 text-sm mb-1" data-message></p>
      <p class="text-gray-400 text-xs mb-5" data-count aria-live="polite"></p>
      <button type="button" class="${ui.secondary}">Cancel</button>
    </div>`);
  view.querySelector("h2").textContent = title;
  view.querySelector("[data-message]").textContent = message;
  const count = view.querySelector("[data-count]");
  const started = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    count.textContent = seconds ? `${Math.max(0, seconds - elapsed)}s` : `${elapsed}s`;
  }, 250);
  count.textContent = seconds ? `${seconds}s` : "0s";
  const stop = () => clearInterval(timer);
  view.querySelector("button").addEventListener("click", () => {
    stop();
    closeModal({ silent: true });
    onCancel?.();
  });
  openModal(view, {
    onClose: () => {
      stop();
      onCancel?.();
    },
  });
  return stop;
}

async function sendInvite(type, target) {
  if (isActive()) return showMessage("Finish your current match first", "error", 2000, true);
  const res = await api("/api/match/invite", { type, ...target });
  if (res.error) return showMessage(res.error, "error", 2200, true);
  const stop = waitingDialog({
    title: `Inviting ${res.to.name}`,
    message: `Waiting for them to accept ${TITLES[type]}...`,
    seconds: res.expiresInSec,
    onCancel: () => {
      if (outgoing?.id === res.inviteId) api("/api/match/invite/cancel", { inviteId: res.inviteId });
      outgoing = null;
    },
  });
  outgoing = { id: res.inviteId, stop };
}

async function findOpponent(type) {
  if (isActive()) return showMessage("Finish your current match first", "error", 2000, true);
  const res = await api("/api/match/queue", { type });
  if (res.error) return showMessage(res.error, "error", 2200, true);
  if (res.status === "matched") return enterMatch(res.match);
  waitingDialog({
    title: "Finding an opponent",
    message: `Looking for someone to play ${TITLES[type]}...`,
    onCancel: () => api("/api/match/queue/leave", {}),
  });
}

function onInviteClosed(e) {
  const { id, reason, by } = e.detail;
  if (outgoing?.id === id) {
    outgoing.stop();
    outgoing = null;
    closeModal({ silent: true });
    const text = { declined: `${by ?? "They"} declined your invite`, expired: "No answer, the invite expired", left: "The other player left" };
    showMessage(text[reason] ?? "Invite closed", "error", 2200, true);
  }
  if (invitePopup?.id === id) {
    invitePopup.stop();
    invitePopup = null;
    closeModal({ silent: true });
  }
}

function onInvite(e) {
  const invite = e.detail;
  if (isActive() || busyElsewhere() || invitePopup) {
    api("/api/match/invite/respond", { inviteId: invite.id, accept: false });
    return;
  }
  const seconds = invite.expiresInSec;
  const view = html(`
    <div class="invite-popup text-center">
      <div class="invite-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54"></circle><circle class="invite-ring-progress" cx="60" cy="60" r="54"></circle></svg>
        <span class="invite-ring-icon"></span>
        <span class="invite-ring-count" aria-live="polite"></span>
      </div>
      <h2 class="font-game text-2xl text-gray-800 mb-1"></h2>
      <p class="text-gray-500 text-sm mb-5"></p>
      <div class="grid grid-cols-2 gap-3">
        <button type="button" data-decline class="confirm-btn confirm-btn--cancel">Decline</button>
        <button type="button" data-accept class="confirm-btn invite-accept">Accept</button>
      </div>
    </div>`);
  view.querySelector(".invite-ring-icon").textContent = invite.type === "chess" ? "♟️" : "❌⭕";
  view.querySelector("h2").textContent = `${invite.from.name} challenges you!`;
  view.querySelector("p").textContent = `${TITLES[invite.type]} · ID ${formatUid(invite.from.uid)}`;
  view.querySelector(".invite-ring-progress").style.animationDuration = `${seconds}s`;
  const count = view.querySelector(".invite-ring-count");
  let left = seconds;
  count.textContent = left;

  const answer = async (accept) => {
    if (!invitePopup) return;
    invitePopup.stop();
    invitePopup = null;
    closeModal({ silent: true });
    const res = await api("/api/match/invite/respond", { inviteId: invite.id, accept });
    if (accept && res.error) showMessage(res.error, "error", 2200, true);
    if (accept && res.match) enterMatch(res.match);
  };
  const timer = setInterval(() => {
    left -= 1;
    count.textContent = Math.max(0, left);
    if (left <= 0) answer(false);
  }, 1000);
  invitePopup = { id: invite.id, stop: () => clearInterval(timer) };
  view.querySelector("[data-accept]").addEventListener("click", () => answer(true));
  view.querySelector("[data-decline]").addEventListener("click", () => answer(false));
  openModal(view, { onClose: () => answer(false) });
  chessSound.check();
}

// ---------- mode picker ----------

function modeCard(icon, title, hint, onClick, disabled = false) {
  const button = html(`<button type="button" class="mode-card"><span class="mode-icon"></span><span><strong></strong><small></small></span></button>`);
  button.querySelector(".mode-icon").textContent = icon;
  button.querySelector("strong").textContent = title;
  button.querySelector("small").textContent = hint;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function askUid(type) {
  const view = html(`
    <form class="text-center" novalidate>
      <h2 class="font-game text-2xl text-gray-800 mb-1">Invite by player ID</h2>
      <p class="text-gray-500 text-sm mb-4">Ask your opponent for the ID in their 👥 or 👤 menu</p>
      <input name="uid" class="${ui.input} text-center tracking-widest uppercase mb-4" placeholder="ABCD-1234" maxlength="9" autocomplete="off" autocapitalize="characters">
      <button type="submit" class="${ui.primary}">Send invite</button>
    </form>`);
  view.addEventListener("submit", (e) => {
    e.preventDefault();
    const uid = view.uid.value.trim();
    if (uid) sendInvite(type, { uid });
  });
  openModal(view);
}

async function pickFriend(type) {
  const view = html(`
    <div>
      <h2 class="font-game text-2xl text-center text-gray-800 mb-1">Invite a friend</h2>
      <p class="text-center text-gray-500 text-sm mb-4">Only online friends can be invited</p>
      <div data-list class="space-y-2"><p class="text-sm text-gray-400 text-center">Loading...</p></div>
    </div>`);
  openModal(view);
  const res = await api("/api/friends");
  const list = view.querySelector("[data-list]");
  if (res.error) return (list.textContent = res.error);
  const online = res.friends.filter((f) => f.status === "online");
  if (!online.length) {
    list.innerHTML = `<p class="text-sm text-gray-400 text-center py-3">None of your friends are online right now.</p>`;
    return;
  }
  list.replaceChildren(
    ...online.map((f) => {
      const row = html(`<button type="button" class="friend-row friend-row--button"><span class="friend-avatar">🐰</span><span class="friend-info"><strong></strong><small></small></span><span class="friend-btn is-good">Invite</span></button>`);
      row.querySelector("strong").textContent = f.name;
      row.querySelector("small").textContent = formatUid(f.uid);
      row.addEventListener("click", () => sendInvite(type, { friendId: f.id }));
      return row;
    })
  );
}

function openModePicker(type) {
  const registered = state.user && !state.user.isGuest;
  const view = html(`
    <div>
      <h2 class="font-game text-2xl text-center text-gray-800 mb-1"></h2>
      <p class="text-center text-gray-500 text-sm mb-4">Choose how to play</p>
      <div data-modes class="space-y-2"></div>
    </div>`);
  view.querySelector("h2").textContent = `${type === "chess" ? "♟️" : "❌"} ${TITLES[type]}`;
  view.querySelector("[data-modes]").append(
    modeCard("🐰", "Play vs Joko", "Practice against your pet", () => {
      closeModal({ silent: true });
      (type === "chess" ? startChess : startTicTacToe)();
    }),
    modeCard("👥", "Invite a friend", registered ? "Pick someone from your friend list" : "Register to use the friend list", () => pickFriend(type), !registered),
    modeCard("🔢", "Invite by player ID", "Works for guests too", () => askUid(type)),
    modeCard("🎲", "Find an opponent", "Random online player", () => findOpponent(type))
  );
  openModal(view);
}

// ---------- setup ----------

async function resumeIfPlaying() {
  if (isActive()) return;
  const current = await refreshUnfinished();
  const res = { match: current };
  if (!res.match || isActive()) return;
  const ok = await confirmDialog({
    title: "Match in progress",
    message: `You have an unfinished ${TITLES[res.match.type]} match against ${res.match.foe.name}. You can also resume it later from the menu.`,
    confirmText: "Resume",
    cancelText: "Later",
    icon: "⚔️",
    tone: "primary",
  });
  if (ok) enterMatch((await api(`/api/match/${res.match.id}`)) ?? res.match);
}

export function initVersus() {
  for (const type of ["tictactoe", "chess"]) {
    const action = type === "chess" ? "chess" : "xox";
    document.querySelector(`[data-action="${action}"]`)?.addEventListener("click", () => openModePicker(type));
  }
  screen().querySelector('[data-action="versus-resign"]').addEventListener("click", resign);
  screen().querySelector('[data-action="versus-back"]').addEventListener("click", () => sendEvent("BACK"));

  window.addEventListener("versus:invite", (e) => sendInvite(e.detail.type, { friendId: e.detail.friendId }));
  window.addEventListener("rt:invite", onInvite);
  window.addEventListener("rt:invite:closed", onInviteClosed);
  for (const button of document.querySelectorAll('[data-action="resume-match"]')) button.addEventListener("click", resumeMatch);
  for (const type of ["rt:match:start", "rt:match:update", "rt:match:end"]) window.addEventListener(type, (e) => trackMatch(e.detail));
  window.addEventListener("session:changed", refreshUnfinished);
  window.addEventListener("rt:match:start", (e) => {
    if (outgoing) {
      outgoing.stop();
      outgoing = null;
    }
    enterMatch(e.detail);
  });
  window.addEventListener("rt:match:update", (e) => apply(e.detail));
  window.addEventListener("rt:match:player", (e) => updateFoe(e.detail));
  window.addEventListener("rt:match:end", (e) => apply(e.detail));
  window.addEventListener("rt:hello", resumeIfPlaying);
  window.leaveVersus = leave;
}
