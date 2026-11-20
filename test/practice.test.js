import { test } from "node:test";
import assert from "node:assert/strict";
import { practiceStart, practiceCall, isLocalSession } from "../src/practice.js";

test("online-only games are refused offline", () => {
  assert.ok(practiceStart("image").error);
  assert.ok(practiceStart("chess").error);
});

test("word practice: guesses end the round without rewards", () => {
  const s = practiceStart("word");
  assert.ok(isLocalSession(s.sessionId));
  assert.equal(s.answer, undefined);
  const wrong = practiceCall("/api/game/guess", { sessionId: s.sessionId, answer: "zzzzz" });
  assert.equal(wrong.result, "wrong");
  practiceCall("/api/game/guess", { sessionId: s.sessionId, answer: "zzzzz" });
  const lose = practiceCall("/api/game/guess", { sessionId: s.sessionId, answer: "zzzzz" });
  assert.equal(lose.result, "lose");
  assert.deepEqual(lose.reward, { coin: 0, mood: 0, score: 0 });
  assert.ok(practiceCall("/api/game/guess", { sessionId: s.sessionId, answer: "x" }).error);
});

test("tic-tac-toe practice: Joko answers every move", () => {
  const s = practiceStart("tictactoe");
  const m = practiceCall("/api/game/move", { sessionId: s.sessionId, cell: 4 });
  assert.equal(m.board[4], "X");
  assert.equal(m.board.filter((v) => v === "O").length, 1);
  assert.ok(practiceCall("/api/game/move", { sessionId: s.sessionId, cell: 4 }).error);
});

test("memory practice: cards are locked during the preview", () => {
  const s = practiceStart("memory");
  assert.equal(s.preview.length, 16);
  assert.ok(practiceCall("/api/game/memory/flip", { sessionId: s.sessionId, index: 0 }).error);
});

test("simon practice: finishing needs the winning rounds", () => {
  const s = practiceStart("simon");
  assert.ok(practiceCall("/api/game/simon/finish", { sessionId: s.sessionId }).error);
  let sequence = s.sequence;
  for (let round = 0; round < 6; round++) {
    let res;
    for (const move of sequence) res = practiceCall("/api/game/simon/press", { sessionId: s.sessionId, move });
    sequence = res.sequence;
  }
  const done = practiceCall("/api/game/simon/finish", { sessionId: s.sessionId });
  assert.equal(done.outcome, "win");
  assert.equal(done.reward.coin, 0);
});
