import crypto from "node:crypto";
import { transaction } from "../database/connection.js";
import { GameSession } from "../models/gameSession.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { Pet } from "../models/pet.model.js";
import { HttpError } from "../utils/httpError.js";
import { getCurrentPet, mutatePet } from "./pet.service.js";
import { baseFromDifficulty, coinReward, coinFactors } from "./scoring.service.js";
import { TICTACTOE, COIN } from "../config/game.js";

export const PLAYER = "X";
export const PET = "O";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function winnerOf(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { mark: board[a], line };
  }
  return null;
}

const emptyCells = (board) => board.flatMap((cell, i) => (cell ? [] : [i]));

function minimax(board, turn, depth) {
  const win = winnerOf(board);
  if (win) return win.mark === PET ? 10 - depth : depth - 10;
  const empty = emptyCells(board);
  if (empty.length === 0) return 0;

  const scores = empty.map((i) => {
    board[i] = turn;
    const score = minimax(board, turn === PET ? PLAYER : PET, depth + 1);
    board[i] = null;
    return score;
  });
  return turn === PET ? Math.max(...scores) : Math.min(...scores);
}

export function bestMove(board) {
  let best = { cell: null, score: -Infinity };
  for (const cell of emptyCells(board)) {
    board[cell] = PET;
    const score = minimax(board, PLAYER, 1);
    board[cell] = null;
    if (score > best.score) best = { cell, score };
  }
  return best.cell;
}

// Plays optimally most of the time; occasionally slips so the pet stays beatable.
export function petMove(board, mistakeRate = TICTACTOE.mistakeRate) {
  const empty = emptyCells(board);
  if (empty.length === 0) return null;
  if (crypto.randomInt(1000) < mistakeRate * 1000) return empty[crypto.randomInt(empty.length)];
  return bestMove(board);
}

function statusOf(board) {
  const win = winnerOf(board);
  if (win) return { status: win.mark === PLAYER ? "win" : "lose", winLine: win.line };
  if (emptyCells(board).length === 0) return { status: "draw", winLine: null };
  return { status: "playing", winLine: null };
}

function performanceOf(board) {
  const playerMoves = board.filter((c) => c === PLAYER).length;
  const extra = Math.max(0, playerMoves - 3);
  return Math.max(TICTACTOE.minPerformance, 1 - TICTACTOE.perExtraMovePenalty * extra);
}

function coinContext(userId) {
  return {
    difficulty: TICTACTOE.difficulty,
    recentWins: GameSession.countWinsSince(userId, Date.now() - COIN.fatigueWindowMs),
    balance: getCurrentPet(userId).coin,
  };
}

export function initialState() {
  return { board: Array(9).fill(null) };
}

export function previewRewards(userId) {
  return {
    maxScore: baseFromDifficulty(TICTACTOE.difficulty),
    maxCoin: Math.round(coinFactors(coinContext(userId)).effectiveBase),
  };
}

function settle(userId, session, board, outcome) {
  const base = baseFromDifficulty(TICTACTOE.difficulty);
  const performance = performanceOf(board);
  const ratio = outcome === "win" ? 1 : outcome === "draw" ? TICTACTOE.drawRatio : 0;

  const score = Math.round(base * performance * ratio);
  const coin = ratio === 0 ? 0 : Math.max(COIN.min, Math.round(coinReward(coinContext(userId), performance).coin * ratio));
  if (!GameSession.finish(session.id, score)) throw HttpError.badRequest("Game session is not active");

  const pet = mutatePet(userId, (p) => {
    p.coin += coin;
    p.mood += TICTACTOE.mood[outcome];
  });
  if (outcome === "win") PlayerStat.recordWin(userId, score);
  else if (score > 0) PlayerStat.addScore(userId, score);

  return { pet, reward: { coin, mood: TICTACTOE.mood[outcome], score, performance } };
}

export function playMove(userId, sessionId, cell) {
  return transaction(() => {
    const session = GameSession.find(sessionId, userId);
    if (!session || session.type !== "tictactoe" || session.finished) {
      throw HttpError.badRequest("Game session is not active");
    }
    if (Date.now() > session.expires_at) {
      GameSession.finish(session.id);
      return { status: "timeout", board: session.state.board, pet: Pet.toPublic(getCurrentPet(userId)) };
    }

    const board = [...session.state.board];
    if (board[cell]) throw HttpError.badRequest("That cell is already taken");
    board[cell] = PLAYER;

    let result = statusOf(board);
    let petCell = null;
    if (result.status === "playing") {
      petCell = petMove(board);
      board[petCell] = PET;
      result = statusOf(board);
    }

    GameSession.setState(session.id, { board });

    if (result.status === "playing") {
      return { status: "playing", board, playerCell: cell, petCell };
    }

    const { pet, reward } = settle(userId, session, board, result.status);
    return { ...result, board, playerCell: cell, petCell, reward, pet: Pet.toPublic(pet) };
  });
}
