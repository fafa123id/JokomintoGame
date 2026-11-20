import { api } from "./api.js";
import { showMessage } from "./components.js";
import { html, ui } from "./modal.js";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;

let registration = null;

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return registration;
  } catch (err) {
    console.warn("Service worker registration failed", err);
    return null;
  }
}

function keyToBytes(base64url) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const reg = registration ?? (await navigator.serviceWorker.ready);
  return reg.pushManager.getSubscription();
}

async function enable() {
  const { publicKey } = await api("/api/push/key");
  if (!publicKey) {
    showMessage("Notifications aren't configured on the server yet", "error", 2500);
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    showMessage("Notification permission was blocked in the browser", "error", 2500);
    return false;
  }
  const reg = registration ?? (await navigator.serviceWorker.ready);
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  const res = await api("/api/push/subscribe", { subscription: subscription.toJSON() });
  if (res.error) {
    showMessage(res.error, "error", 2500);
    return false;
  }
  showMessage("Notifications on! Joko will let you know when he needs you 🔔", "success", 2500);
  return true;
}

async function disable() {
  const subscription = await currentSubscription();
  if (subscription) {
    await api("/api/push/unsubscribe", { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  showMessage("Notifications off", "success", 1800);
}

// Toggle button shown in the account menu.
export function notificationButton() {
  const button = html(`<button type="button" class="${ui.secondary}"></button>`);
  if (!supported()) {
    button.textContent = "🔕 Notifications not supported here";
    button.disabled = true;
    return button;
  }
  const render = async () => {
    const on = Notification.permission === "granted" && !!(await currentSubscription());
    button.textContent = on ? "🔕 Turn off notifications" : "🔔 Turn on notifications";
    button.dataset.on = on ? "1" : "";
  };
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (button.dataset.on) await disable();
      else await enable();
    } finally {
      button.disabled = false;
      render();
    }
  });
  render();
  return button;
}
