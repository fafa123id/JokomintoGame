import { WebSocketServer } from "ws";
import config from "../config/index.js";
import { userFromToken } from "../services/auth.service.js";
import { connect, shutdown } from "./service.js";

// WebSocket endpoint for Jokoman matches. Same login cookie as the rest of the app,
// and the Origin must be this site so other pages can't open sockets with a player's cookie.
const PATH = "/ws/fps";

function cookieValue(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function reject(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachFps(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://x").pathname !== PATH) return reject(socket, 404, "Not Found");
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return reject(socket, 403, "Forbidden");
      } catch {
        return reject(socket, 403, "Forbidden");
      }
    }
    const { user } = userFromToken(cookieValue(req.headers.cookie, config.auth.cookieName));
    if (!user) return reject(socket, 401, "Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws, user));
  });
  return () => {
    shutdown();
    wss.close();
  };
}
