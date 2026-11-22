import { sendEvent, getGameService } from "../stateManager.js";
import { refreshPet } from "../api.js";
import { updateContext } from "../components.js";
import { requireSession } from "../account.js";
import { FpsGame } from "./game.js";
import { MAPS } from "./shared/maps.js";
import { isTouchDevice } from "./controls.js";
import * as sfx from "./audio.js";
import { announce } from "./announcer.js";
import { loadModels, modelsReady } from "./assets.js";

// Jokoman 5v5: lobby, matchmaking screen, the match itself and the result screen.
const MODES = [
  { id: "bomb", icon: "💣", name: "Bomb", hint: "Plant or defuse · buy guns · first to 10 rounds", ready: true },
  { id: "tdm", icon: "⚔️", name: "Team Deathmatch", hint: "Respawns · free loadout · first to 40 kills", ready: true },
  { id: "hostage", icon: "🧑‍🤝‍🧑", name: "Hostage", hint: "Coming soon", ready: false },
  { id: "ranked", icon: "🏆", name: "Ranked", hint: "Coming soon", ready: false },
  { id: "custom", icon: "🛠️", name: "Custom lobby", hint: "Coming soon", ready: false },
];

let root = null;
let ws = null;
let game = null;
let retries = 0;
let wantQueue = false;
let closing = false;
let selectedMode = "bomb";

const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

function panel() {
  return root.querySelector("[data-panel]");
}

function setPanel(node) {
  const p = panel();
  p.replaceChildren(node);
  p.hidden = false;
}

function lobby(message = "") {
  wantQueue = false;
  const view = el(`
    <div class="fps-lobby">
      <div class="fps-lobby-head">
        <h1>🔫 Jokoman <span>5v5</span></h1>
        <p>Tactical shooter · bots fill empty slots</p>
      </div>
      <div class="fps-modes"></div>
      <div class="fps-maps"><small>Map pool</small><div></div></div>
      <button type="button" class="fps-cta" data-find>Find match</button>
      <p class="fps-note" data-note></p>
      <details class="fps-howto">
        <summary>Controls</summary>
        <p>${isTouchDevice() ? "Left thumb: move · Drag right side: aim · 🔫 shoot (drag to aim while shooting) · ⤒ jump · ⤓ crouch · ↻ reload · weapon bar to switch · skill/ultimate buttons · 💣 hold to plant/defuse · 💬 chat · ☰ menu" : "WASD move · Mouse aim · Click shoot · Right-click scope · B buy · R reload · Q/E, scroll or 1-4 weapons · G drop weapon · Z skill · X ultimate · F hold to plant/defuse · Space jump · " + (navigator.keyboard?.lock ? "Ctrl/C crouch (fullscreen)" : "C crouch") + " · Shift walk · Tab scoreboard · Enter chat · Esc menu"}</p>
      </details>
      <button type="button" class="fps-back" data-back>← Back to games</button>
    </div>`);
  view.querySelector(".fps-modes").append(
    ...MODES.map((m) => {
      const card = el(`<button type="button" class="fps-mode"><span></span><strong></strong><small></small></button>`);
      card.querySelector("span").textContent = m.icon;
      card.querySelector("strong").textContent = m.name;
      card.querySelector("small").textContent = m.hint;
      card.disabled = !m.ready;
      card.classList.toggle("is-active", m.id === selectedMode);
      card.addEventListener("click", () => {
        selectedMode = m.id;
        view.querySelectorAll(".fps-mode").forEach((c) => c.classList.remove("is-active"));
        card.classList.add("is-active");
      });
      return card;
    })
  );
  view.querySelector(".fps-maps div").append(
    ...Object.values(MAPS).map((m) => {
      const chip = el(`<span class="fps-chip"></span>`);
      chip.textContent = m.name;
      return chip;
    })
  );
  view.querySelector("[data-note]").textContent = message;
  view.querySelector("[data-find]").addEventListener("click", findMatch);
  view.querySelector("[data-back]").addEventListener("click", close);
  setPanel(view);
}

