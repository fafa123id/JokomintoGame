import { sendEvent, getGameService } from "../stateManager.js";
import { refreshPet, api, state as appState } from "../api.js";
import { partyBar, inviteSheet, showInvitePopup, closeInvitePopup, customEntry, customLobby, rankCard, ladderSheet, rpSummary } from "./social.js";
import { updateContext } from "../components.js";
import { requireSession } from "../account.js";
import { FpsGame } from "./game.js";
import { MAPS } from "./shared/maps.js";
import { isTouchDevice } from "./controls.js";
import * as sfx from "./audio.js";
import { announce } from "./announcer.js";
import { loadModels, modelsReady } from "./assets.js";

// Jokoman 5v5: lobby (with party), custom lobbies, matchmaking screen, the match and the result screen.
const MODES = [
  { id: "bomb", icon: "💣", name: "Bomb", hint: "Plant or defuse · buy guns · first to 10 rounds", ready: true },
  { id: "tdm", icon: "⚔️", name: "Team Deathmatch", hint: "Respawns · free loadout · first to 40 kills", ready: true },
  { id: "hostage", icon: "🧑‍🤝‍🧑", name: "Hostage", hint: "Rescue or guard two hostages · buy guns · first to 10", ready: true },
  { id: "ranked", icon: "🏆", name: "Ranked", hint: "Climb from Unranked to Joko Emperor", ready: true },
  { id: "custom", icon: "🛠️", name: "Custom lobby", hint: "Private room · your teams and rules", ready: true, opens: true },
];

let root = null;
let ws = null;
let game = null;
let retries = 0;
let wantQueue = false;
let closing = false;
let selectedMode = "bomb";
// Party and custom lobby as the server last told us; screen: "main" | "entry" | "custom".
let party = null;
let custom = null;
let screen = "main";
let pendingAccept = null;
// Ranked: the player's ladder profile (the server rolls Bomb or Hostage per match).
let rankedProfile = null;
const queueMessage = () => (selectedMode === "ranked" ? { t: "queue", ranked: true } : { t: "queue", mode: selectedMode });
const myId = () => appState.user?.id ?? null;
const isLeader = () => !party || party.leader === myId();

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

function toast(text, tone = "") {
  if (!root || !text) return;
  const t = el(`<div class="fps-toast ${tone === "error" ? "is-error" : ""}" role="status"></div>`);
  t.textContent = text;
  root.append(t);
  setTimeout(() => t.remove(), 2800);
}

const idle = () => !game && !wantQueue && !panel()?.querySelector(".fps-end");

// The right out-of-match screen for the current state.
function render(message = "") {
  if (custom) return showCustom();
  if (screen === "entry") return showEntry();
  screen = "main";
  lobby(message);
}

function showEntry() {
  screen = "entry";
  setPanel(
    customEntry({
      inParty: !!party,
      onCreate: () => send({ t: "lobby_create" }),
      onJoin: (code) => send({ t: "lobby_join", code }),
      onBack: () => ((screen = "main"), lobby()),
    })
  );
}

function showCustom() {
  screen = "custom";
  const lobbyAction = (action, extra = {}) => send({ t: "lobby", action, ...extra });
  setPanel(
    customLobby(custom, myId(), {
      onSettings: (settings) => lobbyAction("settings", { settings }),
      onSlot: (target, slot) => lobbyAction("slot", { target, slot }),
      onKick: (target) => lobbyAction("kick", { target }),
      onPromote: (target) => lobbyAction("promote", { target }),
      onInvite: () => inviteSheet(root, "lobby", send),
      onStart: () => send({ t: "lobby_start" }),
      onLeave: () => lobbyAction("leave"),
    })
  );
}

