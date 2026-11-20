import { isOffline, setOffline, refreshPet, state } from "./api.js";
import { showMessage, updateContext } from "./components.js";
import { resyncSession } from "./account.js";

const PROBE_MS = 15000;
let pill = null;
let probeTimer = null;

function render(offline) {
  pill.classList.toggle("is-visible", offline);
  pill.setAttribute("aria-hidden", String(!offline));
  for (const button of document.querySelectorAll("button[data-online-only]")) {
    button.classList.toggle("is-offline", offline);
    button.title = offline ? "Needs internet" : "";
  }
}

// navigator.onLine can't see a dead Wi-Fi, so while offline the health endpoint is polled until it answers.
function probe() {
  clearInterval(probeTimer);
  probeTimer = setInterval(async () => {
    try {
      const res = await fetch("/healthz", { cache: "no-store" });
      if (res.ok) setOffline(false);
    } catch {}
  }, PROBE_MS);
}

async function onReconnect() {
  clearInterval(probeTimer);
  await resyncSession();
  if (state.user) await refreshPet();
  updateContext();
  showMessage("Kembali online! Data tersinkron ✅", "success", 2200, true);
}

// Hands the files this page already loaded to the service worker, so the next launch works offline.
async function warmCache() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const urls = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => {
      const { origin, pathname } = new URL(url);
      return origin === location.origin && !pathname.startsWith("/api/") && !/\.(mp3|ogg|m4a)$/i.test(pathname);
    });
  reg.active?.postMessage({ type: "warm-cache", urls: [...new Set(urls)] });
}

export function initOffline() {
  pill = document.createElement("div");
  pill.className = "net-pill";
  pill.setAttribute("role", "status");
  pill.innerHTML = `<span class="net-dot"></span><span>Offline · practice mode, no coins or score</span>`;
  document.body.appendChild(pill);

  window.addEventListener("online", () => setOffline(false));
  window.addEventListener("offline", () => setOffline(true));
  window.addEventListener("net:change", (e) => {
    render(e.detail.offline);
    if (e.detail.offline) probe();
    else onReconnect();
  });
  render(isOffline());
  if (isOffline()) probe();

  window.addEventListener("load", () => setTimeout(() => warmCache().catch(() => {}), 3000));
}
