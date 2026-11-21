import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 5000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), "jm-social-"));
let proc;
const streams = [];

before(async () => {
  proc = spawn(process.execPath, ["server/server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_FILE: path.join(dir, "test.db"),
      JWT_SECRET: "y".repeat(48),
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
  for (const s of streams) s.abort();
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
  const call = async (p, body) => {
    const res = await fetch(BASE + p, {
      method: body ? "POST" : "GET",
      headers: { ...(body && { "Content-Type": "application/json" }), ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  // Opens the event stream and collects events so tests can wait for them.
  call.listen = async () => {
    const controller = new AbortController();
    streams.push(controller);
    const res = await fetch(`${BASE}/api/events`, { headers: { Cookie: cookie }, signal: controller.signal });
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const events = [];
    const waiters = [];
    (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            const event = raw.match(/^event: (.+)$/m)?.[1];
            const data = raw.match(/^data: (.+)$/m)?.[1];
            if (!event) continue;
            events.push({ event, data: JSON.parse(data) });
            for (const w of [...waiters]) w();
          }
        }
      } catch {}
    })();
    call.next = (name, timeoutMs = 3000) =>
      new Promise((resolve, reject) => {
        const check = () => {
          const i = events.findIndex((e) => e.event === name);
          if (i < 0) return false;
          const [found] = events.splice(i, 1);
          waiters.splice(waiters.indexOf(check), 1);
          clearTimeout(timer);
          resolve(found.data);
          return true;
        };
        const timer = setTimeout(() => reject(new Error(`no "${name}" event`)), timeoutMs);
        waiters.push(check);
        check();
      });
    call.close = () => controller.abort();
    await call.next("hello");
    return call;
  };
  return call;
}

let seq = 0;
async function registered(name) {
  const c = client();
  const r = await c("/api/auth/register", { name, email: `${name.toLowerCase()}${++seq}@test.dev`, password: "password123" });
  assert.equal(r.status, 201);
  c.user = r.body.user;
  return c;
}

async function guest(name) {
  const c = client();
  const r = await c("/api/auth/guest", { name });
  assert.equal(r.status, 201);
  c.user = r.body.user;
  return c;
}

test("every player has a UID; only registered players use friends", async () => {
  const g = await guest("Ghost");
  assert.match(g.user.uid, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.equal((await g("/api/friends")).status, 403);
  const a = await registered("Ana");
  assert.equal((await a("/api/friends/request", { uid: g.user.uid })).status, 400);
  assert.equal((await a("/api/friends/request", { uid: a.user.uid })).status, 400);
  assert.equal((await a("/api/friends/request", { uid: "BAD" })).status, 422);
});

test("friend request, accept and live presence", async () => {
  const a = await registered("Andi");
  const b = await registered("Bela");
  await b.listen();

  const req = await a("/api/friends/request", { uid: b.user.uid });
  assert.equal(req.body.status, "pending");
  assert.equal((await b.next("friends:request")).from.uid, a.user.uid);
  assert.equal((await a("/api/friends/request", { uid: b.user.uid })).status, 409);

  assert.equal((await b("/api/friends")).body.incoming[0].id, a.user.id);
  await b("/api/friends/respond", { userId: a.user.id, accept: true });
  const list = (await a("/api/friends")).body;
  assert.equal(list.friends[0].id, b.user.id);
  assert.equal(list.friends[0].status, "online");

  await a.listen();
  assert.deepEqual(await b.next("friends:presence"), { id: a.user.id, status: "online" });
  a.close();
  assert.deepEqual(await b.next("friends:presence"), { id: a.user.id, status: "offline" });
});

test("invite by UID works for guests; declining tells the sender", async () => {
  const a = await guest("Gita");
  const b = await guest("Hadi");
  await a.listen();
  await b.listen();
  assert.equal((await a("/api/match/invite", { type: "tictactoe", uid: "ZZZZZZZZ" })).status, 404);

  const sent = await a("/api/match/invite", { type: "tictactoe", uid: b.user.uid });
  assert.equal(sent.status, 200);
  const invite = await b.next("invite");
  assert.equal(invite.from.name, "Gita");
  assert.equal(invite.expiresInSec, 5);
  await b("/api/match/invite/respond", { inviteId: invite.id, accept: false });
  assert.equal((await a.next("invite:closed")).reason, "declined");
});

test("tic-tac-toe match: sides, turns, win and rewards", async () => {
  const a = await guest("Xena");
  const b = await guest("Omar");
  await a.listen();
  await b.listen();
  const { inviteId } = (await a("/api/match/invite", { type: "tictactoe", uid: b.user.uid })).body;
  await b.next("invite");
  const accepted = await b("/api/match/invite/respond", { inviteId, accept: true });
  const start = await a.next("match:start");
  assert.equal(start.id, accepted.body.match.id);
  assert.equal((await a("/api/match/invite", { type: "chess", uid: b.user.uid })).status, 409);

  const players = { X: start.mark === "X" ? a : b, O: start.mark === "X" ? b : a };
  const id = start.id;
  assert.equal((await players.O(`/api/match/${id}/move`, { cell: 0 })).status, 400);
  for (const [who, cell] of [["X", 0], ["O", 3], ["X", 1], ["O", 4]]) {
    const r = await players[who](`/api/match/${id}/move`, { cell });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.equal((await players.X(`/api/match/${id}/move`, { cell: 3 })).status, 400);
  const win = await players.X(`/api/match/${id}/move`, { cell: 2 });
  assert.equal(win.body.result, "win");
  assert.ok(win.body.reward.coin >= 100);
  assert.deepEqual(win.body.winLine, [0, 1, 2]);
  const loserEnd = await (players.O === a ? a : b).next("match:end");
  assert.equal(loserEnd.result, "lose");
  assert.equal(loserEnd.canAddFriend, false);
});

test("chess match via matchmaking, then resign", async () => {
  const a = await registered("Kasim");
  const b = await registered("Lulu");
  await a.listen();
  await b.listen();
  assert.equal((await a("/api/match/queue", { type: "chess" })).body.status, "waiting");
  const matched = await b("/api/match/queue", { type: "chess" });
  assert.equal(matched.body.status, "matched");
  const view = await a.next("match:start");
  assert.ok(["w", "b"].includes(view.color));
  assert.equal(view.canAddFriend, true);

  const white = view.color === "w" ? a : b;
  const black = view.color === "w" ? b : a;
  assert.equal((await black(`/api/match/${view.id}/move`, { from: "e7", to: "e5" })).status, 400);
  assert.equal((await white(`/api/match/${view.id}/move`, { from: "e2", to: "e5" })).status, 400);
  assert.equal((await white(`/api/match/${view.id}/move`, { from: "e2", to: "e4" })).body.lastMove.san, "e4");

  assert.equal((await white("/api/skins/equip", { skinId: "classic" })).status, 200);
  const changed = await black.next("match:player");
  assert.equal(changed.matchId, view.id);
  assert.equal(changed.player.skin, "classic");

  const resigned = await black(`/api/match/${view.id}/resign`, {});
  assert.equal(resigned.body.result, "lose");
  assert.equal(resigned.body.reason, "resign");
  assert.equal((await white(`/api/match/${view.id}`)).body.result, "win");
  assert.equal((await white("/api/match/current")).body.match, null);
});
