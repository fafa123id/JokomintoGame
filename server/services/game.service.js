import crypto from "node:crypto";
import { transaction } from "../database/connection.js";
import { GameSession } from "../models/gameSession.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { Pet } from "../models/pet.model.js";
import { HttpError } from "../utils/httpError.js";
import { getCurrentPet, mutatePet, playBlocker } from "./pet.service.js";
import { randomWord } from "./word.service.js";
import { pickImagePuzzle, resolveImageFile, imageCredit } from "./image.service.js";
import { tileDetailWeights } from "./imageAnalysis.service.js";
import { renderTile, TILE_COUNT } from "./imageTile.service.js";
import {
  wordDifficulty,
  imageDifficulty,
  finalScore,
  scoreMultiplier,
  scoringRules,
  coinFactors,
  coinReward,
} from "./scoring.service.js";
import { initialState as ticTacToeState, previewRewards } from "./tictactoe.service.js";
import { initialState as chessState, chessView } from "./chess.service.js";
import { initialState as memoryState, memoryView } from "./memory.service.js";
import { initialState as simonState, simonView } from "./simon.service.js";
import { GAME, COIN } from "../config/game.js";

const IMAGE_TILES = TILE_COUNT;

const secondsLeft = (session) => Math.max(0, Math.ceil((session.expires_at - Date.now()) / 1000));

function initialWordReveal(word) {
  const revealed = [0];
  const total = Math.ceil(word.length * 0.5);
  while (revealed.length < total) {
    const i = crypto.randomInt(word.length);
    if (!revealed.includes(i)) revealed.push(i);
  }
  return revealed;
}

const evenTileWeights = () => Array(IMAGE_TILES).fill(1 / IMAGE_TILES);

function difficultyOf(session) {
  if (session.type === "word") return session.scoring;
  return imageDifficulty(session.scoring.tileWeights ?? evenTileWeights(), session.revealed);
}

function penaltiesOf(session) {
  return {
    elapsedSec: (Date.now() - session.started_at) / 1000,
    wrongGuesses: session.attempts,
    hintsUsed: session.type === "word" ? session.hints_used : 0,
  };
}

function coinContextOf(session) {
  return {
    difficulty: difficultyOf(session).difficulty ?? 0.5,
    recentWins: GameSession.countWinsSince(session.user_id, Date.now() - COIN.fatigueWindowMs),
    balance: getCurrentPet(session.user_id).coin,
  };
}

function pointsView(session) {
  const { base, visibility } = difficultyOf(session);
  const penalties = penaltiesOf(session);
  const { wrong, hints } = scoreMultiplier(penalties);
  const coinContext = coinContextOf(session);
  const coin = coinReward(coinContext, scoreMultiplier(penalties).total);
  return {
    base,
    current: finalScore(base, penalties).score,
    coinBonus: Math.round(coinFactors(coinContext).effectiveBonus * 100) / 100,
    coinCurrent: coin.coin,
    nonTimeFactor: Math.round(wrong * hints * 10_000) / 10_000,
    elapsedSec: Math.floor(penalties.elapsedSec),
    ...(visibility !== undefined && { visibility }),
    ...scoringRules(),
  };
}

function toView(session) {
  if (session.type === "chess") {
    return { sessionId: session.id, type: session.type, timeLeft: secondsLeft(session), ...chessView(session) };
  }
  if (session.type === "memory" || session.type === "simon") {
    const view = session.type === "memory" ? memoryView(session) : simonView(session);
    return { sessionId: session.id, type: session.type, timeLeft: secondsLeft(session), ...view };
  }
  if (session.type === "tictactoe") {
    return {
      sessionId: session.id,
      type: session.type,
      timeLeft: secondsLeft(session),
      board: session.state.board,
      rewards: previewRewards(session.user_id),
    };
  }
  const base = {
    sessionId: session.id,
    type: session.type,
    timeLeft: secondsLeft(session),
    nextHintCost: hintCostFor(session.hints_used),
    points: pointsView(session),
  };
  if (session.type === "word") {
    const masked = session.answer.split("").map((c, i) => (session.revealed.includes(i) ? c : "_"));
    return { ...base, masked };
  }
  return {
    ...base,
    tileUrl: `/api/game/image/${session.id}/tile`,
    revealed: session.revealed,
    credit: imageCredit(session.image_file),
  };
}

// Each hint in a round costs more: 80, 100, 120, ...
export const hintCostFor = (hintsUsed) => GAME.hintCost.base + GAME.hintCost.step * hintsUsed;

function findActive(userId, sessionId) {
  const session = GameSession.find(sessionId, userId);
  if (!session || session.finished) throw HttpError.badRequest("Game session is not active");
  const expired = Date.now() > session.expires_at;
  if (expired) session.endedNow = GameSession.finish(session.id);
  return { session, expired };
}

// A finished round (lost or timed out) still cheers Joko up a little.
function loseMood(userId, session) {
  const gain = GAME.mood[session.type]?.lose ?? 0;
  const pet = mutatePet(userId, (p) => {
    p.mood += gain;
  });
  return { pet, gain };
}

function timeoutResult(userId, session) {
  const { pet, gain } = session.endedNow ? loseMood(userId, session) : { pet: getCurrentPet(userId), gain: 0 };
  return { result: "timeout", answer: session.answer, reward: { mood: gain }, pet: Pet.toPublic(pet) };
}

