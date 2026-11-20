import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { petMove, legalMoves } from "../server/services/chess.service.js";

test("pet always returns a legal move", () => {
  const chess = new Chess();
  for (let i = 0; i < 12 && !chess.isGameOver(); i++) {
    const moves = chess.moves({ verbose: true });
    chess.move(moves[i % moves.length]);
    if (chess.isGameOver()) break;
    const reply = petMove(chess.fen(), { depth: 1 });
    assert.ok(chess.moves({ verbose: true }).some((m) => m.from === reply.from && m.to === reply.to));
    chess.move(reply);
  }
});

test("pet takes a free queen", () => {
  const reply = petMove("4k3/8/8/3Q4/3r4/8/8/4K3 b - - 0 1", { depth: 2, mistakeRate: 0 });
  assert.equal(reply.to, "d5");
  assert.equal(reply.captured, "q");
});

test("pet never misses a mate in one, even when set to blunder", () => {
  const fen = "k7/8/8/8/8/1r6/r7/7K b - - 0 1";
  for (let i = 0; i < 5; i++) {
    const chess = new Chess(fen);
    chess.move(petMove(fen, { depth: 2, mistakeRate: 1 }));
    assert.ok(chess.isCheckmate());
  }
});

test("legal move map lists every origin square", () => {
  const map = legalMoves(new Chess());
  assert.equal(Object.keys(map).length, 10);
  assert.deepEqual(map.e2.sort(), ["e3", "e4"]);
});
