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
  assert.doesNotMatch(g.body.tileUrl, /car|house|bird|tree|flower|sun|moon/);
  assert.equal(g.body.credit, null);
  const open = g.body.revealed[0];
  const hidden = [...Array(9).keys()].find((i) => !g.body.revealed.includes(i));
  assert.equal((await c(`${g.body.tileUrl}/${open}`)).status, 200);
  assert.equal((await c(`${g.body.tileUrl}/${hidden}`)).status, 403);
  assert.equal((await c(`${g.body.tileUrl}/9`)).status, 404);
  assert.equal((await client()(`${g.body.tileUrl}/${open}`)).status, 401);

  const quit = await c("/api/game/end", { sessionId: g.body.sessionId });
  assert.equal(quit.body.answer, undefined);
  assert.equal((await c(`${g.body.tileUrl}/${hidden}`)).status, 200);
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

test("chess: server validates moves and Joko replies", async () => {
  const c = await guest("Kasparov");
  const g = await c("/api/game/start", { type: "chess" });
  assert.equal(g.status, 200);
  assert.ok(g.body.fen.startsWith("rnbqkbnr"));
  const m = await c("/api/game/chess/move", { sessionId: g.body.sessionId, from: "e2", to: "e4" });
  assert.equal(m.body.status, "playing");
  assert.equal(m.body.playerMove.san, "e4");
  assert.ok(m.body.petMove?.san);
  assert.equal((await c("/api/game/chess/move", { sessionId: g.body.sessionId, from: "e4", to: "e8" })).status, 400);
  assert.equal((await c("/api/game/chess/move", { sessionId: g.body.sessionId, from: "z9", to: "e8" })).status, 422);
});

test("memory: faces stay hidden until flipped and a solved board pays out", async () => {
  const c = await guest("Memo");
  const g = await c("/api/game/start", { type: "memory" });
  assert.equal(g.status, 200);
  assert.equal(g.body.cards, 16);
  assert.equal(g.body.deck, undefined);
  assert.doesNotMatch(JSON.stringify(g.body), /pizza|steak|roti/);
  const flip = (index) => c("/api/game/memory/flip", { sessionId: g.body.sessionId, index });

  const first = await flip(0);
  assert.equal(first.body.status, "open");
  assert.ok(first.body.face);
  assert.equal((await flip(0)).status, 400);
  assert.equal((await flip(16)).status, 422);

  const known = new Map([[0, first.body.face]]);
  const matched = new Set();
  let open = 0;
  let last = first.body;
  const unknown = () => [...Array(16).keys()].find((i) => !known.has(i) && i !== open);
  const partnerOf = (index) => [...known].find(([i, f]) => i !== index && !matched.has(i) && f === known.get(index))?.[0];
  for (let guard = 0; last.status !== "win"; guard++) {
    assert.ok(guard < 100);
    let target;
    if (open === null) {
      const ready = [...known.keys()].find((i) => !matched.has(i) && partnerOf(i) !== undefined);
      target = ready ?? unknown();
    } else {
      target = partnerOf(open) ?? unknown();
    }
    const res = await flip(target);
    assert.equal(res.status, 200);
    last = res.body;
    known.set(target, last.face);
    if (last.status === "open") {
      open = target;
      continue;
    }
    if (last.match) last.pair.forEach((i) => matched.add(i));
    open = null;
  }
  assert.ok(last.reward.coin >= 100);
  assert.ok(last.reward.score > 0);
  assert.equal(last.reward.mood, 25);
});

test("simon: the sequence grows on success and a wrong move ends the game", async () => {
  const c = await guest("Simone");
  const g = await c("/api/game/start", { type: "simon" });
  assert.equal(g.status, 200);
  assert.equal(g.body.sequence.length, 2);
  const press = (move) => c("/api/game/simon/press", { sessionId: g.body.sessionId, move });

  let sequence = g.body.sequence;
  for (let round = 0; round < 6; round++) {
    let res;
    for (const move of sequence) res = await press(move);
    assert.equal(res.body.status, "round");
    assert.equal(res.body.sequence.length, sequence.length + 1);
    sequence = res.body.sequence;
  }
  const wrong = (sequence[0] + 1) % 4;
  const over = await press(wrong);
  assert.equal(over.body.status, "over");
  assert.equal(over.body.outcome, "win");
  assert.equal(over.body.expected, sequence[0]);
  assert.ok(over.body.reward.coin >= 100);
  assert.equal((await press(0)).status, 400);
  assert.equal((await c("/api/game/simon/press", { sessionId: g.body.sessionId, move: 4 })).status, 422);
});

test("hint cost escalates within a round", async () => {
  const c = await guest("Hinter");
  const g = await c("/api/game/start", { type: "word" });
  assert.equal(g.body.nextHintCost, 80);
});

test("playing costs 1 hunger and 1 hygiene", async () => {
  const c = await guest("Player");
  const g = await c("/api/game/start", { type: "word" });
  assert.equal(g.body.pet.hunger, 1);
  assert.equal(g.body.pet.hygiene, 99);
});

test("petting raises mood but is rate limited", async () => {
  const c = await guest("Purr");
  const first = await c("/api/pet/stroke", {});
  assert.equal(first.status, 200);
  const second = await c("/api/pet/stroke", {});
  assert.equal(second.body.gained, 0);
});

test("push subscriptions only accept real push services", async () => {
  const c = await guest("Pushy");
  const evil = await c("/api/push/subscribe", {
    subscription: { endpoint: "https://169.254.169.254/latest", keys: { p256dh: "abc", auth: "def" } },
  });
  assert.equal(evil.status, 400);
  assert.equal((await c("/api/push/subscribe", { subscription: { endpoint: "http://x" } })).status, 422);
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