function lobby(message = "") {
  wantQueue = false;
  if (party) {
    selectedMode = party.ranked ? "ranked" : party.mode;
  }
  const leader = isLeader();
  const setMode = (mode, ranked) => party && send({ t: "party", action: "mode", mode, ranked });
  const view = el(`
    <div class="fps-lobby">
      <div class="fps-lobby-head">
        <h1>🔫 Jokoman <span>5v5</span></h1>
        <p>Tactical shooter · bots fill empty slots</p>
      </div>
      <div data-party></div>
      <div class="fps-modes"></div>
      <div data-ranked></div>
      <div class="fps-maps"><small>Map pool</small><div></div></div>
      <button type="button" class="fps-cta" data-find>Find match</button>
      <p class="fps-note" data-note></p>
      <details class="fps-howto">
        <summary>Controls</summary>
        <p>${isTouchDevice() ? "Left thumb: move · Drag right side: aim · 🔫 shoot (drag to aim while shooting) · ⤒ jump · ⤓ crouch · ↻ reload · weapon bar to switch · skill/ultimate buttons · 💣 hold to plant/defuse · 💬 chat · ☰ menu" : "WASD move · Mouse aim · Click shoot · Right-click scope · B buy · H change hero (TDM) · R reload · Q/E, scroll or 1-4 weapons · G drop weapon · Z skill · X ultimate · F hold to plant/defuse · Space jump · " + (navigator.keyboard?.lock ? "Ctrl/C crouch (fullscreen)" : "C crouch") + " · Shift walk · Tab scoreboard · Enter chat · Esc menu"}</p>
      </details>
      <button type="button" class="fps-back" data-back>← Back to games</button>
    </div>`);
  view.querySelector(".fps-modes").append(
    ...MODES.map((m) => {
      const card = el(`<button type="button" class="fps-mode"><span></span><strong></strong><small></small></button>`);
      card.querySelector("span").textContent = m.icon;
      card.querySelector("strong").textContent = m.name;
      card.querySelector("small").textContent = m.hint;
      card.disabled = !m.ready || (!m.opens && !leader);
      card.classList.toggle("is-active", m.id === selectedMode);
      card.addEventListener("click", () => {
        if (m.opens) return showEntry();
        selectedMode = m.id;
        if (party) setMode(m.id === "ranked" ? "bomb" : m.id, m.id === "ranked");
        lobby();
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
  const rankedSlot = view.querySelector("[data-ranked]");
  if (selectedMode === "ranked") {
    rankedSlot.replaceWith(
      rankCard(rankedProfile, { onLadder: () => send({ t: "ladder" }) })
    );
  } else rankedSlot.remove();
  view.querySelector("[data-party]").replaceWith(
    partyBar(party, myId(), {
      onInvite: () => inviteSheet(root, "party", send),
      onLeave: () => send({ t: "party", action: "leave" }),
      onKick: (target) => send({ t: "party", action: "kick", target }),
      onPromote: (target) => send({ t: "party", action: "promote", target }),
    })
  );
  const find = view.querySelector("[data-find]");
  if (!leader) {
    find.disabled = true;
    find.textContent = `Waiting for ${party.members.find((p) => p.id === party.leader)?.name ?? "the leader"}`;
  } else if (party) find.textContent = `Find ${selectedMode === "ranked" ? "ranked " : ""}match · party of ${party.members.length}`;
  else if (selectedMode === "ranked") find.textContent = "Find ranked match";
  view.querySelector("[data-note]").textContent = message;
  find.addEventListener("click", findMatch);
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
  const mode = status.mode ?? selectedMode;
  view.querySelector("h2").textContent = status.ranked ? "Finding a ranked match" : "Finding players";
  view.querySelector("[data-count]").textContent = `${status.waiting ?? 1} / 10 players in queue${status.party > 1 ? ` · your party of ${status.party}` : ""}`;
  view.querySelector("[data-mode]").textContent = { tdm: "⚔️ Team Deathmatch", hostage: "🧑‍🤝‍🧑 Hostage", ranked: "🏆 Ranked · 🎲 Bomb or Hostage" }[mode] ?? "💣 Bomb";
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
      <div data-rp></div>
      <div class="fps-rewards"></div>
      <table class="fps-table"><thead><tr><th>Player</th><th>K</th><th>D</th><th>A</th></tr></thead><tbody></tbody></table>
      <div class="fps-end-actions">
        <button type="button" class="fps-cta" data-again>Play again</button>
        <button type="button" class="fps-back" data-back>Back to games</button>
      </div>
    </div>`);
  const rp = view.querySelector("[data-rp]");
  if (msg.reward?.ranked) rp.replaceWith(rpSummary(msg.reward.ranked));
  else rp.remove();
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
        tr.children[0].textContent = `${p.rank ? `${p.rank.icon} ` : ""}${p.name}${p.bot ? " 🤖" : ""}`;
        tr.children[1].textContent = p.kills;
        tr.children[2].textContent = p.deaths;
        tr.children[3].textContent = p.assists ?? 0;
        return tr;
      })
  );
  const again = view.querySelector("[data-again]");
  if (msg.custom) {
    again.textContent = "Back to lobby";
    again.addEventListener("click", () => render());
  } else if (!isLeader()) {
    again.textContent = "Back to party";
    again.addEventListener("click", () => lobby());
  } else again.addEventListener("click", findMatch);
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
  render();
}

// ---------- invites ----------

function flushAccept() {
  if (!pendingAccept || ws?.readyState !== WebSocket.OPEN) return;
  send({ t: "invite_accept", id: pendingAccept });
  pendingAccept = null;
}

function acceptInvite(invite) {
  pendingAccept = invite.id;
  if (!root || root.hidden) open();
  else flushAccept();
}

function onInvite(e) {
  const invite = e.detail;
  // Mid-match there's no room for a popup; the server already refuses most of these.
  if (game) return api("/api/fps/invite/decline", { inviteId: invite.id });
  showInvitePopup(invite, { onAccept: acceptInvite, onDecline: (inv) => api("/api/fps/invite/decline", { inviteId: inv.id }) });
}

const CLOSED_TEXT = { declined: "declined your invite", expired: "didn't answer your invite", failed: "couldn't join" };

// ---------- socket ----------

function send(message) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/fps`;
  ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    retries = 0;
    flushAccept();
    // On reconnect the server already sends the running match; only ask to queue when not in one.
    if (wantQueue && !game) send(queueMessage());
  });
  ws.addEventListener("message", (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.t === "profile" || msg.t === "ladder") {
      rankedProfile = msg.ranked ?? msg.me ?? rankedProfile;
      if (msg.t === "ladder") ladderSheet(root, msg);
      else if (idle() && screen === "main") lobby();
    } else if (msg.t === "hello" || msg.t === "left") {
      party = msg.party ?? null;
      custom = msg.lobby ?? null;
      rankedProfile = msg.ranked ?? rankedProfile;
      if (msg.t === "hello" && idle()) render();
    } else if (msg.t === "party") {
      party = msg.party;
      if (msg.kicked) toast("You were removed from the party", "error");
      if (idle() && screen === "main") lobby();
    } else if (msg.t === "lobby") {
      custom = msg.lobby;
      if (msg.kicked) toast("The host removed you from the lobby", "error");
      if (!idle()) return;
      if (custom) showCustom();
      else if (screen === "custom") {
        screen = "main";
        lobby();
      }
    } else if (msg.t === "notice") toast(msg.text, msg.tone);
    else if (msg.t === "invite_closed") toast(`${msg.name} ${CLOSED_TEXT[msg.reason] ?? "can't join"}`, msg.reason === "declined" ? "error" : "");
    else if (msg.t === "welcome") startGame(msg);
    else if (msg.t === "queue") {
      // Party members are queued by their leader.
      if (game) return;
      wantQueue = true;
      queueScreen(msg);
    } else if (msg.t === "cancelled") {
      wantQueue = false;
      lobby(msg.reason ?? "");
    }
    else if (msg.t === "match_end") {
      endScreen(msg);
      if (msg.ranked) send({ t: "profile" });
    }
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
  if (!isLeader()) return lobby();
  wantQueue = true;
  queueScreen();
  if (isTouchDevice()) {
    try {
      await root.requestFullscreen?.();
      await screen.orientation?.lock?.("landscape");
    } catch {}
  }
  if (ws?.readyState === WebSocket.OPEN) send(queueMessage());
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
  render();
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
  window.addEventListener("rt:fps:invite", onInvite);
  window.addEventListener("rt:fps:invite:closed", (e) => closeInvitePopup(e.detail?.id));
}
