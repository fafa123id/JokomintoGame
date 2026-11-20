import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// docker-compose runs nginx-proxy -> nginx -> app; the client IP must survive both hops
// so rate limits apply per player instead of to everyone at once.
test("trusting private hops resolves the real client IP through two proxies", async () => {
  const app = express();
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ip`, {
      headers: { "X-Forwarded-For": "203.0.113.7, 172.18.0.5" },
    });
    assert.equal((await res.json()).ip, "203.0.113.7");
  } finally {
    server.close();
  }
});
