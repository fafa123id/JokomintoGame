import { test } from "node:test";
import assert from "node:assert/strict";
import { winnerOf, bestMove, petMove, PLAYER, PET } from "../server/services/tictactoe.service.js";

const parse = (rows) => rows.join("").split("").map((c) => (c === "." ? null : c));

test("detects winners and their line", () => {
  assert.deepEqual(winnerOf(parse(["XXX", "OO.", "..."])), { mark: PLAYER, line: [0, 1, 2] });
  assert.deepEqual(winnerOf(parse(["O.X", ".OX", "..O"])), { mark: PET, line: [0, 4, 8] });
  assert.equal(winnerOf(parse(["XOX", "XOO", "OXX"])), null);
});

test("pet takes a winning move", () => {
  assert.equal(bestMove(parse(["OO.", "XX.", "X.."])), 2);
});

test("pet blocks the player's winning move", () => {
  assert.equal(bestMove(parse(["XX.", ".O.", "..."])), 2);
});

function play(firstPlayerMove) {
  const board = Array(9).fill(null);
  board[firstPlayerMove] = PLAYER;
  let turn = PET;
  while (!winnerOf(board) && board.some((c) => !c)) {
    if (turn === PET) {
      board[petMove(board, 0)] = PET;
    } else {
      const empty = board.flatMap((c, i) => (c ? [] : [i]));
      board[empty[0]] = PLAYER;
    }
    turn = turn === PET ? PLAYER : PET;
  }
  return winnerOf(board)?.mark ?? "draw";
}

test("a perfect pet never loses", () => {
  for (let first = 0; first < 9; first++) assert.notEqual(play(first), PLAYER, `opening ${first}`);
});

test("mistake rate 1 makes random but legal moves", () => {
  const board = parse(["XO.", "...", "..."]);
  for (let i = 0; i < 50; i++) {
    const move = petMove([...board], 1);
    assert.ok(move >= 2 && move <= 8);
  }
});