function queueScreen(status = {}) {
  let view = panel().querySelector(".fps-queue");
  if (!view) {
    view = el(`
      <div class="fps-queue">
        <div class="fps-spinner"></div>
        <h2>Finding players</h2>
        <p class="fps-queue-mode" data-mode></p>
        <p data-count></p>
        <p data-fill></p>
        <button type="button" class="fps-back" data-cancel>Cancel</button>
      </div>`);
    view.querySelector("[data-cancel]").addEventListener("click", () => {
      wantQueue = false;
      send({ t: "cancel" });
    });
    setPanel(view);
  }
  view.querySelector("[data-count]").textContent = `${status.waiting ?? 1} / 10 players in queue`;
  view.querySelector("[data-mode]").textContent = selectedMode === "tdm" ? "⚔️ Team Deathmatch" : "💣 Bomb";
  view.querySelector("[data-fill]").textContent = status.full
    ? "All servers are busy, you're next in line..."
    : `Bots fill the empty slots in ${Math.ceil((status.fillInMs ?? 0) / 1000)}s`;
}

function endScreen(msg) {
  const won = msg.winner === game?.team;
  const draw = !msg.winner;
  const players = msg.players;
  sfx.result(won);
  // Bomb mode: the winners' side is called out (match win/lose lines are for Team Deathmatch).
  // Bomb: the winners' side is called out. Team Deathmatch: match win / match lose.
  if (msg.mode === "tdm") setTimeout(() => !draw && announce(won ? "match-win" : "match-lose"), 600);
  else if (msg.side) setTimeout(() => announce(msg.side === "attack" ? "attackers-win" : "defenders-win"), 600);
  const view = el(`
    <div class="fps-end ${won ? "is-win" : "is-lose"}">
      <h1>${draw ? "DRAW" : won ? "VICTORY" : "DEFEAT"}</h1>
      <p class="fps-end-score"><span class="is-red"></span> : <span class="is-blue"></span></p>
      <div class="fps-rewards"></div>
      <table class="fps-table"><thead><tr><th>Player</th><th>K</th><th>D</th><th>A</th></tr></thead><tbody></tbody></table>
      <div class="fps-end-actions">
        <button type="button" class="fps-cta" data-again>Play again</button>
        <button type="button" class="fps-back" data-back>Back to games</button>
      </div>
    </div>`);
  view.querySelector(".is-red").textContent = msg.score.red;
  view.querySelector(".is-blue").textContent = msg.score.blue;
  const r = msg.reward;
  const rewards = view.querySelector(".fps-rewards");
  for (const [text, show] of [[`+${r?.coin ?? 0} 🪙`, r?.coin], [`+${r?.mood ?? 0} 😊`, r?.mood], [`+${r?.score ?? 0} pts`, r?.score]]) {
    if (!show) continue;
    const chip = el(`<span></span>`);
    chip.textContent = text;
    rewards.appendChild(chip);
  }
  view.querySelector("tbody").append(
    ...players
      .sort((a, b) => (a.team === b.team ? b.kills - a.kills : a.team === "red" ? -1 : 1))
      .map((p) => {
        const tr = el(`<tr><td></td><td></td><td></td><td></td></tr>`);
        tr.className = `is-${p.team}${p.id === game?.meId ? " is-me" : ""}`;
        tr.children[0].textContent = `${p.name}${p.bot ? " 🤖" : ""}`;
        tr.children[1].textContent = p.kills;
        tr.children[2].textContent = p.deaths;
        tr.children[3].textContent = p.assists ?? 0;
        return tr;
      })
  );
  view.querySelector("[data-again]").addEventListener("click", findMatch);
  view.querySelector("[data-back]").addEventListener("click", close);
  stopGame();
  setPanel(view);
  refreshPet().then(updateContext);
}

