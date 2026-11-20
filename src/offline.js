import { isOffline, setOffline, refreshPet, state } from "./api.js";
import { showMessage, updateContext } from "./components.js";
import { resyncSession } from "./account.js";

// The game is online-only: losing the connection blocks the screen until it comes back.
const RETRY_SEC = 5;

let overlay = null;
let retryTimer = null;
let countdown = RETRY_SEC;
let checking = false;

const el = (selector) => overlay.querySelector(selector);

async function reachable() {
  try {
    const res = await fetch("/healthz", { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

async function reconnect() {
  if (checking) return;
  checking = true;
  overlay.classList.add("is-checking");
  el("[data-net-retry]").disabled = true;
  el("[data-net-label]").textContent = "Reconnecting...";
  const ok = await reachable();
  checking = false;
  overlay.classList.remove("is-checking");
  el("[data-net-retry]").disabled = false;
  el("[data-net-label]").textContent = "Reconnect";
  if (ok) return setOffline(false);
  el(".net-card").classList.remove("is-shaking");
  void el(".net-card").offsetWidth;
  el(".net-card").classList.add("is-shaking");
  countdown = RETRY_SEC;
}

function tick() {
  if (checking) return;
  countdown -= 1;
  if (countdown <= 0) return reconnect();
  el("[data-net-countdown]").textContent = `Trying again in ${countdown}s`;
}

function show() {
  countdown = RETRY_SEC;
  el("[data-net-countdown]").textContent = `Trying again in ${countdown}s`;
  overlay.hidden = false;
  void overlay.offsetWidth;
  overlay.classList.add("is-visible");
  clearInterval(retryTimer);
  retryTimer = setInterval(tick, 1000);
  el("[data-net-retry]").focus();
}

async function hide() {
  clearInterval(retryTimer);
  overlay.classList.remove("is-visible");
  setTimeout(() => (overlay.hidden = true), 300);
  await resyncSession();
  if (state.user) await refreshPet();
  updateContext();
  showMessage("Back online! ✅", "success", 1800, true);
}

export function initOffline() {
  overlay = document.createElement("div");
  overlay.className = "net-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "netTitle");
  overlay.innerHTML = `
    <div class="net-card">
      <div class="net-art">
        <img src="/asset/char/sad.png" alt="" draggable="false">
        <span class="net-badge" aria-hidden="true">📶</span>
      </div>
      <h2 id="netTitle" class="font-game text-2xl text-gray-800 mb-1">Joko needs internet</h2>
      <p class="text-gray-500 text-sm mb-5">JokomintoGame requires an internet connection to play and keep your progress safe. Check your Wi-Fi or mobile data.</p>
      <button type="button" class="net-retry" data-net-retry>
        <span class="net-spinner" aria-hidden="true"></span><span data-net-label>Reconnect</span>
      </button>
      <p class="net-countdown" data-net-countdown aria-live="polite"></p>
    </div>`;
  document.body.appendChild(overlay);
  el("[data-net-retry]").addEventListener("click", reconnect);

  window.addEventListener("online", () => reconnect());
  window.addEventListener("offline", () => setOffline(true));
  window.addEventListener("net:change", (e) => (e.detail.offline ? show() : hide()));
  if (isOffline()) show();
}
