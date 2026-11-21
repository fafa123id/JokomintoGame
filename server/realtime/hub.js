// Server-Sent Events hub: one or more open streams per user (tabs, devices).
// A user counts as online while at least one stream is open. Single-process only.
const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_USER = 5;

const streams = new Map();
const presenceListeners = new Set();

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const isOnline = (userId) => streams.has(userId);

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
  const set = streams.get(userId);
  if (!set) return false;
  for (const res of set) write(res, event, data);
  return true;
}

export function connect(req, res, userId) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Lets nginx stream the response instead of buffering it.
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");

  let set = streams.get(userId);
  const firstStream = !set;
  if (!set) streams.set(userId, (set = new Set()));
  if (set.size >= MAX_STREAMS_PER_USER) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    oldest.end();
  }
  set.add(res);
  write(res, "hello", { online: true });

  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (set.size === 0 && streams.get(userId) === set) {
      streams.delete(userId);
      emitPresence(userId, false);
    }
  });

  if (firstStream) emitPresence(userId, true);
}

// Ends every stream so the HTTP server can shut down.
export function closeAll() {
  for (const set of streams.values()) for (const res of set) res.end();
  streams.clear();
}