// While queued or playing, closing the tab (or a stray Ctrl+W) asks for confirmation first.
function guardUnload(e) {
  if (!game && !wantQueue) return;
  e.preventDefault();
  e.returnValue = "";
}

function stopGame() {
  game?.dispose();
  game = null;
  root?.classList.remove("is-playing");
}

async function startGame(welcome) {
  wantQueue = false;
  // Custom 3D models (if any) finish loading first; a slow download never holds the match up.
  if (!game) await modelsReady();
  if (closing) return;
  // A reconnect or a repeated "queue" answers with the same match: keep the running game
  // instead of building a second renderer on top of it.
  if (game && game.roomId === welcome.room) {
    panel().hidden = true;
    return game.resync(welcome);
  }
  stopGame();
  panel().hidden = true;
  root.classList.add("is-playing");
  game = new FpsGame(root, send, welcome, { onLeave: leaveMatch });
}

// Confirmed inside the in-game menu (a page-level dialog wouldn't show over fullscreen).
function leaveMatch() {
  send({ t: "leave" });
  stopGame();
  lobby();
}

// ---------- socket ----------

function send(message) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/fps`;
  ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    retries = 0;
    // On reconnect the server already sends the running match; only ask to queue when not in one.
    if (wantQueue && !game) send({ t: "queue", mode: selectedMode });
  });
  ws.addEventListener("message", (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.t === "hello") {
      if (!game && !wantQueue && !panel().querySelector(".fps-end")) lobby();
    } else if (msg.t === "welcome") startGame(msg);
    else if (msg.t === "queue") wantQueue && !game && queueScreen(msg);
    else if (msg.t === "cancelled") lobby();
    else if (msg.t === "match_end") endScreen(msg);
    else game?.handle(msg);
  });
  ws.addEventListener("close", () => {
    if (closing) return;
    if (retries++ < 5) {
      if (game) game.hud.banner("Reconnecting...", "", "is-bomb", 1500);
      setTimeout(connect, 800 * retries);
    } else {
      stopGame();
      lobby("Lost connection to the game server. Try again in a moment.");
    }
  });
}

async function findMatch() {
  // Already in a match (e.g. rejoined on open): nothing to queue for.
  if (game) return;
  wantQueue = true;
  queueScreen();
  if (isTouchDevice()) {
    try {
      await root.requestFullscreen?.();
      await screen.orientation?.lock?.("landscape");
    } catch {}
  }
  if (ws?.readyState === WebSocket.OPEN) send({ t: "queue", mode: selectedMode });
  else if (!ws || ws.readyState === WebSocket.CLOSED) connect();
}

// ---------- open / close ----------

async function open() {
  if (!(await requireSession())) return;
  const svc = getGameService();
  if (svc.state.value !== "playing") sendEvent("GAME_SELECTED");
  if (!root) {
    root = el(`<div class="fps-root"><div class="fps-panel" data-panel></div></div>`);
    document.body.appendChild(root);
  }
  root.hidden = false;
  closing = false;
  loadModels();
  document.documentElement.classList.add("fps-active");
  window.dispatchEvent(new CustomEvent("fps:active", { detail: true }));
  lobby();
  if (!ws || ws.readyState === WebSocket.CLOSED) connect();
}

function teardown() {
  closing = true;
  wantQueue = false;
  stopGame();
  ws?.close();
  ws = null;
  if (root) root.hidden = true;
  document.documentElement.classList.remove("fps-active");
  window.dispatchEvent(new CustomEvent("fps:active", { detail: false }));
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function close() {
  teardown();
  sendEvent("BACK");
  refreshPet().then(updateContext);
}

export function initFps() {
  window.addEventListener("beforeunload", guardUnload);
  document.querySelector('[data-action="fps"]')?.addEventListener("click", open);
  window.leaveFps = () => {
    if (root && !root.hidden) teardown();
  };
  window.addEventListener("session:replaced", () => root && !root.hidden && teardown());
}