function isCorrect(session, guess) {
  const answer = session.answer.toLowerCase();
  if (guess === answer) return true;
  return session.type === "image" && (guess === `${answer}s` || guess === `${answer}es`);
}

export async function startGame(userId, type) {
  const blocker = playBlocker(getCurrentPet(userId));
  if (blocker) throw HttpError.badRequest(blocker);

  let puzzle;
  if (type === "word") {
    const answer = await randomWord();
    const revealed = initialWordReveal(answer);
    const { base, difficulty, factors } = wordDifficulty(answer, revealed);
    puzzle = { answer, revealed, scoring: { base, difficulty, factors } };
  } else if (type === "chess") {
    puzzle = { answer: "-", state: chessState() };
  } else if (type === "tictactoe") {
    puzzle = { answer: "-", state: ticTacToeState() };
  } else if (type === "memory") {
    puzzle = { answer: "-", state: memoryState() };
  } else if (type === "simon") {
    puzzle = { answer: "-", state: simonState() };
  } else {
    const image = await pickImagePuzzle();
    const tileWeights = await tileDetailWeights(resolveImageFile(image.imageFile));
    puzzle = { ...image, scoring: { tileWeights } };
  }

  return transaction(() => {
    const pet = mutatePet(userId, (p) => {
      const blocker = playBlocker(p);
      if (blocker) throw HttpError.badRequest(blocker);
      p.hunger += GAME.playCost.hunger;
      p.hygiene -= GAME.playCost.hygiene;
    });
    GameSession.closeActiveFor(userId);
    const session = GameSession.create({
      ...puzzle,
      id: crypto.randomUUID(),
      userId,
      type,
      expiresAt: Date.now() + GAME.timeSec[type] * 1000,
    });
    PlayerStat.recordGamePlayed(userId);
    return { ...toView(session), pet: Pet.toPublic(pet) };
  });
}

export function useHint(userId, sessionId) {
  return transaction(() => {
    const { session, expired } = findActive(userId, sessionId);
    if (expired) return timeoutResult(userId, session);

    const total = session.type === "word" ? session.answer.length : IMAGE_TILES;
    const hidden = [...Array(total).keys()].filter((i) => !session.revealed.includes(i));
    if (hidden.length === 0) throw HttpError.badRequest("Nothing left to reveal");

    const cost = hintCostFor(session.hints_used);
    const pet = mutatePet(userId, (p) => {
      if (p.coin < cost) throw HttpError.badRequest(`Not enough coins! Need ${cost} coins`);
      p.coin -= cost;
    });
    session.revealed.push(hidden[crypto.randomInt(hidden.length)]);
    session.hints_used += 1;
    GameSession.revealMore(session.id, session.revealed);
    return { ...toView(session), hintPaid: cost, pet: Pet.toPublic(pet) };
  });
}

export function submitGuess(userId, sessionId, answer) {
  return transaction(() => {
    const { session, expired } = findActive(userId, sessionId);
    if (expired) return timeoutResult(userId, session);

    if (!isCorrect(session, answer)) {
      const attempts = GameSession.addAttempt(session.id);
      if (attempts >= GAME.maxWrongGuesses) {
        GameSession.finish(session.id);
        const { pet, gain } = loseMood(userId, session);
        return { result: "lose", answer: session.answer, reward: { mood: gain }, pet: Pet.toPublic(pet) };
      }
      const pet = getCurrentPet(userId);
      session.attempts = attempts;
      return {
        result: "wrong",
        attemptsLeft: GAME.maxWrongGuesses - attempts,
        points: pointsView(session),
        pet: Pet.toPublic(pet),
      };
    }

    const { base, visibility } = difficultyOf(session);
    const penalties = penaltiesOf(session);
    const result = finalScore(base, penalties);
    const score = result.score;
    const coin = coinReward(coinContextOf(session), result.multiplier);
    if (!GameSession.finish(session.id, score)) throw HttpError.badRequest("Game session is not active");
    const moodGain = GAME.mood[session.type].win;
    const pet = mutatePet(userId, (p) => {
      p.coin += coin.coin;
      p.mood += moodGain;
    });
    PlayerStat.recordWin(userId, score);
    return {
      result: "win",
      reward: { coin: coin.coin, mood: moodGain, score },
      scoring: { ...result, ...(visibility !== undefined && { visibility }) },
      coinBreakdown: coin.breakdown,
      pet: Pet.toPublic(pet),
    };
  });
}

export function endGame(userId, sessionId) {
  return transaction(() => {
    const session = GameSession.find(sessionId, userId);
    if (!session) throw HttpError.notFound("Unknown session");
    const expired = Date.now() > session.expires_at;
    const endedNow = GameSession.finish(session.id);
    if (!expired) return { result: "quit" };
    const gain = endedNow && GAME.mood[session.type] ? loseMood(userId, session).gain : 0;
    return { result: "timeout", answer: session.answer, reward: { mood: gain } };
  });
}

// Hidden tiles stay on the server until they are revealed or the round is over.
export async function gameImageTile(userId, sessionId, index) {
  const session = GameSession.find(sessionId, userId);
  const file = session?.type === "image" ? resolveImageFile(session.image_file) : null;
  if (!file || !Number.isInteger(index) || index < 0 || index >= IMAGE_TILES) throw HttpError.notFound();
  const over = session.finished || Date.now() > session.expires_at;
  if (!over && !session.revealed.includes(index)) throw HttpError.forbidden("Tile is still hidden");
  return renderTile(file, index);
}
