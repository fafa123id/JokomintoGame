export const state = {
  user: null,
  pet: null,
};

const OFFLINE_MESSAGE = "No internet connection 📶";

let offline = typeof navigator !== "undefined" && navigator.onLine === false;

export const isOffline = () => offline;

export function setOffline(next) {
  if (offline === next) return;
  offline = next;
  window.dispatchEvent(new CustomEvent("net:change", { detail: { offline } }));
}

export function setPet(pet) {
  if (pet) state.pet = pet;
}

export async function api(path, body, { silent401 = false } = {}) {
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
