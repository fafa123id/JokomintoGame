// Server-Sent Events hub: one or more open streams per user (tabs, devices). Single-process only.
// Each tab pings every ~20s; a stream that stays silent past the timeout is closed, so a phone
// that lost its signal shows offline within that window instead of whenever TCP notices.
// A user is "away" when every open tab reports itself hidden.
const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_USER = 5;
const TIMEOUT_MS = Number(process.env.PRESENCE_TIMEOUT_MS) || 45_000;
const SWEEP_MS = Math.max(500, Math.min(10_000, Math.floor(TIMEOUT_MS / 3)));

const users = new Map();
const presenceListeners = new Set();

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const isOnline = (userId) => users.has(userId);
export const isAway = (userId) => {
  const streams = users.get(userId);
  return !!streams && [...streams.values()].every((s) => s.away);
};

export function onPresence(listener) {
  presenceListeners.add(listener);
  return () => presenceListeners.delete(listener);
}

function emitPresence(userId, online) {
  for (const listener of presenceListeners) {
    try {
      listener(userId, online);
    } catch (err) {
      console.error("presence listener failed", err);
    }
  }
}

export function send(userId, event, data = {}) {
  const streams = users.get(userId);
  if (!streams) return false;
  for (const stream of streams.values()) write(stream.res, event, data);
  return true;
}

export function connect(req, res, userId, clientId) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Lets nginx stream the response instead of buffering it.
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");

  let streams = users.get(userId);
  const firstStream = !streams;
  if (!streams) users.set(userId, (streams = new Map()));
  const wasAway = isAway(userId);
  // A reconnecting tab replaces its previous stream.
  streams.get(clientId)?.res.end();
  if (streams.size >= MAX_STREAMS_PER_USER && !streams.has(clientId)) {
    const [oldestId, oldest] = streams.entries().next().value;
    streams.delete(oldestId);
    oldest.res.end();
  }
  const stream = { res, lastSeen: Date.now(), away: false };
  streams.set(clientId, stream);
  write(res, "hello", { online: true });

  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  heartbeat.unref?.();

  // "close" fires both when the client leaves and when the server ends a stale stream.
  res.on("close", () => {
    clearInterval(heartbeat);
    if (streams.get(clientId) !== stream) return;
    const awayBefore = isAway(userId);
    streams.delete(clientId);
    if (streams.size === 0 && users.get(userId) === streams) {
      users.delete(userId);
      emitPresence(userId, false);
    } else if (awayBefore !== isAway(userId)) emitPresence(userId, true);
  });

  if (firstStream || wasAway) emitPresence(userId, true);
}

// Called by each tab every ~20s and whenever it is hidden or shown again.
export function ping(userId, clientId, away) {
  const stream = users.get(userId)?.get(clientId);
  if (!stream) return false;
  const wasAway = isAway(userId);
  stream.lastSeen = Date.now();
  stream.away = !!away;
  if (wasAway !== isAway(userId)) emitPresence(userId, true);
  return true;
}

function sweep() {
  const cutoff = Date.now() - TIMEOUT_MS;
  for (const streams of users.values()) {
    for (const stream of streams.values()) if (stream.lastSeen < cutoff) stream.res.end();
  }
}

const sweeper = setInterval(sweep, SWEEP_MS);
sweeper.unref?.();

// Signs other tabs/devices out after the account logs in somewhere else.
export function kickUser(userId, exceptClientId, event, data = {}) {
  const streams = users.get(userId);
  if (!streams) return;
  for (const [clientId, stream] of streams) {
    if (clientId === exceptClientId) continue;
    write(stream.res, event, data);
    stream.res.end();
  }
}

// Ends every stream so the HTTP server can shut down.
export function closeAll() {
  for (const streams of users.values()) for (const stream of streams.values()) stream.res.end();
  users.clear();
}
