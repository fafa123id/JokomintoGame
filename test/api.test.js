import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 4000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), "jm-test-"));
let proc;

before(async () => {
  proc = spawn(process.execPath, ["server/server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_FILE: path.join(dir, "test.db"),
      JWT_SECRET: "x".repeat(48),
      NODE_ENV: "test",
      GOOGLE_CLIENT_ID: "",
      PIXABAY_API_KEY: "",
    },
    stdio: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});

after(async () => {
  if (proc && proc.exitCode === null) {
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await exited;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

function client() {
  let cookie = "";
  return async (p, body) => {
    const res = await fetch(BASE + p, {
      method: body ? "POST" : "GET",
      headers: { ...(body && { "Content-Type": "application/json" }), ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
}

async function guest(name = "Tester") {
  const c = client();
  const r = await c("/api/auth/guest", { name });
  assert.equal(r.status, 201);
  return c;
}

test("guest can play without an account", async () => {
  const c = await guest("Budi");
  const me = await c("/api/auth/me");
  assert.equal(me.body.user.isGuest, true);
  assert.equal(me.body.user.name, "Budi");
  assert.equal((await c("/api/pet")).body.pet.coin, 50);
});

test("guest name is validated", async () => {
  const c = client();
  assert.equal((await c("/api/auth/guest", { name: "<script>" })).status, 422);
  assert.equal((await c("/api/auth/guest", { name: "a" })).status, 422);
  assert.equal((await c("/api/auth/guest", {})).status, 422);
});

test("register from guest keeps progress", async () => {
  const c = await guest("Siti");
  await c("/api/pet/feed", { food: "roti" });
  const r = await c("/api/auth/register", { email: "siti@test.dev", password: "password123" });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.isGuest, false);
  assert.equal(r.body.progressKept, true);
  assert.equal((await c("/api/pet")).body.pet.coin, 45);
});

test("login from guest switches to account and drops guest", async () => {
  const owner = client();
  await owner("/api/auth/register", { name: "Owner", email: "owner@test.dev", password: "password123" });

  const c = await guest("Temp");
  const r = await c("/api/auth/login", { email: "owner@test.dev", password: "password123" });
  assert.equal(r.status, 200);
  assert.equal(r.body.guestDiscarded, true);
  assert.equal(r.body.user.name, "Owner");
  assert.equal((await client()("/api/auth/login", { email: "owner@test.dev", password: "wrongpass1" })).status, 401);
});

test("cookie is httpOnly and protected routes need a session", async () => {
  const r = await client()("/api/auth/guest", { name: "Cookie" });
  assert.match(r.headers.get("set-cookie"), /HttpOnly/i);
  assert.equal((await client()("/api/pet")).status, 401);
});

test("prices come from the server", async () => {
  const c = await guest();
  const r = await c("/api/pet/feed", { food: "steak", cost: 0 });
  assert.equal(r.status, 400);
  assert.equal((await c("/api/pet/feed", { food: "__proto__" })).status, 422);
});

test("game answer is never exposed before the game ends", async () => {
  const c = await guest();
  const g = await c("/api/game/start", { type: "image" });
  assert.equal(g.status, 200);
  assert.equal(g.body.answer, undefined);
  assert.doesNotMatch(g.body.imageUrl, /car|house|bird|tree|flower|sun|moon/);
  assert.equal(g.body.credit, null);
  assert.equal((await c(g.body.imageUrl)).status, 200);
  assert.equal((await client()(g.body.imageUrl)).status, 401);

  const quit = await c("/api/game/end", { sessionId: g.body.sessionId });
  assert.equal(quit.body.answer, undefined);
});

test("wrong guesses are limited", async () => {
  const c = await guest();
  const g = await c("/api/game/start", { type: "word" });
  let last;
  for (let i = 0; i < 3; i++) last = await c("/api/game/guess", { sessionId: g.body.sessionId, answer: "zzzzz" });
  assert.equal(last.body.result, "lose");
  assert.equal((await c("/api/game/guess", { sessionId: g.body.sessionId, answer: "zzzzz" })).status, 400);
});

test("leaderboard: global shows registered players only, guest sees own rank", async () => {
  const anon = await client()("/api/leaderboard");
  assert.equal(anon.status, 200);
  assert.equal(anon.body.me, null);

  const c = await guest("Ghost");
  const lb = await c("/api/leaderboard");
  assert.equal(lb.body.me.isGuest, true);
  assert.equal(lb.body.me.onGlobal, false);
  assert.ok(lb.body.top.every((row) => row.name !== "Ghost"));
  assert.ok(lb.body.top.every((row) => !("email" in row)));
});

test("skins: cannot buy without coins, free skin can be equipped", async () => {
  const c = await guest("Skinny");
  const list = await c("/api/skins");
  assert.equal(list.body.equipped, "classic");
  assert.equal((await c("/api/skins/buy", { skinId: "angel" })).status, 400);
  assert.equal((await c("/api/skins/equip", { skinId: "angel" })).status, 400);
  assert.equal((await c("/api/skins/buy", { skinId: "__proto__" })).status, 422);
  assert.equal((await c("/api/skins/equip", { skinId: "classic" })).status, 200);
});

test("tic-tac-toe: server validates moves and plays back", async () => {
  const c = await guest("Xavier");
  const g = await c("/api/game/start", { type: "tictactoe" });
  assert.equal(g.status, 200);
  assert.equal(g.body.board.length, 9);
  const m = await c("/api/game/move", { sessionId: g.body.sessionId, cell: 4 });
  assert.equal(m.body.board[4], "X");
  assert.equal(m.body.board.filter((v) => v === "O").length, 1);
  assert.equal((await c("/api/game/move", { sessionId: g.body.sessionId, cell: 4 })).status, 400);
  assert.equal((await c("/api/game/move", { sessionId: g.body.sessionId, cell: 9 })).status, 422);
  assert.equal((await c("/api/game/move", { sessionId: g.body.sessionId, cell: "1" })).status, 422);
});

test("CSRF: non-JSON and foreign origin are rejected", async () => {
  const form = await fetch(`${BASE}/api/auth/login`, { method: "POST", body: new URLSearchParams({ email: "a" }) });
  assert.equal(form.status, 415);
  const evil = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: "{}",
  });
  assert.equal(evil.status, 403);
});

test("server files are not publicly served", async () => {
  for (const p of ["/server/server.js", "/server/storage/images/car.jpg", "/package.json", "/.env", "/server/storage/database/game.db"]) {
    assert.equal((await fetch(BASE + p)).status, 404, p);
  }
  assert.ok((await fetch(BASE + "/")).headers.get("content-security-policy"));
});
