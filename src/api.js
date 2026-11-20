import { practiceStart, practiceCall, isLocalSession } from "./practice.js";

export const state = {
  user: null,
  pet: null,
};

const SNAPSHOT_KEY = "jm_snapshot";
const OFFLINE_MESSAGE = "Kamu sedang offline 📴 Fitur ini butuh internet";

let offline = typeof navigator !== "undefined" && navigator.onLine === false;

export const isOffline = () => offline;

export function setOffline(next) {
  if (offline === next) return;
  offline = next;
  window.dispatchEvent(new CustomEvent("net:change", { detail: { offline } }));
}

// Last known user and pet, so the app can open without a connection.
export function saveSnapshot() {
  if (!state.user || state.user.offline) return;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ user: state.user, pet: state.pet }));
  } catch {}
}

export function loadSnapshot() {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {}
}

export function setPet(pet) {
  if (!pet) return;
  state.pet = pet;
  saveSnapshot();
}

export async function api(path, body, { silent401 = false } = {}) {
  // Practice rounds started offline stay on the device until they end.
  if (path.startsWith("/api/game/") && isLocalSession(body?.sessionId)) return practiceCall(path, body);
  if (path === "/api/game/start" && offline) return practiceStart(body?.type);

  const options = { credentials: "same-origin", headers: {} };
  if (body !== undefined) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, options);
  } catch {
    setOffline(true);
    if (path === "/api/game/start") return practiceStart(body?.type);
    return { error: OFFLINE_MESSAGE, offline: true };
  }
  setOffline(false);

  let data = {};
  try {
    data = await res.json();
  } catch {}

  if (res.status === 401 && !silent401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new CustomEvent("auth:required"));
  }
  if (data.pet) setPet(data.pet);
  if (!res.ok && !data.error) data.error = `Request failed (${res.status})`;
  return data;
}

export async function refreshPet() {
  const { pet } = await api("/api/pet", undefined, { silent401: true });
  return pet;
}
