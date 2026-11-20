import crypto from "node:crypto";
import { Chess } from "chess.js";
import { transaction } from "../database/connection.js";
import { GameSession } from "../models/gameSession.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { Pet } from "../models/pet.model.js";
import { HttpError } from "../utils/httpError.js";
import { getCurrentPet, mutatePet } from "./pet.service.js";
import { baseFromDifficulty, coinReward, coinFactors } from "./scoring.service.js";
import { CHESS, COIN } from "../config/game.js";

// The player is white, Joko (the pet) plays black.
const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100_000;

function centerBonus(type, file, rank) {
  if (type === "k" || type === "q") return 0;
  const distance = Math.max(Math.abs(file - 3.5), Math.abs(rank - 3.5));
  return Math.round((3.5 - distance) * (type === "p" ? 6 : 8));
}

// Positive values favour black.
function evaluate(chess) {
  let score = 0;
  chess.board().forEach((row, rank) =>
    row.forEach((square, file) => {
      if (!square) return;
      const value = PIECE_VALUE[square.type] + centerBonus(square.type, file, rank);
      score += square.color === "b" ? value : -value;
    })
  );
  return score;
}

function orderedMoves(chess) {
  return chess
    .moves({ verbose: true })
    .sort((a, b) => (b.captured ? PIECE_VALUE[b.captured] : 0) - (a.captured ? PIECE_VALUE[a.captured] : 0));
}

function negamax(chess, depth, alpha, beta) {
  const sign = chess.turn() === "b" ? 1 : -1;
  if (chess.isCheckmate()) return -MATE - depth;
  if (chess.isDraw()) return 0;
  if (depth === 0) return sign * evaluate(chess);

  let best = -Infinity;
  for (const move of orderedMoves(chess)) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function petMove(fen, { depth = CHESS.searchDepth, mistakeRate = CHESS.mistakeRate } = {}) {
  const chess = new Chess(fen);
  const scored = orderedMoves(chess).map((move) => {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -Infinity, Infinity);
    chess.undo();
    return { move, score };
  });
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);

  // Never miss a mate; otherwise occasionally pick a slightly weaker move so Joko stays beatable.
  if (scored[0].score < MATE / 2 && crypto.randomInt(1000) < mistakeRate * 1000) {
    const pool = scored.slice(0, Math.min(3, scored.length));
    return pool[crypto.randomInt(pool.length)].move;
  }
  const best = scored.filter((s) => s.score >= scored[0].score - 15);
  return best[crypto.randomInt(best.length)].move;
}

export function legalMoves(chess) {
  const map = {};
  for (const move of chess.moves({ verbose: true })) (map[move.from] ??= []).push(move.to);
  return map;
}

const describe = (move) =>
  move && { from: move.from, to: move.to, san: move.san, captured: move.captured ?? null, promotion: move.promotion ?? null, flags: move.flags };

function outcomeOf(chess) {
  if (chess.isCheckmate()) return chess.turn() === "b" ? "win" : "lose";
  if (chess.isDraw()) return "draw";
  return "playing";
}

function coinContext(userId) {
  return {
    difficulty: CHESS.difficulty,
    recentWins: GameSession.countWinsSince(userId, Date.now() - COIN.fatigueWindowMs),
    balance: getCurrentPet(userId).coin,
  };
}

export function initialState() {
  return { fen: new Chess().fen(), moves: 0 };
}

export function chessView(session) {
  const chess = new Chess(session.state.fen);
  return {
    fen: chess.fen(),
    legal: legalMoves(chess),
    check: chess.inCheck(),
    rewards: {
      maxScore: baseFromDifficulty(CHESS.difficulty),
      maxCoin: COIN.base + Math.round(coinFactors(coinContext(session.user_id)).effectiveBonus),
    },
  };
}

function settle(userId, session, moves, outcome) {
  const base = baseFromDifficulty(CHESS.difficulty);
  const extra = Math.max(0, moves - CHESS.parMoves);
  const performance = Math.max(CHESS.minPerformance, 1 - CHESS.perExtraMovePenalty * extra);
  const ratio = outcome === "win" ? 1 : outcome === "draw" ? CHESS.drawRatio : 0;

  const score = Math.round(base * performance * ratio);
  const coin = ratio === 0 ? 0 : Math.round(coinReward(coinContext(userId), performance).coin * ratio);
  if (!GameSession.finish(session.id, score)) throw HttpError.badRequest("Game session is not active");

  const pet = mutatePet(userId, (p) => {
    p.coin += coin;
    p.mood += CHESS.mood[outcome];
  });
  if (outcome === "win") PlayerStat.recordWin(userId, score);
  else if (score > 0) PlayerStat.addScore(userId, score);
  return { pet, reward: { coin, mood: CHESS.mood[outcome], score, performance } };
}

export function playChessMove(userId, sessionId, { from, to, promotion = "q" }) {
  return transaction(() => {
    const session = GameSession.find(sessionId, userId);
    if (!session || session.type !== "chess" || session.finished) throw HttpError.badRequest("Game session is not active");
    if (Date.now() > session.expires_at) {
      GameSession.finish(session.id);
      return { status: "timeout", fen: session.state.fen, pet: Pet.toPublic(getCurrentPet(userId)) };
    }

    const chess = new Chess(session.state.fen);
    if (chess.turn() !== "w") throw HttpError.badRequest("It's not your turn");
    let playerMove;
    try {
      playerMove = chess.move({ from, to, promotion });
    } catch {
      throw HttpError.badRequest("That move isn't allowed");
    }

    const moves = (session.state.moves ?? 0) + 1;
    let outcome = outcomeOf(chess);
    let pet = null;
    if (outcome === "playing") {
      pet = chess.move(petMove(chess.fen()));
      outcome = outcomeOf(chess);
    }

    GameSession.setState(session.id, { fen: chess.fen(), moves });
    const result = {
      status: outcome,
      fen: chess.fen(),
      playerMove: describe(playerMove),
      petMove: describe(pet),
      check: chess.inCheck(),
      legal: outcome === "playing" ? legalMoves(chess) : {},
    };
    if (outcome === "playing") return result;

    const settled = settle(userId, session, moves, outcome);
    return { ...result, reward: settled.reward, pet: Pet.toPublic(settled.pet) };
  });
}
