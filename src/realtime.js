import { state, api, clientId } from "./api.js";

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
  "session:replaced",
];
// Presence: a ping every 20s keeps this tab online (the server drops tabs silent for 45s).
// A hidden tab reports "away"; hidden for 2 minutes, it disconnects until it is shown again.
const PING_MS = 20_000;
const HIDDEN_DISCONNECT_MS = 120_000;

let source = null;
let userId = null;
let pingTimer = null;
let hiddenTimer = null;

const ping = () => {
  if (source && source.readyState !== EventSource.CLOSED) api("/api/events/ping", { client: clientId, away: document.hidden });
};

function disconnect() {
  source?.close();
  source = null;
  clearInterval(pingTimer);
  pingTimer = null;
}

function connect() {
  if (state.user?.id === userId && source && source.readyState !== EventSource.CLOSED) return;
  disconnect();
  userId = state.user?.id ?? null;
  if (!userId || !("EventSource" in window)) return;

  source = new EventSource(`/api/events?client=${encodeURIComponent(clientId)}`);
  for (const type of EVENTS) {
    source.addEventListener(type, (e) => {
      let detail = {};
      try {
        detail = JSON.parse(e.data);
      } catch {}
      window.dispatchEvent(new CustomEvent(`rt:${type}`, { detail }));
    });
  }
  // Every (re)connect starts fresh on the server, so report visibility right away.
  source.addEventListener("hello", () => document.hidden && ping());
  pingTimer = setInterval(ping, PING_MS);
}

function onVisibility() {
  clearTimeout(hiddenTimer);
  if (document.hidden) {
    ping();
    hiddenTimer = setTimeout(disconnect, HIDDEN_DISCONNECT_MS);
    return;
  }
  if (!source || source.readyState === EventSource.CLOSED) connect();
  else ping();
}

export function initRealtime() {
  window.addEventListener("session:changed", connect);
  window.addEventListener("rt:session:replaced", () => {
    disconnect();
    userId = null;
    window.dispatchEvent(new CustomEvent("session:replaced"));
  });
  document.addEventListener("visibilitychange", onVisibility);
  // After a long outage the browser may give up; reconnect when the network is back.
  window.addEventListener("net:change", (e) => {
    if (!e.detail.offline && (!source || source.readyState === EventSource.CLOSED)) {
      userId = null;
      connect();
    }
  });
}
