import { state } from "./api.js";

// Server-sent events, re-dispatched on window as "rt:<event>" so any module can listen.
const EVENTS = [
  "hello",
  "friends:request",
  "friends:accepted",
  "friends:changed",
  "friends:presence",
  "invite",
  "invite:closed",
  "match:start",
  "match:update",
  "match:end",
  "match:player",
];

let source = null;
let userId = null;

function connect() {
  if (state.user?.id === userId && source) return;
  source?.close();
  source = null;
  userId = state.user?.id ?? null;
  if (!userId || !("EventSource" in window)) return;

  source = new EventSource("/api/events");
  for (const type of EVENTS) {
    source.addEventListener(type, (e) => {
      let detail = {};
      try {
        detail = JSON.parse(e.data);
      } catch {}
      window.dispatchEvent(new CustomEvent(`rt:${type}`, { detail }));
    });
  }
}

export function initRealtime() {
  window.addEventListener("session:changed", connect);
  // The browser retries on its own; after a long outage, reconnect when the page comes back.
  window.addEventListener("net:change", (e) => {
    if (!e.detail.offline && source?.readyState === EventSource.CLOSED) {
      userId = null;
      connect();
    }
  });
}
